/**
 * Adyacencia física de las 9 dianas dentro de un módulo 3x3, en orden de
 * lectura (dosier §6.2):
 *
 *   1 2 3
 *   4 5 6
 *   7 8 9
 *
 * Se usa para generar vibración cruzada realista: un impacto en una diana
 * induce señal de menor amplitud en sus vecinas ortogonales/diagonales.
 */
const GRID: number[][] = [
  [1, 2, 3],
  [4, 5, 6],
  [7, 8, 9],
];

function coordsOf(index: number): [number, number] {
  for (let r = 0; r < 3; r++) {
    const row = GRID[r] as number[];
    const c = row.indexOf(index);
    if (c !== -1) return [r, c];
  }
  throw new Error(`target_index fuera de rango: ${index}`);
}

/** Vecinos (hasta 8, incluye diagonales) de una diana dentro de su módulo. */
export function neighboursOf(targetIndex: number): number[] {
  const [r, c] = coordsOf(targetIndex);
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const rr = r + dr;
      const cc = c + dc;
      if (rr >= 0 && rr < 3 && cc >= 0 && cc < 3) {
        out.push((GRID[rr] as number[])[cc] as number);
      }
    }
  }
  return out;
}
