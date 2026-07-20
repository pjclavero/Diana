import {
  AmmoInput,
  computeAccuracy,
  NOT_COMPUTABLE_MESSAGE,
  resolveShotsFired,
} from '../../src/domain/accuracy/accuracy';

function ammo(overrides: Partial<AmmoInput> = {}): AmmoInput {
  return {
    initialAmmo: 20,
    remainingAmmo: null,
    remainingKnown: false,
    mustUseAllAmmo: false,
    detectedHits: 0,
    validHits: 0,
    invalidHits: 0,
    ...overrides,
  };
}

/** ADR-0006 y dosier 17.2-17.3. */
describe('Precisión y munición (ADR-0006)', () => {
  describe('caso 1 · munición consumida completamente', () => {
    it('disparos = munición inicial y la precisión se calcula', () => {
      const result = computeAccuracy(
        ammo({ mustUseAllAmmo: true, initialAmmo: 20, detectedHits: 15, validHits: 12, invalidHits: 3 }),
      );
      expect(result.shotsFired).toBe(20);
      expect(result.accuracyTotal).toBe(75);
      expect(result.accuracyValid).toBe(60);
      expect(result.accuracyStatus).toBe('computed');
    });
  });

  describe('caso 2 · munición restante introducida', () => {
    it('disparos = inicial - restante', () => {
      const result = computeAccuracy(
        ammo({
          initialAmmo: 20,
          remainingAmmo: 5,
          remainingKnown: true,
          detectedHits: 12,
          validHits: 10,
          invalidHits: 2,
        }),
      );
      expect(result.shotsFired).toBe(15);
      expect(result.accuracyTotal).toBe(80);
      expect(result.accuracyValid).toBeCloseTo(66.67, 2);
      expect(result.accuracyStatus).toBe('computed');
      expect(result.reason).toBeNull();
    });
  });

  describe('caso 3 · munición restante DESCONOCIDA', () => {
    const result = computeAccuracy(
      ammo({ initialAmmo: 20, remainingKnown: false, detectedHits: 12, validHits: 10, invalidHits: 2 }),
    );

    it('los disparos realizados son null: no se inventan', () => {
      expect(result.shotsFired).toBeNull();
    });

    it('las dos precisiones son null', () => {
      expect(result.accuracyTotal).toBeNull();
      expect(result.accuracyValid).toBeNull();
    });

    it('el estado es not_computable con motivo legible', () => {
      expect(result.accuracyStatus).toBe('not_computable');
      expect(result.reason).toContain(NOT_COMPUTABLE_MESSAGE);
    });

    it('PROHIBIDO sustituir los disparos por la munición inicial', () => {
      expect(result.shotsFired).not.toBe(20);
      expect(result.remainingAmmo).toBeNull();
    });

    it('PROHIBIDO derivar fallos de la diferencia munición - impactos', () => {
      // El resultado no expone ningún campo de "fallos" derivado.
      expect(Object.keys(result)).not.toContain('missedShots');
      expect(Object.keys(result)).not.toContain('failedShots');
      expect(result.invalidHits).toBe(2); // sólo impactos realmente detectados
    });
  });

  describe('casos límite', () => {
    it('sin munición inicial registrada, no es calculable', () => {
      const result = computeAccuracy(ammo({ initialAmmo: null, remainingKnown: true, remainingAmmo: 3 }));
      expect(result.accuracyStatus).toBe('not_computable');
      expect(result.shotsFired).toBeNull();
    });

    it('restante mayor que inicial, no es calculable y lo dice', () => {
      const result = computeAccuracy(
        ammo({ initialAmmo: 10, remainingAmmo: 12, remainingKnown: true }),
      );
      expect(result.accuracyStatus).toBe('not_computable');
      expect(result.reason).toMatch(/supera la inicial/);
    });

    it('cero disparos realizados, no es calculable (no se divide por cero)', () => {
      const result = computeAccuracy(
        ammo({ initialAmmo: 10, remainingAmmo: 10, remainingKnown: true }),
      );
      expect(result.accuracyStatus).toBe('not_computable');
      expect(result.accuracyTotal).toBeNull();
      expect(result.reason).toMatch(/no se registraron disparos/);
    });

    it('precisión del 100 % cuando todos los disparos impactan válidos', () => {
      const result = computeAccuracy(
        ammo({
          initialAmmo: 9,
          remainingAmmo: 0,
          remainingKnown: true,
          detectedHits: 9,
          validHits: 9,
          invalidHits: 0,
        }),
      );
      expect(result.accuracyTotal).toBe(100);
      expect(result.accuracyValid).toBe(100);
    });

    it('avisa si hay más impactos detectados que disparos, pero calcula', () => {
      const result = computeAccuracy(
        ammo({
          initialAmmo: 10,
          remainingAmmo: 8,
          remainingKnown: true,
          detectedHits: 5,
          validHits: 5,
          invalidHits: 0,
        }),
      );
      expect(result.accuracyStatus).toBe('computed');
      expect(result.warnings.join(' ')).toMatch(/mayores que los disparos/);
    });

    it('avisa si válidos + incorrectos no cuadran con detectados', () => {
      const result = computeAccuracy(
        ammo({
          initialAmmo: 10,
          remainingAmmo: 0,
          remainingKnown: true,
          detectedHits: 5,
          validHits: 2,
          invalidHits: 1,
        }),
      );
      expect(result.warnings.join(' ')).toMatch(/Recuento incoherente/);
    });

    it('recuentos negativos son un error de programación', () => {
      expect(() => computeAccuracy(ammo({ detectedHits: -1 }))).toThrow();
    });
  });

  describe('resolveShotsFired', () => {
    it.each([
      [{ initialAmmo: 20, remainingAmmo: 5, remainingKnown: true, mustUseAllAmmo: false }, 15],
      [{ initialAmmo: 20, remainingAmmo: null, remainingKnown: false, mustUseAllAmmo: true }, 20],
      [{ initialAmmo: 20, remainingAmmo: null, remainingKnown: false, mustUseAllAmmo: false }, null],
      [{ initialAmmo: null, remainingAmmo: 5, remainingKnown: true, mustUseAllAmmo: false }, null],
    ])('%j → %s', (partial, expected) => {
      expect(resolveShotsFired(ammo(partial as Partial<AmmoInput>))).toBe(expected);
    });
  });
});
