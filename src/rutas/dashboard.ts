import { Hono } from 'hono';
import type { Bindings } from '../tipos';

export const dashboardRouter = new Hono<{ Bindings: Bindings }>();

dashboardRouter.get('/', async (c) => {
  const estudioId = c.req.query('estudio_id');
  if (!estudioId) return c.json({ error: 'estudio_id es obligatorio.' }, 400);

  const dias = 7;
  const hoy = new Date();
  const limite = new Date(hoy);
  limite.setDate(limite.getDate() + dias);
  const desde = hoy.toISOString().slice(0, 10);
  const hasta = limite.toISOString().slice(0, 10);

  const [proximasAudiencias, vencimientosProximos, tareasTotal, tareasProximas, expedientesActivos] =
    await Promise.all([
      c.env.DB.prepare(
        `SELECT au.*, e.caratula AS expediente_caratula
           FROM audiencias au
           JOIN expedientes e ON e.id = au.expediente_id
          WHERE au.estudio_id = ? AND au.estado = 'Programada'
          ORDER BY au.fecha ASC
          LIMIT 5`
      ).bind(estudioId).all(),

      c.env.DB.prepare(
        `SELECT a.*, e.caratula AS expediente_caratula, c.apellido AS cliente_apellido, c.nombre AS cliente_nombre
           FROM actuaciones a
           JOIN expedientes e ON e.id = a.expediente_id
           JOIN clientes c ON c.id = e.cliente_id
          WHERE a.estudio_id = ?
            AND a.vencimiento IS NOT NULL
            AND a.vencimiento BETWEEN ? AND ?
          ORDER BY a.vencimiento ASC
          LIMIT 5`
      ).bind(estudioId, desde, hasta).all(),

      c.env.DB.prepare(
        `SELECT COUNT(*) AS total FROM tareas WHERE estudio_id = ? AND estado != 'Completada'`
      ).bind(estudioId).first<{ total: number }>(),

      c.env.DB.prepare(
        `SELECT t.*, e.caratula AS expediente_caratula
           FROM tareas t
           JOIN expedientes e ON e.id = t.expediente_id
          WHERE t.estudio_id = ? AND t.estado != 'Completada'
          ORDER BY t.fecha_limite IS NULL, t.fecha_limite ASC
          LIMIT 5`
      ).bind(estudioId).all(),

      c.env.DB.prepare(
        `SELECT COUNT(*) AS total FROM expedientes WHERE estudio_id = ? AND estado = 'Activo'`
      ).bind(estudioId).first<{ total: number }>(),
    ]);

  return c.json({
    proximasAudiencias: proximasAudiencias.results,
    vencimientosProximos: vencimientosProximos.results,
    tareasPendientes: {
      total: tareasTotal?.total ?? 0,
      proximas: tareasProximas.results,
    },
    expedientesActivos: expedientesActivos?.total ?? 0,
  });
});
