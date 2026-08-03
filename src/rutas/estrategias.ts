import { Hono } from 'hono';
import type { Bindings } from '../tipos';

export const estrategiasRouter = new Hono<{ Bindings: Bindings }>();

estrategiasRouter.post('/', async (c) => {
  const body = await c.req.json<{
    estudio_id: string;
    expediente_id: string;
    titulo: string;
    contenido?: string;
    creado_por?: string;
  }>();

  if (!body.estudio_id || !body.expediente_id || !body.titulo) {
    return c.json({ error: 'estudio_id, expediente_id y titulo son obligatorios.' }, 400);
  }

  const id = crypto.randomUUID();
  const creado_en = Date.now();

  await c.env.DB.prepare(
    `INSERT INTO estrategias (id, estudio_id, expediente_id, titulo, contenido, creado_por, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, body.estudio_id, body.expediente_id, body.titulo, body.contenido ?? null, body.creado_por ?? null, creado_en)
    .run();

  return c.json({ id, titulo: body.titulo }, 201);
});

estrategiasRouter.get('/', async (c) => {
  const expedienteId = c.req.query('expediente_id');
  if (!expedienteId) return c.json({ error: 'expediente_id es obligatorio.' }, 400);

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM estrategias WHERE expediente_id = ? ORDER BY creado_en DESC'
  ).bind(expedienteId).all();

  return c.json(results);
});

estrategiasRouter.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const { titulo, contenido } = await c.req.json<{ titulo?: string; contenido?: string }>();

  await c.env.DB.prepare(
    'UPDATE estrategias SET titulo = COALESCE(?, titulo), contenido = COALESCE(?, contenido), actualizado_en = ? WHERE id = ?'
  )
    .bind(titulo ?? null, contenido ?? null, Date.now(), id)
    .run();

  return c.json({ id, actualizado: true });
});