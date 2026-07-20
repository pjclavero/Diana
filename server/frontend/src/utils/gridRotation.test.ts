import { describe, expect, it } from "vitest";
import { rotatedTargetIndices } from "./gridRotation";

describe("rotatedTargetIndices", () => {
  it("devuelve la rejilla de lectura sin cambios a 0°", () => {
    expect(rotatedTargetIndices(0)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("rota 90° en sentido horario", () => {
    expect(rotatedTargetIndices(90)).toEqual([7, 4, 1, 8, 5, 2, 9, 6, 3]);
  });

  it("rota 180°", () => {
    expect(rotatedTargetIndices(180)).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1]);
  });

  it("rota 270°", () => {
    expect(rotatedTargetIndices(270)).toEqual([3, 6, 9, 2, 5, 8, 1, 4, 7]);
  });
});
