import { Hono } from 'hono';
import type { Bindings } from './tipos';

const app = new Hono<{ Bindings: Bindings }>();

/**
 * Ruta de verificación. Sirve para confirmar, desde el navegador o con
 * curl, que el Worker está desplegado y que la conexión con D1 funciona.
 * No requiere autenticación — no expone ningún dato del estudio.
 */
app.get('/api/salud', async (c) => {
  const resultado = await c.env.DB.prepare(
    'SELECT COUNT(*) AS total FROM estudios'
  ).first<{ total: number }>();

  return c.json({
    estado: 'ok',
    base_de_datos: 'conectada',
    estudios_registrados: resultado?.total ?? 0,
  });
});

/**
 * A partir de acá se van sumando los routers por entidad:
 *   app.route('/api/clientes', clientesRouter)
 *   app.route('/api/expedientes', expedientesRouter)
 *   ...
 * Cada uno en su propio archivo dentro de src/rutas/, para no repetir
 * el problema del archivo único de 1700+ líneas de la versión anterior.
 */

export default app;
