import { Hono } from 'hono';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import type { Bindings } from '../tipos';

export const generadorDocumentosRouter = new Hono<{ Bindings: Bindings }>();

// TODO: mover a una columna en `estudios` (p. ej. domicilio_procesal) cuando
// exista más de un estudio usando este generador.
const DOMICILIO_PROCESAL_DEFAULT = 'calle 46 N° 1068, La Plata';

function formatearFechaHoy(): string {
  const ahora = new Date();
  const dia = String(ahora.getDate()).padStart(2, '0');
  const mes = String(ahora.getMonth() + 1).padStart(2, '0');
  const anio = ahora.getFullYear();
  return `${dia}/${mes}/${anio}`;
}

generadorDocumentosRouter.post('/', async (c) => {
  const body = await c.req.json<{
    estudio_id: string;
    template_id: string;
    expediente_id: string;
    categoria_resultado?: string;
  }>();

  const { estudio_id, template_id, expediente_id, categoria_resultado } = body;

  if (!estudio_id || !template_id || !expediente_id) {
    return c.json(
      { error: 'estudio_id, template_id y expediente_id son obligatorios.' },
      400
    );
  }

  const template = await c.env.DB.prepare(
    'SELECT id, nombre, documento_id FROM templates WHERE id = ? AND estudio_id = ?'
  )
    .bind(template_id, estudio_id)
    .first<{ id: string; nombre: string; documento_id: string | null }>();

  if (!template) {
    return c.json({ error: 'Template no encontrado.' }, 404);
  }
  if (!template.documento_id) {
    return c.json({ error: 'El template no tiene un documento fuente asociado.' }, 422);
  }

  const documentoFuente = await c.env.DB.prepare(
    'SELECT id, ruta_r2 FROM documentos WHERE id = ? AND estudio_id = ?'
  )
    .bind(template.documento_id, estudio_id)
    .first<{ id: string; ruta_r2: string }>();

  if (!documentoFuente) {
    return c.json({ error: 'El documento fuente del template no fue encontrado.' }, 404);
  }

  const expediente = await c.env.DB.prepare(
    `SELECT
       e.id AS expediente_id,
       e.cliente_id AS cliente_id,
       e.caratula AS expediente_caratula,
       e.numero AS expediente_numero,
       e.fuero AS expediente_fuero,
       e.juzgado AS expediente_juzgado,
       e.departamento AS expediente_departamento,
       c.nombre AS cliente_nombre,
       c.apellido AS cliente_apellido,
       c.dni AS cliente_dni,
       c.domicilio AS cliente_domicilio
     FROM expedientes e
     JOIN clientes c ON c.id = e.cliente_id
     WHERE e.id = ? AND e.estudio_id = ?`
  )
    .bind(expediente_id, estudio_id)
    .first<{
      expediente_id: string;
      cliente_id: string;
      expediente_caratula: string;
      expediente_numero: string | null;
      expediente_fuero: string | null;
      expediente_juzgado: string | null;
      expediente_departamento: string | null;
      cliente_nombre: string;
      cliente_apellido: string;
      cliente_dni: string | null;
      cliente_domicilio: string | null;
    }>();

  if (!expediente) {
    return c.json({ error: 'Expediente no encontrado.' }, 404);
  }

  const objetoR2 = await c.env.DOCUMENTOS.get(documentoFuente.ruta_r2);
  if (!objetoR2) {
    return c.json({ error: 'El archivo fuente del template no se encuentra en R2.' }, 409);
  }
  const bufferOriginal = await objetoR2.arrayBuffer();

  const datos = {
    cliente_nombre: expediente.cliente_nombre,
    cliente_apellido: expediente.cliente_apellido,
    cliente_dni: expediente.cliente_dni,
    cliente_domicilio: expediente.cliente_domicilio,
    expediente_caratula: expediente.expediente_caratula,
    expediente_numero: expediente.expediente_numero,
    expediente_fuero: expediente.expediente_fuero,
    expediente_juzgado: expediente.expediente_juzgado,
    expediente_departamento: expediente.expediente_departamento,
    fecha_hoy: formatearFechaHoy(),
    estudio_domicilio_procesal: DOMICILIO_PROCESAL_DEFAULT,
  };

  let bufferRenderizado: Uint8Array;
  try {
    const zip = new PizZip(bufferOriginal);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      nullGetter: () => '',
    });
    doc.render(datos);
    bufferRenderizado = doc.getZip().generate({ type: 'uint8array' });
  } catch (error: any) {
    const mensaje =
      error?.properties?.errors?.[0]?.properties?.explanation ||
      error?.message ||
      'Error desconocido al procesar el template.';
    return c.json(
      { error: 'El template tiene un error de formato: ' + mensaje },
      422
    );
  }

  const nuevoId = crypto.randomUUID();
  const ruta_r2 = `${estudio_id}/${nuevoId}.docx`;

  await c.env.DOCUMENTOS.put(ruta_r2, bufferRenderizado, {
    httpMetadata: {
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
  });

  const nombre = `${template.nombre} - ${expediente.expediente_caratula}`;
  const categoria = categoria_resultado ?? 'escrito_judicial';
  const creado_en = Date.now();
  const tamano_bytes = bufferRenderizado.byteLength;

  await c.env.DB.prepare(
    `INSERT INTO documentos
      (id, estudio_id, cliente_id, expediente_id, categoria, nombre, extension, ruta_r2, tamano_bytes, cargado_por, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      nuevoId,
      estudio_id,
      expediente.cliente_id,
      expediente_id,
      categoria,
      nombre,
      'docx',
      ruta_r2,
      tamano_bytes,
      null,
      creado_en
    )
    .run();

  return c.json({ id: nuevoId, nombre, ruta_r2 }, 201);
});
