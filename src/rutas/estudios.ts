import { Hono } from 'hono';
import type { Bindings } from '../tipos';

export const estudiosRouter = new Hono<{ Bindings: Bindings }>();

/**
 * Alta de un estudio. Sin autenticación todavía (se agrega con Access) —
 * por ahora solo la usamos una vez, para crear tu propio estudio.
 */
estudiosRouter.post('/', async (c) => {
  const body = await c.req.json<{
    nombre: string;
    cuit?: string;
    matricula?: string;
    domicilio?: string;
    localidad?: string;
  }>();

  if (!body.nombre) {
    return c.json({ error: 'El campo nombre es obligatorio.' }, 400);
  }

  const id = crypto.randomUUID();
  const creado_en = Date.now();

  await c.env.DB.prepare(
    `INSERT INTO estudios (id, nombre, cuit, matricula, domicilio, localidad, creado_en, activo)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
  )
    .bind(
      id,
      body.nombre,
      body.cuit ?? null,
      body.matricula ?? null,
      body.domicilio ?? null,
      body.localidad ?? null,
      creado_en
    )
    .run();

  return c.json({ id, nombre: body.nombre, creado_en }, 201);
});

/** Listado simple de estudios. */
estudiosRouter.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, nombre, cuit, matricula, domicilio, localidad, creado_en, activo FROM estudios ORDER BY creado_en DESC'
  ).all();

  return c.json(results);
});