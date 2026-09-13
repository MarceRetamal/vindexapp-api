// Test de integración de usuarios, montado con requireAuth (JWKS de
// prueba, sin red).
import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { env } from '../../test/env';
import { crearEstudioDePrueba } from '../../test/fixtures';
import { crearAppAutenticada, crearUsuarioAutenticado } from '../../test/auth';
import type { Env } from '../tipos';
import { usuariosRouter } from './usuarios';

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

async function get(path: string, token?: string) {
  return app.request(path, token ? { headers: { 'Cf-Access-Jwt-Assertion': token } } : {}, env);
}

describe('POST /api/usuarios', () => {
  beforeEach(async () => {
    app = await crearAppAutenticada(usuariosRouter);
  });

  it('crea un usuario con los campos obligatorios', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);

    const res = await post(
      '/',
      { nombre: 'Ana', apellido: 'Gómez', email: `ana-${crypto.randomUUID()}@vindexlegal.com.ar`, rol: 'asociado' },
      token
    );
    expect(res.status).toBe(201);
  });

  it('rechaza si falta un campo obligatorio', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);

    const res = await post('/', { nombre: 'Ana' }, token);
    expect(res.status).toBe(400);
  });

  it('rechaza un rol inválido', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);

    const res = await post(
      '/',
      { nombre: 'Ana', apellido: 'Gómez', email: `ana-${crypto.randomUUID()}@vindexlegal.com.ar`, rol: 'socio_fundador' },
      token
    );
    expect(res.status).toBe(400);
  });

  it('devuelve 409 si el email ya está en uso', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const email = `duplicado-${crypto.randomUUID()}@vindexlegal.com.ar`;

    await post('/', { nombre: 'Ana', apellido: 'Gómez', email, rol: 'asociado' }, token);
    const res = await post('/', { nombre: 'Otra', apellido: 'Persona', email, rol: 'administrativo' }, token);
    expect(res.status).toBe(409);
  });
});

describe('GET /api/usuarios', () => {
  beforeEach(async () => {
    app = await crearAppAutenticada(usuariosRouter);
  });

  it('exige autenticación', async () => {
    const res = await get('/');
    expect(res.status).toBe(401);
  });

  it('no devuelve usuarios de otro estudio', async () => {
    const estudioA = await crearEstudioDePrueba(env.DB);
    const estudioB = await crearEstudioDePrueba(env.DB);
    const tokenA = await crearUsuarioAutenticado(env.DB, estudioA);
    const tokenB = await crearUsuarioAutenticado(env.DB, estudioB);
    await post('/', { nombre: 'Ana', apellido: 'Gómez', email: `ana-${crypto.randomUUID()}@vindexlegal.com.ar`, rol: 'asociado' }, tokenA);
    await post('/', { nombre: 'Luis', apellido: 'Pérez', email: `luis-${crypto.randomUUID()}@vindexlegal.com.ar`, rol: 'asociado' }, tokenB);

    const res = await get('/', tokenA);
    const usuarios = await res.json<{ nombre: string }[]>();
    // El usuario autenticado (crearUsuarioAutenticado) + el creado por POST arriba.
    expect(usuarios.every((u) => u.nombre !== 'Luis')).toBe(true);
  });
});
