import { Hono } from 'hono';
import type { Bindings } from '../tipos';

export const presupuestosRouter = new Hono<{ Bindings: Bindings }>();

presupuestosRouter.post('/', async (c) => {
  const body = await c.req.json<{
    estudio_id: string;
    cliente_id?: string;
    contacto_nombre?: string;
    contacto_telefono?: string;
    concepto: string;
    monto: number;
  }>();

  if (!body.estudio_id || !body.concepto || body.monto === undefined) {
    return c.json({ error: 'estudio_id, concepto y monto son obligatorios.' }, 400);
  }
  if (!body.cliente_id && !body.contacto_nombre) {
    return c.json(
      { error: 'Falta cliente_id (cliente existente) o contacto_nombre (potencial cliente).' },
      400
    );
  }

  const id = crypto.randomUUID();
  const creado_en = Date.now();

  await c.env.DB.prepare(
    `INSERT INTO presupuestos
      (id, estudio_id, cliente_id, contacto_nombre, contacto_telefono, concepto, monto, estado, fecha_emision, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'borrador', ?, ?)`
  )
    .bind(
      id, body.estudio_id, body.cliente_id ?? null, body.contacto_nombre ?? null,
      body.contacto_telefono ?? null, body.concepto, body.monto,
      new Date(creado_en).toISOString().slice(0, 10), creado_en
    )
    .run();

  return c.json({ id, estado: 'borrador' }, 201);
});

presupuestosRouter.get('/', async (c) => {
  const estudioId = c.req.query('estudio_id');
  if (!estudioId) return c.json({ error: 'estudio_id es obligatorio.' }, 400);

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM presupuestos WHERE estudio_id = ? ORDER BY creado_en DESC'
  ).bind(estudioId).all();

  return c.json(results);
});

/** Cambia el estado (enviado / rechazado / vencido) — transición simple. */
presupuestosRouter.patch('/:id/estado', async (c) => {
  const id = c.req.param('id');
  const { estado } = await c.req.json<{ estado: string }>();

  if (!['enviado', 'rechazado', 'vencido'].includes(estado)) {
    return c.json({ error: 'estado inválido. Usá /firmar para la firma.' }, 400);
  }

  await c.env.DB.prepare('UPDATE presupuestos SET estado = ? WHERE id = ?')
    .bind(estado, id)
    .run();

  return c.json({ id, estado });
});

/**
 * Firma del presupuesto: transición especial. Si todavía no existe el
 * cliente (era un potencial cliente por contacto_nombre), lo crea acá.
 * Requiere el expediente_id ya creado (se abre por separado, en
 * /api/expedientes, y se vincula acá).
 */
presupuestosRouter.patch('/:id/firmar', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{
    expediente_id: string;
    nombre?: string;
    apellido?: string;
    dni?: string;
  }>();

  const presupuesto = await c.env.DB.prepare(
    'SELECT * FROM presupuestos WHERE id = ?'
  ).bind(id).first<{
    estudio_id: string;
    cliente_id: string | null;
    contacto_telefono: string | null;
    estado: string;
  }>();

  if (!presupuesto) return c.json({ error: 'Presupuesto no encontrado.' }, 404);
  if (presupuesto.estado === 'firmado') {
    return c.json({ error: 'Este presupuesto ya está firmado.' }, 409);
  }
  if (!body.expediente_id) {
    return c.json({ error: 'expediente_id es obligatorio para firmar.' }, 400);
  }

  const expediente = await c.env.DB.prepare(
    'SELECT id FROM expedientes WHERE id = ? AND estudio_id = ?'
  )
    .bind(body.expediente_id, presupuesto.estudio_id)
    .first();

  if (!expediente) {
    return c.json(
      { error: 'El expediente no existe o no pertenece a este estudio.' },
      404
    );
  }

  let clienteId = presupuesto.cliente_id;

  if (!clienteId) {
    if (!body.nombre || !body.apellido) {
      return c.json(
        { error: 'Es un presupuesto sin cliente formal: nombre y apellido son obligatorios para darlo de alta.' },
        400
      );
    }
    clienteId = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO clientes (id, estudio_id, nombre, apellido, dni, telefono_fijo, estado, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, 'Activo', ?)`
    )
      .bind(
        clienteId, presupuesto.estudio_id, body.nombre, body.apellido,
        body.dni ?? null, presupuesto.contacto_telefono ?? null, Date.now()
      )
      .run();
  }

  const fecha_firma = new Date().toISOString().slice(0, 10);

  await c.env.DB.prepare(
    `UPDATE presupuestos
     SET estado = 'firmado', cliente_id = ?, expediente_id = ?, fecha_firma = ?
     WHERE id = ?`
  )
    .bind(clienteId, body.expediente_id, fecha_firma, id)
    .run();

  return c.json({ id, estado: 'firmado', cliente_id: clienteId, expediente_id: body.expediente_id });
});

/** Edita campos básicos de un presupuesto que todavía no fue firmado. */
presupuestosRouter.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const presupuesto = await c.env.DB.prepare(
    'SELECT estado FROM presupuestos WHERE id = ?'
  ).bind(id).first<{ estado: string }>();

  if (!presupuesto) return c.json({ error: 'Presupuesto no encontrado.' }, 404);
  if (presupuesto.estado === 'firmado') {
    return c.json({ error: 'No se puede editar un presupuesto ya firmado.' }, 409);
  }

  const body = await c.req.json<{
    concepto?: string;
    monto?: number;
    contacto_nombre?: string;
    contacto_telefono?: string;
  }>();

  const campos = {
    concepto: body.concepto,
    monto: body.monto,
    contacto_nombre: body.contacto_nombre,
    contacto_telefono: body.contacto_telefono,
  };
  const entradas = Object.entries(campos).filter(([, valor]) => valor !== undefined);
  if (entradas.length === 0) {
    return c.json({ error: 'No se recibió ningún campo para actualizar.' }, 400);
  }
  const asignaciones = entradas.map(([campo]) => `${campo} = ?`).join(', ');
  const valores = entradas.map(([, valor]) => valor);

  await c.env.DB.prepare(`UPDATE presupuestos SET ${asignaciones} WHERE id = ?`)
    .bind(...valores, id)
    .run();

  const actualizado = await c.env.DB.prepare('SELECT * FROM presupuestos WHERE id = ?').bind(id).first();
  return c.json(actualizado);
});

/** Elimina un presupuesto que todavía no fue firmado (borrador/enviado/rechazado/vencido). */
presupuestosRouter.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const presupuesto = await c.env.DB.prepare(
    'SELECT estado FROM presupuestos WHERE id = ?'
  ).bind(id).first<{ estado: string }>();

  if (!presupuesto) return c.json({ error: 'Presupuesto no encontrado.' }, 404);
  if (presupuesto.estado === 'firmado') {
    return c.json(
      { error: 'No se puede eliminar un presupuesto firmado: ya generó cliente y/o expediente vinculado.' },
      409
    );
  }

  await c.env.DB.prepare('DELETE FROM presupuestos WHERE id = ?').bind(id).run();
  return c.json({ id, eliminado: true });
});