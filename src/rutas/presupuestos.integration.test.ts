// Test de integración de la ruta de presupuestos. La parte no trivial es /firmar:
// dos caminos distintos según si el presupuesto ya tenía cliente_id (cliente
// existente) o solo contacto_nombre (potencial cliente, se da de alta recién acá).
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { env } from '../../test/env';
import { crearClienteDePrueba, crearEstudioDePrueba, crearExpedienteDePrueba } from '../../test/fixtures';

const BASE = 'http://vindexapp-api.local';

async function post(path: string, body: unknown) {
  return SELF.fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function patch(path: string, body: unknown) {
  return SELF.fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function crearPresupuestoConCliente(estudioId: string, clienteId: string) {
  const res = await post('/api/presupuestos', {
    estudio_id: estudioId,
    cliente_id: clienteId,
    concepto: 'Honorarios iniciales',
    monto: 50000,
  });
  return res.json<{ id: string }>();
}

async function crearPresupuestoDePotencialCliente(estudioId: string) {
  const res = await post('/api/presupuestos', {
    estudio_id: estudioId,
    contacto_nombre: 'Juan Contacto',
    contacto_telefono: '2211234567',
    concepto: 'Consulta inicial',
    monto: 20000,
  });
  return res.json<{ id: string }>();
}

describe('POST /api/presupuestos', () => {
  it('crea un presupuesto en borrador con cliente_id existente', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const clienteId = await crearClienteDePrueba(env.DB, estudioId);

    const res = await post('/api/presupuestos', {
      estudio_id: estudioId,
      cliente_id: clienteId,
      concepto: 'Honorarios iniciales',
      monto: 50000,
    });

    expect(res.status).toBe(201);
    const body = await res.json<{ estado: string }>();
    expect(body.estado).toBe('borrador');
  });

  it('crea un presupuesto para un potencial cliente vía contacto_nombre', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const res = await post('/api/presupuestos', {
      estudio_id: estudioId,
      contacto_nombre: 'Juan Contacto',
      concepto: 'Consulta inicial',
      monto: 20000,
    });
    expect(res.status).toBe(201);
  });

  it('rechaza si falta estudio_id, concepto o monto', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const res = await post('/api/presupuestos', { estudio_id: estudioId, concepto: 'X' });
    expect(res.status).toBe(400);
  });

  it('rechaza si no viene ni cliente_id ni contacto_nombre', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const res = await post('/api/presupuestos', {
      estudio_id: estudioId,
      concepto: 'Honorarios',
      monto: 1000,
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/presupuestos', () => {
  it('exige estudio_id', async () => {
    const res = await SELF.fetch(`${BASE}/api/presupuestos`);
    expect(res.status).toBe(400);
  });

  it('devuelve solo los presupuestos del estudio pedido', async () => {
    const estudioA = await crearEstudioDePrueba(env.DB);
    const estudioB = await crearEstudioDePrueba(env.DB);
    await crearPresupuestoDePotencialCliente(estudioA);
    await crearPresupuestoDePotencialCliente(estudioB);

    const res = await SELF.fetch(`${BASE}/api/presupuestos?estudio_id=${estudioA}`);
    const presupuestos = await res.json<unknown[]>();
    expect(presupuestos).toHaveLength(1);
  });
});

describe('PATCH /api/presupuestos/:id/estado', () => {
  it('acepta una transición válida', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const { id } = await crearPresupuestoDePotencialCliente(estudioId);

    const res = await patch(`/api/presupuestos/${id}/estado`, { estado: 'enviado' });
    expect(res.status).toBe(200);
    const body = await res.json<{ estado: string }>();
    expect(body.estado).toBe('enviado');
  });

  it('rechaza "firmado" — esa transición pasa por /firmar', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const { id } = await crearPresupuestoDePotencialCliente(estudioId);

    const res = await patch(`/api/presupuestos/${id}/estado`, { estado: 'firmado' });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/presupuestos/:id/firmar', () => {
  it('devuelve 404 si el presupuesto no existe', async () => {
    const res = await patch('/api/presupuestos/no-existe/firmar', { expediente_id: 'x' });
    expect(res.status).toBe(404);
  });

  it('devuelve 400 si falta expediente_id', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const { id } = await crearPresupuestoDePotencialCliente(estudioId);
    const res = await patch(`/api/presupuestos/${id}/firmar`, {});
    expect(res.status).toBe(400);
  });

  it('devuelve 404 si el expediente no existe o es de otro estudio', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const clienteId = await crearClienteDePrueba(env.DB, estudioId);
    const { id } = await crearPresupuestoConCliente(estudioId, clienteId);

    const otroEstudioId = await crearEstudioDePrueba(env.DB);
    const clienteDeOtroEstudio = await crearClienteDePrueba(env.DB, otroEstudioId);
    const expedienteDeOtroEstudio = await crearExpedienteDePrueba(env.DB, otroEstudioId, clienteDeOtroEstudio);

    const res = await patch(`/api/presupuestos/${id}/firmar`, { expediente_id: expedienteDeOtroEstudio });
    expect(res.status).toBe(404);
  });

  it('firma directo cuando el presupuesto ya tenía cliente_id (no exige nombre/apellido)', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const clienteId = await crearClienteDePrueba(env.DB, estudioId);
    const expedienteId = await crearExpedienteDePrueba(env.DB, estudioId, clienteId);
    const { id } = await crearPresupuestoConCliente(estudioId, clienteId);

    const res = await patch(`/api/presupuestos/${id}/firmar`, { expediente_id: expedienteId });

    expect(res.status).toBe(200);
    const body = await res.json<{ estado: string; cliente_id: string; expediente_id: string }>();
    expect(body.estado).toBe('firmado');
    expect(body.cliente_id).toBe(clienteId);
    expect(body.expediente_id).toBe(expedienteId);
  });

  it('exige nombre y apellido para dar de alta al potencial cliente', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const clienteDummy = await crearClienteDePrueba(env.DB, estudioId);
    const expedienteId = await crearExpedienteDePrueba(env.DB, estudioId, clienteDummy);
    const { id } = await crearPresupuestoDePotencialCliente(estudioId);

    const res = await patch(`/api/presupuestos/${id}/firmar`, { expediente_id: expedienteId });
    expect(res.status).toBe(400);
  });

  it('da de alta al cliente potencial y firma, cuando vienen nombre y apellido', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const clienteDummy = await crearClienteDePrueba(env.DB, estudioId);
    const expedienteId = await crearExpedienteDePrueba(env.DB, estudioId, clienteDummy);
    const { id } = await crearPresupuestoDePotencialCliente(estudioId);

    const res = await patch(`/api/presupuestos/${id}/firmar`, {
      expediente_id: expedienteId,
      nombre: 'Juan',
      apellido: 'Contacto',
    });

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
    const clienteId = await crearClienteDePrueba(env.DB, estudioId);
    const expedienteId = await crearExpedienteDePrueba(env.DB, estudioId, clienteId);
    const { id } = await crearPresupuestoConCliente(estudioId, clienteId);
    await patch(`/api/presupuestos/${id}/firmar`, { expediente_id: expedienteId });

    const res = await patch(`/api/presupuestos/${id}/firmar`, { expediente_id: expedienteId });
    expect(res.status).toBe(409);
  });
});

