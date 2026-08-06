import { Hono } from 'hono';
import type { Bindings } from '../tipos';

export const usuariosRouter = new Hono<{ Bindings: Bindings }>();

const ROLES_VALIDOS = ['titular', 'asociado', 'administrativo'] as const;
type Rol = (typeof ROLES_VALIDOS)[number];

usuariosRouter.post('/', async (c) => {
  const body = await c.req.json<{
    estudio_id: string;
    nombre: string;
    apellido: string;
    dni?: string;
    domicilio?: string;
    localidad?: string;
    telefono_fijo?: string;
    whatsapp?: string;
    email: string;
    rol: Rol;
  }>();

  if (!body.estudio_id || !body.nombre || !body.apellido || !body.email || !body.rol) {
    return c.json(
      { error: 'estudio_id, nombre, apellido, email y rol son obligatorios.' },
      400
    );
  }

  if (!ROLES_VALIDOS.includes(body.rol)) {
    return c.json({ error: `rol debe ser uno de: ${ROLES_VALIDOS.join(', ')}` }, 400);
  }

  const id = crypto.randomUUID();
  const creado_en = Date.now();

  try {
    await c.env.DB.prepare(
      `INSERT INTO usuarios
        (id, estudio_id, nombre, apellido, dni, domicilio, localidad, telefono_fijo, whatsapp, email, rol, activo, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
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
        body.email,
        body.rol,
        creado_en
      )
      .run();
  } catch (err) {
    // El email tiene restricción UNIQUE en el esquema.
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'No se pudo crear el usuario. ¿El email ya está en uso?' }, 409);
    }
    throw err;
  }

  return c.json({ id, nombre: body.nombre, apellido: body.apellido, email: body.email }, 201);
});

usuariosRouter.get('/', async (c) => {
  const estudioId = c.req.query('estudio_id');

  const query = estudioId
    ? c.env.DB.prepare(
        `SELECT id, estudio_id, nombre, apellido, dni, email, rol, activo, creado_en
         FROM usuarios WHERE estudio_id = ? ORDER BY apellido, nombre`
      ).bind(estudioId)
    : c.env.DB.prepare(
        `SELECT id, estudio_id, nombre, apellido, dni, email, rol, activo, creado_en
         FROM usuarios ORDER BY apellido, nombre`
      );

  const { results } = await query.all();
  return c.json(results);
});