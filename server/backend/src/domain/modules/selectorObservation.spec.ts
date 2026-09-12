import {
  leerObservacionSelector,
  esObservacionNueva,
} from './selectorObservation';

const T0 = new Date('2026-09-12T18:06:53.000Z');

describe('observación del selector · 3.1 sólo observa, no decide', () => {
  it('lee PRINCIPAL y su rol', () => {
    const o = leerObservacionSelector({ selector: 'PRINCIPAL', role: 'principal' }, T0);
    expect(o).toEqual({ selector: 'PRINCIPAL', role: 'principal', observedAt: T0 });
  });

  it('lee SATELITE y su rol', () => {
    const o = leerObservacionSelector({ selector: 'SATELITE', role: 'satellite' }, T0);
    expect(o?.selector).toBe('SATELITE');
    expect(o?.role).toBe('satellite');
  });

  it('FAIL CLOSED · un valor fuera del enum NO se persiste ni se aproxima', () => {
    // El firmware no publica durante el tránsito del selector —medido en el
    // banco—, así que un valor raro aquí significa que algo va mal. Guardarlo
    // como posición válida sería inventar una posición que nadie ha visto.
    for (const malo of ['INVALID_SELECTOR', 'principal', 'TRANSITO', '', '1,1']) {
      expect(leerObservacionSelector({ selector: malo, role: 'principal' }, T0)).toBeNull();
    }
  });

  it('un status sin los campos no rompe nada: devuelve null', () => {
    expect(leerObservacionSelector({}, T0)).toBeNull();
    expect(leerObservacionSelector({ selector: null }, T0)).toBeNull();
    expect(leerObservacionSelector({ selector: 123 }, T0)).toBeNull();
  });

  it('si el role no es válido se deriva de la POSICIÓN, que es el dato de origen', () => {
    const o = leerObservacionSelector({ selector: 'PRINCIPAL', role: 'jefe' }, T0);
    expect(o?.role).toBe('principal');
    const s = leerObservacionSelector({ selector: 'SATELITE' }, T0);
    expect(s?.role).toBe('satellite');
  });

  it('AUTO se observa como tal: es una posición real del selector de 3', () => {
    const o = leerObservacionSelector({ selector: 'AUTO', role: 'auto' }, T0);
    expect(o?.selector).toBe('AUTO');
  });
});

describe('IDEMPOTENCIA · module-status es RETENIDO y se reentrega', () => {
  it('la misma observación no se considera nueva', () => {
    const o = leerObservacionSelector({ selector: 'PRINCIPAL', role: 'principal' }, T0)!;
    expect(esObservacionNueva({ selector: 'PRINCIPAL', role: 'principal' }, o)).toBe(false);
  });

  it('un cambio de posición SÍ es nuevo', () => {
    const o = leerObservacionSelector({ selector: 'SATELITE', role: 'satellite' }, T0)!;
    expect(esObservacionNueva({ selector: 'PRINCIPAL', role: 'principal' }, o)).toBe(true);
  });

  it('un módulo sin observación previa siempre es nuevo', () => {
    const o = leerObservacionSelector({ selector: 'SATELITE', role: 'satellite' }, T0)!;
    expect(esObservacionNueva(null, o)).toBe(true);
    expect(esObservacionNueva({ selector: null, role: null }, o)).toBe(true);
  });
});
