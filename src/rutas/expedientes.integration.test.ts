// Test de integración de la ruta de expedientes vía SELF.fetch, contra D1 con el
// esquema real. A diferencia de clientes, casi todo acá exige un cliente_id válido
// (FK) además del estudio_id — de ahí crearClienteDePrueba().
import { SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { env } from '../../test/env';
import { crearClienteDePrueba, crearEstudioDePrueba } from '../../test/fixtures';

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

async function crearExpedienteDePrueba(estudioId: string, clienteId: string) {
  const res = await post('/api/expedientes', {
    estudio_id: estudioId,
    cliente_id: clienteId,
    caratula: 'Pérez c/ Gómez s/ Despido',
  });
  return res.json<{ id: string }>();
}

describe('POST /api/expedientes', () => {
  let estudioId: string;
  let clienteId: string;

  beforeEach(async () => {
    estudioId = await crearEstudioDePrueba(env.DB);
    clienteId = await crearClienteDePrueba(env.DB, estudioId);
  });

  it('crea un expediente en estado "En trámite" con los campos obligatorios', async () => {
    const res = await post('/api/expedientes', {
      estudio_id: estudioId,
      cliente_id: clienteId,
      caratula: 'Pérez c/ Gómez s/ Despido',
    });

    expect(res.status).toBe(201);
    const body = await res.json<{ id: string; caratula: string; cliente_id: string }>();
    expect(body.caratula).toBe('Pérez c/ Gómez s/ Despido');
    expect(body.cliente_id).toBe(clienteId);
  });

  it('rechaza la creación si falta un campo obligatorio', async () => {
    const res = await post('/api/expedientes', { estudio_id: estudioId, cliente_id: clienteId });
    expect(res.status).toBe(400);
  });

  it('devuelve 404 si el cliente no existe', async () => {
    const res = await post('/api/expedientes', {
      estudio_id: estudioId,
      cliente_id: crypto.randomUUID(),
      caratula: 'Pérez c/ Gómez s/ Despido',
    });
    expect(res.status).toBe(404);
  });

  it('devuelve 404 si el cliente pertenece a otro estudio', async () => {
    const otroEstudioId = await crearEstudioDePrueba(env.DB);
    const clienteDeOtroEstudio = await crearClienteDePrueba(env.DB, otroEstudioId);

    const res = await post('/api/expedientes', {
      estudio_id: estudioId,
      cliente_id: clienteDeOtroEstudio,
      caratula: 'Pérez c/ Gómez s/ Despido',
    });

    expect(res.status).toBe(404);
  });
});

describe('GET /api/expedientes', () => {
  it('exige estudio_id como query param', async () => {
    const res = await SELF.fetch(`${BASE}/api/expedientes`);
    expect(res.status).toBe(400);
  });

  it('filtra por cliente_id cuando se pasa', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const clienteA = await crearClienteDePrueba(env.DB, estudioId);
    const clienteB = await crearClienteDePrueba(env.DB, estudioId);

    await post('/api/expedientes', { estudio_id: estudioId, cliente_id: clienteA, caratula: 'Expediente A' });
    await post('/api/expedientes', { estudio_id: estudioId, cliente_id: clienteB, caratula: 'Expediente B' });

    const res = await SELF.fetch(`${BASE}/api/expedientes?estudio_id=${estudioId}&cliente_id=${clienteA}`);
    const expedientes = await res.json<{ caratula: string }[]>();

    expect(expedientes).toHaveLength(1);
    expect(expedientes[0]?.caratula).toBe('Expediente A');
  });
});

describe('GET /api/expedientes/:id', () => {
  it('exige estudio_id como query param', async () => {
    const res = await SELF.fetch(`${BASE}/api/expedientes/no-existe`);
    expect(res.status).toBe(400);
  });

  it('devuelve 404 si no existe en ese estudio', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const res = await SELF.fetch(`${BASE}/api/expedientes/no-existe?estudio_id=${estudioId}`);
    expect(res.status).toBe(404);
  });

  it('devuelve el expediente con el nombre del cliente resuelto', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const clienteId = await crearClienteDePrueba(env.DB, estudioId);
    const { id } = await crearExpedienteDePrueba(estudioId, clienteId);

    const res = await SELF.fetch(`${BASE}/api/expedientes/${id}?estudio_id=${estudioId}`);
    expect(res.status).toBe(200);
    const body = await res.json<{ cliente_nombre: string; cliente_apellido: string }>();
    expect(body.cliente_nombre).toBe('Cliente');
    expect(body.cliente_apellido).toBe('De Prueba');
  });
});

