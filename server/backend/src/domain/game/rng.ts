/**
 * Generador pseudoaleatorio determinista (mulberry32).
 *
 * La misma semilla produce SIEMPRE la misma secuencia, en cualquier máquina y
 * versión de Node: es la base de la reproducibilidad exigida al motor de
 * partidas. No usar `Math.random()` en el motor.
 */
export class DeterministicRng {
  private state: number;

  constructor(public readonly seed: number) {
    if (!Number.isInteger(seed) || seed < 0) {
      throw new Error(`La semilla debe ser un entero no negativo, recibido: ${seed}`);
    }
    this.state = (seed ^ 0x9e3779b9) >>> 0;
  }

  /** Flotante en [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Entero en [min, max] ambos incluidos. */
  nextInt(min: number, max: number): number {
    if (max < min) throw new Error(`Rango inválido [${min}, ${max}]`);
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('No se puede elegir de una lista vacía');
    return items[this.nextInt(0, items.length - 1)];
  }

  /** Fisher-Yates determinista. Devuelve una copia. */
  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = this.nextInt(0, i);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }
}
