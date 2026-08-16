import { Hono } from 'hono';
import type { Bindings } from '../tipos';

export const expedientesRouter = new Hono<{ Bindings: Bindings }>();

expedientesRouter.post('/', async (c) => {
  const body = await c.req.json<{
    estudio_id: string;
    cliente_id: string;
    caratula: string;
    numero?: string;
    fuero?: string;
    juzgado?: string;
    departamento?: string;
    rol_procesal?: string;
    inicio?: string;
    notas?: string;
  }>();

  if (!body.estudio_id || !body.cliente_id || !body.caratula) {
    return c.json(
      { error: 'estudio_id, cliente_id y caratula son obligatorios.' },
      400
    );
  }

  const cliente = await c.env.DB.prepare(
    'SELECT id FROM clientes WHERE id = ? AND estudio_id = ?'
  )
    .bind(body.cliente_id, body.estudio_id)
    .first();

  if (!cliente) {
    return c.json(
      { error: 'El cliente no existe o no pertenece a este estudio.' },
      404
    );
  }

  const id = crypto.randomUUID();
  const creado_en = Date.now();

  await c.env.DB.prepare(
    `INSERT INTO expedientes
      (id, estudio_id, cliente_id, caratula, numero, fuero, juzgado, departamento, rol_procesal, estado, inicio, notas, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'En trámite', ?, ?, ?)`
  )
    .bind(
      id,
      body.estudio_id,
      body.cliente_id,
      body.caratula,
      body.numero ?? null,
      body.fuero ?? null,
      body.juzgado ?? null,
      body.departamento ?? null,
      body.rol_procesal ?? null,
      body.inicio ?? null,
      body.notas ?? null,
      creado_en
    )
    .run();

  return c.json({ id, caratula: body.caratula, cliente_id: body.cliente_id }, 201);
});

expedientesRouter.get('/', async (c) => {
  const estudioId = c.req.query('estudio_id');
  const clienteId = c.req.query('cliente_id');

  if (!estudioId) {
    return c.json({ error: 'estudio_id es obligatorio como parámetro de consulta.' }, 400);
  }

  const query = clienteId
    ? c.env.DB.prepare(
        `SELECT e.*, c.nombre AS cliente_nombre, c.apellido AS cliente_apellido
         FROM expedientes e JOIN clientes c ON c.id = e.cliente_id
         WHERE e.estudio_id = ? AND e.cliente_id = ? ORDER BY e.creado_en DESC`
      ).bind(estudioId, clienteId)
    : c.env.DB.prepare(
        `SELECT e.*, c.nombre AS cliente_nombre, c.apellido AS cliente_apellido
         FROM expedientes e JOIN clientes c ON c.id = e.cliente_id
         WHERE e.estudio_id = ? ORDER BY e.creado_en DESC`
      ).bind(estudioId);

  const { results } = await query.all();
  return c.json(results);
});

/** Un expediente puntual, con el nombre del cliente ya resuelto. */
expedientesRouter.get('/:id', async (c) => {
  const id = c.req.param('id');
  const estudioId = c.req.query('estudio_id');

  if (!estudioId) {
    return c.json({ error: 'estudio_id es obligatorio como parámetro de consulta.' }, 400);
  }

  const expediente = await c.env.DB.prepare(
    `SELECT e.*, c.nombre AS cliente_nombre, c.apellido AS cliente_apellido
     FROM expedientes e JOIN clientes c ON c.id = e.cliente_id
     WHERE e.id = ? AND e.estudio_id = ?`
  ).bind(id, estudioId).first();

  if (!expediente) {
    return c.json({ error: 'Expediente no encontrado.' }, 404);
  }

  return c.json(expediente);
});

/** Da de baja un expediente (baja lógica: no borra el registro). */
expedientesRouter.patch('/:id/baja', async (c) => {
  const id = c.req.param('id');
  const estudioId = c.req.query('estudio_id');

  if (!estudioId) {
    return c.json({ error: 'estudio_id es obligatorio como parámetro de consulta.' }, 400);
  }

  const { motivo } = await c.req.json<{ motivo?: string }>();

  const expediente = await c.env.DB.prepare(
    'SELECT id FROM expedientes WHERE id = ? AND estudio_id = ?'
  )
    .bind(id, estudioId)
    .first();

  if (!expediente) {
    return c.json({ error: 'Expediente no encontrado.' }, 404);
  }

  const hoy = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date());

  await c.env.DB.prepare(
    `UPDATE expedientes SET estado = 'Archivado', baja = ?, motivo_baja = ? WHERE id = ?`
  )
    .bind(hoy, motivo ?? null, id)
    .run();

  const actualizado = await c.env.DB.prepare('SELECT * FROM expedientes WHERE id = ?')
    .bind(id)
    .first();

  return c.json(actualizado);
});

