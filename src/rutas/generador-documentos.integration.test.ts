// Test de integración de generador-documentos, montado con requireAuth (JWKS
// de prueba, sin red). Cubre validación y aislamiento por estudio_id; no
// ejercita el camino feliz de renderizado real de .docx (requiere un archivo
// .docx válido en R2 y no aporta cobertura sobre el fix de auth de este
// cambio).
import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { env } from '../../test/env';
import { crearClienteDePrueba, crearEstudioDePrueba, crearExpedienteDePrueba } from '../../test/fixtures';
import { crearAppAutenticada, crearUsuarioAutenticado } from '../../test/auth';
import type { Env } from '../tipos';
import { generadorDocumentosRouter } from './generador-documentos';

let app: Hono<Env>;

async function post(path: string, body: unknown, token?: string) {
  return app.request(
    path,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Cf-Access-Jwt-Assertion': token } : {}),
      },
      body: JSON.stringify(body),
    },
    env
  );
}

describe('POST /api/generador-documentos', () => {
  beforeEach(async () => {
    app = await crearAppAutenticada(generadorDocumentosRouter);
  });

  it('exige autenticación', async () => {
    const res = await post('/', { template_id: 'x', expediente_id: 'y' });
    expect(res.status).toBe(401);
  });

  it('rechaza si falta un campo obligatorio', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const res = await post('/', { template_id: 'x' }, token);
    expect(res.status).toBe(400);
  });

  it('devuelve 404 si el template no existe o es de otro estudio', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const clienteId = await crearClienteDePrueba(env.DB, estudioId);
    const expedienteId = await crearExpedienteDePrueba(env.DB, estudioId, clienteId);

    const otroEstudioId = await crearEstudioDePrueba(env.DB);
    const templateDeOtroEstudio = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO templates (id, estudio_id, nombre, creado_en) VALUES (?, ?, 'Template ajeno', ?)`
    ).bind(templateDeOtroEstudio, otroEstudioId, Date.now()).run();

    const res = await post('/', { template_id: templateDeOtroEstudio, expediente_id: expedienteId }, token);
    expect(res.status).toBe(404);
  });

  it('devuelve 404 si el expediente no existe o es de otro estudio', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);
    const documentoId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO documentos (id, estudio_id, categoria, nombre, extension, ruta_r2, creado_en)
       VALUES (?, ?, 'template', 'modelo.docx', 'docx', ?, ?)`
    ).bind(documentoId, estudioId, `${estudioId}/modelo.docx`, Date.now()).run();
    const templateId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO templates (id, estudio_id, nombre, documento_id, creado_en) VALUES (?, ?, 'Template', ?, ?)`
    ).bind(templateId, estudioId, documentoId, Date.now()).run();

    const otroEstudioId = await crearEstudioDePrueba(env.DB);
    const clienteDeOtroEstudio = await crearClienteDePrueba(env.DB, otroEstudioId);
    const expedienteDeOtroEstudio = await crearExpedienteDePrueba(env.DB, otroEstudioId, clienteDeOtroEstudio);

    const res = await post('/', { template_id: templateId, expediente_id: expedienteDeOtroEstudio }, token);
    expect(res.status).toBe(404);
  });
});
