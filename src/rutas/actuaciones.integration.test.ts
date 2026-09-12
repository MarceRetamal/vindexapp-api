// Test de integración de la ruta de actuaciones, montada con requireAuth (JWKS
// de prueba, sin red). La parte no trivial es /vencimientos-proximos: filtra
// por rango de fechas y hace join con expedientes y clientes.
import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { env } from '../../test/env';
import { crearClienteDePrueba, crearEstudioDePrueba, crearExpedienteDePrueba } from '../../test/fixtures';
import { crearAppAutenticada, crearUsuarioAutenticado } from '../../test/auth';
import type { Env } from '../tipos';
import { actuacionesRouter } from './actuaciones';

let app: Hono<Env>;

async function post(path: string, body: unknown, token: string) {
  return app.request(
    path,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cf-Access-Jwt-Assertion': token },
      body: JSON.stringify(body),
    },
    env
  );
}

async function patch(path: string, token: string) {
  return app.request(path, { method: 'PATCH', headers: { 'Cf-Access-Jwt-Assertion': token } }, env);
}

async function get(path: string, token?: string) {
  return app.request(path, token ? { headers: { 'Cf-Access-Jwt-Assertion': token } } : {}, env);
}

function fechaMasDias(dias: number): string {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

async function armarExpediente() {
  const estudioId = await crearEstudioDePrueba(env.DB);
  const clienteId = await crearClienteDePrueba(env.DB, estudioId);
  const expedienteId = await crearExpedienteDePrueba(env.DB, estudioId, clienteId);
  const token = await crearUsuarioAutenticado(env.DB, estudioId);
  return { estudioId, clienteId, expedienteId, token };
}

describe('POST /api/actuaciones', () => {
  beforeEach(async () => {
    app = await crearAppAutenticada(actuacionesRouter);
  });

  it('crea una actuación con los campos obligatorios', async () => {
    const { expedienteId, token } = await armarExpediente();

    const res = await post('/', { expediente_id: expedienteId, tipo: 'Escrito presentado', fecha: fechaMasDias(0) }, token);

    expect(res.status).toBe(201);
    const body = await res.json<{ id: string; tipo: string }>();
    expect(body.tipo).toBe('Escrito presentado');
  });

  it('guarda visible, hito y vencimiento cuando vienen en el body', async () => {
    const { expedienteId, token } = await armarExpediente();
    const vencimiento = fechaMasDias(5);

    const creada = await post('/', {
      expediente_id: expedienteId,
      tipo: 'Traslado',
      fecha: fechaMasDias(0),
      visible: true,
      hito: true,
      vencimiento,
    }, token);
    const { id } = await creada.json<{ id: string }>();

    const fila = await env.DB.prepare('SELECT visible, hito, vencimiento FROM actuaciones WHERE id = ?')
      .bind(id)
      .first<{ visible: number; hito: number; vencimiento: string }>();

    expect(fila?.visible).toBe(1);
    expect(fila?.hito).toBe(1);
    expect(fila?.vencimiento).toBe(vencimiento);
  });

  it('rechaza si falta un campo obligatorio', async () => {
    const { expedienteId, token } = await armarExpediente();
    const res = await post('/', { expediente_id: expedienteId }, token);
    expect(res.status).toBe(400);
  });

  it('devuelve 404 si el expediente pertenece a otro estudio', async () => {
    const { expedienteId } = await armarExpediente();
    const otroEstudioId = await crearEstudioDePrueba(env.DB);
    const otroToken = await crearUsuarioAutenticado(env.DB, otroEstudioId);

    const res = await post('/', { expediente_id: expedienteId, tipo: 'Intento cruzado', fecha: fechaMasDias(0) }, otroToken);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/actuaciones', () => {
  beforeEach(async () => {
    app = await crearAppAutenticada(actuacionesRouter);
  });

  it('exige expediente_id', async () => {
    const { token } = await armarExpediente();
    const res = await get('/', token);
    expect(res.status).toBe(400);
  });

  it('devuelve las actuaciones del expediente ordenadas por fecha descendente', async () => {
    const { expedienteId, token } = await armarExpediente();

    await post('/', { expediente_id: expedienteId, tipo: 'Primera', fecha: fechaMasDias(-10) }, token);
    await post('/', { expediente_id: expedienteId, tipo: 'Segunda', fecha: fechaMasDias(0) }, token);

    const res = await get(`/?expediente_id=${expedienteId}`, token);
    const actuaciones = await res.json<{ tipo: string }[]>();

    expect(actuaciones).toHaveLength(2);
    expect(actuaciones[0]?.tipo).toBe('Segunda');
  });

  it('no devuelve actuaciones de un expediente de otro estudio', async () => {
    const { expedienteId, token } = await armarExpediente();
    await post('/', { expediente_id: expedienteId, tipo: 'Primera', fecha: fechaMasDias(0) }, token);

    const otroEstudioId = await crearEstudioDePrueba(env.DB);
    const otroToken = await crearUsuarioAutenticado(env.DB, otroEstudioId);

    const res = await get(`/?expediente_id=${expedienteId}`, otroToken);
    const actuaciones = await res.json<unknown[]>();
    expect(actuaciones).toHaveLength(0);
  });
});

describe('GET /api/actuaciones/vencimientos-proximos', () => {
  beforeEach(async () => {
    app = await crearAppAutenticada(actuacionesRouter);
  });

  it('exige autenticación', async () => {
    const res = await get('/vencimientos-proximos');
    expect(res.status).toBe(401);
  });

  it('devuelve solo las actuaciones con vencimiento dentro de los próximos N días', async () => {
    const { expedienteId, token } = await armarExpediente();

    await post('/', { expediente_id: expedienteId, tipo: 'Vence pronto', fecha: fechaMasDias(0), vencimiento: fechaMasDias(3) }, token);
    await post('/', { expediente_id: expedienteId, tipo: 'Vence lejos', fecha: fechaMasDias(0), vencimiento: fechaMasDias(30) }, token);
    await post('/', { expediente_id: expedienteId, tipo: 'Sin vencimiento', fecha: fechaMasDias(0) }, token);

    const res = await get('/vencimientos-proximos', token);
    const proximas = await res.json<{ tipo: string; expediente_caratula: string; cliente_nombre: string }[]>();

    expect(proximas).toHaveLength(1);
    expect(proximas[0]?.tipo).toBe('Vence pronto');
    expect(proximas[0]?.expediente_caratula).toBe('Expediente de prueba');
    expect(proximas[0]?.cliente_nombre).toBe('Cliente');
  });

  it('respeta el parámetro dias para ampliar la ventana', async () => {
    const { expedienteId, token } = await armarExpediente();

    await post('/', { expediente_id: expedienteId, tipo: 'Vence en 20 días', fecha: fechaMasDias(0), vencimiento: fechaMasDias(20) }, token);

    const conDefault = await get('/vencimientos-proximos', token);
    expect(await conDefault.json()).toHaveLength(0);

    const conVentanaAmpliada = await get('/vencimientos-proximos?dias=30', token);
    expect(await conVentanaAmpliada.json()).toHaveLength(1);
  });
});

describe('PATCH /api/actuaciones/:id/notificar', () => {
  beforeEach(async () => {
    app = await crearAppAutenticada(actuacionesRouter);
  });

  it('marca la actuación como notificada y visible', async () => {
    const { expedienteId, token } = await armarExpediente();
    const creada = await post('/', { expediente_id: expedienteId, tipo: 'Resolución', fecha: fechaMasDias(0), visible: false }, token);
    const { id } = await creada.json<{ id: string }>();

    const res = await patch(`/${id}/notificar`, token);
    expect(res.status).toBe(200);

    const fila = await env.DB.prepare('SELECT notificado, visible FROM actuaciones WHERE id = ?')
      .bind(id)
      .first<{ notificado: number; visible: number }>();
    expect(fila?.notificado).toBe(1);
    expect(fila?.visible).toBe(1);
  });

  it('devuelve 404 si la actuación es de otro estudio', async () => {
    const { expedienteId, token } = await armarExpediente();
    const creada = await post('/', { expediente_id: expedienteId, tipo: 'Resolución', fecha: fechaMasDias(0) }, token);
    const { id } = await creada.json<{ id: string }>();

    const otroEstudioId = await crearEstudioDePrueba(env.DB);
    const otroToken = await crearUsuarioAutenticado(env.DB, otroEstudioId);

    const res = await patch(`/${id}/notificar`, otroToken);
    expect(res.status).toBe(404);
  });
});
