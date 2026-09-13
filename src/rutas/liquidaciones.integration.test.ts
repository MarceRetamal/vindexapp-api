// Test de integración de la capa HTTP de liquidaciones (validación del body +
// invocación del motor). El motor en sí (montos, antigüedad) ya está cubierto
// en src/liquidaciones/motores.test.ts; acá solo se prueba lo que agrega esta
// ruta: parseo/validación del JSON entrante y los códigos de estado.
// Ruta pública a propósito (ver la nota en liquidaciones.ts) — se prueba
// contra el Worker completo con SELF.fetch, sin token.
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const BASE = 'http://vindexapp-api.local';

async function post(body: unknown) {
  return SELF.fetch(`${BASE}/api/liquidaciones/casas-particulares`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const BODY_VALIDO = {
  fechaIngreso: '2020-01-15',
  fechaEgreso: '2026-06-15',
  mejorRemuneracion: 500000,
  tipoExtincion: 'despido_sin_causa',
  preavisoOtorgado: false,
  diasTrabajadosAnioEnCurso: 165,
};

describe('POST /api/liquidaciones/casas-particulares', () => {
  it('no exige autenticación (calculadora pública del sitio)', async () => {
    const res = await post(BODY_VALIDO);
    expect(res.status).toBe(200);
  });

  it('calcula la liquidación con un body válido', async () => {
    const res = await post(BODY_VALIDO);
    expect(res.status).toBe(200);
    const body = await res.json<{ totalBruto: number; antiguedad: { aniosCompletos: number } }>();
    expect(body.totalBruto).toBeGreaterThan(0);
    expect(body.antiguedad.aniosCompletos).toBe(6);
  });

  it('rechaza si falta fechaIngreso o fechaEgreso', async () => {
    const { fechaIngreso, ...resto } = BODY_VALIDO;
    const res = await post(resto);
    expect(res.status).toBe(400);
  });

  it('rechaza una fecha con formato inválido', async () => {
    const res = await post({ ...BODY_VALIDO, fechaIngreso: 'no-es-una-fecha' });
    expect(res.status).toBe(400);
  });

  it('rechaza si fechaEgreso es anterior a fechaIngreso', async () => {
    const res = await post({ ...BODY_VALIDO, fechaEgreso: '2019-01-01' });
    expect(res.status).toBe(400);
  });

  it('rechaza mejorRemuneracion faltante o no positiva', async () => {
    const res1 = await post({ ...BODY_VALIDO, mejorRemuneracion: undefined });
    expect(res1.status).toBe(400);
    const res2 = await post({ ...BODY_VALIDO, mejorRemuneracion: 0 });
    expect(res2.status).toBe(400);
  });

  it('rechaza un tipoExtincion inválido', async () => {
    const res = await post({ ...BODY_VALIDO, tipoExtincion: 'despido_por_capricho' });
    expect(res.status).toBe(400);
  });

  it('rechaza si falta preavisoOtorgado', async () => {
    const { preavisoOtorgado, ...resto } = BODY_VALIDO;
    const res = await post(resto);
    expect(res.status).toBe(400);
  });

  it('rechaza diasPreavisoOtorgados negativo', async () => {
    const res = await post({ ...BODY_VALIDO, diasPreavisoOtorgados: -5 });
    expect(res.status).toBe(400);
  });

  it('rechaza si falta diasTrabajadosAnioEnCurso', async () => {
    const { diasTrabajadosAnioEnCurso, ...resto } = BODY_VALIDO;
    const res = await post(resto);
    expect(res.status).toBe(400);
  });

  it('agrega una advertencia cuando el tipoExtincion no es despido sin causa/indirecto', async () => {
    const res = await post({ ...BODY_VALIDO, tipoExtincion: 'renuncia' });
    expect(res.status).toBe(200);
    const body = await res.json<{ advertencias: string[] }>();
    expect(body.advertencias.length).toBeGreaterThan(0);
  });
});
