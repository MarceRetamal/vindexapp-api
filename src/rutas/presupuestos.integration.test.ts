// Test de integración de la ruta de presupuestos, montada con requireAuth
// (JWKS de prueba, sin red). La parte no trivial es /firmar: dos caminos
// distintos según si el presupuesto ya tenía cliente_id (cliente existente)
// o solo contacto_nombre (potencial cliente, se da de alta recién acá).
import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { env } from '../../test/env';
import { crearClienteDePrueba, crearEstudioDePrueba, crearExpedienteDePrueba } from '../../test/fixtures';
import { crearAppAutenticada, crearUsuarioAutenticado } from '../../test/auth';
import type { Env } from '../tipos';
import { presupuestosRouter } from './presupuestos';

let app: Hono<Env>;

async function post(path: string, body: unknown, token: string) {
  return app.request(
    path,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cf-Access-Jwt-Assertion': token },
      body: JSON.stringify(body),
    },
    env
  );
}

async function patch(path: string, body: unknown, token: string) {
  return app.request(
    path,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Cf-Access-Jwt-Assertion': token },
      body: JSON.stringify(body),
    },
    env
  );
}

async function del(path: string, token: string) {
  return app.request(path, { method: 'DELETE', headers: { 'Cf-Access-Jwt-Assertion': token } }, env);
}

async function get(path: string, token?: string) {
  return app.request(path, token ? { headers: { 'Cf-Access-Jwt-Assertion': token } } : {}, env);
}

async function crearPresupuestoConCliente(token: string, clienteId: string) {
  const res = await post('/', { cliente_id: clienteId, concepto: 'Honorarios iniciales', monto: 50000 }, token);
  return res.json<{ id: string }>();
}

async function crearPresupuestoDePotencialCliente(token: string) {
  const res = await post('/', {
    contacto_nombre: 'Juan Contacto',
    contacto_telefono: '2211234567',
    concepto: 'Consulta inicial',
    monto: 20000,
  }, token);
  return res.json<{ id: string }>();
}

beforeEach(async () => {
  app = await crearAppAutenticada(presupuestosRouter);
});

describe('POST /api/presupuestos', () => {
  it('crea un presupuesto en borrador con cliente_id existente', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const clienteId = await crearClienteDePrueba(env.DB, estudioId);

    const res = await post('/', { cliente_id: clienteId, concepto: 'Honorarios iniciales', monto: 50000 }, token);

    expect(res.status).toBe(201);
    const body = await res.json<{ estado: string }>();
    expect(body.estado).toBe('borrador');
  });

  it('crea un presupuesto para un potencial cliente vía contacto_nombre', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const res = await post('/', { contacto_nombre: 'Juan Contacto', concepto: 'Consulta inicial', monto: 20000 }, token);
    expect(res.status).toBe(201);
  });

  it('rechaza si falta concepto o monto', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const res = await post('/', { concepto: 'X' }, token);
    expect(res.status).toBe(400);
  });

  it('rechaza si no viene ni cliente_id ni contacto_nombre', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const res = await post('/', { concepto: 'Honorarios', monto: 1000 }, token);
    expect(res.status).toBe(400);
  });

  it('devuelve 404 si el cliente_id pertenece a otro estudio', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const otroEstudioId = await crearEstudioDePrueba(env.DB);
    const clienteDeOtroEstudio = await crearClienteDePrueba(env.DB, otroEstudioId);

    const res = await post('/', { cliente_id: clienteDeOtroEstudio, concepto: 'X', monto: 1000 }, token);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/presupuestos', () => {
  it('exige autenticación', async () => {
    const res = await get('/');
    expect(res.status).toBe(401);
  });

  it('devuelve solo los presupuestos del estudio del usuario autenticado', async () => {
    const estudioA = await crearEstudioDePrueba(env.DB);
    const estudioB = await crearEstudioDePrueba(env.DB);
    const tokenA = await crearUsuarioAutenticado(env.DB, estudioA);
    const tokenB = await crearUsuarioAutenticado(env.DB, estudioB);
    await crearPresupuestoDePotencialCliente(tokenA);
    await crearPresupuestoDePotencialCliente(tokenB);

    const res = await get('/', tokenA);
    const presupuestos = await res.json<unknown[]>();
    expect(presupuestos).toHaveLength(1);
  });
});

