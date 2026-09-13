import { Hono } from 'hono';
import type { Env } from '../tipos';
import { requireAuth } from '../middleware/auth';

export const estudiosRouter = new Hono<Env>();

/**
 * Alta de un estudio (provisión de un tenant nuevo). A propósito SIN
 * requireAuth(): es el problema del huevo y la gallina — para crear el
 * primer usuario de un estudio hace falta que el estudio ya exista, así que
 * esta ruta no puede exigir una sesión de un usuario que todavía no tiene
 * estudio. Hoy es alcanzable sin autenticación por cualquiera que llegue al
 * Worker (incluido el fallback *.workers.dev, que Access no cubre — ver
 * "Autenticación" en CLAUDE.md). Es una decisión de producto pendiente, no
 * un descuido: definir si esto sigue siendo así (onboarding self-service
 * futuro), se gatea con un secreto/invite-token, o se deshabilita en
 * producción y se corre a mano (wrangler) para cada estudio nuevo — VINDEX
 * es hoy de un solo estudio, así que no urge, pero no se debe asumir
 * resuelto.
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

/**
 * Devuelve el propio estudio del usuario autenticado (nunca el listado
 * completo de la plataforma — antes de este cambio esta ruta no tenía
 * requireAuth() y devolvía TODOS los estudios de todos los tenants, sin
 * excepción). Se mantiene la forma de array por compatibilidad con
 * clientes existentes; en la práctica siempre tiene 0 o 1 elementos.
 */
estudiosRouter.get('/', requireAuth(), async (c) => {
  const auth = c.get('auth');

  const { results } = await c.env.DB.prepare(
    'SELECT id, nombre, cuit, matricula, domicilio, localidad, creado_en, activo FROM estudios WHERE id = ?'
  )
    .bind(auth.estudio_id)
    .all();

  return c.json(results);
});
