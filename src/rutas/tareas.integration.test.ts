// Test de integración de tareas, montado con requireAuth (JWKS de prueba,
// sin red). Antes de este cambio ninguna operación por id verificaba
// estudio_id: cualquier usuario autenticado de cualquier estudio podía leer,
// completar o borrar la tarea de otro con solo conocer su id.
import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { env } from '../../test/env';
import { crearClienteDePrueba, crearEstudioDePrueba, crearExpedienteDePrueba } from '../../test/fixtures';
import { crearAppAutenticada, crearUsuarioAutenticado } from '../../test/auth';
import type { Env } from '../tipos';
import { tareasRouter } from './tareas';

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

async function armarExpediente() {
  const estudioId = await crearEstudioDePrueba(env.DB);
  const clienteId = await crearClienteDePrueba(env.DB, estudioId);
  const expedienteId = await crearExpedienteDePrueba(env.DB, estudioId, clienteId);
  const token = await crearUsuarioAutenticado(env.DB, estudioId);
  return { estudioId, clienteId, expedienteId, token };
}

describe('POST /api/tareas', () => {
  beforeEach(async () => {
    app = await crearAppAutenticada(tareasRouter);
  });

  it('crea una tarea con los campos obligatorios', async () => {
    const { expedienteId, token } = await armarExpediente();
    const res = await post('/', { expediente_id: expedienteId, titulo: 'Presentar escrito' }, token);

    expect(res.status).toBe(201);
    const body = await res.json<{ id: string; titulo: string; estado: string }>();
    expect(body.titulo).toBe('Presentar escrito');
    expect(body.estado).toBe('Pendiente');
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

describe('GET /api/tareas', () => {
  beforeEach(async () => {
    app = await crearAppAutenticada(tareasRouter);
  });

  it('exige expediente_id', async () => {
    const { token } = await armarExpediente();
    const res = await get('/', token);
    expect(res.status).toBe(400);
  });

  it('no devuelve tareas de un expediente de otro estudio', async () => {
    const { expedienteId, token } = await armarExpediente();
    await post('/', { expediente_id: expedienteId, titulo: 'Tarea propia' }, token);

    const otroEstudioId = await crearEstudioDePrueba(env.DB);
    const otroToken = await crearUsuarioAutenticado(env.DB, otroEstudioId);

    const res = await get(`/?expediente_id=${expedienteId}`, otroToken);
    const tareas = await res.json<unknown[]>();
    expect(tareas).toHaveLength(0);
  });
});

describe('PATCH /api/tareas/:id/estado', () => {
  beforeEach(async () => {
    app = await crearAppAutenticada(tareasRouter);
  });

  it('marca la tarea como completada y registra completado_en', async () => {
    const { expedienteId, token } = await armarExpediente();
    const creada = await post('/', { expediente_id: expedienteId, titulo: 'Tarea' }, token);
    const { id } = await creada.json<{ id: string }>();

    const res = await patch(`/${id}/estado`, { estado: 'Completada' }, token);
    expect(res.status).toBe(200);
    const body = await res.json<{ estado: string; completado_en: number }>();
    expect(body.estado).toBe('Completada');
    expect(body.completado_en).toBeTruthy();
  });

  it('rechaza un estado inválido', async () => {
    const { expedienteId, token } = await armarExpediente();
    const creada = await post('/', { expediente_id: expedienteId, titulo: 'Tarea' }, token);
    const { id } = await creada.json<{ id: string }>();

    const res = await patch(`/${id}/estado`, { estado: 'Inventado' }, token);
    expect(res.status).toBe(400);
  });

  it('devuelve 404 si la tarea es de otro estudio (no puede completarla ni verla)', async () => {
    const { expedienteId, token } = await armarExpediente();
    const creada = await post('/', { expediente_id: expedienteId, titulo: 'Tarea' }, token);
    const { id } = await creada.json<{ id: string }>();

    const otroEstudioId = await crearEstudioDePrueba(env.DB);
    const otroToken = await crearUsuarioAutenticado(env.DB, otroEstudioId);

    const res = await patch(`/${id}/estado`, { estado: 'Completada' }, otroToken);
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/tareas/:id', () => {
  beforeEach(async () => {
    app = await crearAppAutenticada(tareasRouter);
  });

  it('elimina la tarea', async () => {
    const { expedienteId, token } = await armarExpediente();
    const creada = await post('/', { expediente_id: expedienteId, titulo: 'Tarea' }, token);
    const { id } = await creada.json<{ id: string }>();

    const res = await del(`/${id}`, token);
    expect(res.status).toBe(200);
    const body = await res.json<{ eliminado: boolean }>();
    expect(body.eliminado).toBe(true);
  });

  it('devuelve 404 si la tarea es de otro estudio (no puede borrarla)', async () => {
    const { expedienteId, token } = await armarExpediente();
    const creada = await post('/', { expediente_id: expedienteId, titulo: 'Tarea' }, token);
    const { id } = await creada.json<{ id: string }>();

    const otroEstudioId = await crearEstudioDePrueba(env.DB);
    const otroToken = await crearUsuarioAutenticado(env.DB, otroEstudioId);

    const res = await del(`/${id}`, otroToken);
    expect(res.status).toBe(404);

    const sigueExistiendo = await env.DB.prepare('SELECT id FROM tareas WHERE id = ?').bind(id).first();
    expect(sigueExistiendo).toBeTruthy();
  });
});
