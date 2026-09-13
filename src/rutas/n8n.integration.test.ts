// Test de integración del router de n8n, montado con requireServiceAuth
// (JWKS de prueba, sin red). N8N_ESTUDIO_ID en vitest.config.ts es fijo
// ('estudio-n8n-de-prueba'), así que acá se inserta el estudio con ESE id
// exacto (no con crearEstudioDePrueba, que genera uno random) para que las
// FK de clientes/expedientes/actuaciones/audiencias no fallen.
import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { env } from '../../test/env';
import { crearAppAutenticada, firmarTokenDeServicioDePrueba } from '../../test/auth';
import type { EnvServicio } from '../tipos';
import { n8nRouter } from './n8n';

let app: Hono<EnvServicio>;
let token: string;

async function prepararEstudio() {
  const id = env.N8N_ESTUDIO_ID;
  await env.DB.prepare(
    'INSERT OR IGNORE INTO estudios (id, nombre, creado_en, activo) VALUES (?, ?, ?, 1)'
  )
    .bind(id, 'Estudio de prueba n8n', Date.now())
    .run();
  return id;
}

async function crearCliente(estudioId: string, datos: Partial<{ dni: string; whatsapp: string }> = {}) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO clientes (id, estudio_id, nombre, apellido, dni, whatsapp, estado, creado_en)
     VALUES (?, ?, 'Cliente', 'De Prueba', ?, ?, 'Activo', ?)`
  )
    .bind(id, estudioId, datos.dni ?? null, datos.whatsapp ?? null, Date.now())
    .run();
  return id;
}

async function crearExpediente(estudioId: string, clienteId: string) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO expedientes (id, estudio_id, cliente_id, caratula, estado, creado_en)
     VALUES (?, ?, ?, 'Expediente de prueba', 'En trámite', ?)`
  )
    .bind(id, estudioId, clienteId, Date.now())
    .run();
  return id;
}

async function get(path: string, tok?: string) {
  return app.request(path, tok ? { headers: { 'Cf-Access-Jwt-Assertion': tok } } : {}, env);
}

async function post(path: string, body: unknown, tok: string) {
  return app.request(
    path,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cf-Access-Jwt-Assertion': tok },
      body: JSON.stringify(body),
    },
    env
  );
}

async function patch(path: string, tok: string) {
  return app.request(path, { method: 'PATCH', headers: { 'Cf-Access-Jwt-Assertion': tok } }, env);
}

beforeEach(async () => {
  app = await crearAppAutenticada(n8nRouter);
  token = await firmarTokenDeServicioDePrueba('n8n-vindex-de-prueba');
});

