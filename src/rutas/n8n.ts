import { Hono } from 'hono';
import type { EnvServicio } from '../tipos';
import { requireServiceAuth } from '../middleware/auth';

/**
 * Superficie de API para la automatización de WhatsApp en n8n. Protegida con
 * requireServiceAuth() (Service Token de Cloudflare Access), no requireAuth()
 * — ver la nota en middleware/auth.ts sobre por qué son middlewares
 * separados. Alcance deliberadamente angosto: n8n solo necesita (1) buscar/
 * dar de alta clientes o leads, (2) leer expedientes y actuaciones VISIBLES
 * (nunca el detalle interno del abogado), y (3) el circuito de notificación
 * de actuaciones/audiencias. No expone nada de `mensajes` (el chat interno
 * cifrado abogado-cliente está explícitamente prohibido de tocar por
 * WhatsApp/n8n, ver el comentario en 0001_esquema_inicial.sql), ni
 * documentos, presupuestos, estrategias, ni ninguna otra ruta de negocio.
 */
export const n8nRouter = new Hono<EnvServicio>();

n8nRouter.use('*', requireServiceAuth());

/** Busca un cliente por whatsapp o por dni (al menos uno de los dos). */
n8nRouter.get('/clientes', async (c) => {
  const servicio = c.get('servicio');
  const whatsapp = c.req.query('whatsapp');
  const dni = c.req.query('dni');

  if (!whatsapp && !dni) {
    return c.json({ error: 'whatsapp o dni es obligatorio.' }, 400);
  }

  const query = whatsapp
    ? c.env.DB.prepare(
        `SELECT id, nombre, apellido, dni, whatsapp, estado
           FROM clientes WHERE estudio_id = ? AND whatsapp = ?`
      ).bind(servicio.estudio_id, whatsapp)
    : c.env.DB.prepare(
        `SELECT id, nombre, apellido, dni, whatsapp, estado
           FROM clientes WHERE estudio_id = ? AND dni = ?`
      ).bind(servicio.estudio_id, dni);

  const { results } = await query.all();
  return c.json(results);
});

/** Da de alta un potencial cliente (lead) capturado por el agente de WhatsApp. */
n8nRouter.post('/clientes', async (c) => {
  const servicio = c.get('servicio');
  const body = await c.req.json<{
    nombre: string;
    apellido: string;
    dni?: string;
    whatsapp?: string;
    telefono_fijo?: string;
    email?: string;
    domicilio?: string;
    localidad?: string;
    notas?: string;
  }>();

  if (!body.nombre || !body.apellido) {
    return c.json({ error: 'nombre y apellido son obligatorios.' }, 400);
  }

  if (body.dni) {
    const existente = await c.env.DB.prepare(
      'SELECT id FROM clientes WHERE estudio_id = ? AND dni = ?'
    )
      .bind(servicio.estudio_id, body.dni)
      .first<{ id: string }>();
    if (existente) {
      return c.json({ error: 'Ya existe un cliente con ese DNI.', id: existente.id }, 409);
    }
  }

  const id = crypto.randomUUID();
  const creado_en = Date.now();

  try {
    await c.env.DB.prepare(
      `INSERT INTO clientes
        (id, estudio_id, nombre, apellido, dni, domicilio, localidad, whatsapp, email, estado, notas, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Potencial', ?, ?)`
    )
      .bind(
        id,
        servicio.estudio_id,
        body.nombre,
        body.apellido,
        body.dni ?? null,
        body.domicilio ?? null,
        body.localidad ?? null,
        body.whatsapp ?? null,
        body.email ?? null,
        body.notas ?? null,
        creado_en
      )
      .run();
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'Ya existe un cliente con ese DNI.' }, 409);
    }
    throw err;
  }

  return c.json({ id, nombre: body.nombre, apellido: body.apellido, estado: 'Potencial' }, 201);
});

/** Expedientes de un cliente (para "cómo va mi causa"). */
n8nRouter.get('/expedientes', async (c) => {
  const servicio = c.get('servicio');
  const clienteId = c.req.query('cliente_id');
  if (!clienteId) return c.json({ error: 'cliente_id es obligatorio.' }, 400);

  const cliente = await c.env.DB.prepare(
    'SELECT id FROM clientes WHERE id = ? AND estudio_id = ?'
  ).bind(clienteId, servicio.estudio_id).first();
  if (!cliente) {
    return c.json({ error: 'Cliente no encontrado.' }, 404);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT id, caratula, numero, fuero, juzgado, estado
       FROM expedientes WHERE cliente_id = ? AND estudio_id = ?
      ORDER BY creado_en DESC`
  ).bind(clienteId, servicio.estudio_id).all();

  return c.json(results);
});

/**
 * Actuaciones de un expediente, solo las marcadas `visible = 1` (nunca el
 * detalle interno del abogado: detalle_interno, hito, etc. quedan afuera de
 * este SELECT a propósito).
 */
n8nRouter.get('/actuaciones', async (c) => {
  const servicio = c.get('servicio');
  const expedienteId = c.req.query('expediente_id');
  if (!expedienteId) return c.json({ error: 'expediente_id es obligatorio.' }, 400);

  const expediente = await c.env.DB.prepare(
    'SELECT id FROM expedientes WHERE id = ? AND estudio_id = ?'
  ).bind(expedienteId, servicio.estudio_id).first();
  if (!expediente) {
    return c.json({ error: 'Expediente no encontrado.' }, 404);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT id, tipo, fecha, texto_cliente
       FROM actuaciones
      WHERE expediente_id = ? AND estudio_id = ? AND visible = 1
      ORDER BY fecha DESC, creado_en DESC`
  ).bind(expedienteId, servicio.estudio_id).all();

  return c.json(results);
});

