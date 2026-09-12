// Test de integración de la ruta de documentos, montada con requireAuth (JWKS
// de prueba, sin red). El flujo real es solicitar-subida (firma una URL de R2)
// -> el frontend hace PUT directo a esa URL -> confirmar-subida (verifica con
// head() y recién ahí escribe en D1). Acá el PUT directo a R2 se simula
// escribiendo con env.DOCUMENTOS.put() en vez de pegarle de verdad a la URL
// firmada (que apunta a una cuenta R2 de mentira, ver vitest.config.ts).
import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { env } from '../../test/env';
import { crearEstudioDePrueba } from '../../test/fixtures';
import { crearAppAutenticada, crearUsuarioAutenticado } from '../../test/auth';
import type { Env } from '../tipos';
import { documentosRouter } from './documentos';

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

async function get(path: string, token?: string) {
  return app.request(path, token ? { headers: { 'Cf-Access-Jwt-Assertion': token } } : {}, env);
}

async function del(path: string, token: string) {
  return app.request(path, { method: 'DELETE', headers: { 'Cf-Access-Jwt-Assertion': token } }, env);
}

async function solicitarSubida(token: string, categoria = 'escrito_judicial') {
  const res = await post('/solicitar-subida', { categoria, nombre_archivo: 'demanda.pdf', content_type: 'application/pdf' }, token);
  return res.json<{ id: string; ruta_r2: string; url_subida: string; expira_en_segundos: number }>();
}

/** Simula el PUT directo del frontend a R2 con la URL firmada. */
async function subirArchivoDePrueba(rutaR2: string, contenido = 'contenido de prueba') {
  await env.DOCUMENTOS.put(rutaR2, contenido);
  return contenido.length;
}

async function crearDocumentoDePrueba(token: string) {
  const solicitud = await solicitarSubida(token);
  await subirArchivoDePrueba(solicitud.ruta_r2);

  const res = await post('/confirmar-subida', {
    id: solicitud.id,
    categoria: 'escrito_judicial',
    nombre_archivo: 'demanda.pdf',
    ruta_r2: solicitud.ruta_r2,
  }, token);
  return { ...(await res.json<{ id: string }>()), ruta_r2: solicitud.ruta_r2 };
}

