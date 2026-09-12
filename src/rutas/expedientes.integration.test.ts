// Test de integración de la ruta de expedientes, montada con requireAuth (JWKS
// de prueba, sin red). A diferencia de clientes, casi todo acá exige un
// cliente_id válido (FK) además del estudio del usuario autenticado.
import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { env } from '../../test/env';
import { crearClienteDePrueba, crearEstudioDePrueba } from '../../test/fixtures';
import { crearAppAutenticada, crearUsuarioAutenticado } from '../../test/auth';
import type { Env } from '../tipos';
import { expedientesRouter } from './expedientes';

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

async function crearExpedienteDePrueba(token: string, clienteId: string) {
  const res = await post('/', { cliente_id: clienteId, caratula: 'Pérez c/ Gómez s/ Despido' }, token);
  return res.json<{ id: string }>();
}

describe('POST /api/expedientes', () => {
  let estudioId: string;
  let clienteId: string;
  let token: string;

  beforeEach(async () => {
    app = await crearAppAutenticada(expedientesRouter);
    estudioId = await crearEstudioDePrueba(env.DB);
    clienteId = await crearClienteDePrueba(env.DB, estudioId);
    token = await crearUsuarioAutenticado(env.DB, estudioId);
  });

  it('crea un expediente en estado "En trámite" con los campos obligatorios', async () => {
    const res = await post('/', { cliente_id: clienteId, caratula: 'Pérez c/ Gómez s/ Despido' }, token);

    expect(res.status).toBe(201);
    const body = await res.json<{ id: string; caratula: string; cliente_id: string }>();
    expect(body.caratula).toBe('Pérez c/ Gómez s/ Despido');
    expect(body.cliente_id).toBe(clienteId);
  });

  it('rechaza la creación si falta un campo obligatorio', async () => {
    const res = await post('/', { cliente_id: clienteId }, token);
    expect(res.status).toBe(400);
  });

  it('devuelve 404 si el cliente no existe', async () => {
    const res = await post('/', { cliente_id: crypto.randomUUID(), caratula: 'Pérez c/ Gómez s/ Despido' }, token);
    expect(res.status).toBe(404);
  });

  it('devuelve 404 si el cliente pertenece a otro estudio', async () => {
    const otroEstudioId = await crearEstudioDePrueba(env.DB);
    const clienteDeOtroEstudio = await crearClienteDePrueba(env.DB, otroEstudioId);

    const res = await post('/', { cliente_id: clienteDeOtroEstudio, caratula: 'Pérez c/ Gómez s/ Despido' }, token);

    expect(res.status).toBe(404);
  });
});

describe('GET /api/expedientes', () => {
  beforeEach(async () => {
    app = await crearAppAutenticada(expedientesRouter);
  });

  it('exige autenticación', async () => {
    const res = await get('/');
    expect(res.status).toBe(401);
  });

  it('filtra por cliente_id cuando se pasa', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const clienteA = await crearClienteDePrueba(env.DB, estudioId);
    const clienteB = await crearClienteDePrueba(env.DB, estudioId);

    await post('/', { cliente_id: clienteA, caratula: 'Expediente A' }, token);
    await post('/', { cliente_id: clienteB, caratula: 'Expediente B' }, token);

    const res = await get(`/?cliente_id=${clienteA}`, token);
    const expedientes = await res.json<{ caratula: string }[]>();

    expect(expedientes).toHaveLength(1);
    expect(expedientes[0]?.caratula).toBe('Expediente A');
  });
});