describe('autenticación del router de n8n', () => {
  it('exige un token', async () => {
    const res = await get('/clientes?dni=30111222');
    expect(res.status).toBe(401);
  });

  it('rechaza un token de usuario normal (con email, sin common_name)', async () => {
    const { firmarTokenDePrueba } = await import('../../test/auth');
    const tokenDeUsuario = await firmarTokenDePrueba('abogada@vindexlegal.com.ar');
    const res = await get('/clientes?dni=30111222', tokenDeUsuario);
    expect(res.status).toBe(401);
  });

  it('rechaza un Service Token con common_name distinto al esperado', async () => {
    const tokenAjeno = await firmarTokenDeServicioDePrueba('otro-service-token');
    const res = await get('/clientes?dni=30111222', tokenAjeno);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/n8n/clientes', () => {
  it('exige whatsapp o dni', async () => {
    const res = await get('/clientes', token);
    expect(res.status).toBe(400);
  });

  it('busca por dni', async () => {
    const estudioId = await prepararEstudio();
    await crearCliente(estudioId, { dni: '30111222' });

    const res = await get('/clientes?dni=30111222', token);
    const clientes = await res.json<{ dni: string }[]>();
    expect(clientes).toHaveLength(1);
    expect(clientes[0]?.dni).toBe('30111222');
  });

  it('busca por whatsapp', async () => {
    const estudioId = await prepararEstudio();
    await crearCliente(estudioId, { whatsapp: '5491141743745' });

    const res = await get('/clientes?whatsapp=5491141743745', token);
    const clientes = await res.json<unknown[]>();
    expect(clientes).toHaveLength(1);
  });
});

describe('POST /api/n8n/clientes', () => {
  it('crea un lead en estado Potencial', async () => {
    await prepararEstudio();
    const res = await post('/clientes', { nombre: 'Juan', apellido: 'Contacto', whatsapp: '5491111111111' }, token);
    expect(res.status).toBe(201);
    const body = await res.json<{ estado: string }>();
    expect(body.estado).toBe('Potencial');
  });

  it('rechaza si falta nombre o apellido', async () => {
    await prepararEstudio();
    const res = await post('/clientes', { nombre: 'Juan' }, token);
    expect(res.status).toBe(400);
  });

  it('devuelve 409 si el dni ya existe en el estudio', async () => {
    const estudioId = await prepararEstudio();
    await crearCliente(estudioId, { dni: '30999888' });

    const res = await post('/clientes', { nombre: 'Otro', apellido: 'Lead', dni: '30999888' }, token);
    expect(res.status).toBe(409);
  });
});

describe('GET /api/n8n/expedientes', () => {
  it('devuelve los expedientes del cliente', async () => {
    const estudioId = await prepararEstudio();
    const clienteId = await crearCliente(estudioId);
    await crearExpediente(estudioId, clienteId);

    const res = await get(`/expedientes?cliente_id=${clienteId}`, token);
    const expedientes = await res.json<unknown[]>();
    expect(expedientes).toHaveLength(1);
  });

  it('devuelve 404 si el cliente no existe', async () => {
    await prepararEstudio();
    const res = await get('/expedientes?cliente_id=no-existe', token);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/n8n/actuaciones', () => {
  it('devuelve solo las actuaciones visible=1, nunca el detalle interno del abogado', async () => {
    const estudioId = await prepararEstudio();
    const clienteId = await crearCliente(estudioId);
    const expedienteId = await crearExpediente(estudioId, clienteId);

    await env.DB.prepare(
      `INSERT INTO actuaciones (id, estudio_id, expediente_id, tipo, fecha, detalle_interno, texto_cliente, visible, creado_en)
       VALUES (?, ?, ?, 'Resolución', '2026-09-01', 'Detalle solo del abogado', 'Se dictó resolución', 1, ?)`
    ).bind(crypto.randomUUID(), estudioId, expedienteId, Date.now()).run();
    await env.DB.prepare(
      `INSERT INTO actuaciones (id, estudio_id, expediente_id, tipo, fecha, detalle_interno, visible, creado_en)
       VALUES (?, ?, ?, 'Nota interna', '2026-09-02', 'Solo para el abogado', 0, ?)`
    ).bind(crypto.randomUUID(), estudioId, expedienteId, Date.now()).run();

    const res = await get(`/actuaciones?expediente_id=${expedienteId}`, token);
    const actuaciones = await res.json<{ tipo: string; texto_cliente: string }[]>();
    expect(actuaciones).toHaveLength(1);
    expect(actuaciones[0]?.tipo).toBe('Resolución');
    expect(JSON.stringify(actuaciones[0])).not.toContain('Detalle solo del abogado');
  });
});

describe('GET /api/n8n/notificaciones-pendientes y PATCH .../notificado', () => {
  it('lista las visibles y no notificadas, con el whatsapp del cliente, y las marca al confirmar', async () => {
    const estudioId = await prepararEstudio();
    const clienteId = await crearCliente(estudioId, { whatsapp: '5491122223333' });
    const expedienteId = await crearExpediente(estudioId, clienteId);
    const actuacionId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO actuaciones (id, estudio_id, expediente_id, tipo, fecha, visible, notificado, creado_en)
       VALUES (?, ?, ?, 'Resolución', '2026-09-01', 1, 0, ?)`
    ).bind(actuacionId, estudioId, expedienteId, Date.now()).run();

    const res = await get('/notificaciones-pendientes', token);
    const pendientes = await res.json<{ id: string; cliente_whatsapp: string }[]>();
    expect(pendientes.some((p) => p.id === actuacionId && p.cliente_whatsapp === '5491122223333')).toBe(true);

    const resPatch = await patch(`/actuaciones/${actuacionId}/notificado`, token);
    expect(resPatch.status).toBe(200);

    const res2 = await get('/notificaciones-pendientes', token);
    const pendientes2 = await res2.json<{ id: string }[]>();
    expect(pendientes2.some((p) => p.id === actuacionId)).toBe(false);
  });
});

describe('GET /api/n8n/audiencias-proximas y PATCH .../recordatorio-enviado', () => {
  it('lista las próximas con recordatorio pendiente y las marca al confirmar', async () => {
    const estudioId = await prepararEstudio();
    const clienteId = await crearCliente(estudioId, { whatsapp: '5491133334444' });
    const expedienteId = await crearExpediente(estudioId, clienteId);
    const audienciaId = crypto.randomUUID();
    const manana = new Date();
    manana.setDate(manana.getDate() + 1);
    const fecha = manana.toISOString().slice(0, 10);

    await env.DB.prepare(
      `INSERT INTO audiencias (id, estudio_id, expediente_id, tipo, fecha, estado, recordatorio, recordatorio_enviado, creado_en)
       VALUES (?, ?, ?, 'Vista', ?, 'Programada', 1, 0, ?)`
    ).bind(audienciaId, estudioId, expedienteId, fecha, Date.now()).run();

    const res = await get('/audiencias-proximas', token);
    const proximas = await res.json<{ id: string; cliente_whatsapp: string }[]>();
    expect(proximas.some((a) => a.id === audienciaId && a.cliente_whatsapp === '5491133334444')).toBe(true);

    const resPatch = await patch(`/audiencias/${audienciaId}/recordatorio-enviado`, token);
    expect(resPatch.status).toBe(200);

    const res2 = await get('/audiencias-proximas', token);
    const proximas2 = await res2.json<{ id: string }[]>();
    expect(proximas2.some((a) => a.id === audienciaId)).toBe(false);
  });
});
