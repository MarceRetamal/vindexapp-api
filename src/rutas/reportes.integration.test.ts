// Test de integración de reportes, montado con requireAuth (JWKS de prueba,
// sin red). Cubre que estudio_id salga de la sesión y el aislamiento entre
// estudios en ambos endpoints.
import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { env } from '../../test/env';
import { crearClienteDePrueba, crearEstudioDePrueba } from '../../test/fixtures';
import { crearAppAutenticada, crearUsuarioAutenticado } from '../../test/auth';
import type { Env } from '../tipos';
import { reportesRouter } from './reportes';

let app: Hono<Env>;

async function get(path: string, token?: string) {
  return app.request(path, token ? { headers: { 'Cf-Access-Jwt-Assertion': token } } : {}, env);
}

describe('GET /api/reportes/expedientes', () => {
  beforeEach(async () => {
    app = await crearAppAutenticada(reportesRouter);
  });

  it('exige autenticación', async () => {
    const res = await get('/expedientes');
    expect(res.status).toBe(401);
  });

  it('cuenta expedientes solo del estudio del usuario autenticado', async () => {
    const estudioA = await crearEstudioDePrueba(env.DB);
    const estudioB = await crearEstudioDePrueba(env.DB);
    const tokenA = await crearUsuarioAutenticado(env.DB, estudioA);
    const clienteA = await crearClienteDePrueba(env.DB, estudioA);
    const clienteB = await crearClienteDePrueba(env.DB, estudioB);

    await env.DB.prepare(
      `INSERT INTO expedientes (id, estudio_id, cliente_id, caratula, estado, creado_en)
       VALUES (?, ?, ?, 'Expediente A', 'Activo', ?)`
    ).bind(crypto.randomUUID(), estudioA, clienteA, Date.now()).run();
    await env.DB.prepare(
      `INSERT INTO expedientes (id, estudio_id, cliente_id, caratula, estado, creado_en)
       VALUES (?, ?, ?, 'Expediente B', 'Activo', ?)`
    ).bind(crypto.randomUUID(), estudioB, clienteB, Date.now()).run();

    const res = await get('/expedientes', tokenA);
    const body = await res.json<{ porEstado: { estado: string; cantidad: number }[] }>();
    const activo = body.porEstado.find((f) => f.estado === 'Activo');
    expect(activo?.cantidad).toBe(1);
  });
});

describe('GET /api/reportes/presupuestos', () => {
  beforeEach(async () => {
    app = await crearAppAutenticada(reportesRouter);
  });

  it('exige autenticación', async () => {
    const res = await get('/presupuestos');
    expect(res.status).toBe(401);
  });

  it('suma solo los presupuestos firmados del estudio del usuario autenticado', async () => {
    const estudioA = await crearEstudioDePrueba(env.DB);
    const estudioB = await crearEstudioDePrueba(env.DB);
    const tokenA = await crearUsuarioAutenticado(env.DB, estudioA);
    const hoy = new Date().toISOString().slice(0, 10);

    await env.DB.prepare(
      `INSERT INTO presupuestos (id, estudio_id, contacto_nombre, concepto, monto, estado, fecha_emision, creado_en)
       VALUES (?, ?, 'Juan', 'Honorarios', 50000, 'firmado', ?, ?)`
    ).bind(crypto.randomUUID(), estudioA, hoy, Date.now()).run();
    await env.DB.prepare(
      `INSERT INTO presupuestos (id, estudio_id, contacto_nombre, concepto, monto, estado, fecha_emision, creado_en)
       VALUES (?, ?, 'Otro', 'Honorarios', 999999, 'firmado', ?, ?)`
    ).bind(crypto.randomUUID(), estudioB, hoy, Date.now()).run();

    const res = await get('/presupuestos', tokenA);
    const body = await res.json<{ totalFirmadoCentavos: number }>();
    expect(body.totalFirmadoCentavos).toBe(50000);
  });
});
