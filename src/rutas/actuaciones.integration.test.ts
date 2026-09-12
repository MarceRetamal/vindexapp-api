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

async function del(path: string, token: string) {
  return app.request(path, { method: 'DELETE', headers: { 'Cf-Access-Jwt-Assertion': token } }, env);
}

/** Inserta un documento directo en D1 (sin pasar por el flujo de subida a R2) para los tests de vínculo. */
async function crearDocumentoDePrueba(estudioId: string, expedienteId: string | null = null) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO documentos (id, estudio_id, expediente_id, categoria, nombre, extension, ruta_r2, creado_en)
     VALUES (?, ?, ?, 'resolucion', 'proveido.pdf', 'pdf', ?, ?)`
  ).bind(id, estudioId, expedienteId, `${estudioId}/${id}.pdf`, Date.now()).run();
  return id;
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

describe('GET /api/actuaciones (vista MEV con adjuntos)', () => {
  beforeEach(async () => {
    app = await crearAppAutenticada(actuacionesRouter);
  });

  it('devuelve documentos: [] para una actuación sin adjuntos', async () => {
    const { expedienteId, token } = await armarExpediente();
    await post('/', { expediente_id: expedienteId, tipo: 'Escrito', fecha: fechaMasDias(0) }, token);

    const res = await get(`/?expediente_id=${expedienteId}`, token);
    const actuaciones = await res.json<{ documentos: unknown[] }[]>();
    expect(actuaciones[0]?.documentos).toEqual([]);
  });

  it('incluye los documentos vinculados a cada actuación', async () => {
    const { estudioId, expedienteId, token } = await armarExpediente();
    const creada = await post('/', { expediente_id: expedienteId, tipo: 'Resolución', fecha: fechaMasDias(0) }, token);
    const { id } = await creada.json<{ id: string }>();
    const documentoId = await crearDocumentoDePrueba(estudioId, expedienteId);

    await env.DB.prepare(
      'INSERT INTO actuacion_documentos (actuacion_id, documento_id, creado_en) VALUES (?, ?, ?)'
    ).bind(id, documentoId, Date.now()).run();

    const res = await get(`/?expediente_id=${expedienteId}`, token);
    const actuaciones = await res.json<{ id: string; documentos: { id: string; nombre: string }[] }[]>();
    const actuacion = actuaciones.find((a) => a.id === id);
    expect(actuacion?.documentos).toHaveLength(1);
    expect(actuacion?.documentos[0]?.nombre).toBe('proveido.pdf');
  });
});

describe('GET /api/actuaciones/:id', () => {
  beforeEach(async () => {
    app = await crearAppAutenticada(actuacionesRouter);
  });

  it('devuelve el detalle completo con sus adjuntos', async () => {
    const { estudioId, expedienteId, token } = await armarExpediente();
    const creada = await post(
      '/',
      { expediente_id: expedienteId, tipo: 'Resolución', fecha: fechaMasDias(0), detalle_interno: 'Detalle interno' },
      token
    );
    const { id } = await creada.json<{ id: string }>();
    const documentoId = await crearDocumentoDePrueba(estudioId, expedienteId);
    await env.DB.prepare(
      'INSERT INTO actuacion_documentos (actuacion_id, documento_id, creado_en) VALUES (?, ?, ?)'
    ).bind(id, documentoId, Date.now()).run();

    const res = await get(`/${id}`, token);
    expect(res.status).toBe(200);
    const body = await res.json<{ detalle_interno: string; documentos: { id: string }[] }>();
    expect(body.detalle_interno).toBe('Detalle interno');
    expect(body.documentos).toHaveLength(1);
  });

  it('devuelve 404 si la actuación es de otro estudio', async () => {
    const { expedienteId, token } = await armarExpediente();
    const creada = await post('/', { expediente_id: expedienteId, tipo: 'Escrito', fecha: fechaMasDias(0) }, token);
    const { id } = await creada.json<{ id: string }>();

    const otroEstudioId = await crearEstudioDePrueba(env.DB);
    const otroToken = await crearUsuarioAutenticado(env.DB, otroEstudioId);

    const res = await get(`/${id}`, otroToken);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/actuaciones/:id/documentos (vincular adjunto)', () => {
  beforeEach(async () => {
    app = await crearAppAutenticada(actuacionesRouter);
  });

  it('vincula un documento existente del mismo expediente', async () => {
    const { estudioId, expedienteId, token } = await armarExpediente();
    const creada = await post('/', { expediente_id: expedienteId, tipo: 'Escrito', fecha: fechaMasDias(0) }, token);
    const { id } = await creada.json<{ id: string }>();
    const documentoId = await crearDocumentoDePrueba(estudioId, expedienteId);

    const res = await post(`/${id}/documentos`, { documento_id: documentoId }, token);
    expect(res.status).toBe(201);

    const vinculo = await env.DB.prepare(
      'SELECT 1 FROM actuacion_documentos WHERE actuacion_id = ? AND documento_id = ?'
    ).bind(id, documentoId).first();
    expect(vinculo).toBeTruthy();
  });

  it('rechaza si falta documento_id', async () => {
    const { expedienteId, token } = await armarExpediente();
    const creada = await post('/', { expediente_id: expedienteId, tipo: 'Escrito', fecha: fechaMasDias(0) }, token);
    const { id } = await creada.json<{ id: string }>();

    const res = await post(`/${id}/documentos`, {}, token);
    expect(res.status).toBe(400);
  });

  it('devuelve 404 si la actuación es de otro estudio', async () => {
    const { estudioId, expedienteId } = await armarExpediente();
    const documentoId = await crearDocumentoDePrueba(estudioId, expedienteId);

    const otroEstudioId = await crearEstudioDePrueba(env.DB);
    const otroToken = await crearUsuarioAutenticado(env.DB, otroEstudioId);

    const res = await post(`/no-existe/documentos`, { documento_id: documentoId }, otroToken);
    expect(res.status).toBe(404);
  });

  it('devuelve 404 si el documento no existe o es de otro estudio', async () => {
    const { expedienteId, token } = await armarExpediente();
    const creada = await post('/', { expediente_id: expedienteId, tipo: 'Escrito', fecha: fechaMasDias(0) }, token);
    const { id } = await creada.json<{ id: string }>();

    const otroEstudioId = await crearEstudioDePrueba(env.DB);
    const documentoDeOtroEstudio = await crearDocumentoDePrueba(otroEstudioId);

    const res = await post(`/${id}/documentos`, { documento_id: documentoDeOtroEstudio }, token);
    expect(res.status).toBe(404);
  });

  it('rechaza si el documento pertenece a otro expediente del mismo estudio', async () => {
    const { estudioId, expedienteId, clienteId, token } = await armarExpediente();
    const creada = await post('/', { expediente_id: expedienteId, tipo: 'Escrito', fecha: fechaMasDias(0) }, token);
    const { id } = await creada.json<{ id: string }>();

    const otroExpedienteId = await crearExpedienteDePrueba(env.DB, estudioId, clienteId);
    const documentoDeOtroExpediente = await crearDocumentoDePrueba(estudioId, otroExpedienteId);

    const res = await post(`/${id}/documentos`, { documento_id: documentoDeOtroExpediente }, token);
    expect(res.status).toBe(400);
  });

  it('devuelve 409 si el documento ya estaba vinculado', async () => {
    const { estudioId, expedienteId, token } = await armarExpediente();
    const creada = await post('/', { expediente_id: expedienteId, tipo: 'Escrito', fecha: fechaMasDias(0) }, token);
    const { id } = await creada.json<{ id: string }>();
    const documentoId = await crearDocumentoDePrueba(estudioId, expedienteId);

    await post(`/${id}/documentos`, { documento_id: documentoId }, token);
    const res = await post(`/${id}/documentos`, { documento_id: documentoId }, token);
    expect(res.status).toBe(409);
  });
});

describe('DELETE /api/actuaciones/:id/documentos/:documentoId (desvincular adjunto)', () => {
  beforeEach(async () => {
    app = await crearAppAutenticada(actuacionesRouter);
  });

  it('desvincula el documento sin borrarlo', async () => {
    const { estudioId, expedienteId, token } = await armarExpediente();
    const creada = await post('/', { expediente_id: expedienteId, tipo: 'Escrito', fecha: fechaMasDias(0) }, token);
    const { id } = await creada.json<{ id: string }>();
    const documentoId = await crearDocumentoDePrueba(estudioId, expedienteId);
    await post(`/${id}/documentos`, { documento_id: documentoId }, token);

    const res = await del(`/${id}/documentos/${documentoId}`, token);
    expect(res.status).toBe(200);

    const vinculo = await env.DB.prepare(
      'SELECT 1 FROM actuacion_documentos WHERE actuacion_id = ? AND documento_id = ?'
    ).bind(id, documentoId).first();
    expect(vinculo).toBeNull();

    const documentoSigueExistiendo = await env.DB.prepare('SELECT id FROM documentos WHERE id = ?').bind(documentoId).first();
    expect(documentoSigueExistiendo).toBeTruthy();
  });

  it('devuelve 404 si el vínculo no existe', async () => {
    const { estudioId, expedienteId, token } = await armarExpediente();
    const creada = await post('/', { expediente_id: expedienteId, tipo: 'Escrito', fecha: fechaMasDias(0) }, token);
    const { id } = await creada.json<{ id: string }>();
    const documentoId = await crearDocumentoDePrueba(estudioId, expedienteId);

    const res = await del(`/${id}/documentos/${documentoId}`, token);
    expect(res.status).toBe(404);
  });

  it('devuelve 404 si la actuación es de otro estudio', async () => {
    const { estudioId, expedienteId, token } = await armarExpediente();
    const creada = await post('/', { expediente_id: expedienteId, tipo: 'Escrito', fecha: fechaMasDias(0) }, token);
    const { id } = await creada.json<{ id: string }>();
    const documentoId = await crearDocumentoDePrueba(estudioId, expedienteId);
    await post(`/${id}/documentos`, { documento_id: documentoId }, token);

    const otroEstudioId = await crearEstudioDePrueba(env.DB);
    const otroToken = await crearUsuarioAutenticado(env.DB, otroEstudioId);

    const res = await del(`/${id}/documentos/${documentoId}`, otroToken);
    expect(res.status).toBe(404);

    const vinculoSigueExistiendo = await env.DB.prepare(
      'SELECT 1 FROM actuacion_documentos WHERE actuacion_id = ? AND documento_id = ?'
    ).bind(id, documentoId).first();
    expect(vinculoSigueExistiendo).toBeTruthy();
  });
});
