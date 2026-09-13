// Test de integración de audiencias, montado con requireAuth (JWKS de
// prueba, sin red).
import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { env } from '../../test/env';
import { crearClienteDePrueba, crearEstudioDePrueba, crearExpedienteDePrueba } from '../../test/fixtures';
import { crearAppAutenticada, crearUsuarioAutenticado } from '../../test/auth';
import type { Env } from '../tipos';
import { audienciasRouter } from './audiencias';

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

async function get(path: string, token?: string) {
  return app.request(path, token ? { headers: { 'Cf-Access-Jwt-Assertion': token } } : {}, env);
}

async function armarExpediente() {
  const estudioId = await crearEstudioDePrueba(env.DB);
  const clienteId = await crearClienteDePrueba(env.DB, estudioId);
  const expedienteId = await crearExpedienteDePrueba(env.DB, estudioId, clienteId);
  const token = await crearUsuarioAutenticado(env.DB, estudioId);
  return { estudioId, clienteId, expedienteId, token };
}

describe('POST /api/audiencias', () => {
  beforeEach(async () => {
    app = await crearAppAutenticada(audienciasRouter);
  });

  it('crea una audiencia con los campos obligatorios', async () => {
    const { expedienteId, token } = await armarExpediente();
    const res = await post('/', { expediente_id: expedienteId, tipo: 'Conciliación', fecha: '2026-10-01' }, token);

    expect(res.status).toBe(201);
    const body = await res.json<{ id: string; estado: string }>();
    expect(body.estado).toBe('Programada');
  });

  it('rechaza si falta un campo obligatorio', async () => {
    const { expedienteId, token } = await armarExpediente();
    const res = await post('/', { expediente_id: expedienteId }, token);
    expect(res.status).toBe(400);
  });

  it('rechaza una modalidad inválida', async () => {
    const { expedienteId, token } = await armarExpediente();
    const res = await post('/', { expediente_id: expedienteId, tipo: 'Vista', fecha: '2026-10-01', modalidad: 'Por paloma mensajera' }, token);
    expect(res.status).toBe(400);
  });

  it('devuelve 404 si el expediente pertenece a otro estudio', async () => {
    const { expedienteId } = await armarExpediente();
    const otroEstudioId = await crearEstudioDePrueba(env.DB);
    const otroToken = await crearUsuarioAutenticado(env.DB, otroEstudioId);

    const res = await post('/', { expediente_id: expedienteId, tipo: 'Vista', fecha: '2026-10-01' }, otroToken);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/audiencias', () => {
  beforeEach(async () => {
    app = await crearAppAutenticada(audienciasRouter);
  });

  it('exige autenticación', async () => {
    const res = await get('/');
    expect(res.status).toBe(401);
  });

  it('filtra por expediente_id cuando se pasa', async () => {
    const { expedienteId, token } = await armarExpediente();
    await post('/', { expediente_id: expedienteId, tipo: 'Vista', fecha: '2026-10-01' }, token);

    const res = await get(`/?expediente_id=${expedienteId}`, token);
    const audiencias = await res.json<unknown[]>();
    expect(audiencias).toHaveLength(1);
  });

  it('no devuelve audiencias de otro estudio', async () => {
    const { expedienteId, token } = await armarExpediente();
    await post('/', { expediente_id: expedienteId, tipo: 'Vista', fecha: '2026-10-01' }, token);

    const otroEstudioId = await crearEstudioDePrueba(env.DB);
    const otroToken = await crearUsuarioAutenticado(env.DB, otroEstudioId);

    const res = await get('/', otroToken);
    const audiencias = await res.json<unknown[]>();
    expect(audiencias).toHaveLength(0);
  });
});

describe('PATCH /api/audiencias/:id/estado', () => {
  beforeEach(async () => {
    app = await crearAppAutenticada(audienciasRouter);
  });

  it('cambia el estado', async () => {
    const { expedienteId, token } = await armarExpediente();
    const creada = await post('/', { expediente_id: expedienteId, tipo: 'Vista', fecha: '2026-10-01' }, token);
    const { id } = await creada.json<{ id: string }>();

    const res = await patch(`/${id}/estado`, { estado: 'Realizada' }, token);
    expect(res.status).toBe(200);
  });

  it('rechaza un estado inválido', async () => {
    const { expedienteId, token } = await armarExpediente();
    const creada = await post('/', { expediente_id: expedienteId, tipo: 'Vista', fecha: '2026-10-01' }, token);
    const { id } = await creada.json<{ id: string }>();

    const res = await patch(`/${id}/estado`, { estado: 'Ganada' }, token);
    expect(res.status).toBe(400);
  });

  it('devuelve 404 si la audiencia es de otro estudio', async () => {
    const { expedienteId, token } = await armarExpediente();
    const creada = await post('/', { expediente_id: expedienteId, tipo: 'Vista', fecha: '2026-10-01' }, token);
    const { id } = await creada.json<{ id: string }>();

    const otroEstudioId = await crearEstudioDePrueba(env.DB);
    const otroToken = await crearUsuarioAutenticado(env.DB, otroEstudioId);

    const res = await patch(`/${id}/estado`, { estado: 'Realizada' }, otroToken);
    expect(res.status).toBe(404);
  });
});
