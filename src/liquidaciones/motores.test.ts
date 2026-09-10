import { describe, expect, it } from 'vitest';
import { calcularAntiguedad, MotorCasasParticulares } from './motores';

describe('calcularAntiguedad', () => {
  it('calcula años completos sin resto de meses/días', () => {
    const antiguedad = calcularAntiguedad(new Date(2020, 0, 15), new Date(2023, 0, 15));
    expect(antiguedad.aniosCompletos).toBe(3);
    expect(antiguedad.mesesRestantes).toBe(0);
  });

  it('ajusta meses y días cuando el día de egreso es anterior al de ingreso', () => {
    const antiguedad = calcularAntiguedad(new Date(2020, 0, 20), new Date(2023, 1, 10));
    // de 20/ene/2020 a 10/feb/2023: 3 años no cumplidos aún (falta el mes de ene->feb con día 20->10)
    expect(antiguedad.aniosCompletos).toBe(3);
    expect(antiguedad.mesesRestantes).toBe(0);
  });

  it('rechaza fecha de egreso anterior a la de ingreso', () => {
    expect(() => calcularAntiguedad(new Date(2023, 0, 1), new Date(2022, 0, 1))).toThrow(
      'La fecha de egreso no puede ser anterior a la fecha de ingreso.'
    );
  });
});

describe('MotorCasasParticulares.diasPreavisoEmpleador (art. 42)', () => {
  it('otorga 10 días con menos de 1 año de antigüedad', () => {
    const dias = MotorCasasParticulares.diasPreavisoEmpleador({
      aniosCompletos: 0,
      mesesRestantes: 6,
      diasTotales: 180,
    });
    expect(dias).toBe(10);
  });

  it('otorga 30 días con 1 año o más de antigüedad', () => {
    const dias = MotorCasasParticulares.diasPreavisoEmpleador({
      aniosCompletos: 1,
      mesesRestantes: 0,
      diasTotales: 365,
    });
    expect(dias).toBe(30);
  });
});

describe('MotorCasasParticulares.indemnizacionAntiguedad (art. 48)', () => {
  it('redondea hacia arriba cuando el resto supera los 3 meses', () => {
    const monto = MotorCasasParticulares.indemnizacionAntiguedad(100000, {
      aniosCompletos: 2,
      mesesRestantes: 4,
      diasTotales: 850,
    });
    expect(monto).toBe(300000); // 2 años + 1 período extra por fracción > 3 meses
  });

  it('no redondea hacia arriba cuando el resto es de 3 meses o menos', () => {
    const monto = MotorCasasParticulares.indemnizacionAntiguedad(100000, {
      aniosCompletos: 2,
      mesesRestantes: 3,
      diasTotales: 820,
    });
    expect(monto).toBe(200000);
  });

  it('aplica el piso de 1 mes aun con antigüedad menor a un año', () => {
    const monto = MotorCasasParticulares.indemnizacionAntiguedad(100000, {
      aniosCompletos: 0,
      mesesRestantes: 2,
      diasTotales: 60,
    });
    expect(monto).toBe(100000);
  });
});