describe('PATCH /api/presupuestos/:id/estado', () => {
  it('acepta una transición válida', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const { id } = await crearPresupuestoDePotencialCliente(token);

    const res = await patch(`/${id}/estado`, { estado: 'enviado' }, token);
    expect(res.status).toBe(200);
    const body = await res.json<{ estado: string }>();
    expect(body.estado).toBe('enviado');
  });

  it('rechaza "firmado" — esa transición pasa por /firmar', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const { id } = await crearPresupuestoDePotencialCliente(token);

    const res = await patch(`/${id}/estado`, { estado: 'firmado' }, token);
    expect(res.status).toBe(400);
  });

  it('devuelve 404 si el presupuesto es de otro estudio', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const { id } = await crearPresupuestoDePotencialCliente(token);

    const otroEstudioId = await crearEstudioDePrueba(env.DB);
    const otroToken = await crearUsuarioAutenticado(env.DB, otroEstudioId);

    const res = await patch(`/${id}/estado`, { estado: 'enviado' }, otroToken);
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/presupuestos/:id/firmar', () => {
  it('devuelve 404 si el presupuesto no existe', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const res = await patch('/no-existe/firmar', { expediente_id: 'x' }, token);
    expect(res.status).toBe(404);
  });

  it('devuelve 400 si falta expediente_id', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const { id } = await crearPresupuestoDePotencialCliente(token);
    const res = await patch(`/${id}/firmar`, {}, token);
    expect(res.status).toBe(400);
  });

  it('devuelve 404 si el expediente no existe o es de otro estudio', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const clienteId = await crearClienteDePrueba(env.DB, estudioId);
    const { id } = await crearPresupuestoConCliente(token, clienteId);

    const otroEstudioId = await crearEstudioDePrueba(env.DB);
    const clienteDeOtroEstudio = await crearClienteDePrueba(env.DB, otroEstudioId);
    const expedienteDeOtroEstudio = await crearExpedienteDePrueba(env.DB, otroEstudioId, clienteDeOtroEstudio);

    const res = await patch(`/${id}/firmar`, { expediente_id: expedienteDeOtroEstudio }, token);
    expect(res.status).toBe(404);
  });

  it('firma directo cuando el presupuesto ya tenía cliente_id (no exige nombre/apellido)', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const clienteId = await crearClienteDePrueba(env.DB, estudioId);
    const expedienteId = await crearExpedienteDePrueba(env.DB, estudioId, clienteId);
    const { id } = await crearPresupuestoConCliente(token, clienteId);

    const res = await patch(`/${id}/firmar`, { expediente_id: expedienteId }, token);

    expect(res.status).toBe(200);
    const body = await res.json<{ estado: string; cliente_id: string; expediente_id: string }>();
    expect(body.estado).toBe('firmado');
    expect(body.cliente_id).toBe(clienteId);
    expect(body.expediente_id).toBe(expedienteId);
  });

  it('exige nombre y apellido para dar de alta al potencial cliente', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const clienteDummy = await crearClienteDePrueba(env.DB, estudioId);
    const expedienteId = await crearExpedienteDePrueba(env.DB, estudioId, clienteDummy);
    const { id } = await crearPresupuestoDePotencialCliente(token);

    const res = await patch(`/${id}/firmar`, { expediente_id: expedienteId }, token);
    expect(res.status).toBe(400);
  });

  it('da de alta al cliente potencial y firma, cuando vienen nombre y apellido', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const clienteDummy = await crearClienteDePrueba(env.DB, estudioId);
    const expedienteId = await crearExpedienteDePrueba(env.DB, estudioId, clienteDummy);
    const { id } = await crearPresupuestoDePotencialCliente(token);

    const res = await patch(`/${id}/firmar`, {
      expediente_id: expedienteId,
      nombre: 'Juan',
      apellido: 'Contacto',
    }, token);

    expect(res.status).toBe(200);
    const body = await res.json<{ estado: string; cliente_id: string }>();
    expect(body.estado).toBe('firmado');
    expect(body.cliente_id).toBeTruthy();

    const clienteCreado = await env.DB.prepare('SELECT nombre, apellido, telefono_fijo FROM clientes WHERE id = ?')
      .bind(body.cliente_id)
      .first<{ nombre: string; apellido: string; telefono_fijo: string }>();
    expect(clienteCreado?.nombre).toBe('Juan');
    expect(clienteCreado?.apellido).toBe('Contacto');
    expect(clienteCreado?.telefono_fijo).toBe('2211234567');
  });

  it('devuelve 409 si ya está firmado', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const clienteId = await crearClienteDePrueba(env.DB, estudioId);
    const expedienteId = await crearExpedienteDePrueba(env.DB, estudioId, clienteId);
    const { id } = await crearPresupuestoConCliente(token, clienteId);
    await patch(`/${id}/firmar`, { expediente_id: expedienteId }, token);

    const res = await patch(`/${id}/firmar`, { expediente_id: expedienteId }, token);
    expect(res.status).toBe(409);
  });
});

describe('PATCH /api/presupuestos/:id', () => {
  it('actualiza solo los campos presentes en el body', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const { id } = await crearPresupuestoDePotencialCliente(token);

    const res = await patch(`/${id}`, { monto: 30000 }, token);
    expect(res.status).toBe(200);
    const body = await res.json<{ monto: number; concepto: string }>();
    expect(body.monto).toBe(30000);
    expect(body.concepto).toBe('Consulta inicial');
  });

  it('devuelve 404 si no existe', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const res = await patch('/no-existe', { monto: 1 }, token);
    expect(res.status).toBe(404);
  });

  it('devuelve 400 si el body no trae ningún campo', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const { id } = await crearPresupuestoDePotencialCliente(token);
    const res = await patch(`/${id}`, {}, token);
    expect(res.status).toBe(400);
  });

  it('devuelve 409 si ya está firmado', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const clienteId = await crearClienteDePrueba(env.DB, estudioId);
    const expedienteId = await crearExpedienteDePrueba(env.DB, estudioId, clienteId);
    const { id } = await crearPresupuestoConCliente(token, clienteId);
    await patch(`/${id}/firmar`, { expediente_id: expedienteId }, token);

    const res = await patch(`/${id}`, { monto: 1 }, token);
    expect(res.status).toBe(409);
  });
});

describe('DELETE /api/presupuestos/:id', () => {
  it('elimina un presupuesto no firmado', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const { id } = await crearPresupuestoDePotencialCliente(token);

    const res = await del(`/${id}`, token);
    expect(res.status).toBe(200);
    const body = await res.json<{ eliminado: boolean }>();
    expect(body.eliminado).toBe(true);
  });

  it('devuelve 404 si no existe', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const res = await del('/no-existe', token);
    expect(res.status).toBe(404);
  });

  it('devuelve 409 si ya está firmado', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const clienteId = await crearClienteDePrueba(env.DB, estudioId);
    const expedienteId = await crearExpedienteDePrueba(env.DB, estudioId, clienteId);
    const { id } = await crearPresupuestoConCliente(token, clienteId);
    await patch(`/${id}/firmar`, { expediente_id: expedienteId }, token);

    const res = await del(`/${id}`, token);
    expect(res.status).toBe(409);
  });
});