describe('PATCH /api/presupuestos/:id', () => {
  it('actualiza solo los campos presentes en el body', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const { id } = await crearPresupuestoDePotencialCliente(estudioId);

    const res = await patch(`/api/presupuestos/${id}`, { monto: 30000 });
    expect(res.status).toBe(200);
    const body = await res.json<{ monto: number; concepto: string }>();
    expect(body.monto).toBe(30000);
    expect(body.concepto).toBe('Consulta inicial');
  });

  it('devuelve 404 si no existe', async () => {
    const res = await patch('/api/presupuestos/no-existe', { monto: 1 });
    expect(res.status).toBe(404);
  });

  it('devuelve 400 si el body no trae ningún campo', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const { id } = await crearPresupuestoDePotencialCliente(estudioId);
    const res = await patch(`/api/presupuestos/${id}`, {});
    expect(res.status).toBe(400);
  });

  it('devuelve 409 si ya está firmado', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const clienteId = await crearClienteDePrueba(env.DB, estudioId);
    const expedienteId = await crearExpedienteDePrueba(env.DB, estudioId, clienteId);
    const { id } = await crearPresupuestoConCliente(estudioId, clienteId);
    await patch(`/api/presupuestos/${id}/firmar`, { expediente_id: expedienteId });

    const res = await patch(`/api/presupuestos/${id}`, { monto: 1 });
    expect(res.status).toBe(409);
  });
});

describe('DELETE /api/presupuestos/:id', () => {
  it('elimina un presupuesto no firmado', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const { id } = await crearPresupuestoDePotencialCliente(estudioId);

    const res = await SELF.fetch(`${BASE}/api/presupuestos/${id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json<{ eliminado: boolean }>();
    expect(body.eliminado).toBe(true);
  });

  it('devuelve 404 si no existe', async () => {
    const res = await SELF.fetch(`${BASE}/api/presupuestos/no-existe`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('devuelve 409 si ya está firmado', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const clienteId = await crearClienteDePrueba(env.DB, estudioId);
    const expedienteId = await crearExpedienteDePrueba(env.DB, estudioId, clienteId);
    const { id } = await crearPresupuestoConCliente(estudioId, clienteId);
    await patch(`/api/presupuestos/${id}/firmar`, { expediente_id: expedienteId });

    const res = await SELF.fetch(`${BASE}/api/presupuestos/${id}`, { method: 'DELETE' });
    expect(res.status).toBe(409);
  });
});
