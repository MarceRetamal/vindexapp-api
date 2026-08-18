import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Bindings } from './tipos';
import { estudiosRouter } from './rutas/estudios';
import { usuariosRouter } from './rutas/usuarios';
import { clientesRouter } from './rutas/clientes';
import { expedientesRouter } from './rutas/expedientes';
import { documentosRouter } from './rutas/documentos';
import { presupuestosRouter } from './rutas/presupuestos';
import { estrategiasRouter } from './rutas/estrategias';
import { actuacionesRouter } from './rutas/actuaciones';
import { templatesRouter } from './rutas/templates';
import { audienciasRouter } from './rutas/audiencias';
import { liquidacionesRouter } from './rutas/liquidaciones';
import { whoamiRouter } from './rutas/whoami';
import { tareasRouter } from './rutas/tareas';
import { dashboardRouter } from './rutas/dashboard';
import { reportesRouter } from './rutas/reportes';
import { generadorDocumentosRouter } from './rutas/generador-documentos';
import { googleCalendarRouter } from './rutas/google-calendar';

const app = new Hono<{ Bindings: Bindings }>();

app.use(
  '/api/*',
  cors({
    origin: ['http://localhost:5173', 'https://panel.vindexlegal.com.ar'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE'],
    credentials: true,
  })
);

app.route('/api/estudios', estudiosRouter);
app.route('/api/usuarios', usuariosRouter);
app.route('/api/clientes', clientesRouter);
app.route('/api/expedientes', expedientesRouter);
app.route('/api/documentos', documentosRouter);
app.route('/api/presupuestos', presupuestosRouter);
app.route('/api/estrategias', estrategiasRouter);
app.route('/api/actuaciones', actuacionesRouter);
app.route('/api/templates', templatesRouter);
app.route('/api/audiencias', audienciasRouter);
app.route('/api/liquidaciones', liquidacionesRouter);
app.route('/api/whoami', whoamiRouter);
app.route('/api/tareas', tareasRouter);
app.route('/api/dashboard', dashboardRouter);
app.route('/api/reportes', reportesRouter);
app.route('/api/generador-documentos', generadorDocumentosRouter);
app.route('/api/google-calendar', googleCalendarRouter);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'Error interno del servidor.' }, 500);
});

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

export default app;