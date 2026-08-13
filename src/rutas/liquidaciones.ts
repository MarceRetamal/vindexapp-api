import { Hono } from 'hono';
import type { Bindings } from '../tipos';
import type { DatosBaseLiquidacion, TipoExtincion } from '../liquidaciones/motores';
import { MotorCasasParticulares } from '../liquidaciones/motores';

export const liquidacionesRouter = new Hono<{ Bindings: Bindings }>();

const TIPOS_EXTINCION: TipoExtincion[] = [
  'despido_sin_causa',
  'despido_con_causa',
  'despido_indirecto',
  'renuncia',
  'mutuo_acuerdo',
  'vencimiento_periodo_prueba',
  'fallecimiento_trabajador',
  'fallecimiento_empleador',
  'jubilacion',
  'incapacidad_permanente',
];

/** Body crudo tal como llega en el JSON (las fechas viajan como strings ISO). */
interface BodyLiquidacionCasasParticulares {
  fechaIngreso?: string;
  fechaEgreso?: string;
  mejorRemuneracion?: number;
  tipoExtincion?: string;
  preavisoOtorgado?: boolean;
  diasPreavisoOtorgados?: number;
  diasTrabajadosAnioEnCurso?: number;
}

/**
 * Valida el body contra la forma de `DatosBaseLiquidacion` y devuelve los datos ya
 * convertidos (fechas como `Date`), o un mensaje de error en español si algo no cierra.
 * Sigue el mismo criterio manual campo-por-campo que el resto de las rutas (`clientes.ts`,
 * `expedientes.ts`): no hay una librería de validación en este proyecto todavía.
 */
function validarDatosBaseLiquidacion(
  body: BodyLiquidacionCasasParticulares
): { datos: DatosBaseLiquidacion } | { error: string } {
  if (!body.fechaIngreso || !body.fechaEgreso) {
    return { error: 'fechaIngreso y fechaEgreso son obligatorias.' };
  }

  const fechaIngreso = new Date(body.fechaIngreso);
  const fechaEgreso = new Date(body.fechaEgreso);

  if (Number.isNaN(fechaIngreso.getTime())) {
    return { error: 'fechaIngreso no es una fecha válida (usar formato ISO, ej. "2024-03-15").' };
  }
  if (Number.isNaN(fechaEgreso.getTime())) {
    return { error: 'fechaEgreso no es una fecha válida (usar formato ISO, ej. "2024-03-15").' };
  }
  if (fechaEgreso < fechaIngreso) {
    return { error: 'fechaEgreso no puede ser anterior a fechaIngreso.' };
  }

  if (typeof body.mejorRemuneracion !== 'number' || !Number.isFinite(body.mejorRemuneracion) || body.mejorRemuneracion <= 0) {
    return { error: 'mejorRemuneracion es obligatoria y debe ser un número mayor a 0.' };
  }

  if (!body.tipoExtincion || !TIPOS_EXTINCION.includes(body.tipoExtincion as TipoExtincion)) {
    return {
      error: `tipoExtincion es obligatorio y debe ser uno de: ${TIPOS_EXTINCION.join(', ')}.`,
    };
  }

  if (typeof body.preavisoOtorgado !== 'boolean') {
    return { error: 'preavisoOtorgado es obligatorio y debe ser true o false.' };
  }

  if (
    body.diasPreavisoOtorgados !== undefined &&
    (typeof body.diasPreavisoOtorgados !== 'number' || !Number.isFinite(body.diasPreavisoOtorgados) || body.diasPreavisoOtorgados < 0)
  ) {
    return { error: 'diasPreavisoOtorgados debe ser un número mayor o igual a 0.' };
  }

  if (
    typeof body.diasTrabajadosAnioEnCurso !== 'number' ||
    !Number.isFinite(body.diasTrabajadosAnioEnCurso) ||
    body.diasTrabajadosAnioEnCurso < 0
  ) {
    return { error: 'diasTrabajadosAnioEnCurso es obligatorio y debe ser un número mayor o igual a 0.' };
  }

  return {
    datos: {
      fechaIngreso,
      fechaEgreso,
      mejorRemuneracion: body.mejorRemuneracion,
      tipoExtincion: body.tipoExtincion as TipoExtincion,
      preavisoOtorgado: body.preavisoOtorgado,
      diasPreavisoOtorgados: body.diasPreavisoOtorgados,
      diasTrabajadosAnioEnCurso: body.diasTrabajadosAnioEnCurso,
    },
  };
}

/**
 * Liquidación de despido sin causa/indirecto para personal de casas particulares
 * (Ley 26.844). Endpoint de cálculo puro: no lee ni escribe en la base de datos.
 *
 * Sin autenticación todavía (se agrega con Access, ver README.md) — igual que el resto
 * de las rutas de este proyecto por ahora.
 */
liquidacionesRouter.post('/casas-particulares', async (c) => {
  const body = await c.req.json<BodyLiquidacionCasasParticulares>();

  const validacion = validarDatosBaseLiquidacion(body);
  if ('error' in validacion) {
    return c.json({ error: validacion.error }, 400);
  }

  const resultado = MotorCasasParticulares.liquidarDespidoSinCausa(validacion.datos);

  return c.json(resultado);
});
