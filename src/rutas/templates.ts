import { Hono } from 'hono';
import type { Env } from '../tipos';
import { requireAuth } from '../middleware/auth';

export const templatesRouter = new Hono<Env>();

templatesRouter.use('*', requireAuth());

templatesRouter.post('/', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json<{
    nombre: string;
    categoria?: string;
    documento_id?: string;
  }>();

  if (!body.nombre) {
    return c.json({ error: 'nombre es obligatorio.' }, 400);
  }

  const id = crypto.randomUUID();
  const creado_en = Date.now();

  await c.env.DB.prepare(
    `INSERT INTO templates (id, estudio_id, nombre, categoria, documento_id, creado_en)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(id, auth.estudio_id, body.nombre, body.categoria ?? null, body.documento_id ?? null, creado_en)
    .run();

  return c.json({ id, nombre: body.nombre }, 201);
});

templatesRouter.get('/', async (c) => {
  const auth = c.get('auth');
  const categoria = c.req.query('categoria');

  const query = categoria
    ? c.env.DB.prepare(
        'SELECT * FROM templates WHERE estudio_id = ? AND categoria = ? ORDER BY nombre'
      ).bind(auth.estudio_id, categoria)
    : c.env.DB.prepare('SELECT * FROM templates WHERE estudio_id = ? ORDER BY nombre').bind(auth.estudio_id);

  const { results } = await query.all();
  return c.json(results);
});
