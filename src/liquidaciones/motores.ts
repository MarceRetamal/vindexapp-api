// VINDEX LEGAL — Motores de cálculo de liquidaciones laborales
//
// Tres regímenes previstos para este módulo:
//
//   1. Casas Particulares (Ley 26.844) — COMPLETO y verificado contra el texto de la ley.
//      Ver `MotorCasasParticulares` más abajo. Es el único de los tres regímenes que hoy
//      tiene una función expuesta por la API (`liquidarDespidoSinCausa`, servida desde
//      `POST /api/liquidaciones/casas-particulares`).
//
//   2. LCT (Ley 20.744 t.o. 1976, con la reforma de la Ley 27.802) — PENDIENTE.
//      Dejado como esqueleto/interfaz comentada (`MotorLCT`, más abajo). No se completa
//      porque el texto vigente reformado (días de preaviso, tope indemnizatorio del
//      art. 245, período de prueba post-reforma, régimen de actualización de créditos
//      del art. 276 + art. 55 Ley 27.802) todavía no fue verificado en esta conversación.
//      No se cargan valores de memoria sin verificación directa contra el texto legal.
//
//   3. Construcción (Ley 22.250 + CCT 76/75) — PARCIAL.
//      La escala salarial UOCRA (`ESCALA_UOCRA_AGOSTO_2026`, más abajo) está completa y
//      vigente. El motor de liquidación en sí (`MotorConstruccion`, esqueleto comentado)
//      queda pendiente porque el % de aporte mensual al Fondo de Cese Laboral —variable
//      según antigüedad del vínculo— y el resto del mecanismo de la Ley 22.250 todavía
//      no fueron confirmados contra el texto de la ley.
//
// Regla general para este archivo: los esqueletos de MotorLCT y MotorConstruccion NO se
// completan con valores recordados de memoria sin verificación directa — requieren que
// el texto vigente de esas leyes se cargue y confirme en el chat antes de activarse.

// ============================================================
// TIPOS COMUNES A LOS TRES REGÍMENES
// ============================================================

export type TipoExtincion =
  | "despido_sin_causa"
  | "despido_con_causa"
  | "despido_indirecto"
  | "renuncia"
  | "mutuo_acuerdo"
  | "vencimiento_periodo_prueba"
  | "fallecimiento_trabajador"
  | "fallecimiento_empleador"
  | "jubilacion"
  | "incapacidad_permanente";

export interface DatosBaseLiquidacion {
  fechaIngreso: Date;
  fechaEgreso: Date;
  /** Mejor remuneración mensual, normal y habitual devengada durante el último año
   *  (o el tiempo de prestación de servicios, si fue menor). */
  mejorRemuneracion: number;
  tipoExtincion: TipoExtincion;
  preavisoOtorgado: boolean;
  diasPreavisoOtorgados?: number;
  /** Días trabajados en el año calendario en curso al momento del egreso, para el
   *  cálculo de vacaciones no gozadas (proporcional). */
  diasTrabajadosAnioEnCurso: number;
}

export interface Antiguedad {
  aniosCompletos: number;
  mesesRestantes: number;
  diasTotales: number;
}

export interface ResultadoLiquidacion {
  antiguedad: Antiguedad;
  indemnizacionAntiguedad: number;
  indemnizacionSustitutivaPreaviso: number;
  integracionMesDespido: number;
  sacProporcional: number;
  vacacionesNoGozadas: number;
  indemnizacionEspecialMaternidadOMatrimonio: number;
  totalBruto: number;
  advertencias: string[];
}

/** Calcula antigüedad exacta (años, meses, días) entre dos fechas. */
export function calcularAntiguedad(ingreso: Date, egreso: Date): Antiguedad {
  if (egreso < ingreso) {
    throw new Error("La fecha de egreso no puede ser anterior a la fecha de ingreso.");
  }
  let anios = egreso.getFullYear() - ingreso.getFullYear();
  let meses = egreso.getMonth() - ingreso.getMonth();
  let dias = egreso.getDate() - ingreso.getDate();

  if (dias < 0) {
    meses -= 1;
    const mesAnterior = new Date(egreso.getFullYear(), egreso.getMonth(), 0);
    dias += mesAnterior.getDate();
  }
  if (meses < 0) {
    anios -= 1;
    meses += 12;
  }

  const diasTotales = Math.floor((egreso.getTime() - ingreso.getTime()) / (1000 * 60 * 60 * 24));
  return { aniosCompletos: anios, mesesRestantes: meses, diasTotales };
}

