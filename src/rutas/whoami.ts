import { Hono } from 'hono';
import type { Bindings } from '../tipos';

export const whoamiRouter = new Hono<{ Bindings: Bindings }>();

whoamiRouter.get('/', async (c) => {
  const access = (c.executionCtx as any).access;

  if (!access) {
    return c.json({ error: 'No autenticado con Cloudflare Access.' }, 401);
  }

  const identity = await access.getIdentity();
  const email = identity?.email;

  if (!email) {
    return c.json({ error: 'No se pudo determinar el email autenticado.' }, 401);
  }

  const usuario = await c.env.DB.prepare(
    `SELECT id, estudio_id, nombre, apellido, email, rol
     FROM usuarios WHERE email = ? AND activo = 1`
  ).bind(email).first<{
    id: string;
    estudio_id: string;
    nombre: string;
    apellido: string;
    email: string;
    rol: string;
  }>();

  if (!usuario) {
    return c.json(
      { error: `No hay un usuario activo registrado con el email ${email}.` },
      403
    );
  }

  const estudio = await c.env.DB.prepare(
    'SELECT id, nombre FROM estudios WHERE id = ?'
  ).bind(usuario.estudio_id).first<{ id: string; nombre: string }>();

  return c.json({ usuario, estudio });
});