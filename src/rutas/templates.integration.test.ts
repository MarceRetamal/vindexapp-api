// Test de integración de templates, montado con requireAuth (JWKS de
// prueba, sin red).
import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { env } from '../../test/env';
import { crearEstudioDePrueba } from '../../test/fixtures';
import { crearAppAutenticada, crearUsuarioAutenticado } from '../../test/auth';
import type { Env } from '../tipos';
import { templatesRouter } from './templates';

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

describe('POST /api/templates', () => {
  beforeEach(async () => {
    app = await crearAppAutenticada(templatesRouter);
  });

  it('crea un template con el campo obligatorio', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);

    const res = await post('/', { nombre: 'Contestación de demanda' }, token);
    expect(res.status).toBe(201);
  });

  it('rechaza si falta nombre', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);

    const res = await post('/', {}, token);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/templates', () => {
  beforeEach(async () => {
    app = await crearAppAutenticada(templatesRouter);
  });

  it('exige autenticación', async () => {
    const res = await get('/');
    expect(res.status).toBe(401);
  });

  it('filtra por categoria cuando se pasa', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    await post('/', { nombre: 'Escrito genérico', categoria: 'escrito' }, token);
    await post('/', { nombre: 'Presupuesto tipo', categoria: 'presupuesto' }, token);

    const res = await get('/?categoria=escrito', token);
    const templates = await res.json<{ nombre: string }[]>();
    expect(templates).toHaveLength(1);
    expect(templates[0]?.nombre).toBe('Escrito genérico');
  });

  it('no devuelve templates de otro estudio', async () => {
    const estudioA = await crearEstudioDePrueba(env.DB);
    const estudioB = await crearEstudioDePrueba(env.DB);
    const tokenA = await crearUsuarioAutenticado(env.DB, estudioA);
    const tokenB = await crearUsuarioAutenticado(env.DB, estudioB);
    await post('/', { nombre: 'Template A' }, tokenA);
    await post('/', { nombre: 'Template B' }, tokenB);

    const res = await get('/', tokenA);
    const templates = await res.json<{ nombre: string }[]>();
    expect(templates).toHaveLength(1);
    expect(templates[0]?.nombre).toBe('Template A');
  });
});
