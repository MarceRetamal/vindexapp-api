// Test de integración de google-calendar, montado con requireAuth (JWKS de
// prueba, sin red). Antes de este cambio, /estado y /desconectar tomaban
// usuario_id de query: cualquier usuario autenticado podía consultar o
// desconectar la agenda de Google de OTRO usuario con solo conocer su id.
// No se ejercita /callback (requiere mockear el intercambio de token con
// Google) — su única lógica de auth es la misma que estado/desconectar.
import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { env } from '../../test/env';
import { crearEstudioDePrueba } from '../../test/fixtures';
import { crearAppAutenticada, crearUsuarioAutenticado } from '../../test/auth';
import type { Env } from '../tipos';
import { googleCalendarRouter } from './google-calendar';

let app: Hono<Env>;

async function get(path: string, token?: string) {
  return app.request(path, token ? { headers: { 'Cf-Access-Jwt-Assertion': token } } : {}, env);
}

async function del(path: string, token?: string) {
  return app.request(path, { method: 'DELETE', headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {} }, env);
}

describe('GET /api/google-calendar/conectar', () => {
  beforeEach(async () => {
    app = await crearAppAutenticada(googleCalendarRouter);
  });

  it('exige autenticación', async () => {
    const res = await get('/conectar');
    expect(res.status).toBe(401);
  });

  it('devuelve una URL de autorización de Google', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const res = await get('/conectar', token);
    expect(res.status).toBe(200);
    const body = await res.json<{ url: string }>();
    expect(body.url).toContain('accounts.google.com');
  });
});

describe('GET /api/google-calendar/estado', () => {
  beforeEach(async () => {
    app = await crearAppAutenticada(googleCalendarRouter);
  });

  it('exige autenticación', async () => {
    const res = await get('/estado');
    expect(res.status).toBe(401);
  });

  it('devuelve conectado false cuando el usuario no tiene tokens guardados', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const res = await get('/estado', token);
    const body = await res.json<{ conectado: boolean }>();
    expect(body.conectado).toBe(false);
  });

  it('no expone la conexión de Google de otro usuario', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const emailA = `a-${crypto.randomUUID()}@vindexlegal.com.ar`;
    const tokenA = await crearUsuarioAutenticado(env.DB, estudioId, emailA);
    const tokenB = await crearUsuarioAutenticado(env.DB, estudioId);

    const usuarioA = await env.DB.prepare('SELECT id FROM usuarios WHERE email = ?')
      .bind(emailA)
      .first<{ id: string }>();

    await env.DB.prepare(
      `INSERT INTO google_tokens (usuario_id, access_token, refresh_token, expira_en, google_calendar_id, conectado_en)
       VALUES (?, 'tok', 'refresh', ?, 'cal-a', ?)`
    ).bind(usuarioA!.id, Date.now() + 3600_000, Date.now()).run();

    const resA = await get('/estado', tokenA);
    expect((await resA.json<{ conectado: boolean }>()).conectado).toBe(true);

    const resB = await get('/estado', tokenB);
    expect((await resB.json<{ conectado: boolean }>()).conectado).toBe(false);
  });
});

describe('DELETE /api/google-calendar/desconectar', () => {
  beforeEach(async () => {
    app = await crearAppAutenticada(googleCalendarRouter);
  });

  it('exige autenticación', async () => {
    const res = await del('/desconectar');
    expect(res.status).toBe(401);
  });

  it('desconecta solo al usuario autenticado, sin afectar a otro usuario', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const emailA = `a-${crypto.randomUUID()}@vindexlegal.com.ar`;
    const emailB = `b-${crypto.randomUUID()}@vindexlegal.com.ar`;
    const tokenA = await crearUsuarioAutenticado(env.DB, estudioId, emailA);
    await crearUsuarioAutenticado(env.DB, estudioId, emailB);

    const usuarioA = await env.DB.prepare('SELECT id FROM usuarios WHERE email = ?').bind(emailA).first<{ id: string }>();
    const usuarioB = await env.DB.prepare('SELECT id FROM usuarios WHERE email = ?').bind(emailB).first<{ id: string }>();

    for (const usuario of [usuarioA!, usuarioB!]) {
      await env.DB.prepare(
        `INSERT INTO google_tokens (usuario_id, access_token, refresh_token, expira_en, google_calendar_id, conectado_en)
         VALUES (?, 'tok', 'refresh', ?, 'cal', ?)`
      ).bind(usuario.id, Date.now() + 3600_000, Date.now()).run();
    }

    const res = await del('/desconectar', tokenA);
    expect(res.status).toBe(200);

    const filaA = await env.DB.prepare('SELECT usuario_id FROM google_tokens WHERE usuario_id = ?').bind(usuarioA!.id).first();
    const filaB = await env.DB.prepare('SELECT usuario_id FROM google_tokens WHERE usuario_id = ?').bind(usuarioB!.id).first();
    expect(filaA).toBeNull();
    expect(filaB).toBeTruthy();
  });
});