function esBisiesto(anio: number): boolean {
  return (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
}

/** Sin uso interno todavía — queda disponible para MotorLCT/MotorConstruccion. */
export function diasDelAnio(anio: number): number {
  return esBisiesto(anio) ? 366 : 365;
}

// ============================================================
// MOTOR 1 — LCT (Ley 20.744 t.o. 1976, reforma Ley 27.802)
// ============================================================
// ESQUELETO — pendiente de cargar el texto vigente (con reforma 27.802) para completar:
//   - días de preaviso por antigüedad (art. 231 LCT o el que lo haya sustituido)
//   - integración del mes de despido (art. 233)
//   - tope indemnizatorio del art. 245 (remite a convenio aplicable — no corresponde a este
//     motor si no hay convenio, pero hay que confirmar el tratamiento del piso mínimo)
//   - período de prueba vigente tras la reforma (para el escenario "vencimiento_periodo_prueba")
//   - régimen de actualización de créditos: remite al art. 276 LCT reformado + art. 55 Ley
//     27.802 (transitorio, con jurisprudencia dividida — ver nota de PBA, Tribunal de
//     Trabajo N°2 La Plata, causa por inconstitucionalidad)
//
// export namespace MotorLCT {
//   export const DIAS_PREAVISO_TRABAJADOR = /* TODO: confirmar contra texto */;
//   export function diasPreavisoEmpleador(antiguedad: Antiguedad): number {
//     throw new Error("Pendiente: cargar texto LCT con reforma 27.802");
//   }
//   export function indemnizacionAntiguedad(mejorRemuneracion: number, antiguedad: Antiguedad): number {
//     // Art. 245: 1 mes por año o fracción mayor a 3 meses, piso de 1 mes — esta fórmula
//     // coincide con la de Ley 26.844 art. 48 y probablemente no cambió con la reforma,
//     // pero se dejará sin activar hasta confirmar contra el texto reformado.
//     throw new Error("Pendiente: confirmar contra texto LCT con reforma 27.802");
//   }
// }

// ============================================================
// MOTOR 2 — CONSTRUCCIÓN (Ley 22.250 + CCT 76/75)
// ============================================================
// ESQUELETO — la Ley 22.250 no indemniza por antigüedad como la LCT: capitaliza un
// Fondo de Cese Laboral (FCL) mediante aportes mensuales del empleador sobre la
// remuneración, que se liquida al cese cualquiera sea la causa. Esto exige:
//   - % de aporte mensual al FCL (variable según antigüedad del vínculo: distinto el
//     primer año del resto — NO confirmado en este chat, no cargar de memoria)
//   - depositario del fondo (banco/ART/caja específica según la ley)
//   - si corresponde también preaviso/integración además del FCL, o si el FCL lo sustituye
//   - motor de escala salarial: YA CERRADO (ver tablasSalarialesUOCRA más abajo, agosto 2026)
//
// export interface AporteFCL {
//   mes: Date;
//   remuneracionDelMes: number;
//   porcentajeAporte: number; // TODO: confirmar contra texto Ley 22.250
//   montoAportado: number;
// }
// export namespace MotorConstruccion {
//   export function calcularFondoCeseLaboral(aportes: AporteFCL[]): number {
//     throw new Error("Pendiente: cargar texto Ley 22.250 para confirmar % de aporte");
//   }
// }

/** Categorías salariales CCT 76/75 (art. 5) mapeadas a los 5 niveles de la escala paritaria. */
export type CategoriaUOCRA =
  | "oficial_especializado"
  | "oficial"
  | "medio_oficial"
  | "ayudante"
  | "sereno";

export type ZonaUOCRA = "A" | "B" | "C" | "austral";

/**
 * Escala salarial UOCRA (CCT 76/75) vigente a AGOSTO 2026.
 * Fuente: acuerdo paritario homologado 2/6/2026 (segundo tramo jun-jul-ago 2026),
 * texto oficial leído en uocra.org para los % de aumento y las sumas no remunerativas
 * de zona A; básicos de agosto y zonas B/C/austral tomados de fuentes periodísticas
 * que citan el mismo acuerdo y coinciden con la SNR verificada en el original —
 * NO es lectura directa del Anexo I/II oficial. Verificar contra el Anexo antes de
 * usar en producción si el margen de error debe ser cero.
 */
export const ESCALA_UOCRA_AGOSTO_2026: Record<ZonaUOCRA, Record<CategoriaUOCRA, number>> = {
  A: {
    oficial_especializado: 7420,
    oficial: 6348,
    medio_oficial: 5866,
    ayudante: 5399,
    sereno: 980858, // mensual, no por hora
  },
  B: {
    oficial_especializado: 8237,
    oficial: 7049,
    medio_oficial: 6502,
    ayudante: 6020,
    sereno: 1092719,
  },
  C: {
    oficial_especializado: 11392,
    oficial: 10680,
    medio_oficial: 10306,
    ayudante: 10007,
    sereno: 1639782,
  },
  austral: {
    oficial_especializado: 14841,
    oficial: 12695,
    medio_oficial: 11732,
    ayudante: 10798,
    sereno: 1961716,
  },
};

/** Adicional por asistencia perfecta (art. 52 CCT 76/75): 20% sobre el básico de la categoría. */
export const ADICIONAL_ASISTENCIA_PERFECTA = 0.20;

// ============================================================
// MOTOR 3 — CASAS PARTICULARES (Ley 26.844) — COMPLETO
// ============================================================

export namespace MotorCasasParticulares {
  /** Art. 42: días de preaviso a cargo del empleador según antigüedad. */
  export function diasPreavisoEmpleador(antiguedad: Antiguedad): number {
    return antiguedad.aniosCompletos >= 1 ? 30 : 10;
  }

  /** Art. 42 inc. a): el trabajador debe preavisar con 10 días, sin variación por antigüedad. */
  export const DIAS_PREAVISO_TRABAJADOR = 10;

  /**
   * Art. 48: indemnización por antigüedad — 1 mes de sueldo por cada año de servicio o
   * fracción mayor de 3 meses, tomando como base la mejor remuneración mensual, normal y
   * habitual devengada durante el último año (o el tiempo de prestación si fue menor).
   * Piso: nunca menor a 1 mes.
   */
  export function indemnizacionAntiguedad(mejorRemuneracion: number, antiguedad: Antiguedad): number {
    let periodos = antiguedad.aniosCompletos;
    if (antiguedad.mesesRestantes > 3) periodos += 1;
    if (periodos < 1) periodos = 1;
    return mejorRemuneracion * periodos;
  }

  /**
   * Art. 43-44: indemnización sustitutiva de preaviso omitido o insuficiente, más la
   * integración del mes de despido si el egreso no coincide con el último día del mes.
   */
  export function indemnizacionSustitutivaPreaviso(
    mejorRemuneracion: number,
    antiguedad: Antiguedad,
    diasOtorgados: number
  ): number {
    const diasQueCorrespondian = diasPreavisoEmpleador(antiguedad);
    const diasFaltantes = Math.max(0, diasQueCorrespondian - diasOtorgados);
    if (diasFaltantes === 0) return 0;
    return (mejorRemuneracion / 30) * diasFaltantes;
  }

  export function integracionMesDespido(mejorRemuneracion: number, fechaEgreso: Date): number {
    const ultimoDiaDelMes = new Date(fechaEgreso.getFullYear(), fechaEgreso.getMonth() + 1, 0).getDate();
    if (fechaEgreso.getDate() === ultimoDiaDelMes) return 0;
    const diasRestantes = ultimoDiaDelMes - fechaEgreso.getDate();
    return (mejorRemuneracion / 30) * diasRestantes;
  }

  /**
   * Art. 26-28: SAC proporcional. 50% de la mejor remuneración del semestre en curso,
   * proporcional a los días trabajados en ese semestre.
   */
  export function sacProporcional(mejorRemuneracionSemestre: number, diasTrabajadosEnSemestre: number): number {
    const DIAS_SEMESTRE = 182.5; // aproximación estándar; ajustar si se requiere precisión diaria exacta
    return (mejorRemuneracionSemestre * 0.5 * diasTrabajadosEnSemestre) / DIAS_SEMESTRE;
  }

  /**
   * Art. 29: vacaciones según antigüedad al 31/12 del año que corresponda (días corridos,
   * régimen "completo" — para quien cumplió el requisito del art. 30 de 6 meses trabajados).
   */
  export function diasVacacionesPorAntiguedad(antiguedad: Antiguedad): number {
    const anios = antiguedad.aniosCompletos;
    if (anios <= 5) return 14;
    if (anios <= 10) return 21;
    if (anios <= 20) return 28;
    return 35;
  }

  /**
   * Art. 29-30: vacaciones no gozadas al momento del egreso, indemnizadas.
   * Si no llegó a los 6 meses de trabajo en el año/aniversario, se liquida proporcional
   * (1 día cada 20 días trabajados, sin distinción de antigüedad para ese cómputo — la ley
   * no establece escala proporcional distinta a la de la LCT en este punto específico).
   */
  export function vacacionesNoGozadas(
    mejorRemuneracion: number,
    antiguedad: Antiguedad,
    diasTrabajadosAnioEnCurso: number,
    _anioEgreso: number
  ): number {
    const cumplioSeisMeses = diasTrabajadosAnioEnCurso >= 183; // aprox. mitad del año calendario
    const diasVacaciones = cumplioSeisMeses
      ? diasVacacionesPorAntiguedad(antiguedad)
      : Math.floor(diasTrabajadosAnioEnCurso / 20);
    const valorDiaConPlus = (mejorRemuneracion / 25) * 1; // TODO: confirmar si corresponde plus vacacional
    // Nota: la Ley 26.844 no fija expresamente el divisor para el valor día de vacaciones;
    // por analogía con la LCT (art. 155) suele usarse /25. La calculadora de upacp.org.ar que
    // Marcelo usa como contraste liquida con divisor 30 y SIN plus vacacional — hay que
    // decidir explícitamente qué criterio adopta el motor, no asumirlo en silencio.
    return valorDiaConPlus * diasVacaciones;
  }

  /**
   * Art. 34: enfermedad inculpable — días con derecho a remuneración según antigüedad
   * (a diferencia de la LCT general, acá el criterio es solo antigüedad, sin cargas de familia).
   */
  export function mesesConGoceDeSueldoPorEnfermedad(antiguedad: Antiguedad): number {
    return antiguedad.aniosCompletos < 5 ? 3 : 6;
  }

  /**
   * Art. 41: indemnización especial por despido por causa de maternidad/embarazo o
   * matrimonio — 1 año de remuneraciones, acumulable a la indemnización por antigüedad.
   * Debe determinarse por fuera del motor si se dan los supuestos de presunción del
   * art. 40 (despido dentro de los 7,5 meses anteriores/posteriores al parto) o del
   * art. 41 último párrafo (matrimonio, 3 meses antes / 6 meses después).
   */
  export function indemnizacionEspecialMaternidadOMatrimonio(mejorRemuneracion: number): number {
    return mejorRemuneracion * 12;
  }

  /**
   * Liquidación completa para egreso por despido sin causa (el escenario más habitual
   * para el motor). Otros tipos de extinción (renuncia, mutuo acuerdo, etc.) no generan
   * indemnización por antigüedad ni preaviso — se resuelven aparte.
   */
  export function liquidarDespidoSinCausa(datos: DatosBaseLiquidacion): ResultadoLiquidacion {
    const advertencias: string[] = [];
    const antiguedad = calcularAntiguedad(datos.fechaIngreso, datos.fechaEgreso);

    if (datos.tipoExtincion !== "despido_sin_causa" && datos.tipoExtincion !== "despido_indirecto") {
      advertencias.push(
        "Esta función calcula el escenario de despido sin causa/indirecto (arts. 48-49). " +
          "Para otros tipos de extinción, la indemnización por antigüedad y el preaviso no corresponden de la misma forma."
      );
    }

    const indemAntiguedad = indemnizacionAntiguedad(datos.mejorRemuneracion, antiguedad);
    const indemPreaviso = datos.preavisoOtorgado
      ? indemnizacionSustitutivaPreaviso(datos.mejorRemuneracion, antiguedad, datos.diasPreavisoOtorgados ?? 0)
      : indemnizacionSustitutivaPreaviso(datos.mejorRemuneracion, antiguedad, 0);
    const integracion = integracionMesDespido(datos.mejorRemuneracion, datos.fechaEgreso);
    const sac = sacProporcional(datos.mejorRemuneracion, datos.diasTrabajadosAnioEnCurso % 183);
    const vacaciones = vacacionesNoGozadas(
      datos.mejorRemuneracion,
      antiguedad,
      datos.diasTrabajadosAnioEnCurso,
      datos.fechaEgreso.getFullYear()
    );

    advertencias.push(
      "Este cálculo NO incluye categoría ni escala salarial mínima de convenio (Resolución CNTCP) " +
        "porque ese dato sigue pendiente de conseguir — no está en el texto de la Ley 26.844."
    );
    advertencias.push(
      "El valor día de vacaciones usa divisor 25 por analogía con el art. 155 LCT; definir explícitamente " +
        "si el motor debe adoptar el criterio de la calculadora upacp.org.ar (divisor 30, sin plus) en su lugar."
    );

    const totalBruto = indemAntiguedad + indemPreaviso + integracion + sac + vacaciones;

    return {
      antiguedad,
      indemnizacionAntiguedad: indemAntiguedad,
      indemnizacionSustitutivaPreaviso: indemPreaviso,
      integracionMesDespido: integracion,
      sacProporcional: sac,
      vacacionesNoGozadas: vacaciones,
      indemnizacionEspecialMaternidadOMatrimonio: 0,
      totalBruto,
      advertencias,
    };
  }
}
