// Test de integración de la ruta de documentos vía SELF.fetch. El flujo real es
// solicitar-subida (firma una URL de R2) -> el frontend hace PUT directo a esa URL
// -> confirmar-subida (verifica con head() y recién ahí escribe en D1). Acá el PUT
// directo a R2 se simula escribiendo con env.DOCUMENTOS.put() en vez de pegarle de
// verdad a la URL firmada (que apunta a una cuenta R2 de mentira, ver vitest.config.ts).
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { env } from '../../test/env';
import { crearEstudioDePrueba } from '../../test/fixtures';

const BASE = 'http://vindexapp-api.local';

async function post(path: string, body: unknown) {
  return SELF.fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function solicitarSubida(estudioId: string, categoria = 'escrito_judicial') {
  const res = await post('/api/documentos/solicitar-subida', {
    estudio_id: estudioId,
    categoria,
    nombre_archivo: 'demanda.pdf',
    content_type: 'application/pdf',
  });
  return res.json<{ id: string; ruta_r2: string; url_subida: string; expira_en_segundos: number }>();
}

/** Simula el PUT directo del frontend a R2 con la URL firmada. */
async function subirArchivoDePrueba(rutaR2: string, contenido = 'contenido de prueba') {
  await env.DOCUMENTOS.put(rutaR2, contenido);
  return contenido.length;
}

async function crearDocumentoDePrueba(estudioId: string) {
  const solicitud = await solicitarSubida(estudioId);
  await subirArchivoDePrueba(solicitud.ruta_r2);

  const res = await post('/api/documentos/confirmar-subida', {
    id: solicitud.id,
    estudio_id: estudioId,
    categoria: 'escrito_judicial',
    nombre_archivo: 'demanda.pdf',
    ruta_r2: solicitud.ruta_r2,
  });
  return { ...(await res.json<{ id: string }>()), ruta_r2: solicitud.ruta_r2 };
}

describe('POST /api/documentos/solicitar-subida', () => {
  it('devuelve una URL firmada y una ruta_r2 bajo el estudio', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const res = await solicitarSubida(estudioId);

    expect(res.ruta_r2.startsWith(`${estudioId}/`)).toBe(true);
    expect(res.ruta_r2.endsWith('.pdf')).toBe(true);
    expect(res.url_subida).toContain('X-Amz-Signature');
    expect(res.expira_en_segundos).toBe(900);
  });

  it('rechaza si falta un campo obligatorio', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const res = await post('/api/documentos/solicitar-subida', {
      estudio_id: estudioId,
      categoria: 'escrito_judicial',
    });
    expect(res.status).toBe(400);
  });

  it('rechaza una categoría inválida', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const res = await post('/api/documentos/solicitar-subida', {
      estudio_id: estudioId,
      categoria: 'categoria_inventada',
      nombre_archivo: 'demanda.pdf',
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/documentos/confirmar-subida', () => {
  it('registra el documento en D1 con el tamaño real del objeto en R2', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const solicitud = await solicitarSubida(estudioId);
    const bytes = await subirArchivoDePrueba(solicitud.ruta_r2, 'contenido de prueba');

    const res = await post('/api/documentos/confirmar-subida', {
      id: solicitud.id,
      estudio_id: estudioId,
      categoria: 'escrito_judicial',
      nombre_archivo: 'demanda.pdf',
      ruta_r2: solicitud.ruta_r2,
    });

    expect(res.status).toBe(201);
    const body = await res.json<{ id: string; tamano_bytes: number }>();
    expect(body.id).toBe(solicitud.id);
    expect(body.tamano_bytes).toBe(bytes);
  });

  it('devuelve 409 si el archivo nunca se subió a R2', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const solicitud = await solicitarSubida(estudioId);

    const res = await post('/api/documentos/confirmar-subida', {
      id: solicitud.id,
      estudio_id: estudioId,
      categoria: 'escrito_judicial',
      nombre_archivo: 'demanda.pdf',
      ruta_r2: solicitud.ruta_r2,
    });

    expect(res.status).toBe(409);
  });

  it('rechaza si falta un campo obligatorio', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const res = await post('/api/documentos/confirmar-subida', { estudio_id: estudioId });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/documentos', () => {
  it('exige estudio_id', async () => {
    const res = await SELF.fetch(`${BASE}/api/documentos`);
    expect(res.status).toBe(400);
  });

  it('lista solo los documentos del estudio pedido', async () => {
    const estudioA = await crearEstudioDePrueba(env.DB);
    const estudioB = await crearEstudioDePrueba(env.DB);
    await crearDocumentoDePrueba(estudioA);
    await crearDocumentoDePrueba(estudioB);

    const res = await SELF.fetch(`${BASE}/api/documentos?estudio_id=${estudioA}`);
    const documentos = await res.json<{ nombre: string }[]>();

    expect(documentos).toHaveLength(1);
    expect(documentos[0]?.nombre).toBe('demanda.pdf');
  });
});

describe('GET /api/documentos/:id/descargar', () => {
  it('exige estudio_id', async () => {
    const res = await SELF.fetch(`${BASE}/api/documentos/no-existe/descargar`);
    expect(res.status).toBe(400);
  });

  it('devuelve 404 si el documento no existe', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const res = await SELF.fetch(`${BASE}/api/documentos/no-existe/descargar?estudio_id=${estudioId}`);
    expect(res.status).toBe(404);
  });

  it('devuelve una URL de descarga firmada con el nombre original', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const { id } = await crearDocumentoDePrueba(estudioId);

    const res = await SELF.fetch(`${BASE}/api/documentos/${id}/descargar?estudio_id=${estudioId}`);
    expect(res.status).toBe(200);
    const body = await res.json<{ url_descarga: string; nombre: string; expira_en_segundos: number }>();
    expect(body.nombre).toBe('demanda.pdf');
    expect(body.expira_en_segundos).toBe(300);
    expect(body.url_descarga).toContain('response-content-disposition');
  });
});

describe('DELETE /api/documentos/:id', () => {
  it('exige estudio_id', async () => {
    const res = await SELF.fetch(`${BASE}/api/documentos/no-existe`, { method: 'DELETE' });
    expect(res.status).toBe(400);
  });

  it('devuelve 404 si el documento no existe', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const res = await SELF.fetch(`${BASE}/api/documentos/no-existe?estudio_id=${estudioId}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
  });

  it('borra el documento de D1 y el objeto de R2', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const { id, ruta_r2 } = await crearDocumentoDePrueba(estudioId);

    const res = await SELF.fetch(`${BASE}/api/documentos/${id}?estudio_id=${estudioId}`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    const body = await res.json<{ eliminado: boolean }>();
    expect(body.eliminado).toBe(true);

    const objetoBorrado = await env.DOCUMENTOS.head(ruta_r2);
    expect(objetoBorrado).toBeNull();

    const filaBorrada = await env.DB.prepare('SELECT id FROM documentos WHERE id = ?').bind(id).first();
    expect(filaBorrada).toBeNull();
  });
});
