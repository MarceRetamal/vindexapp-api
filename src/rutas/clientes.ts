import { Hono } from 'hono';
import type { Bindings } from '../tipos';

export const clientesRouter = new Hono<{ Bindings: Bindings }>();

clientesRouter.post('/', async (c) => {
  const body = await c.req.json<{
    estudio_id: string;
    nombre: string;
    apellido: string;
    dni?: string;
    domicilio?: string;
    localidad?: string;
    telefono_fijo?: string;
    whatsapp?: string;
    email?: string;
    estado?: 'Activo' | 'Potencial' | 'Inactivo';
    notas?: string;
  }>();

  if (!body.estudio_id || !body.nombre || !body.apellido) {
    return c.json({ error: 'estudio_id, nombre y apellido son obligatorios.' }, 400);
  }

  // Si viene DNI, verificamos primero si ya existe un cliente con ese
  // DNI en este mismo estudio, para poder devolver un mensaje claro
  // (y no depender únicamente del error de la base).
  if (body.dni) {
    const existente = await c.env.DB.prepare(
      'SELECT id, nombre, apellido FROM clientes WHERE estudio_id = ? AND dni = ?'
    )
      .bind(body.estudio_id, body.dni)
      .first<{ id: string; nombre: string; apellido: string }>();

    if (existente) {
      return c.json(
        {
          error: 'Ya existe un cliente con ese DNI.',
          cliente_existente: existente,
        },
        409
      );
    }
  }

  const id = crypto.randomUUID();
  const creado_en = Date.now();

  try {
    await c.env.DB.prepare(
      `INSERT INTO clientes
        (id, estudio_id, nombre, apellido, dni, domicilio, localidad, telefono_fijo, whatsapp, email, estado, notas, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        body.estudio_id,
        body.nombre,
        body.apellido,
        body.dni ?? null,
        body.domicilio ?? null,
        body.localidad ?? null,
        body.telefono_fijo ?? null,
        body.whatsapp ?? null,
        body.email ?? null,
        body.estado ?? 'Activo',
        body.notas ?? null,
        creado_en
      )
      .run();
  } catch (err) {
    // Red de seguridad ante una carrera de dos pedidos simultáneos con
    // el mismo DNI (el chequeo de arriba no la cubre al 100%).
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'Ya existe un cliente con ese DNI.' }, 409);
    }
    throw err;
  }

  return c.json({ id, nombre: body.nombre, apellido: body.apellido }, 201);
});

clientesRouter.get('/', async (c) => {
  const estudioId = c.req.query('estudio_id');
  const dni = c.req.query('dni');

  if (!estudioId) {
    return c.json({ error: 'estudio_id es obligatorio como parámetro de consulta.' }, 400);
  }

  const query = dni
    ? c.env.DB.prepare(
        `SELECT * FROM clientes WHERE estudio_id = ? AND dni = ?`
      ).bind(estudioId, dni)
    : c.env.DB.prepare(
        `SELECT * FROM clientes WHERE estudio_id = ? ORDER BY apellido, nombre`
      ).bind(estudioId);

  const { results } = await query.all();
  return c.json(results);
});

/** Un cliente puntual. */
clientesRouter.get('/:id', async (c) => {
  const id = c.req.param('id');

  const cliente = await c.env.DB.prepare(
    'SELECT * FROM clientes WHERE id = ?'
  ).bind(id).first();

  if (!cliente) {
    return c.json({ error: 'Cliente no encontrado.' }, 404);
  }

  return c.json(cliente);
});

/** Actualiza campos de un cliente existente. Solo pisa los campos presentes en el body. */
clientesRouter.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{
    nombre?: string;
    apellido?: string;
    dni?: string;
    domicilio?: string;
    localidad?: string;
    telefono_fijo?: string;
    whatsapp?: string;
    email?: string;
    estado?: 'Activo' | 'Potencial' | 'Inactivo';
    notas?: string;
  }>();

  const actual = await c.env.DB.prepare(
    'SELECT id, estudio_id FROM clientes WHERE id = ?'
  )
    .bind(id)
    .first<{ id: string; estudio_id: string }>();

  if (!actual) {
    return c.json({ error: 'Cliente no encontrado.' }, 404);
  }

  if (body.dni) {
    const existente = await c.env.DB.prepare(
      'SELECT id, nombre, apellido FROM clientes WHERE estudio_id = ? AND dni = ? AND id != ?'
    )
      .bind(actual.estudio_id, body.dni, id)
      .first<{ id: string; nombre: string; apellido: string }>();

    if (existente) {
      return c.json(
        { error: 'Ya existe un cliente con ese DNI.', cliente_existente: existente },
        409
      );
    }
  }

  const campos: Record<string, unknown> = {
    nombre: body.nombre,
    apellido: body.apellido,
    dni: body.dni,
    domicilio: body.domicilio,
    localidad: body.localidad,
    telefono_fijo: body.telefono_fijo,
    whatsapp: body.whatsapp,
    email: body.email,
    estado: body.estado,
    notas: body.notas,
  };

  const entradas = Object.entries(campos).filter(([, valor]) => valor !== undefined);

  if (entradas.length === 0) {
    return c.json({ error: 'No se recibió ningún campo para actualizar.' }, 400);
  }

  const asignaciones = entradas.map(([campo]) => `${campo} = ?`).join(', ');
  const valores = entradas.map(([, valor]) => valor);

  try {
    await c.env.DB.prepare(`UPDATE clientes SET ${asignaciones} WHERE id = ?`)
      .bind(...valores, id)
      .run();
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'Ya existe un cliente con ese DNI.' }, 409);
    }
    throw err;
  }

  const actualizado = await c.env.DB.prepare('SELECT * FROM clientes WHERE id = ?')
    .bind(id)
    .first();

  return c.json(actualizado);
});
