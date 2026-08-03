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

  // Confirmamos que el cliente exista y pertenezca a este mismo estudio,
  // antes de abrirle un expediente.
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
        `SELECT * FROM expedientes WHERE estudio_id = ? AND cliente_id = ? ORDER BY creado_en DESC`
      ).bind(estudioId, clienteId)
    : c.env.DB.prepare(
        `SELECT * FROM expedientes WHERE estudio_id = ? ORDER BY creado_en DESC`
      ).bind(estudioId);

  const { results } = await query.all();
  return c.json(results);
});