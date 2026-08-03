import { Hono } from 'hono';
import type { Bindings } from './tipos';
import { estudiosRouter } from './rutas/estudios';
import { usuariosRouter } from './rutas/usuarios';
import { clientesRouter } from './rutas/clientes';
import { expedientesRouter } from './rutas/expedientes';
import { documentosRouter } from './rutas/documentos';
import { presupuestosRouter } from './rutas/presupuestos';
import { estrategiasRouter } from './rutas/estrategias';
import { actuacionesRouter } from './rutas/actuaciones';
const app = new Hono<{ Bindings: Bindings }>();

app.route('/api/estudios', estudiosRouter);
app.route('/api/usuarios', usuariosRouter);
app.route('/api/clientes', clientesRouter);
app.route('/api/expedientes', expedientesRouter);
app.route('/api/documentos', documentosRouter);
app.route('/api/presupuestos', presupuestosRouter);
app.route('/api/estrategias', estrategiasRouter);
app.route('/api/actuaciones', actuacionesRouter);


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
 * Siguientes routers a sumar, mismo patrón:
 *   app.route('/api/clientes', clientesRouter)
 *   app.route('/api/expedientes', expedientesRouter)
 *   ...
 */

export default app;