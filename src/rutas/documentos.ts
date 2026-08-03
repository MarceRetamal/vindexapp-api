import { Hono } from 'hono';
import type { Bindings } from '../tipos';

export const documentosRouter = new Hono<{ Bindings: Bindings }>();

const CATEGORIAS_VALIDAS = [
  'escrito_judicial', 'resolucion', 'presupuesto', 'estrategia',
  'planilla', 'template', 'factura', 'captura', 'otro',
] as const;

/**
 * Sube un archivo real a R2 y registra su metadata en D1, en un solo
 * pedido. Se espera multipart/form-data con:
 *   - archivo: el File
 *   - estudio_id, categoria: obligatorios
 *   - cliente_id, expediente_id, notas: opcionales
 */
documentosRouter.post('/', async (c) => {
  const body = await c.req.parseBody();
  const archivo = body['archivo'];

  if (!(archivo instanceof File)) {
    return c.json({ error: 'Falta el archivo (campo "archivo").' }, 400);
  }

  const estudio_id = body['estudio_id'] as string | undefined;
  const categoria = body['categoria'] as string | undefined;

  if (!estudio_id || !categoria) {
    return c.json({ error: 'estudio_id y categoria son obligatorios.' }, 400);
  }

  if (!CATEGORIAS_VALIDAS.includes(categoria as (typeof CATEGORIAS_VALIDAS)[number])) {
    return c.json({ error: `categoria debe ser una de: ${CATEGORIAS_VALIDAS.join(', ')}` }, 400);
  }

  const cliente_id = (body['cliente_id'] as string) || null;
  const expediente_id = (body['expediente_id'] as string) || null;
  const notas = (body['notas'] as string) || null;

  const id = crypto.randomUUID();
  const extension = archivo.name.includes('.')
    ? archivo.name.split('.').pop()!.toLowerCase()
    : 'sin_extension';
  const ruta_r2 = `${estudio_id}/${id}.${extension}`;
  const creado_en = Date.now();

  // 1. Subida real del archivo al bucket.
  await c.env.DOCUMENTOS.put(ruta_r2, await archivo.arrayBuffer(), {
    httpMetadata: { contentType: archivo.type || 'application/octet-stream' },
  });

  // 2. Registro de la metadata en la base.
  await c.env.DB.prepare(
    `INSERT INTO documentos
      (id, estudio_id, cliente_id, expediente_id, categoria, nombre, extension, ruta_r2, tamano_bytes, notas, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id, estudio_id, cliente_id, expediente_id, categoria,
      archivo.name, extension, ruta_r2, archivo.size, notas, creado_en
    )
    .run();

  return c.json({ id, nombre: archivo.name, categoria, tamano_bytes: archivo.size }, 201);
});

documentosRouter.get('/', async (c) => {
  const estudioId = c.req.query('estudio_id');
  const expedienteId = c.req.query('expediente_id');
  const clienteId = c.req.query('cliente_id');

  if (!estudioId) {
    return c.json({ error: 'estudio_id es obligatorio.' }, 400);
  }

  let sql = 'SELECT id, categoria, nombre, extension, tamano_bytes, notas, creado_en FROM documentos WHERE estudio_id = ?';
  const params: string[] = [estudioId];

  if (expedienteId) {
    sql += ' AND expediente_id = ?';
    params.push(expedienteId);
  } else if (clienteId) {
    sql += ' AND cliente_id = ?';
    params.push(clienteId);
  }
  sql += ' ORDER BY creado_en DESC';

  const { results } = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json(results);
});

/** Descarga el archivo real, transmitido a través del Worker. */
documentosRouter.get('/:id/descargar', async (c) => {
  const id = c.req.param('id');

  const doc = await c.env.DB.prepare(
    'SELECT nombre, ruta_r2 FROM documentos WHERE id = ?'
  )
    .bind(id)
    .first<{ nombre: string; ruta_r2: string }>();

  if (!doc) {
    return c.json({ error: 'Documento no encontrado.' }, 404);
  }

  const objeto = await c.env.DOCUMENTOS.get(doc.ruta_r2);
  if (!objeto) {
    return c.json({ error: 'El archivo no existe en el almacenamiento.' }, 404);
  }

  c.header('Content-Disposition', `attachment; filename="${doc.nombre}"`);
  return c.body(objeto.body);
});