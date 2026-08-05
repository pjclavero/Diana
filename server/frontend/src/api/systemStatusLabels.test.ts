import { describe, expect, it } from "vitest";
import { conflictSentence, summarizeConflicts, systemStateLabel } from "./systemStatusLabels";
import type { ConflictKind, SystemState } from "../types/domain";

describe("systemStateLabel", () => {
  it("traduce cada estado real del servidor (idle|configuring|ready|game_running|degraded|maintenance)", () => {
    const states: SystemState[] = ["idle", "configuring", "ready", "game_running", "degraded", "maintenance"];
    const labels = states.map(systemStateLabel);
    // Ninguna traducción puede quedarse vacía ni repetir la clave cruda.
    expect(labels).toEqual(["Inactivo", "Configurando", "Listo", "Partida en curso", "Degradado", "Mantenimiento"]);
    expect(new Set(labels).size).toBe(states.length);
  });

  it("un estado desconocido se conserva tal cual, no se inventa", () => {
    expect(systemStateLabel("estado-inventado" as SystemState)).toBe("estado-inventado");
  });
});

describe("conflictSentence", () => {
  it("dual_principal explica el bloqueo del inicio de partida", () => {
    expect(conflictSentence("dual_principal")).toMatch(/PRINCIPAL/);
    expect(conflictSentence("dual_principal")).toMatch(/bloqueado/);
  });

  it("cada clave del contrato tiene una frase propia y no vacía", () => {
    const kinds: ConflictKind[] = ["dual_principal", "duplicate_position", "no_principal", "schema_mismatch", "firmware_mismatch"];
    for (const k of kinds) {
      expect(conflictSentence(k).length).toBeGreaterThan(0);
    }
  });
});

describe("summarizeConflicts — nunca «sin conflictos detectados» a secas", () => {
  it("sin conflictos: dice qué se comprueba de verdad y qué falta por comprobar", () => {
    const summary = summarizeConflicts([]);
    expect(summary.messages).toEqual([]);
    expect(summary.scopeNote).toContain("selector duplicado en PRINCIPAL");
    expect(summary.scopeNote).toContain("posición duplicada en la matriz");
    // Las tres claves declaradas pero no detectadas hoy deben quedar dichas,
    // no escondidas: es la diferencia entre "no hay" y "no se mira".
    expect(summary.scopeNote).toContain("ausencia de módulo en PRINCIPAL");
    expect(summary.scopeNote).toContain("contrato distinto entre módulos");
    expect(summary.scopeNote).toContain("firmware distinto entre módulos");
  });

  it("con un conflicto activo: un mensaje por conflicto, en el orden recibido", () => {
    const summary = summarizeConflicts(["duplicate_position", "dual_principal"]);
    expect(summary.messages).toHaveLength(2);
    expect(summary.messages[0]).toMatch(/misma casilla/);
    expect(summary.messages[1]).toMatch(/PRINCIPAL/);
    expect(summary.scopeNote).not.toMatch(/^Sin conflictos/);
  });

  it("los conflictos activos se listan tal cual llegan, sin deduplicar ni reordenar", () => {
    const summary = summarizeConflicts(["dual_principal", "dual_principal"]);
    expect(summary.messages).toHaveLength(2);
  });
});
