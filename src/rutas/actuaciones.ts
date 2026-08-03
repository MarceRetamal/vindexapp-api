import { Hono } from 'hono';
import type { Bindings } from '../tipos';

export const actuacionesRouter = new Hono<{ Bindings: Bindings }>();

actuacionesRouter.post('/', async (c) => {
  const body = await c.req.json<{
    estudio_id: string;
    expediente_id: string;
    tipo: string;
    fecha: string;
    detalle_interno?: string;
    texto_cliente?: string;
    visible?: boolean;
    hito?: boolean;
    creado_por?: string;
  }>();

  if (!body.estudio_id || !body.expediente_id || !body.tipo || !body.fecha) {
    return c.json({ error: 'estudio_id, expediente_id, tipo y fecha son obligatorios.' }, 400);
  }

  const id = crypto.randomUUID();
  const creado_en = Date.now();

  await c.env.DB.prepare(
    `INSERT INTO actuaciones
      (id, estudio_id, expediente_id, tipo, fecha, detalle_interno, texto_cliente, visible, hito, creado_por, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id, body.estudio_id, body.expediente_id, body.tipo, body.fecha,
      body.detalle_interno ?? null, body.texto_cliente ?? null,
      body.visible ? 1 : 0, body.hito ? 1 : 0, body.creado_por ?? null, creado_en
    )
    .run();

  return c.json({ id, tipo: body.tipo, fecha: body.fecha }, 201);
});

actuacionesRouter.get('/', async (c) => {
  const expedienteId = c.req.query('expediente_id');
  if (!expedienteId) return c.json({ error: 'expediente_id es obligatorio.' }, 400);

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM actuaciones WHERE expediente_id = ? ORDER BY fecha DESC, creado_en DESC'
  ).bind(expedienteId).all();

  return c.json(results);
});

/** Marca una actuación como notificada/publicada al cliente. */
actuacionesRouter.patch('/:id/notificar', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('UPDATE actuaciones SET notificado = 1, visible = 1 WHERE id = ?')
    .bind(id)
    .run();
  return c.json({ id, notificado: true });
});