import { describe, expect, it } from "vitest";
import { applyMove } from "./topologyMove";
import type { TopologySlot } from "../../api";

function slot(x: number, y: number, module_id: string | null, locked = false): TopologySlot {
  return { position: { x, y }, module_id, rotation: 0, locked, out_of_service: false } as TopologySlot;
}

describe("applyMove (editor de matriz)", () => {
  it("mueve un módulo a una celda vacía y deja libre la de origen", () => {
    const slots = [slot(-1, -1, "A"), slot(0, 0, null)];
    const out = applyMove(slots, "A", { x: 0, y: 0 });
    expect(out.find((s) => s.position.x === 0 && s.position.y === 0)!.module_id).toBe("A");
    expect(out.find((s) => s.position.x === -1 && s.position.y === -1)!.module_id).toBeNull();
  });

  it("INTERCAMBIA cuando el destino está ocupado (no machaca al ocupante) — caso celda central", () => {
    const slots = [slot(-1, -1, "A"), slot(0, 0, "CENTRO")];
    const out = applyMove(slots, "A", { x: 0, y: 0 });
    // A pasa al centro; el ocupante CENTRO va a la casilla de origen de A.
    expect(out.find((s) => s.position.x === 0 && s.position.y === 0)!.module_id).toBe("A");
    expect(out.find((s) => s.position.x === -1 && s.position.y === -1)!.module_id).toBe("CENTRO");
  });

  it("no hace nada si el destino está bloqueado", () => {
    const slots = [slot(-1, -1, "A"), slot(0, 0, "B", true)];
    expect(applyMove(slots, "A", { x: 0, y: 0 })).toBe(slots);
  });

  it("no hace nada al soltar un módulo sobre su propia casilla", () => {
    const slots = [slot(0, 0, "A")];
    expect(applyMove(slots, "A", { x: 0, y: 0 })).toBe(slots);
  });

  it("un módulo de fuera de la matriz sobre celda vacía se coloca", () => {
    const slots = [slot(0, 0, null)];
    const out = applyMove(slots, "NUEVO", { x: 0, y: 0 });
    expect(out.find((s) => s.position.x === 0 && s.position.y === 0)!.module_id).toBe("NUEVO");
  });

  it("un módulo de fuera de la matriz NO machaca al ocupante de una celda ocupada", () => {
    const slots = [slot(0, 0, "OCUPANTE")];
    // Sin casilla de origen a la que enviar al ocupante → se rechaza la suelta.
    expect(applyMove(slots, "NUEVO", { x: 0, y: 0 })).toBe(slots);
  });
});
