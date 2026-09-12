import { Hono } from 'hono';
import type { Env } from '../tipos';
import { requireAuth } from '../middleware/auth';

export const tareasRouter = new Hono<Env>();

tareasRouter.use('*', requireAuth());

const ESTADOS_VALIDOS = ['Pendiente', 'En curso', 'Completada'] as const;

tareasRouter.post('/', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json<{
    expediente_id: string;
    titulo: string;
    descripcion?: string;
    fecha_limite?: string;
    asignado_a?: string;
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
    `INSERT INTO tareas
      (id, estudio_id, expediente_id, titulo, descripcion, estado, fecha_limite, asignado_a, creado_por, creado_en)
     VALUES (?, ?, ?, ?, ?, 'Pendiente', ?, ?, ?, ?)`
  )
    .bind(
      id, auth.estudio_id, body.expediente_id, body.titulo,
      body.descripcion ?? null, body.fecha_limite ?? null,
      body.asignado_a ?? null, auth.usuario_id, creado_en
    )
    .run();

  return c.json({ id, titulo: body.titulo, estado: 'Pendiente' }, 201);
});

tareasRouter.get('/', async (c) => {
  const auth = c.get('auth');
  const expedienteId = c.req.query('expediente_id');
  if (!expedienteId) return c.json({ error: 'expediente_id es obligatorio.' }, 400);

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM tareas WHERE expediente_id = ? AND estudio_id = ? ORDER BY fecha_limite IS NULL, fecha_limite ASC, creado_en DESC'
  ).bind(expedienteId, auth.estudio_id).all();

  return c.json(results);
});

/** Cambia el estado de la tarea; registra completado_en al pasar a Completada. */
tareasRouter.patch('/:id/estado', async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id');
  const { estado } = await c.req.json<{ estado: string }>();

  if (!ESTADOS_VALIDOS.includes(estado as (typeof ESTADOS_VALIDOS)[number])) {
    return c.json({ error: `estado debe ser uno de: ${ESTADOS_VALIDOS.join(', ')}` }, 400);
  }

  const tarea = await c.env.DB.prepare(
    'SELECT id FROM tareas WHERE id = ? AND estudio_id = ?'
  ).bind(id, auth.estudio_id).first();
  if (!tarea) {
    return c.json({ error: 'Tarea no encontrada.' }, 404);
  }

  const completado_en = estado === 'Completada' ? Date.now() : null;

  await c.env.DB.prepare('UPDATE tareas SET estado = ?, completado_en = ? WHERE id = ?')
    .bind(estado, completado_en, id)
    .run();

  return c.json({ id, estado, completado_en });
});

/** Elimina la tarea. Hard delete: una tarea no tiene referencias descendientes. */
tareasRouter.delete('/:id', async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id');

  const tarea = await c.env.DB.prepare(
    'SELECT id FROM tareas WHERE id = ? AND estudio_id = ?'
  ).bind(id, auth.estudio_id).first();
  if (!tarea) {
    return c.json({ error: 'Tarea no encontrada.' }, 404);
  }

  await c.env.DB.prepare('DELETE FROM tareas WHERE id = ?').bind(id).run();
  return c.json({ id, eliminado: true });
});
