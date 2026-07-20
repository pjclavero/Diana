/**
 * Generador pseudoaleatorio determinista (mulberry32).
 *
 * Todo el simulador debe derivar su aleatoriedad de aquí, nunca de
 * Math.random() ni de crypto.randomUUID(): la reproducibilidad por semilla
 * (encargo WP-05, "DETERMINISMO") depende de que la misma semilla produzca
 * exactamente la misma secuencia de números, y por tanto la misma secuencia
 * de eventos.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    // Normaliza a entero de 32 bits sin signo.
    this.state = seed >>> 0;
    if (this.state === 0) {
      this.state = 0x9e3779b9;
    }
  }

  /** Siguiente flotante en [0, 1). */
  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Entero en [min, max] (ambos incluidos). */
  int(min: number, max: number): number {
    if (max < min) {
      throw new Error(`Rng.int: max (${max}) < min (${min})`);
    }
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Flotante en [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** true con probabilidad p (0..1). */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Elemento aleatorio no vacío. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error('Rng.pick: lista vacía');
    }
    return items[this.int(0, items.length - 1)] as T;
  }

  /** Baraja Fisher-Yates determinista, sin mutar el array de entrada. */
  shuffle<T>(items: readonly T[]): T[] {
    const copy = items.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const tmp = copy[i] as T;
      copy[i] = copy[j] as T;
      copy[j] = tmp;
    }
    return copy;
  }

  /** Deriva una sub-semilla estable a partir de una etiqueta (namespacing). */
  fork(label: string): Rng {
    let h = this.state ^ 0x811c9dc5;
    for (let i = 0; i < label.length; i++) {
      h = Math.imul(h ^ label.charCodeAt(i), 16777619);
    }
    return new Rng(h >>> 0);
  }
}
