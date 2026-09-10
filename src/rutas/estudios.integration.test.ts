// Test de integración de la ruta de estudios. Es la única entidad sin estudio_id
// propio (es la raíz del aislamiento multi-estudio) y sin autenticación en el
// código — ver la nota en el propio router sobre por qué (Access se agrega aparte).
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { env } from '../../test/env';

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
  it('devuelve todos los estudios, incluido el recién creado', async () => {
    const res1 = await post('/api/estudios', { nombre: `Estudio de prueba ${crypto.randomUUID()}` });
    const { id, nombre } = await res1.json<{ id: string; nombre: string }>();

    const res2 = await SELF.fetch(`${BASE}/api/estudios`);
    expect(res2.status).toBe(200);
    const estudios = await res2.json<{ id: string; nombre: string }[]>();

    expect(estudios.some((e) => e.id === id && e.nombre === nombre)).toBe(true);
  });

  it('ordena por fecha de creación descendente', async () => {
    // Timestamps explícitos e insertados directo en D1: dos POST reales podrían caer
    // en el mismo milisegundo y volver el orden no determinístico. La tabla no tiene
    // aislamiento por estudio_id (es la raíz del modelo), así que se compara la
    // posición relativa de estos dos IDs entre sí, no el índice 0 de la lista completa.
    const idPrimero = crypto.randomUUID();
    const idSegundo = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO estudios (id, nombre, creado_en, activo) VALUES (?, 'Orden - primero', 1000, 1)"
    )
      .bind(idPrimero)
      .run();
    await env.DB.prepare(
      "INSERT INTO estudios (id, nombre, creado_en, activo) VALUES (?, 'Orden - segundo', 2000, 1)"
    )
      .bind(idSegundo)
      .run();

    const res = await SELF.fetch(`${BASE}/api/estudios`);
    const estudios = await res.json<{ id: string }[]>();
    const posiciones = estudios.map((e) => e.id);

    expect(posiciones.indexOf(idSegundo)).toBeLessThan(posiciones.indexOf(idPrimero));
  });
});
