import { Hono } from "hono";
import { firmarUrlR2, type BindingsR2 } from "../lib/r2-firmado";

interface Bindings extends BindingsR2 {
  DB: D1Database;
  DOCUMENTOS: R2Bucket;
}

const documentosRouter = new Hono<{ Bindings: Bindings }>();

const CATEGORIAS_VALIDAS = [
  "escrito_judicial",
  "resolucion",
  "presupuesto",
  "estrategia",
  "planilla",
  "template",
  "factura",
  "captura",
  "otro",
] as const;

// Paso 1 del flujo: el frontend pide una URL para subir directo a R2.
// Todavía no se toca la base — se firma la URL y se devuelve.
documentosRouter.post("/solicitar-subida", async (c) => {
  const body = await c.req.json();
  const { estudio_id, categoria, nombre_archivo, content_type } = body;

  if (!estudio_id || !categoria || !nombre_archivo) {
    return c.json(
      { error: "estudio_id, categoria y nombre_archivo son obligatorios." },
      400
    );
  }
  if (!CATEGORIAS_VALIDAS.includes(categoria)) {
    return c.json(
      { error: `categoria debe ser una de: ${CATEGORIAS_VALIDAS.join(", ")}` },
      400
    );
  }

  const id = crypto.randomUUID();
  const extension = nombre_archivo.includes(".")
    ? nombre_archivo.split(".").pop()!.toLowerCase()
    : "sin_extension";
  const ruta_r2 = `${estudio_id}/${id}.${extension}`;

  const url_subida = await firmarUrlR2(c.env, "PUT", ruta_r2, {
    contentType: content_type || "application/octet-stream",
    expiresInSeconds: 900, // 15 min, contemplando escaneos pesados en conexión lenta
  });

  return c.json({ id, ruta_r2, url_subida, expira_en_segundos: 900 });
});

// Paso 2: el frontend ya hizo el PUT directo a R2 con url_subida.
// Recién acá se verifica que el objeto exista y se registra en D1.
documentosRouter.post("/confirmar-subida", async (c) => {
  const body = await c.req.json();
  const {
    id,
    estudio_id,
    categoria,
    nombre_archivo,
    ruta_r2,
    cliente_id,
    expediente_id,
    notas,
  } = body;

  if (!id || !estudio_id || !categoria || !nombre_archivo || !ruta_r2) {
    return c.json(
      { error: "id, estudio_id, categoria, nombre_archivo y ruta_r2 son obligatorios." },
      400
    );
  }

  const cabecera = await c.env.DOCUMENTOS.head(ruta_r2);
  if (!cabecera) {
    return c.json(
      { error: "El archivo no llegó a subirse a R2. Repetí el proceso desde /solicitar-subida." },
      409
    );
  }

  const extension = nombre_archivo.includes(".")
    ? nombre_archivo.split(".").pop()!.toLowerCase()
    : "sin_extension";
  const creado_en = Date.now();

  await c.env.DB.prepare(
    `INSERT INTO documentos
      (id, estudio_id, cliente_id, expediente_id, categoria, nombre, extension, ruta_r2, tamano_bytes, notas, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      estudio_id,
      cliente_id ?? null,
      expediente_id ?? null,
      categoria,
      nombre_archivo,
      extension,
      ruta_r2,
      cabecera.size,
      notas ?? null,
      creado_en
    )
    .run();

  return c.json(
    { id, nombre: nombre_archivo, categoria, tamano_bytes: cabecera.size },
    201
  );
});

documentosRouter.get("/", async (c) => {
  const estudioId = c.req.query("estudio_id");
  const expedienteId = c.req.query("expediente_id");
  const clienteId = c.req.query("cliente_id");
  if (!estudioId) {
    return c.json({ error: "estudio_id es obligatorio." }, 400);
  }
  let sql =
    "SELECT id, categoria, nombre, extension, tamano_bytes, notas, creado_en FROM documentos WHERE estudio_id = ?";
  const params: unknown[] = [estudioId];
  if (expedienteId) {
    sql += " AND expediente_id = ?";
    params.push(expedienteId);
  } else if (clienteId) {
    sql += " AND cliente_id = ?";
    params.push(clienteId);
  }
  sql += " ORDER BY creado_en DESC";
  const { results } = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json(results);
});

// Ahora devuelve una URL firmada de lectura (5 min), no el archivo proxiado.
documentosRouter.get("/:id/descargar", async (c) => {
  const id = c.req.param("id");
  const estudioId = c.req.query("estudio_id");
  if (!estudioId) {
    return c.json({ error: "estudio_id es obligatorio como parámetro de consulta." }, 400);
  }
  const doc = await c.env.DB.prepare(
    "SELECT nombre, ruta_r2 FROM documentos WHERE id = ? AND estudio_id = ?"
  )
    .bind(id, estudioId)
    .first<{ nombre: string; ruta_r2: string }>();
  if (!doc) {
    return c.json({ error: "Documento no encontrado." }, 404);
  }

  const url_descarga = await firmarUrlR2(c.env, "GET", doc.ruta_r2, {
    expiresInSeconds: 300,
    extraParams: {
      "response-content-disposition": `attachment; filename="${doc.nombre}"`,
    },
  });

  return c.json({ url_descarga, nombre: doc.nombre, expira_en_segundos: 300 });
});

documentosRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const estudioId = c.req.query("estudio_id");
  if (!estudioId) {
    return c.json({ error: "estudio_id es obligatorio como parámetro de consulta." }, 400);
  }

  const doc = await c.env.DB.prepare(
    "SELECT ruta_r2 FROM documentos WHERE id = ? AND estudio_id = ?"
  )
    .bind(id, estudioId)
    .first<{ ruta_r2: string }>();
  if (!doc) {
    return c.json({ error: "Documento no encontrado." }, 404);
  }

  await c.env.DOCUMENTOS.delete(doc.ruta_r2);
  await c.env.DB.prepare("DELETE FROM documentos WHERE id = ?").bind(id).run();

  return c.json({ id, eliminado: true });
});

export { documentosRouter };