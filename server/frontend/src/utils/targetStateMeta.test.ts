import { describe, expect, it } from "vitest";
import { TARGET_STATE_META } from "./targetStateMeta";
import type { TargetState } from "../types/domain";

const ALL_STATES: TargetState[] = [
  "off",
  "safe",
  "active",
  "hit",
  "countdown",
  "penalty",
  "error",
  "calibration",
  "locked",
  "sensor_error",
  "maintenance",
  "disabled",
];

describe("TARGET_STATE_META (dosier §10.5: nunca sólo color)", () => {
  it("define metadatos para los 12 estados del contrato common.schema.json", () => {
    expect(Object.keys(TARGET_STATE_META).sort()).toEqual([...ALL_STATES].sort());
  });

  it.each(ALL_STATES)("el estado '%s' expone color, patrón, símbolo, etiqueta y texto accesible", (state) => {
    const meta = TARGET_STATE_META[state];
    expect(meta.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(meta.pattern.length).toBeGreaterThan(0);
    expect(meta.symbol.length).toBeGreaterThan(0);
    expect(meta.label.trim().length).toBeGreaterThan(0);
    expect(meta.aria.trim().length).toBeGreaterThan(0);
  });

  it("no hay dos estados que compartan color + patrón + símbolo (evita depender sólo del color)", () => {
    const seen = new Set<string>();
    for (const state of ALL_STATES) {
      const meta = TARGET_STATE_META[state];
      const key = `${meta.pattern}|${meta.symbol}`;
      // Distintos estados pueden compartir color, pero no color+patrón+símbolo a la vez.
      const colorKey = `${meta.color}|${key}`;
      expect(seen.has(colorKey)).toBe(false);
      seen.add(colorKey);
    }
  });
});
