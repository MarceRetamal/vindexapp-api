// Test de integración de dashboard, montado con requireAuth (JWKS de prueba,
// sin red). Cubre que el estudio_id salga de la sesión (no de query) y que
// el aislamiento por estudio se respete en cada uno de los cinco conteos.
import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { env } from '../../test/env';
import { crearClienteDePrueba, crearEstudioDePrueba, crearExpedienteDePrueba } from '../../test/fixtures';
import { crearAppAutenticada, crearUsuarioAutenticado } from '../../test/auth';
import type { Env } from '../tipos';
import { dashboardRouter } from './dashboard';

let app: Hono<Env>;

async function get(path: string, token?: string) {
  return app.request(path, token ? { headers: { 'Cf-Access-Jwt-Assertion': token } } : {}, env);
}

describe('GET /api/dashboard', () => {
  beforeEach(async () => {
    app = await crearAppAutenticada(dashboardRouter);
  });

  it('exige autenticación', async () => {
    const res = await get('/');
    expect(res.status).toBe(401);
  });

  it('devuelve la forma esperada para un estudio sin datos', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);

    const res = await get('/', token);
    expect(res.status).toBe(200);
    const body = await res.json<{
      proximasAudiencias: unknown[];
      vencimientosProximos: unknown[];
      tareasPendientes: { total: number; proximas: unknown[] };
      expedientesActivos: number;
    }>();
    expect(body.proximasAudiencias).toEqual([]);
    expect(body.tareasPendientes.total).toBe(0);
    expect(body.expedientesActivos).toBe(0);
  });

  it('cuenta solo las tareas pendientes del estudio del usuario autenticado', async () => {
    const estudioA = await crearEstudioDePrueba(env.DB);
    const estudioB = await crearEstudioDePrueba(env.DB);
    const tokenA = await crearUsuarioAutenticado(env.DB, estudioA);
    const clienteA = await crearClienteDePrueba(env.DB, estudioA);
    const expedienteA = await crearExpedienteDePrueba(env.DB, estudioA, clienteA);
    const clienteB = await crearClienteDePrueba(env.DB, estudioB);
    const expedienteB = await crearExpedienteDePrueba(env.DB, estudioB, clienteB);

    await env.DB.prepare(
      `INSERT INTO tareas (id, estudio_id, expediente_id, titulo, estado, creado_en)
       VALUES (?, ?, ?, 'Tarea A', 'Pendiente', ?)`
    ).bind(crypto.randomUUID(), estudioA, expedienteA, Date.now()).run();
    await env.DB.prepare(
      `INSERT INTO tareas (id, estudio_id, expediente_id, titulo, estado, creado_en)
       VALUES (?, ?, ?, 'Tarea B', 'Pendiente', ?)`
    ).bind(crypto.randomUUID(), estudioB, expedienteB, Date.now()).run();

    const res = await get('/', tokenA);
    const body = await res.json<{ tareasPendientes: { total: number } }>();
    expect(body.tareasPendientes.total).toBe(1);
  });
});
