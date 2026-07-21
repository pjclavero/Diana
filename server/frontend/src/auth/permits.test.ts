import { describe, expect, it } from "vitest";
import { permits } from "./permits";

describe("permits (visibilidad por permisos en cliente)", () => {
  it("el comodín total concede cualquier permiso", () => {
    expect(permits(["*"], "users:write")).toBe(true);
    expect(permits(["*"], "firmware:deploy")).toBe(true);
  });

  it("concede el permiso exacto", () => {
    expect(permits(["games:write", "topology:write"], "topology:write")).toBe(true);
  });

  it("admite el comodín por recurso", () => {
    expect(permits(["games:*"], "games:control")).toBe(true);
    expect(permits(["games:*"], "users:write")).toBe(false);
  });

  it("niega lo no concedido", () => {
    expect(permits(["profile:read"], "games:write")).toBe(false);
    expect(permits([], "modules:read")).toBe(false);
  });
});
