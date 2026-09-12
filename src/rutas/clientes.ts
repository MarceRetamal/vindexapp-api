import { Hono } from 'hono';
import type { Env } from '../tipos';
import { requireAuth } from '../middleware/auth';

export const clientesRouter = new Hono<Env>();

clientesRouter.use('*', requireAuth());

clientesRouter.post('/', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json<{
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

  if (!body.nombre || !body.apellido) {
    return c.json({ error: 'nombre y apellido son obligatorios.' }, 400);
  }

  // Si viene DNI, verificamos primero si ya existe un cliente con ese
  // DNI en este mismo estudio, para poder devolver un mensaje claro
  // (y no depender únicamente del error de la base).
  if (body.dni) {
    const existente = await c.env.DB.prepare(
      'SELECT id, nombre, apellido FROM clientes WHERE estudio_id = ? AND dni = ?'
    )
      .bind(auth.estudio_id, body.dni)
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
        auth.estudio_id,
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
  const auth = c.get('auth');
  const dni = c.req.query('dni');

  const query = dni
    ? c.env.DB.prepare(
        `SELECT * FROM clientes WHERE estudio_id = ? AND dni = ?`
      ).bind(auth.estudio_id, dni)
    : c.env.DB.prepare(
        `SELECT * FROM clientes WHERE estudio_id = ? ORDER BY apellido, nombre`
      ).bind(auth.estudio_id);

  const { results } = await query.all();
  return c.json(results);
});

/** Un cliente puntual. */
clientesRouter.get('/:id', async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id');

  const cliente = await c.env.DB.prepare(
    'SELECT * FROM clientes WHERE id = ? AND estudio_id = ?'
  ).bind(id, auth.estudio_id).first();

  if (!cliente) {
    return c.json({ error: 'Cliente no encontrado.' }, 404);
  }

  return c.json(cliente);
});

/** Actualiza campos de un cliente existente. Solo pisa los campos presentes en el body. */
clientesRouter.patch('/:id', async (c) => {
  const auth = c.get('auth');
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
    'SELECT id FROM clientes WHERE id = ? AND estudio_id = ?'
  )
    .bind(id, auth.estudio_id)
    .first();

  if (!actual) {
    return c.json({ error: 'Cliente no encontrado.' }, 404);
  }

  if (body.dni) {
    const existente = await c.env.DB.prepare(
      'SELECT id, nombre, apellido FROM clientes WHERE estudio_id = ? AND dni = ? AND id != ?'
    )
      .bind(auth.estudio_id, body.dni, id)
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
