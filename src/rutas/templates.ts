import { Hono } from 'hono';
import type { Bindings } from '../tipos';

export const templatesRouter = new Hono<{ Bindings: Bindings }>();

templatesRouter.post('/', async (c) => {
  const body = await c.req.json<{
    estudio_id: string;
    nombre: string;
    categoria?: string;
    documento_id?: string;
  }>();

  if (!body.estudio_id || !body.nombre) {
    return c.json({ error: 'estudio_id y nombre son obligatorios.' }, 400);
  }

  const id = crypto.randomUUID();
  const creado_en = Date.now();

  await c.env.DB.prepare(
    `INSERT INTO templates (id, estudio_id, nombre, categoria, documento_id, creado_en)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(id, body.estudio_id, body.nombre, body.categoria ?? null, body.documento_id ?? null, creado_en)
    .run();

  return c.json({ id, nombre: body.nombre }, 201);
});

templatesRouter.get('/', async (c) => {
  const estudioId = c.req.query('estudio_id');
  if (!estudioId) return c.json({ error: 'estudio_id es obligatorio.' }, 400);

  const categoria = c.req.query('categoria');

  const query = categoria
    ? c.env.DB.prepare(
        'SELECT * FROM templates WHERE estudio_id = ? AND categoria = ? ORDER BY nombre'
      ).bind(estudioId, categoria)
    : c.env.DB.prepare('SELECT * FROM templates WHERE estudio_id = ? ORDER BY nombre').bind(estudioId);

  const { results } = await query.all();
  return c.json(results);
});
