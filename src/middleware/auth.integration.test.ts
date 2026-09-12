import { describe, expect, it, beforeAll } from 'vitest';
import { env } from '../../test/env';
import { Hono } from 'hono';
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  createLocalJWKSet,
  type JWTVerifyGetKey,
} from 'jose';
import { requireAuth, type AuthContext } from './auth';
import type { Env } from '../tipos';

const AUDIENCIA = 'aud-de-prueba';
let jwksDePrueba: JWTVerifyGetKey;
let privateKey: CryptoKey;

beforeAll(async () => {
  const par = await generateKeyPair('RS256');
  privateKey = par.privateKey;
  const jwk = await exportJWK(par.publicKey);
  jwk.kid = 'clave-de-prueba';
  jwksDePrueba = createLocalJWKSet({ keys: [jwk] });
});

async function firmarToken(email?: string) {
  const ahora = Math.floor(Date.now() / 1000);
  return new SignJWT(email ? { email } : {})
    .setProtectedHeader({ alg: 'RS256', kid: 'clave-de-prueba' })
    .setIssuedAt(ahora)
    .setAudience(AUDIENCIA)
    .setExpirationTime(ahora + 300)
    .sign(privateKey);
}

function crearAppDePrueba() {
  const app = new Hono<Env>();
  app.use('*', requireAuth(() => jwksDePrueba));
  app.get('/protegido', (c) => c.json(c.get('auth')));
  return app;
}

describe('requireAuth', () => {
  it('devuelve 401 sin token', async () => {
    const app = crearAppDePrueba();
    const res = await app.request('/protegido', {}, env);
    expect(res.status).toBe(401);
  });

  it('devuelve 403 si el email no esta dado de alta', async () => {
    const app = crearAppDePrueba();
    const token = await firmarToken('nadie@vindexlegal.com.ar');

    const res = await app.request(
      '/protegido',
      { headers: { 'Cf-Access-Jwt-Assertion': token } },
      env
    );

    expect(res.status).toBe(403);
  });

  it('setea el contexto de auth para un usuario activo', async () => {
    await env.DB.prepare(
      `INSERT INTO estudios (id, nombre, creado_en, activo) VALUES ('estudio-test-auth', 'Estudio Test', 0, 1)`
    ).run();
    await env.DB.prepare(
      `INSERT INTO usuarios (id, estudio_id, nombre, apellido, email, rol, activo, creado_en)
       VALUES ('usuario-test-auth', 'estudio-test-auth', 'Ada', 'Lovelace', 'ada@vindexlegal.com.ar', 'titular', 1, 0)`
    ).run();

    const app = crearAppDePrueba();
    const token = await firmarToken('ada@vindexlegal.com.ar');

    const res = await app.request(
      '/protegido',
      { headers: { 'Cf-Access-Jwt-Assertion': token } },
      env
    );

    expect(res.status).toBe(200);
    const cuerpo = await res.json<AuthContext>();
    expect(cuerpo).toEqual({
      usuario_id: 'usuario-test-auth',
      estudio_id: 'estudio-test-auth',
      rol: 'titular',
      email: 'ada@vindexlegal.com.ar',
    });
  });
});
