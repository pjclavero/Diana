import { describe, expect, it } from "vitest";
import { computeAccuracy, ACCURACY_NOT_COMPUTABLE_TEXT } from "./accuracy";

describe("computeAccuracy (ADR-0006)", () => {
  it("calcula la precisión cuando se exige consumir toda la munición", () => {
    const r = computeAccuracy({
      ammoInitial: 10,
      ammoRemaining: null,
      ammoMustBeFullyConsumed: true,
      hitsDetected: 9,
      hitsValid: 8,
    });
    expect(r.status).toBe("computable");
    expect(r.shots_fired).toBe(10);
    expect(r.total_accuracy_pct).toBeCloseTo(90);
    expect(r.valid_accuracy_pct).toBeCloseTo(80);
  });

  it("calcula la precisión a partir de munición inicial y restante conocidas", () => {
    const r = computeAccuracy({
      ammoInitial: 10,
      ammoRemaining: 4,
      ammoMustBeFullyConsumed: false,
      hitsDetected: 5,
      hitsValid: 5,
    });
    expect(r.status).toBe("computable");
    expect(r.shots_fired).toBe(6);
    expect(r.total_accuracy_pct).toBeCloseTo((5 / 6) * 100);
  });

  it("NO calcula la precisión cuando se desconoce la munición restante (caso normativo del ADR-0006)", () => {
    const r = computeAccuracy({
      ammoInitial: 10,
      ammoRemaining: null,
      ammoMustBeFullyConsumed: false,
      hitsDetected: 5,
      hitsValid: 5,
    });
    expect(r.status).toBe("not_computable");
    expect(r.shots_fired).toBeNull();
    expect(r.total_accuracy_pct).toBeNull();
    expect(r.valid_accuracy_pct).toBeNull();
    expect(r.reason).toMatch(/desconoce/i);
  });

  it("nunca sustituye los disparos desconocidos por la munición inicial", () => {
    const r = computeAccuracy({
      ammoInitial: 20,
      ammoRemaining: null,
      ammoMustBeFullyConsumed: false,
      hitsDetected: 3,
      hitsValid: 3,
    });
    // Si se hubiera usado la munición inicial como sustituto, shots_fired sería 20.
    expect(r.shots_fired).not.toBe(20);
    expect(r.status).toBe("not_computable");
  });

  it("expone el texto exacto exigido por el ADR-0006", () => {
    expect(ACCURACY_NOT_COMPUTABLE_TEXT).toBe("Precisión no calculable: se desconoce el número real de disparos.");
  });
});
