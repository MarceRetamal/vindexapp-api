import { Hono } from 'hono';
import type { Env } from '../tipos';
import { requireAuth } from '../middleware/auth';

export const actuacionesRouter = new Hono<Env>();

actuacionesRouter.use('*', requireAuth());

actuacionesRouter.post('/', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json<{
    expediente_id: string;
    tipo: string;
    fecha: string;
    detalle_interno?: string;
    texto_cliente?: string;
    visible?: boolean;
    hito?: boolean;
    vencimiento?: string;
  }>();

  if (!body.expediente_id || !body.tipo || !body.fecha) {
    return c.json({ error: 'expediente_id, tipo y fecha son obligatorios.' }, 400);
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
    `INSERT INTO actuaciones
      (id, estudio_id, expediente_id, tipo, fecha, detalle_interno, texto_cliente, visible, hito, creado_por, creado_en, vencimiento)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id, auth.estudio_id, body.expediente_id, body.tipo, body.fecha,
      body.detalle_interno ?? null, body.texto_cliente ?? null,
      body.visible ? 1 : 0, body.hito ? 1 : 0, auth.usuario_id, creado_en,
      body.vencimiento ?? null
    )
    .run();

  return c.json({ id, tipo: body.tipo, fecha: body.fecha }, 201);
});

actuacionesRouter.get('/', async (c) => {
  const auth = c.get('auth');
  const expedienteId = c.req.query('expediente_id');
  if (!expedienteId) return c.json({ error: 'expediente_id es obligatorio.' }, 400);

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM actuaciones WHERE expediente_id = ? AND estudio_id = ? ORDER BY fecha DESC, creado_en DESC'
  ).bind(expedienteId, auth.estudio_id).all();

  return c.json(results);
});

/** Actuaciones con vencimiento manual dentro de los próximos N días (default 7). */
actuacionesRouter.get('/vencimientos-proximos', async (c) => {
  const auth = c.get('auth');
  const dias = Number(c.req.query('dias') ?? '7');

  const hoy = new Date();
  const limite = new Date(hoy);
  limite.setDate(limite.getDate() + dias);

  const desde = hoy.toISOString().slice(0, 10);
  const hasta = limite.toISOString().slice(0, 10);

  const { results } = await c.env.DB.prepare(
    `SELECT a.*, e.caratula AS expediente_caratula, c.apellido AS cliente_apellido, c.nombre AS cliente_nombre
       FROM actuaciones a
       JOIN expedientes e ON e.id = a.expediente_id
       JOIN clientes c ON c.id = e.cliente_id
      WHERE a.estudio_id = ?
        AND a.vencimiento IS NOT NULL
        AND a.vencimiento BETWEEN ? AND ?
      ORDER BY a.vencimiento ASC`
  )
    .bind(auth.estudio_id, desde, hasta)
    .all();

  return c.json(results);
});

/** Marca una actuación como notificada/publicada al cliente. */
actuacionesRouter.patch('/:id/notificar', async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id');

  const actuacion = await c.env.DB.prepare(
    'SELECT id FROM actuaciones WHERE id = ? AND estudio_id = ?'
  ).bind(id, auth.estudio_id).first();
  if (!actuacion) {
    return c.json({ error: 'Actuación no encontrada.' }, 404);
  }

  await c.env.DB.prepare('UPDATE actuaciones SET notificado = 1, visible = 1 WHERE id = ?')
    .bind(id)
    .run();
  return c.json({ id, notificado: true });
});
