// Test de integración de la ruta de estudios.
// POST sigue sin auth a propósito (alta de un tenant nuevo, ver la nota en el
// propio router) y se prueba contra el Worker completo con SELF.fetch. GET
// pasó a requerir auth y a devolver solo el propio estudio — se prueba
// montando el router con crearAppAutenticada(), como el resto de las rutas.
import { SELF } from 'cloudflare:test';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { env } from '../../test/env';
import { crearEstudioDePrueba } from '../../test/fixtures';
import { crearAppAutenticada, crearUsuarioAutenticado } from '../../test/auth';
import type { Env } from '../tipos';
import { estudiosRouter } from './estudios';

const BASE = 'http://vindexapp-api.local';

async function post(path: string, body: unknown) {
  return SELF.fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/estudios', () => {
  it('crea un estudio con solo el nombre obligatorio', async () => {
    const res = await post('/api/estudios', { nombre: 'VINDEX LEGAL' });

    expect(res.status).toBe(201);
    const body = await res.json<{ id: string; nombre: string; creado_en: number }>();
    expect(body.nombre).toBe('VINDEX LEGAL');
    expect(body.id).toBeTruthy();
    expect(body.creado_en).toBeGreaterThan(0);
  });

  it('guarda los campos opcionales cuando vienen', async () => {
    const res = await post('/api/estudios', {
      nombre: 'VINDEX LEGAL',
      cuit: '20-12345678-9',
      matricula: 'T° LXVI · F° 263 · CALP',
      domicilio: 'Calle Falsa 123',
      localidad: 'La Plata',
    });
    const { id } = await res.json<{ id: string }>();

    const fila = await env.DB.prepare(
      'SELECT cuit, matricula, domicilio, localidad, activo FROM estudios WHERE id = ?'
    )
      .bind(id)
      .first<{ cuit: string; matricula: string; domicilio: string; localidad: string; activo: number }>();

    expect(fila?.cuit).toBe('20-12345678-9');
    expect(fila?.matricula).toBe('T° LXVI · F° 263 · CALP');
    expect(fila?.domicilio).toBe('Calle Falsa 123');
    expect(fila?.localidad).toBe('La Plata');
    expect(fila?.activo).toBe(1);
  });

  it('rechaza si falta el nombre', async () => {
    const res = await post('/api/estudios', { cuit: '20-12345678-9' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/estudios', () => {
  let app: Hono<Env>;

  it('exige autenticación', async () => {
    app = await crearAppAutenticada(estudiosRouter);
    const res = await app.request('/', {}, env);
    expect(res.status).toBe(401);
  });

  it('devuelve únicamente el propio estudio del usuario autenticado', async () => {
    app = await crearAppAutenticada(estudiosRouter);
    const estudioId = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioId);

    const res = await app.request('/', { headers: { 'Cf-Access-Jwt-Assertion': token } }, env);
    expect(res.status).toBe(200);
    const estudios = await res.json<{ id: string }[]>();
    expect(estudios).toHaveLength(1);
    expect(estudios[0]?.id).toBe(estudioId);
  });

  it('no expone estudios de otros tenants', async () => {
    app = await crearAppAutenticada(estudiosRouter);
    const estudioPropio = await crearEstudioDePrueba(env.DB);
    const estudioAjeno = await crearEstudioDePrueba(env.DB);
    const token = await crearUsuarioAutenticado(env.DB, estudioPropio);

    const res = await app.request('/', { headers: { 'Cf-Access-Jwt-Assertion': token } }, env);
    const estudios = await res.json<{ id: string }[]>();
    expect(estudios.some((e) => e.id === estudioAjeno)).toBe(false);
  });
});
