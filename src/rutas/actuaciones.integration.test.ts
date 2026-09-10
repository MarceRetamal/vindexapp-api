// Test de integración de la ruta de actuaciones. La parte no trivial es
// /vencimientos-proximos: filtra por rango de fechas y hace join con expedientes
// y clientes, así que exige tener ese grafo completo armado en la base.
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { env } from '../../test/env';
import { crearClienteDePrueba, crearEstudioDePrueba, crearExpedienteDePrueba } from '../../test/fixtures';

const BASE = 'http://vindexapp-api.local';

async function post(path: string, body: unknown) {
  return SELF.fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
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
  return { estudioId, clienteId, expedienteId };
}

describe('POST /api/actuaciones', () => {
  it('crea una actuación con los campos obligatorios', async () => {
    const { estudioId, expedienteId } = await armarExpediente();

    const res = await post('/api/actuaciones', {
      estudio_id: estudioId,
      expediente_id: expedienteId,
      tipo: 'Escrito presentado',
      fecha: fechaMasDias(0),
    });

    expect(res.status).toBe(201);
    const body = await res.json<{ id: string; tipo: string }>();
    expect(body.tipo).toBe('Escrito presentado');
  });

  it('guarda visible, hito y vencimiento cuando vienen en el body', async () => {
    const { estudioId, expedienteId } = await armarExpediente();
    const vencimiento = fechaMasDias(5);

    const creada = await post('/api/actuaciones', {
      estudio_id: estudioId,
      expediente_id: expedienteId,
      tipo: 'Traslado',
      fecha: fechaMasDias(0),
      visible: true,
      hito: true,
      vencimiento,
    });
    const { id } = await creada.json<{ id: string }>();

    const fila = await env.DB.prepare('SELECT visible, hito, vencimiento FROM actuaciones WHERE id = ?')
      .bind(id)
      .first<{ visible: number; hito: number; vencimiento: string }>();

    expect(fila?.visible).toBe(1);
    expect(fila?.hito).toBe(1);
    expect(fila?.vencimiento).toBe(vencimiento);
  });

  it('rechaza si falta un campo obligatorio', async () => {
    const { estudioId, expedienteId } = await armarExpediente();
    const res = await post('/api/actuaciones', { estudio_id: estudioId, expediente_id: expedienteId });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/actuaciones', () => {
  it('exige expediente_id', async () => {
    const res = await SELF.fetch(`${BASE}/api/actuaciones`);
    expect(res.status).toBe(400);
  });

  it('devuelve las actuaciones del expediente ordenadas por fecha descendente', async () => {
    const { estudioId, expedienteId } = await armarExpediente();

    await post('/api/actuaciones', {
      estudio_id: estudioId,
      expediente_id: expedienteId,
      tipo: 'Primera',
      fecha: fechaMasDias(-10),
    });
    await post('/api/actuaciones', {
      estudio_id: estudioId,
      expediente_id: expedienteId,
      tipo: 'Segunda',
      fecha: fechaMasDias(0),
    });

    const res = await SELF.fetch(`${BASE}/api/actuaciones?expediente_id=${expedienteId}`);
    const actuaciones = await res.json<{ tipo: string }[]>();

    expect(actuaciones).toHaveLength(2);
    expect(actuaciones[0]?.tipo).toBe('Segunda');
  });
});

describe('GET /api/actuaciones/vencimientos-proximos', () => {
  it('exige estudio_id', async () => {
    const res = await SELF.fetch(`${BASE}/api/actuaciones/vencimientos-proximos`);
    expect(res.status).toBe(400);
  });

  it('devuelve solo las actuaciones con vencimiento dentro de los próximos N días', async () => {
    const { estudioId, expedienteId } = await armarExpediente();

    await post('/api/actuaciones', {
      estudio_id: estudioId,
      expediente_id: expedienteId,
      tipo: 'Vence pronto',
      fecha: fechaMasDias(0),
      vencimiento: fechaMasDias(3),
    });
    await post('/api/actuaciones', {
      estudio_id: estudioId,
      expediente_id: expedienteId,
      tipo: 'Vence lejos',
      fecha: fechaMasDias(0),
      vencimiento: fechaMasDias(30),
    });
    await post('/api/actuaciones', {
      estudio_id: estudioId,
      expediente_id: expedienteId,
      tipo: 'Sin vencimiento',
      fecha: fechaMasDias(0),
    });

    const res = await SELF.fetch(`${BASE}/api/actuaciones/vencimientos-proximos?estudio_id=${estudioId}`);
    const proximas = await res.json<{ tipo: string; expediente_caratula: string; cliente_nombre: string }[]>();

    expect(proximas).toHaveLength(1);
    expect(proximas[0]?.tipo).toBe('Vence pronto');
    expect(proximas[0]?.expediente_caratula).toBe('Expediente de prueba');
    expect(proximas[0]?.cliente_nombre).toBe('Cliente');
  });

  it('respeta el parámetro dias para ampliar la ventana', async () => {
    const { estudioId, expedienteId } = await armarExpediente();

    await post('/api/actuaciones', {
      estudio_id: estudioId,
      expediente_id: expedienteId,
      tipo: 'Vence en 20 días',
      fecha: fechaMasDias(0),
      vencimiento: fechaMasDias(20),
    });

    const conDefault = await SELF.fetch(`${BASE}/api/actuaciones/vencimientos-proximos?estudio_id=${estudioId}`);
    expect(await conDefault.json()).toHaveLength(0);

    const conVentanaAmpliada = await SELF.fetch(
      `${BASE}/api/actuaciones/vencimientos-proximos?estudio_id=${estudioId}&dias=30`
    );
    expect(await conVentanaAmpliada.json()).toHaveLength(1);
  });
});

describe('PATCH /api/actuaciones/:id/notificar', () => {
  it('marca la actuación como notificada y visible', async () => {
    const { estudioId, expedienteId } = await armarExpediente();
    const creada = await post('/api/actuaciones', {
      estudio_id: estudioId,
      expediente_id: expedienteId,
      tipo: 'Resolución',
      fecha: fechaMasDias(0),
      visible: false,
    });
    const { id } = await creada.json<{ id: string }>();

    const res = await SELF.fetch(`${BASE}/api/actuaciones/${id}/notificar`, { method: 'PATCH' });
    expect(res.status).toBe(200);

    const fila = await env.DB.prepare('SELECT notificado, visible FROM actuaciones WHERE id = ?')
      .bind(id)
      .first<{ notificado: number; visible: number }>();
    expect(fila?.notificado).toBe(1);
    expect(fila?.visible).toBe(1);
  });
});
