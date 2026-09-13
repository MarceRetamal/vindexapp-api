// Test de integración de whoami, montado con requireAuth (JWKS de prueba,
// sin red).
import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { env } from '../../test/env';
import { crearEstudioDePrueba } from '../../test/fixtures';
import { crearAppAutenticada, crearUsuarioAutenticado } from '../../test/auth';
import type { Env } from '../tipos';
import { whoamiRouter } from './whoami';

let app: Hono<Env>;

async function get(path: string, token?: string) {
  return app.request(path, token ? { headers: { 'Cf-Access-Jwt-Assertion': token } } : {}, env);
}

describe('GET /api/whoami', () => {
  beforeEach(async () => {
    app = await crearAppAutenticada(whoamiRouter);
  });

  it('exige autenticación', async () => {
    const res = await get('/');
    expect(res.status).toBe(401);
  });

  it('devuelve la identidad y el estudio del usuario autenticado', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const email = `whoami-${crypto.randomUUID()}@vindexlegal.com.ar`;
    const token = await crearUsuarioAutenticado(env.DB, estudioId, email);

    const res = await get('/', token);
    expect(res.status).toBe(200);
    const body = await res.json<{
      usuario: { estudio_id: string; email: string; rol: string };
      estudio: { id: string } | null;
    }>();
    expect(body.usuario.estudio_id).toBe(estudioId);
    expect(body.usuario.email).toBe(email);
    expect(body.usuario.rol).toBe('titular');
    expect(body.estudio?.id).toBe(estudioId);
  });
});
