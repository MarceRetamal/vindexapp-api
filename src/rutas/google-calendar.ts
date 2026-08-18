import { Hono } from 'hono';
import type { Bindings } from '../tipos';

export const googleCalendarRouter = new Hono<{ Bindings: Bindings }>();

const REDIRECT_URI = 'https://panel.vindexlegal.com.ar/api/google-calendar/callback';
const SCOPE = 'https://www.googleapis.com/auth/calendar';

googleCalendarRouter.get('/conectar', async (c) => {
  const usuarioId = c.req.query('usuario_id');
  if (!usuarioId) return c.json({ error: 'usuario_id es obligatorio.' }, 400);

  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state: btoa(usuarioId),
  });

  return c.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
});

googleCalendarRouter.get('/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');

  if (!code || !state) {
    return c.redirect('https://panel.vindexlegal.com.ar/agenda?google=error', 302);
  }

  let usuarioId: string;
  try {
    usuarioId = atob(state);
  } catch {
    return c.redirect('https://panel.vindexlegal.com.ar/agenda?google=error', 302);
  }

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: c.env.GOOGLE_CLIENT_ID,
        client_secret: c.env.GOOGLE_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI,
      }),
    });

    if (!tokenResponse.ok) {
      console.error('Error al intercambiar código de Google:', await tokenResponse.text());
      return c.redirect('https://panel.vindexlegal.com.ar/agenda?google=error', 302);
    }

    const tokenData = await tokenResponse.json<{
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    }>();

    const existente = await c.env.DB.prepare(
      'SELECT refresh_token FROM google_tokens WHERE usuario_id = ?'
    )
      .bind(usuarioId)
      .first<{ refresh_token: string }>();

    let refreshToken = tokenData.refresh_token;
    if (!refreshToken) {
      if (!existente) {
        console.error('Google no devolvió refresh_token y no hay conexión previa para', usuarioId);
        return c.redirect('https://panel.vindexlegal.com.ar/agenda?google=error', 302);
      }
      refreshToken = existente.refresh_token;
    }

    const expiraEn = Date.now() + tokenData.expires_in * 1000;
    const conectadoEn = Date.now();

    await c.env.DB.prepare(
      `INSERT OR REPLACE INTO google_tokens
        (usuario_id, access_token, refresh_token, expira_en, google_calendar_id, conectado_en)
       VALUES (?, ?, ?, ?, COALESCE((SELECT google_calendar_id FROM google_tokens WHERE usuario_id = ?), NULL), ?)`
    )
      .bind(usuarioId, tokenData.access_token, refreshToken, expiraEn, usuarioId, conectadoEn)
      .run();

    return c.redirect('https://panel.vindexlegal.com.ar/agenda?google=conectado', 302);
  } catch (err) {
    console.error('Error en callback de Google Calendar:', err);
    return c.redirect('https://panel.vindexlegal.com.ar/agenda?google=error', 302);
  }
});

googleCalendarRouter.get('/estado', async (c) => {
  const usuarioId = c.req.query('usuario_id');
  if (!usuarioId) return c.json({ error: 'usuario_id es obligatorio.' }, 400);

  const fila = await c.env.DB.prepare(
    'SELECT google_calendar_id FROM google_tokens WHERE usuario_id = ?'
  )
    .bind(usuarioId)
    .first<{ google_calendar_id: string | null }>();

  return c.json({
    conectado: !!fila,
    google_calendar_id: fila?.google_calendar_id ?? null,
  });
});

googleCalendarRouter.delete('/desconectar', async (c) => {
  const usuarioId = c.req.query('usuario_id');
  if (!usuarioId) return c.json({ error: 'usuario_id es obligatorio.' }, 400);

  await c.env.DB.prepare('DELETE FROM google_tokens WHERE usuario_id = ?').bind(usuarioId).run();

  return c.json({ usuario_id: usuarioId, desconectado: true });
});
