// Test de integración: ejercita la ruta real vía SELF.fetch (HTTP dentro del
// runtime del Worker) contra D1 con el esquema real aplicado por
// test/aplicar-migraciones.ts. Cubre el camino feliz y el constraint UNIQUE
// (estudio_id, dni) porque es la única regla de negocio no trivial de esta ruta.
import { SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { env } from '../../test/env';
import { crearEstudioDePrueba } from '../../test/fixtures';

async function post(path: string, body: unknown) {
  return SELF.fetch(`http://vindexapp-api.local${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/clientes', () => {
  let estudioId: string;

  beforeEach(async () => {
    estudioId = await crearEstudioDePrueba(env.DB);
  });

  it('crea un cliente con los campos obligatorios', async () => {
    const res = await post('/api/clientes', {
      estudio_id: estudioId,
      nombre: 'Ana',
      apellido: 'Gómez',
    });

    expect(res.status).toBe(201);
    const body = await res.json<{ id: string; nombre: string; apellido: string }>();
    expect(body.nombre).toBe('Ana');
    expect(body.apellido).toBe('Gómez');
    expect(body.id).toBeTruthy();
  });

  it('rechaza la creación si falta un campo obligatorio', async () => {
    const res = await post('/api/clientes', { estudio_id: estudioId, nombre: 'Ana' });
    expect(res.status).toBe(400);
  });

  it('rechaza un DNI duplicado dentro del mismo estudio con 409', async () => {
    await post('/api/clientes', {
      estudio_id: estudioId,
      nombre: 'Ana',
      apellido: 'Gómez',
      dni: '30111222',
    });

    const res = await post('/api/clientes', {
      estudio_id: estudioId,
      nombre: 'Otra',
      apellido: 'Persona',
      dni: '30111222',
    });

    expect(res.status).toBe(409);
    const body = await res.json<{ cliente_existente: { nombre: string } }>();
    expect(body.cliente_existente.nombre).toBe('Ana');
  });

  it('permite el mismo DNI en estudios distintos', async () => {
    const otroEstudioId = await crearEstudioDePrueba(env.DB);

    await post('/api/clientes', {
      estudio_id: estudioId,
      nombre: 'Ana',
      apellido: 'Gómez',
      dni: '30111222',
    });

    const res = await post('/api/clientes', {
      estudio_id: otroEstudioId,
      nombre: 'Ana',
      apellido: 'Gómez',
      dni: '30111222',
    });

    expect(res.status).toBe(201);
  });
});

describe('GET /api/clientes', () => {
  it('exige estudio_id como query param', async () => {
    const res = await SELF.fetch('http://vindexapp-api.local/api/clientes');
    expect(res.status).toBe(400);
  });

  it('devuelve solo los clientes del estudio pedido', async () => {
    const estudioA = await crearEstudioDePrueba(env.DB);
    const estudioB = await crearEstudioDePrueba(env.DB);

    await post('/api/clientes', { estudio_id: estudioA, nombre: 'Ana', apellido: 'Gómez' });
    await post('/api/clientes', { estudio_id: estudioB, nombre: 'Luis', apellido: 'Pérez' });

    const res = await SELF.fetch(`http://vindexapp-api.local/api/clientes?estudio_id=${estudioA}`);
    const clientes = await res.json<{ nombre: string }[]>();

    expect(clientes).toHaveLength(1);
    expect(clientes[0]?.nombre).toBe('Ana');
  });
});

describe('GET /api/clientes/:id', () => {
  it('devuelve 404 si el cliente no existe', async () => {
    const res = await SELF.fetch('http://vindexapp-api.local/api/clientes/no-existe');
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/clientes/:id', () => {
  it('actualiza solo los campos presentes en el body', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const creado = await post('/api/clientes', {
      estudio_id: estudioId,
      nombre: 'Ana',
      apellido: 'Gómez',
      email: 'ana@ejemplo.com',
    });
    const { id } = await creado.json<{ id: string }>();

    const res = await SELF.fetch(`http://vindexapp-api.local/api/clientes/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apellido: 'Gómez Díaz' }),
    });

    expect(res.status).toBe(200);
    const actualizado = await res.json<{ nombre: string; apellido: string; email: string }>();
    expect(actualizado.apellido).toBe('Gómez Díaz');
    expect(actualizado.nombre).toBe('Ana');
    expect(actualizado.email).toBe('ana@ejemplo.com');
  });

  it('devuelve 400 si el body no trae ningún campo', async () => {
    const estudioId = await crearEstudioDePrueba(env.DB);
    const creado = await post('/api/clientes', {
      estudio_id: estudioId,
      nombre: 'Ana',
      apellido: 'Gómez',
    });
    const { id } = await creado.json<{ id: string }>();

    const res = await SELF.fetch(`http://vindexapp-api.local/api/clientes/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });
});
