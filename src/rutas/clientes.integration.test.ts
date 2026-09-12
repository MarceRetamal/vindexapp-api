// Test de integración: ejercita la ruta real montada con requireAuth (JWKS de
// prueba, sin red) contra D1 con el esquema real aplicado por
// test/aplicar-migraciones.ts. Cubre el camino feliz, el constraint UNIQUE
// (estudio_id, dni), y el aislamiento por estudio.
import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { env } from '../../test/env';
import { crearEstudioDePrueba } from '../../test/fixtures';
import { crearAppAutenticada, crearUsuarioAutenticado } from '../../test/auth';
import type { Env } from '../tipos';
import { clientesRouter } from './clientes';

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

describe('POST /api/clientes', () => {
  let estudioId: string;
  let token: string;

  beforeEach(async () => {
    app = await crearAppAutenticada(clientesRouter);
    estudioId = await crearEstudioDePrueba(env.DB);
    token = await crearUsuarioAutenticado(env.DB, estudioId);
  });

  it('devuelve 401 sin token', async () => {
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: 'Ana', apellido: 'Gómez' }),
    }, env);
    expect(res.status).toBe(401);
  });

  it('crea un cliente con los campos obligatorios', async () => {
    const res = await post('/', { nombre: 'Ana', apellido: 'Gómez' }, token);

    expect(res.status).toBe(201);
    const body = await res.json<{ id: string; nombre: string; apellido: string }>();
    expect(body.nombre).toBe('Ana');
    expect(body.apellido).toBe('Gómez');
    expect(body.id).toBeTruthy();
  });

  it('rechaza la creación si falta un campo obligatorio', async () => {
    const res = await post('/', { nombre: 'Ana' }, token);
    expect(res.status).toBe(400);
  });

  it('rechaza un DNI duplicado dentro del mismo estudio con 409', async () => {
    await post('/', { nombre: 'Ana', apellido: 'Gómez', dni: '30111222' }, token);

    const res = await post('/', { nombre: 'Otra', apellido: 'Persona', dni: '30111222' }, token);

    expect(res.status).toBe(409);
    const body = await res.json<{ cliente_existente: { nombre: string } }>();
    expect(body.cliente_existente.nombre).toBe('Ana');
  });

  it('permite el mismo DNI en estudios distintos', async () => {
    const otroEstudioId = await crearEstudioDePrueba(env.DB);
    const tokenOtroEstudio = await crearUsuarioAutenticado(env.DB, otroEstudioId);

    await post('/', { nombre: 'Ana', apellido: 'Gómez', dni: '30111222' }, token);

    const res = await post('/', { nombre: 'Ana', apellido: 'Gómez', dni: '30111222' }, tokenOtroEstudio);

    expect(res.status).toBe(201);
  });
});

describe('GET /api/clientes', () => {
  beforeEach(async () => {
    app = await crearAppAutenticada(clientesRouter);
  });

  it('exige autenticación', async () => {
    const res = await get('/');
    expect(res.status).toBe(401);
  });

  it('devuelve solo los clientes del estudio del usuario autenticado', async () => {
    const estudioA = await crearEstudioDePrueba(env.DB);
    const estudioB = await crearEstudioDePrueba(env.DB);
    const tokenA = await crearUsuarioAutenticado(env.DB, estudioA);
    const tokenB = await crearUsuarioAutenticado(env.DB, estudioB);

    await post('/', { nombre: 'Ana', apellido: 'Gómez' }, tokenA);
    await post('/', { nombre: 'Luis', apellido: 'Pérez' }, tokenB);

    const res = await get('/', tokenA);
    const clientes = await res.json<{ nombre: string }[]>();

    expect(clientes).toHaveLength(1);
    expect(clientes[0]?.nombre).toBe('Ana');
  });
});

describe('GET /api/clientes/:id', () => {
  beforeEach(async () => {
    app = await crearAppAutenticada(clientesRouter);
  });

  it('devuelve 404 si el cliente no existe', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const res = await get('/no-existe', token);
    expect(res.status).toBe(404);
  });

  it('devuelve 404 si el cliente es de otro estudio', async () => {
    const estudioA = await crearEstudioDePrueba(env.DB);
    const estudioB = await crearEstudioDePrueba(env.DB);
    const tokenA = await crearUsuarioAutenticado(env.DB, estudioA);
    const tokenB = await crearUsuarioAutenticado(env.DB, estudioB);

    const creado = await post('/', { nombre: 'Ana', apellido: 'Gómez' }, tokenB);
    const { id } = await creado.json<{ id: string }>();

    const res = await get(`/${id}`, tokenA);
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/clientes/:id', () => {
  beforeEach(async () => {
    app = await crearAppAutenticada(clientesRouter);
  });

  it('actualiza solo los campos presentes en el body', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const creado = await post('/', { nombre: 'Ana', apellido: 'Gómez', email: 'ana@ejemplo.com' }, token);
    const { id } = await creado.json<{ id: string }>();

    const res = await patch(`/${id}`, { apellido: 'Gómez Díaz' }, token);

    expect(res.status).toBe(200);
    const actualizado = await res.json<{ nombre: string; apellido: string; email: string }>();
    expect(actualizado.apellido).toBe('Gómez Díaz');
    expect(actualizado.nombre).toBe('Ana');
    expect(actualizado.email).toBe('ana@ejemplo.com');
  });

  it('devuelve 400 si el body no trae ningún campo', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const creado = await post('/', { nombre: 'Ana', apellido: 'Gómez' }, token);
    const { id } = await creado.json<{ id: string }>();

    const res = await patch(`/${id}`, {}, token);
    expect(res.status).toBe(400);
  });

  it('devuelve 404 si el cliente es de otro estudio (no puede editarlo)', async () => {
    const estudioA = await crearEstudioDePrueba(env.DB);
    const estudioB = await crearEstudioDePrueba(env.DB);
    const tokenA = await crearUsuarioAutenticado(env.DB, estudioA);
    const tokenB = await crearUsuarioAutenticado(env.DB, estudioB);

    const creado = await post('/', { nombre: 'Ana', apellido: 'Gómez' }, tokenB);
    const { id } = await creado.json<{ id: string }>();

    const res = await patch(`/${id}`, { apellido: 'Hackeado' }, tokenA);
    expect(res.status).toBe(404);
  });
});