/** Reactiva un expediente dado de baja. */
expedientesRouter.patch('/:id/reactivar', async (c) => {
  const id = c.req.param('id');
  const estudioId = c.req.query('estudio_id');

  if (!estudioId) {
    return c.json({ error: 'estudio_id es obligatorio como parámetro de consulta.' }, 400);
  }

  const expediente = await c.env.DB.prepare(
    'SELECT id FROM expedientes WHERE id = ? AND estudio_id = ?'
  )
    .bind(id, estudioId)
    .first();

  if (!expediente) {
    return c.json({ error: 'Expediente no encontrado.' }, 404);
  }

  await c.env.DB.prepare(
    `UPDATE expedientes SET estado = 'En trámite', baja = NULL, motivo_baja = NULL WHERE id = ?`
  )
    .bind(id)
    .run();

  const actualizado = await c.env.DB.prepare('SELECT * FROM expedientes WHERE id = ?')
    .bind(id)
    .first();

  return c.json(actualizado);
});
expedientesRouter.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const estudioId = c.req.query("estudio_id");
  if (!estudioId) {
    return c.json({ error: "estudio_id es obligatorio como parámetro de consulta." }, 400);
  }
  const actual = await c.env.DB.prepare(
    "SELECT id FROM expedientes WHERE id = ? AND estudio_id = ?"
  ).bind(id, estudioId).first();
  if (!actual) {
    return c.json({ error: "Expediente no encontrado." }, 404);
  }
  const body = await c.req.json();
  const campos = {
    caratula: body.caratula,
    numero: body.numero,
    fuero: body.fuero,
    juzgado: body.juzgado,
    departamento: body.departamento,
    rol_procesal: body.rol_procesal,
    notas: body.notas,
  };
  const entradas = Object.entries(campos).filter(([, valor]) => valor !== undefined);
  if (entradas.length === 0) {
    return c.json({ error: "No se recibió ningún campo para actualizar." }, 400);
  }
  const asignaciones = entradas.map(([campo]) => `${campo} = ?`).join(", ");
  const valores = entradas.map(([, valor]) => valor);
  await c.env.DB.prepare(`UPDATE expedientes SET ${asignaciones} WHERE id = ?`)
    .bind(...valores, id)
    .run();
  const actualizado = await c.env.DB.prepare("SELECT * FROM expedientes WHERE id = ?").bind(id).first();
  return c.json(actualizado);
});
expedientesRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const estudioId = c.req.query("estudio_id");
  if (!estudioId) {
    return c.json({ error: "estudio_id es obligatorio como parámetro de consulta." }, 400);
  }
  const expediente = await c.env.DB.prepare(
    "SELECT id FROM expedientes WHERE id = ? AND estudio_id = ?"
  ).bind(id, estudioId).first();
  if (!expediente) {
    return c.json({ error: "Expediente no encontrado." }, 404);
  }

  const [documentos, audiencias, actuaciones, estrategias, presupuestos] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) AS total FROM documentos WHERE expediente_id = ?").bind(id).first<{ total: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS total FROM audiencias WHERE expediente_id = ?").bind(id).first<{ total: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS total FROM actuaciones WHERE expediente_id = ?").bind(id).first<{ total: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS total FROM estrategias WHERE expediente_id = ?").bind(id).first<{ total: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS total FROM presupuestos WHERE expediente_id = ?").bind(id).first<{ total: number }>(),
  ]);

  const bloqueos: string[] = [];
  if ((documentos?.total ?? 0) > 0) bloqueos.push(`${documentos!.total} documento(s)`);
  if ((audiencias?.total ?? 0) > 0) bloqueos.push(`${audiencias!.total} audiencia(s)`);
  if ((actuaciones?.total ?? 0) > 0) bloqueos.push(`${actuaciones!.total} actuación(es)`);
  if ((estrategias?.total ?? 0) > 0) bloqueos.push(`${estrategias!.total} estrategia(s)`);
  if ((presupuestos?.total ?? 0) > 0) bloqueos.push(`${presupuestos!.total} presupuesto(s)`);

  if (bloqueos.length > 0) {
    return c.json(
      {
        error: `No se puede eliminar: tiene registros vinculados (${bloqueos.join(", ")}). Usá PATCH /:id/baja para archivarlo en su lugar.`,
      },
      409
    );
  }

  await c.env.DB.prepare("DELETE FROM expedientes WHERE id = ?").bind(id).run();
  return c.json({ id, eliminado: true });
});