import type { ModuleRotation } from "../types/domain";

/**
 * Aplica la rotación física del módulo (dosier §6.2) a la rejilla de lectura
 * 1..9 para presentar visualmente las 9 dianas en su orientación real.
 */
export function rotatedTargetIndices(rotation: ModuleRotation): number[] {
  let matrix = [
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9],
  ];
  const steps = (rotation / 90) % 4;
  for (let s = 0; s < steps; s += 1) {
    const next = matrix.map((_, r) => matrix.map((row) => row[r]).reverse());
    matrix = next;
  }
  return matrix.flat();
}
