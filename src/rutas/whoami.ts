import { Hono } from 'hono';
import type { Env } from '../tipos';
import { requireAuth } from '../middleware/auth';

export const whoamiRouter = new Hono<Env>();

whoamiRouter.use('*', requireAuth());

whoamiRouter.get('/', async (c) => {
  const auth = c.get('auth');

  const usuario = await c.env.DB.prepare(
    'SELECT nombre, apellido FROM usuarios WHERE id = ?'
  ).bind(auth.usuario_id).first<{ nombre: string; apellido: string }>();

  const estudio = await c.env.DB.prepare(
    'SELECT id, nombre FROM estudios WHERE id = ?'
  ).bind(auth.estudio_id).first<{ id: string; nombre: string }>();

  return c.json({
    usuario: {
      id: auth.usuario_id,
      estudio_id: auth.estudio_id,
      nombre: usuario?.nombre ?? '',
      apellido: usuario?.apellido ?? '',
      email: auth.email,
      rol: auth.rol,
    },
    estudio,
  });
});