describe('POST /api/documentos/solicitar-subida', () => {
  let estudioId: string;
  let token: string;

  beforeEach(async () => {
    app = await crearAppAutenticada(documentosRouter);
    estudioId = await crearEstudioDePrueba(env.DB);
    token = await crearUsuarioAutenticado(env.DB, estudioId);
  });

  it('devuelve una URL firmada y una ruta_r2 bajo el estudio', async () => {
    const res = await solicitarSubida(token);

    expect(res.ruta_r2.startsWith(`${estudioId}/`)).toBe(true);
    expect(res.ruta_r2.endsWith('.pdf')).toBe(true);
    expect(res.url_subida).toContain('X-Amz-Signature');
    expect(res.expira_en_segundos).toBe(900);
  });

  it('rechaza si falta un campo obligatorio', async () => {
    const res = await post('/solicitar-subida', { categoria: 'escrito_judicial' }, token);
    expect(res.status).toBe(400);
  });

  it('rechaza una categoría inválida', async () => {
    const res = await post('/solicitar-subida', { categoria: 'categoria_inventada', nombre_archivo: 'demanda.pdf' }, token);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/documentos/confirmar-subida', () => {
  let token: string;

  beforeEach(async () => {
    app = await crearAppAutenticada(documentosRouter);
    const estudioId = await crearEstudioDePrueba(env.DB);
    token = await crearUsuarioAutenticado(env.DB, estudioId);
  });

  it('registra el documento en D1 con el tamaño real del objeto en R2', async () => {
    const solicitud = await solicitarSubida(token);
    const bytes = await subirArchivoDePrueba(solicitud.ruta_r2, 'contenido de prueba');

    const res = await post('/confirmar-subida', {
      id: solicitud.id,
      categoria: 'escrito_judicial',
      nombre_archivo: 'demanda.pdf',
      ruta_r2: solicitud.ruta_r2,
    }, token);

    expect(res.status).toBe(201);
    const body = await res.json<{ id: string; tamano_bytes: number }>();
    expect(body.id).toBe(solicitud.id);
    expect(body.tamano_bytes).toBe(bytes);
  });

  it('devuelve 409 si el archivo nunca se subió a R2', async () => {
    const solicitud = await solicitarSubida(token);

    const res = await post('/confirmar-subida', {
      id: solicitud.id,
      categoria: 'escrito_judicial',
      nombre_archivo: 'demanda.pdf',
      ruta_r2: solicitud.ruta_r2,
    }, token);

    expect(res.status).toBe(409);
  });

  it('rechaza si falta un campo obligatorio', async () => {
    const res = await post('/confirmar-subida', {}, token);
    expect(res.status).toBe(400);
  });

  it('rechaza una ruta_r2 que no corresponde a este estudio', async () => {
    const res = await post('/confirmar-subida', {
      id: crypto.randomUUID(),
      categoria: 'escrito_judicial',
      nombre_archivo: 'demanda.pdf',
      ruta_r2: 'otro-estudio/algo.pdf',
    }, token);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/documentos', () => {
  beforeEach(async () => {
    app = await crearAppAutenticada(documentosRouter);
  });

  it('exige autenticación', async () => {
    const res = await get('/');
    expect(res.status).toBe(401);
  });

  it('lista solo los documentos del estudio del usuario autenticado', async () => {
    const estudioA = await crearEstudioDePrueba(env.DB);
    const estudioB = await crearEstudioDePrueba(env.DB);
    const tokenA = await crearUsuarioAutenticado(env.DB, estudioA);
    const tokenB = await crearUsuarioAutenticado(env.DB, estudioB);
    await crearDocumentoDePrueba(tokenA);
    await crearDocumentoDePrueba(tokenB);

    const res = await get('/', tokenA);
    const documentos = await res.json<{ nombre: string }[]>();

    expect(documentos).toHaveLength(1);
    expect(documentos[0]?.nombre).toBe('demanda.pdf');
  });
});

describe('GET /api/documentos/:id/descargar', () => {
  beforeEach(async () => {
    app = await crearAppAutenticada(documentosRouter);
  });

  it('devuelve 404 si el documento no existe', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const res = await get('/no-existe/descargar', token);
    expect(res.status).toBe(404);
  });

  it('devuelve una URL de descarga firmada con el nombre original', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const { id } = await crearDocumentoDePrueba(token);

    const res = await get(`/${id}/descargar`, token);
    expect(res.status).toBe(200);
    const body = await res.json<{ url_descarga: string; nombre: string; expira_en_segundos: number }>();
    expect(body.nombre).toBe('demanda.pdf');
    expect(body.expira_en_segundos).toBe(300);
    expect(body.url_descarga).toContain('response-content-disposition');
  });
});

describe('DELETE /api/documentos/:id', () => {
  beforeEach(async () => {
    app = await crearAppAutenticada(documentosRouter);
  });

  it('devuelve 404 si el documento no existe', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const res = await del('/no-existe', token);
    expect(res.status).toBe(404);
  });

  it('borra el documento de D1 y el objeto de R2', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const { id, ruta_r2 } = await crearDocumentoDePrueba(token);

    const res = await del(`/${id}`, token);

    expect(res.status).toBe(200);
    const body = await res.json<{ eliminado: boolean }>();
    expect(body.eliminado).toBe(true);

    const objetoBorrado = await env.DOCUMENTOS.head(ruta_r2);
    expect(objetoBorrado).toBeNull();

    const filaBorrada = await env.DB.prepare('SELECT id FROM documentos WHERE id = ?').bind(id).first();
    expect(filaBorrada).toBeNull();
  });
});
