import { Hono } from 'hono';
import type { Env } from '../tipos';
import { requireAuth } from '../middleware/auth';

export const estrategiasRouter = new Hono<Env>();

estrategiasRouter.use('*', requireAuth());

estrategiasRouter.post('/', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json<{
    expediente_id: string;
    titulo: string;
    contenido?: string;
  }>();

  if (!body.expediente_id || !body.titulo) {
    return c.json({ error: 'expediente_id y titulo son obligatorios.' }, 400);
  }

  const expediente = await c.env.DB.prepare(
    'SELECT id FROM expedientes WHERE id = ? AND estudio_id = ?'
  ).bind(body.expediente_id, auth.estudio_id).first();
  if (!expediente) {
    return c.json({ error: 'El expediente no existe o no pertenece a este estudio.' }, 404);
  }

  const id = crypto.randomUUID();
  const creado_en = Date.now();

  await c.env.DB.prepare(
    `INSERT INTO estrategias (id, estudio_id, expediente_id, titulo, contenido, creado_por, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, auth.estudio_id, body.expediente_id, body.titulo, body.contenido ?? null, auth.usuario_id, creado_en)
    .run();

  return c.json({ id, titulo: body.titulo }, 201);
});

estrategiasRouter.get('/', async (c) => {
  const auth = c.get('auth');
  const expedienteId = c.req.query('expediente_id');
  if (!expedienteId) return c.json({ error: 'expediente_id es obligatorio.' }, 400);

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM estrategias WHERE expediente_id = ? AND estudio_id = ? ORDER BY creado_en DESC'
  ).bind(expedienteId, auth.estudio_id).all();

  return c.json(results);
});

estrategiasRouter.patch('/:id', async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id');
  const { titulo, contenido } = await c.req.json<{ titulo?: string; contenido?: string }>();

  const actual = await c.env.DB.prepare(
    'SELECT id FROM estrategias WHERE id = ? AND estudio_id = ?'
  ).bind(id, auth.estudio_id).first();
  if (!actual) {
    return c.json({ error: 'Estrategia no encontrada.' }, 404);
  }

  await c.env.DB.prepare(
    'UPDATE estrategias SET titulo = COALESCE(?, titulo), contenido = COALESCE(?, contenido), actualizado_en = ? WHERE id = ?'
  )
    .bind(titulo ?? null, contenido ?? null, Date.now(), id)
    .run();

  return c.json({ id, actualizado: true });
});