describe('GET /api/expedientes/:id', () => {
  beforeEach(async () => {
    app = await crearAppAutenticada(expedientesRouter);
  });

  it('devuelve 404 si no existe en ese estudio', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const res = await get('/no-existe', token);
    expect(res.status).toBe(404);
  });

  it('devuelve el expediente con el nombre del cliente resuelto', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const clienteId = await crearClienteDePrueba(env.DB, estudioId);
    const { id } = await crearExpedienteDePrueba(token, clienteId);

    const res = await get(`/${id}`, token);
    expect(res.status).toBe(200);
    const body = await res.json<{ cliente_nombre: string; cliente_apellido: string }>();
    expect(body.cliente_nombre).toBe('Cliente');
    expect(body.cliente_apellido).toBe('De Prueba');
  });

  it('devuelve 404 si el expediente es de otro estudio', async () => {
    const estudioA = await crearEstudioDePrueba(env.DB);
    const estudioB = await crearEstudioDePrueba(env.DB);
    const tokenA = await crearUsuarioAutenticado(env.DB, estudioA);
    const tokenB = await crearUsuarioAutenticado(env.DB, estudioB);
    const clienteB = await crearClienteDePrueba(env.DB, estudioB);
    const { id } = await crearExpedienteDePrueba(tokenB, clienteB);

    const res = await get(`/${id}`, tokenA);
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/expedientes/:id', () => {
  beforeEach(async () => {
    app = await crearAppAutenticada(expedientesRouter);
  });

  it('actualiza solo los campos presentes en el body', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const clienteId = await crearClienteDePrueba(env.DB, estudioId);
    const { id } = await crearExpedienteDePrueba(token, clienteId);

    const res = await patch(`/${id}`, { numero: '12345/2026' }, token);

    expect(res.status).toBe(200);
    const body = await res.json<{ numero: string; caratula: string }>();
    expect(body.numero).toBe('12345/2026');
    expect(body.caratula).toBe('Pérez c/ Gómez s/ Despido');
  });

  it('devuelve 400 si el body no trae ningún campo', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const clienteId = await crearClienteDePrueba(env.DB, estudioId);
    const { id } = await crearExpedienteDePrueba(token, clienteId);

    const res = await patch(`/${id}`, {}, token);
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/expedientes/:id/baja y /reactivar', () => {
  beforeEach(async () => {
    app = await crearAppAutenticada(expedientesRouter);
  });

  it('archiva el expediente con fecha y motivo de baja', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const clienteId = await crearClienteDePrueba(env.DB, estudioId);
    const { id } = await crearExpedienteDePrueba(token, clienteId);

    const res = await patch(`/${id}/baja`, { motivo: 'Acuerdo extrajudicial' }, token);

    expect(res.status).toBe(200);
    const body = await res.json<{ estado: string; motivo_baja: string; baja: string }>();
    expect(body.estado).toBe('Archivado');
    expect(body.motivo_baja).toBe('Acuerdo extrajudicial');
    expect(body.baja).toBeTruthy();
  });

  it('reactiva un expediente dado de baja, limpiando baja y motivo_baja', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const clienteId = await crearClienteDePrueba(env.DB, estudioId);
    const { id } = await crearExpedienteDePrueba(token, clienteId);
    await patch(`/${id}/baja`, { motivo: 'x' }, token);

    const res = await patch(`/${id}/reactivar`, {}, token);

    expect(res.status).toBe(200);
    const body = await res.json<{ estado: string; motivo_baja: string | null; baja: string | null }>();
    expect(body.estado).toBe('En trámite');
    expect(body.motivo_baja).toBeNull();
    expect(body.baja).toBeNull();
  });

  it('devuelve 404 al dar de baja un expediente inexistente', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const res = await patch('/no-existe/baja', {}, token);
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/expedientes/:id', () => {
  beforeEach(async () => {
    app = await crearAppAutenticada(expedientesRouter);
  });

  it('elimina un expediente sin registros vinculados', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const clienteId = await crearClienteDePrueba(env.DB, estudioId);
    const { id } = await crearExpedienteDePrueba(token, clienteId);

    const res = await del(`/${id}`, token);

    expect(res.status).toBe(200);
    const body = await res.json<{ eliminado: boolean }>();
    expect(body.eliminado).toBe(true);
  });

  it('rechaza con 409 si tiene documentos vinculados, y sugiere /baja', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const clienteId = await crearClienteDePrueba(env.DB, estudioId);
    const { id } = await crearExpedienteDePrueba(token, clienteId);

    await env.DB.prepare(
      `INSERT INTO documentos (id, estudio_id, expediente_id, categoria, nombre, extension, ruta_r2, creado_en)
       VALUES (?, ?, ?, 'escrito_judicial', 'demanda.pdf', 'pdf', ?, ?)`
    )
      .bind(crypto.randomUUID(), estudioId, id, `expedientes/${id}/demanda.pdf`, Date.now())
      .run();

    const res = await del(`/${id}`, token);

    expect(res.status).toBe(409);
    const body = await res.json<{ error: string }>();
    expect(body.error).toContain('documento(s)');
    expect(body.error).toContain('/baja');
  });

  it('devuelve 404 si el expediente no existe', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const res = await del('/no-existe', token);
    expect(res.status).toBe(404);
  });
});