describe('PATCH /api/expedientes/:id', () => {
  it('actualiza solo los campos presentes en el body', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const clienteId = await crearClienteDePrueba(env.DB, estudioId);
    const { id } = await crearExpedienteDePrueba(estudioId, clienteId);

    const res = await patch(`/api/expedientes/${id}?estudio_id=${estudioId}`, { numero: '12345/2026' });

    expect(res.status).toBe(200);
    const body = await res.json<{ numero: string; caratula: string }>();
    expect(body.numero).toBe('12345/2026');
    expect(body.caratula).toBe('Pérez c/ Gómez s/ Despido');
  });

  it('devuelve 400 si el body no trae ningún campo', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const clienteId = await crearClienteDePrueba(env.DB, estudioId);
    const { id } = await crearExpedienteDePrueba(estudioId, clienteId);

    const res = await patch(`/api/expedientes/${id}?estudio_id=${estudioId}`, {});
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/expedientes/:id/baja y /reactivar', () => {
  it('archiva el expediente con fecha y motivo de baja', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const clienteId = await crearClienteDePrueba(env.DB, estudioId);
    const { id } = await crearExpedienteDePrueba(estudioId, clienteId);

    const res = await patch(`/api/expedientes/${id}/baja?estudio_id=${estudioId}`, {
      motivo: 'Acuerdo extrajudicial',
    });

    expect(res.status).toBe(200);
    const body = await res.json<{ estado: string; motivo_baja: string; baja: string }>();
    expect(body.estado).toBe('Archivado');
    expect(body.motivo_baja).toBe('Acuerdo extrajudicial');
    expect(body.baja).toBeTruthy();
  });

  it('reactiva un expediente dado de baja, limpiando baja y motivo_baja', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const clienteId = await crearClienteDePrueba(env.DB, estudioId);
    const { id } = await crearExpedienteDePrueba(estudioId, clienteId);
    await patch(`/api/expedientes/${id}/baja?estudio_id=${estudioId}`, { motivo: 'x' });

    const res = await patch(`/api/expedientes/${id}/reactivar?estudio_id=${estudioId}`, {});

    expect(res.status).toBe(200);
    const body = await res.json<{ estado: string; motivo_baja: string | null; baja: string | null }>();
    expect(body.estado).toBe('En trámite');
    expect(body.motivo_baja).toBeNull();
    expect(body.baja).toBeNull();
  });

  it('devuelve 404 al dar de baja un expediente inexistente', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const res = await patch(`/api/expedientes/no-existe/baja?estudio_id=${estudioId}`, {});
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/expedientes/:id', () => {
  it('elimina un expediente sin registros vinculados', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const clienteId = await crearClienteDePrueba(env.DB, estudioId);
    const { id } = await crearExpedienteDePrueba(estudioId, clienteId);

    const res = await SELF.fetch(`${BASE}/api/expedientes/${id}?estudio_id=${estudioId}`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    const body = await res.json<{ eliminado: boolean }>();
    expect(body.eliminado).toBe(true);
  });

  it('rechaza con 409 si tiene documentos vinculados, y sugiere /baja', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const clienteId = await crearClienteDePrueba(env.DB, estudioId);
    const { id } = await crearExpedienteDePrueba(estudioId, clienteId);

    await env.DB.prepare(
      `INSERT INTO documentos (id, estudio_id, expediente_id, categoria, nombre, extension, ruta_r2, creado_en)
       VALUES (?, ?, ?, 'escrito_judicial', 'demanda.pdf', 'pdf', ?, ?)`
    )
      .bind(crypto.randomUUID(), estudioId, id, `expedientes/${id}/demanda.pdf`, Date.now())
      .run();

    const res = await SELF.fetch(`${BASE}/api/expedientes/${id}?estudio_id=${estudioId}`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(409);
    const body = await res.json<{ error: string }>();
    expect(body.error).toContain('documento(s)');
    expect(body.error).toContain('/baja');
  });

  it('devuelve 404 si el expediente no existe', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const res = await SELF.fetch(`${BASE}/api/expedientes/no-existe?estudio_id=${estudioId}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
  });
});
