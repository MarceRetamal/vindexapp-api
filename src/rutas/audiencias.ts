import { Hono } from 'hono';
import type { Bindings } from '../tipos';

export const audienciasRouter = new Hono<{ Bindings: Bindings }>();

const MODALIDADES_VALIDAS = ['Presencial', 'Videoconferencia', 'Telefónica'] as const;
const ESTADOS_VALIDOS = ['Programada', 'Realizada', 'Suspendida', 'Cancelada'] as const;

audienciasRouter.post('/', async (c) => {
  const body = await c.req.json<{
    estudio_id: string;
    expediente_id: string;
    tipo: string;
    fecha: string;
    hora?: string;
    modalidad?: (typeof MODALIDADES_VALIDAS)[number];
    lugar?: string;
    recordatorio?: boolean;
  }>();

  if (!body.estudio_id || !body.expediente_id || !body.tipo || !body.fecha) {
    return c.json(
      { error: 'estudio_id, expediente_id, tipo y fecha son obligatorios.' },
      400
    );
  }

  if (body.modalidad && !MODALIDADES_VALIDAS.includes(body.modalidad)) {
    return c.json({ error: `modalidad debe ser una de: ${MODALIDADES_VALIDAS.join(', ')}` }, 400);
  }

  const expediente = await c.env.DB.prepare(
    'SELECT id FROM expedientes WHERE id = ? AND estudio_id = ?'
  )
    .bind(body.expediente_id, body.estudio_id)
    .first();

  if (!expediente) {
    return c.json(
      { error: 'El expediente no existe o no pertenece a este estudio.' },
      404
    );
  }

  const id = crypto.randomUUID();
  const creado_en = Date.now();

  await c.env.DB.prepare(
    `INSERT INTO audiencias
      (id, estudio_id, expediente_id, tipo, fecha, hora, modalidad, lugar, estado, recordatorio, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Programada', ?, ?)`
  )
    .bind(
      id, body.estudio_id, body.expediente_id, body.tipo, body.fecha,
      body.hora ?? null, body.modalidad ?? null, body.lugar ?? null,
      body.recordatorio === false ? 0 : 1, creado_en
    )
    .run();

  return c.json({ id, tipo: body.tipo, fecha: body.fecha, estado: 'Programada' }, 201);
});

audienciasRouter.get('/', async (c) => {
  const expedienteId = c.req.query('expediente_id');
  const estudioId = c.req.query('estudio_id');

  if (!expedienteId && !estudioId) {
    return c.json({ error: 'expediente_id o estudio_id es obligatorio.' }, 400);
  }

  const query = expedienteId
    ? c.env.DB.prepare(
        'SELECT * FROM audiencias WHERE expediente_id = ? ORDER BY fecha, hora'
      ).bind(expedienteId)
    : c.env.DB.prepare(
        'SELECT * FROM audiencias WHERE estudio_id = ? ORDER BY fecha, hora'
      ).bind(estudioId);

  const { results } = await query.all();
  return c.json(results);
});

/** Cambia el estado de la audiencia (Realizada / Suspendida / Cancelada). */
audienciasRouter.patch('/:id/estado', async (c) => {
  const id = c.req.param('id');
  const { estado } = await c.req.json<{ estado: string }>();

  if (!ESTADOS_VALIDOS.includes(estado as (typeof ESTADOS_VALIDOS)[number])) {
    return c.json({ error: `estado debe ser uno de: ${ESTADOS_VALIDOS.join(', ')}` }, 400);
  }

  await c.env.DB.prepare('UPDATE audiencias SET estado = ? WHERE id = ?')
    .bind(estado, id)
    .run();

  return c.json({ id, estado });
});
