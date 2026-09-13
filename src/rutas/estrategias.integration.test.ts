// Test de integración de estrategias, montado con requireAuth (JWKS de
// prueba, sin red).
import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { env } from '../../test/env';
import { crearClienteDePrueba, crearEstudioDePrueba, crearExpedienteDePrueba } from '../../test/fixtures';
import { crearAppAutenticada, crearUsuarioAutenticado } from '../../test/auth';
import type { Env } from '../tipos';
import { estrategiasRouter } from './estrategias';

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

describe('POST /api/estrategias', () => {
  beforeEach(async () => {
    app = await crearAppAutenticada(estrategiasRouter);
  });

  it('crea una estrategia con los campos obligatorios', async () => {
    const { expedienteId, token } = await armarExpediente();
    const res = await post('/', { expediente_id: expedienteId, titulo: 'Línea argumental principal' }, token);

    expect(res.status).toBe(201);
    const body = await res.json<{ titulo: string }>();
    expect(body.titulo).toBe('Línea argumental principal');
  });

  it('rechaza si falta un campo obligatorio', async () => {
    const { expedienteId, token } = await armarExpediente();
    const res = await post('/', { expediente_id: expedienteId }, token);
    expect(res.status).toBe(400);
  });

  it('devuelve 404 si el expediente pertenece a otro estudio', async () => {
    const { expedienteId } = await armarExpediente();
    const otroEstudioId = await crearEstudioDePrueba(env.DB);
    const otroToken = await crearUsuarioAutenticado(env.DB, otroEstudioId);

    const res = await post('/', { expediente_id: expedienteId, titulo: 'Intento cruzado' }, otroToken);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/estrategias', () => {
  beforeEach(async () => {
    app = await crearAppAutenticada(estrategiasRouter);
  });

  it('exige expediente_id', async () => {
    const { token } = await armarExpediente();
    const res = await get('/', token);
    expect(res.status).toBe(400);
  });

  it('no devuelve estrategias de un expediente de otro estudio', async () => {
    const { expedienteId, token } = await armarExpediente();
    await post('/', { expediente_id: expedienteId, titulo: 'Propia' }, token);

    const otroEstudioId = await crearEstudioDePrueba(env.DB);
    const otroToken = await crearUsuarioAutenticado(env.DB, otroEstudioId);

    const res = await get(`/?expediente_id=${expedienteId}`, otroToken);
    expect(await res.json()).toHaveLength(0);
  });
});

describe('PATCH /api/estrategias/:id', () => {
  beforeEach(async () => {
    app = await crearAppAutenticada(estrategiasRouter);
  });

  it('actualiza solo los campos presentes', async () => {
    const { expedienteId, token } = await armarExpediente();
    const creada = await post('/', { expediente_id: expedienteId, titulo: 'Original', contenido: 'Texto' }, token);
    const { id } = await creada.json<{ id: string }>();

    const res = await patch(`/${id}`, { titulo: 'Actualizada' }, token);
    expect(res.status).toBe(200);

    const fila = await env.DB.prepare('SELECT titulo, contenido FROM estrategias WHERE id = ?')
      .bind(id)
      .first<{ titulo: string; contenido: string }>();
    expect(fila?.titulo).toBe('Actualizada');
    expect(fila?.contenido).toBe('Texto');
  });

  it('devuelve 404 si la estrategia es de otro estudio', async () => {
    const { expedienteId, token } = await armarExpediente();
    const creada = await post('/', { expediente_id: expedienteId, titulo: 'Original' }, token);
    const { id } = await creada.json<{ id: string }>();

    const otroEstudioId = await crearEstudioDePrueba(env.DB);
    const otroToken = await crearUsuarioAutenticado(env.DB, otroEstudioId);

    const res = await patch(`/${id}`, { titulo: 'Hackeada' }, otroToken);
    expect(res.status).toBe(404);
  });
});
