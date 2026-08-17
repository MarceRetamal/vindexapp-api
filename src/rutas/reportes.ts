import { Hono } from 'hono';
import type { Bindings } from '../tipos';

export const reportesRouter = new Hono<{ Bindings: Bindings }>();

reportesRouter.get('/expedientes', async (c) => {
  const estudioId = c.req.query('estudio_id');
  if (!estudioId) return c.json({ error: 'estudio_id es obligatorio.' }, 400);

  const [porEstado, porFuero, porDepartamento, bajasUltimos90Dias] = await Promise.all([
    c.env.DB.prepare(
      `SELECT estado, COUNT(*) AS cantidad
         FROM expedientes
        WHERE estudio_id = ?
        GROUP BY estado`
    ).bind(estudioId).all(),

    c.env.DB.prepare(
      `SELECT fuero, COUNT(*) AS cantidad
         FROM expedientes
        WHERE estudio_id = ? AND estado IN ('Activo', 'En trámite')
        GROUP BY fuero`
    ).bind(estudioId).all(),

    c.env.DB.prepare(
      `SELECT departamento, COUNT(*) AS cantidad
         FROM expedientes
        WHERE estudio_id = ? AND estado IN ('Activo', 'En trámite')
        GROUP BY departamento`
    ).bind(estudioId).all(),

    c.env.DB.prepare(
      `SELECT id, caratula, baja, motivo_baja
         FROM expedientes
        WHERE estudio_id = ? AND baja IS NOT NULL AND baja >= date('now', '-90 days')
        ORDER BY baja DESC`
    ).bind(estudioId).all(),
  ]);

  return c.json({
    porEstado: porEstado.results,
    porFuero: porFuero.results,
    porDepartamento: porDepartamento.results,
    bajasUltimos90Dias: bajasUltimos90Dias.results,
  });
});

reportesRouter.get('/presupuestos', async (c) => {
  const estudioId = c.req.query('estudio_id');
  if (!estudioId) return c.json({ error: 'estudio_id es obligatorio.' }, 400);

  const hoy = new Date();
  const hace90 = new Date(hoy);
  hace90.setDate(hace90.getDate() - 90);

  const desde = c.req.query('desde') ?? hace90.toISOString().slice(0, 10);
  const hasta = c.req.query('hasta') ?? hoy.toISOString().slice(0, 10);

  const [porEstado, firmado, pendiente, conversion] = await Promise.all([
    c.env.DB.prepare(
      `SELECT estado, COUNT(*) AS cantidad, SUM(monto) AS montoTotal
         FROM presupuestos
        WHERE estudio_id = ? AND fecha_emision BETWEEN ? AND ?
        GROUP BY estado`
    ).bind(estudioId, desde, hasta).all(),

    c.env.DB.prepare(
      `SELECT SUM(monto) AS total
         FROM presupuestos
        WHERE estudio_id = ? AND fecha_emision BETWEEN ? AND ? AND estado = 'firmado'`
    ).bind(estudioId, desde, hasta).first<{ total: number | null }>(),

    c.env.DB.prepare(
      `SELECT SUM(monto) AS total
         FROM presupuestos
        WHERE estudio_id = ? AND fecha_emision BETWEEN ? AND ? AND estado IN ('borrador', 'enviado')`
    ).bind(estudioId, desde, hasta).first<{ total: number | null }>(),

    c.env.DB.prepare(
      `SELECT
         SUM(CASE WHEN estado = 'firmado' THEN 1 ELSE 0 END) AS firmados,
         SUM(CASE WHEN estado IN ('firmado', 'rechazado', 'vencido') THEN 1 ELSE 0 END) AS total
         FROM presupuestos
        WHERE estudio_id = ? AND fecha_emision BETWEEN ? AND ?`
    ).bind(estudioId, desde, hasta).first<{ firmados: number | null; total: number | null }>(),
  ]);

  const totalConversion = conversion?.total ?? 0;
  const tasaConversion = totalConversion > 0 ? (conversion?.firmados ?? 0) / totalConversion : null;

  return c.json({
    porEstado: porEstado.results,
    totalFirmadoCentavos: firmado?.total ?? 0,
    totalPendienteCentavos: pendiente?.total ?? 0,
    tasaConversion,
  });
});
