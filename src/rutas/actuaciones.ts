import { Hono } from 'hono';
import type { Env } from '../tipos';
import { requireAuth } from '../middleware/auth';

export const actuacionesRouter = new Hono<Env>();

actuacionesRouter.use('*', requireAuth());

interface DocumentoAdjunto {
  id: string;
  nombre: string;
  extension: string;
  tamano_bytes: number | null;
}

/** Trae, agrupados por actuacion_id, los documentos adjuntos vía actuacion_documentos. */
async function documentosPorActuacion(
  db: D1Database,
  actuacionIds: string[]
): Promise<Map<string, DocumentoAdjunto[]>> {
  const mapa = new Map<string, DocumentoAdjunto[]>();
  if (actuacionIds.length === 0) return mapa;

  const placeholders = actuacionIds.map(() => '?').join(', ');
  const { results } = await db
    .prepare(
      `SELECT ad.actuacion_id, d.id, d.nombre, d.extension, d.tamano_bytes
         FROM actuacion_documentos ad
         JOIN documentos d ON d.id = ad.documento_id
        WHERE ad.actuacion_id IN (${placeholders})
        ORDER BY ad.creado_en ASC`
    )
    .bind(...actuacionIds)
    .all<{ actuacion_id: string; id: string; nombre: string; extension: string; tamano_bytes: number | null }>();

  for (const fila of results) {
    const lista = mapa.get(fila.actuacion_id) ?? [];
    lista.push({ id: fila.id, nombre: fila.nombre, extension: fila.extension, tamano_bytes: fila.tamano_bytes });
    mapa.set(fila.actuacion_id, lista);
  }
  return mapa;
}

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

/** Listado estilo MEV: cada actuación trae su array `documentos` (vacío si no tiene adjuntos). */
actuacionesRouter.get('/', async (c) => {
  const auth = c.get('auth');
  const expedienteId = c.req.query('expediente_id');
  if (!expedienteId) return c.json({ error: 'expediente_id es obligatorio.' }, 400);

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM actuaciones WHERE expediente_id = ? AND estudio_id = ? ORDER BY fecha DESC, creado_en DESC'
  ).bind(expedienteId, auth.estudio_id).all<{ id: string }>();

  const adjuntosPorActuacion = await documentosPorActuacion(c.env.DB, results.map((a) => a.id));

  const conAdjuntos = results.map((actuacion) => ({
    ...actuacion,
    documentos: adjuntosPorActuacion.get(actuacion.id) ?? [],
  }));

  return c.json(conAdjuntos);
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

/** Detalle completo de una actuación puntual (contenido del movimiento + adjuntos), para el drill-down de la vista MEV. */
actuacionesRouter.get('/:id', async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id');

  const actuacion = await c.env.DB.prepare(
    'SELECT * FROM actuaciones WHERE id = ? AND estudio_id = ?'
  ).bind(id, auth.estudio_id).first();
  if (!actuacion) {
    return c.json({ error: 'Actuación no encontrada.' }, 404);
  }

  const adjuntos = await documentosPorActuacion(c.env.DB, [id]);
  return c.json({ ...actuacion, documentos: adjuntos.get(id) ?? [] });
});

/** Vincula un documento ya subido (del mismo expediente) a esta actuación. */
actuacionesRouter.post('/:id/documentos', async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id');
  const { documento_id } = await c.req.json<{ documento_id: string }>();

  if (!documento_id) {
    return c.json({ error: 'documento_id es obligatorio.' }, 400);
  }

  const actuacion = await c.env.DB.prepare(
    'SELECT expediente_id FROM actuaciones WHERE id = ? AND estudio_id = ?'
  ).bind(id, auth.estudio_id).first<{ expediente_id: string }>();
  if (!actuacion) {
    return c.json({ error: 'Actuación no encontrada.' }, 404);
  }

  const documento = await c.env.DB.prepare(
    'SELECT expediente_id FROM documentos WHERE id = ? AND estudio_id = ?'
  ).bind(documento_id, auth.estudio_id).first<{ expediente_id: string | null }>();
  if (!documento) {
    return c.json({ error: 'Documento no encontrado.' }, 404);
  }
  if (documento.expediente_id !== null && documento.expediente_id !== actuacion.expediente_id) {
    return c.json({ error: 'El documento pertenece a otro expediente.' }, 400);
  }

  try {
    await c.env.DB.prepare(
      'INSERT INTO actuacion_documentos (actuacion_id, documento_id, creado_en) VALUES (?, ?, ?)'
    ).bind(id, documento_id, Date.now()).run();
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'El documento ya está vinculado a esta actuación.' }, 409);
    }
    throw err;
  }

  return c.json({ actuacion_id: id, documento_id, vinculado: true }, 201);
});

/** Desvincula un documento de la actuación (no borra el documento, solo el vínculo). */
actuacionesRouter.delete('/:id/documentos/:documentoId', async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id');
  const documentoId = c.req.param('documentoId');

  const actuacion = await c.env.DB.prepare(
    'SELECT id FROM actuaciones WHERE id = ? AND estudio_id = ?'
  ).bind(id, auth.estudio_id).first();
  if (!actuacion) {
    return c.json({ error: 'Actuación no encontrada.' }, 404);
  }

  const vinculo = await c.env.DB.prepare(
    'SELECT 1 FROM actuacion_documentos WHERE actuacion_id = ? AND documento_id = ?'
  ).bind(id, documentoId).first();
  if (!vinculo) {
    return c.json({ error: 'Ese documento no está vinculado a esta actuación.' }, 404);
  }

  await c.env.DB.prepare(
    'DELETE FROM actuacion_documentos WHERE actuacion_id = ? AND documento_id = ?'
  ).bind(id, documentoId).run();

  return c.json({ actuacion_id: id, documento_id: documentoId, desvinculado: true });
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