/**
 * Actuaciones visibles y todavía no notificadas al cliente, de todo el
 * estudio — el polling que dispara los mensajes de WhatsApp de "hubo una
 * actualización en tu expediente". n8n recorre este listado, manda el
 * WhatsApp, y confirma cada una con PATCH /actuaciones/:id/notificado.
 */
n8nRouter.get('/notificaciones-pendientes', async (c) => {
  const servicio = c.get('servicio');

  const { results } = await c.env.DB.prepare(
    `SELECT
       a.id, a.tipo, a.fecha, a.texto_cliente,
       e.id AS expediente_id, e.caratula AS expediente_caratula,
       cl.id AS cliente_id, cl.nombre AS cliente_nombre, cl.apellido AS cliente_apellido, cl.whatsapp AS cliente_whatsapp
     FROM actuaciones a
     JOIN expedientes e ON e.id = a.expediente_id
     JOIN clientes cl ON cl.id = e.cliente_id
    WHERE a.estudio_id = ? AND a.visible = 1 AND a.notificado = 0
    ORDER BY a.fecha ASC, a.creado_en ASC`
  ).bind(servicio.estudio_id).all();

  return c.json(results);
});

/** Confirma que una actuación ya fue notificada al cliente por WhatsApp. */
n8nRouter.patch('/actuaciones/:id/notificado', async (c) => {
  const servicio = c.get('servicio');
  const id = c.req.param('id');

  const actuacion = await c.env.DB.prepare(
    'SELECT id FROM actuaciones WHERE id = ? AND estudio_id = ?'
  ).bind(id, servicio.estudio_id).first();
  if (!actuacion) {
    return c.json({ error: 'Actuación no encontrada.' }, 404);
  }

  await c.env.DB.prepare('UPDATE actuaciones SET notificado = 1 WHERE id = ?').bind(id).run();
  return c.json({ id, notificado: true });
});

/**
 * Audiencias programadas con recordatorio pendiente de envío, dentro de los
 * próximos N días (default 2). Mismo patrón de polling que
 * /notificaciones-pendientes, para el recordatorio de audiencia por WhatsApp.
 */
n8nRouter.get('/audiencias-proximas', async (c) => {
  const servicio = c.get('servicio');
  const dias = Number(c.req.query('dias') ?? '2');

  const hoy = new Date();
  const limite = new Date(hoy);
  limite.setDate(limite.getDate() + dias);
  const desde = hoy.toISOString().slice(0, 10);
  const hasta = limite.toISOString().slice(0, 10);

  const { results } = await c.env.DB.prepare(
    `SELECT
       au.id, au.tipo, au.fecha, au.hora, au.modalidad, au.lugar,
       e.id AS expediente_id, e.caratula AS expediente_caratula,
       cl.id AS cliente_id, cl.nombre AS cliente_nombre, cl.apellido AS cliente_apellido, cl.whatsapp AS cliente_whatsapp
     FROM audiencias au
     JOIN expedientes e ON e.id = au.expediente_id
     JOIN clientes cl ON cl.id = e.cliente_id
    WHERE au.estudio_id = ?
      AND au.estado = 'Programada'
      AND au.recordatorio = 1
      AND au.recordatorio_enviado = 0
      AND au.fecha BETWEEN ? AND ?
    ORDER BY au.fecha ASC, au.hora ASC`
  ).bind(servicio.estudio_id, desde, hasta).all();

  return c.json(results);
});

/** Confirma que el recordatorio de una audiencia ya fue enviado al cliente por WhatsApp. */
n8nRouter.patch('/audiencias/:id/recordatorio-enviado', async (c) => {
  const servicio = c.get('servicio');
  const id = c.req.param('id');

  const audiencia = await c.env.DB.prepare(
    'SELECT id FROM audiencias WHERE id = ? AND estudio_id = ?'
  ).bind(id, servicio.estudio_id).first();
  if (!audiencia) {
    return c.json({ error: 'Audiencia no encontrada.' }, 404);
  }

  await c.env.DB.prepare('UPDATE audiencias SET recordatorio_enviado = 1 WHERE id = ?').bind(id).run();
  return c.json({ id, recordatorio_enviado: true });
});
