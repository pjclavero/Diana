/**
 * Reloj de la simulación. Dos implementaciones:
 *
 *  - VirtualClock: avanza al instante (sin esperas reales de proceso), para
 *    que los tests y la generación de escenarios deterministas sean
 *    rápidos. sleep(ms) resuelve en el siguiente microtask pero el reloj
 *    virtual sí avanza esos ms, así que los `event_us` siguen siendo
 *    coherentes y reproducibles.
 *  - RealTimeClock: usa temporizadores reales, con un multiplicador de
 *    velocidad (--speed), para partidas jugables de verdad contra un
 *    broker real.
 */
export interface Clock {
  /** Microsegundos monotónicos desde el arranque de la simulación. */
  nowUs(): number;
  sleep(ms: number): Promise<void>;
}

export class VirtualClock implements Clock {
  private elapsedUs = 0;

  nowUs(): number {
    return this.elapsedUs;
  }

  async sleep(ms: number): Promise<void> {
    this.elapsedUs += Math.max(0, ms) * 1000;
    // Cede el control del event loop sin esperar tiempo real, para que
    // callbacks encolados (p.ej. handlers MQTT) se procesen en orden.
    await Promise.resolve();
  }
}

export class RealTimeClock implements Clock {
  private readonly startNs: bigint;
  private readonly speed: number;

  constructor(speed = 1) {
    if (speed <= 0) throw new Error('speed debe ser > 0');
    this.speed = speed;
    this.startNs = process.hrtime.bigint();
  }

  nowUs(): number {
    const elapsedNs = process.hrtime.bigint() - this.startNs;
    return Number(elapsedNs / 1000n) * this.speed;
  }

  async sleep(ms: number): Promise<void> {
    const realMs = Math.max(0, ms) / this.speed;
    await new Promise((resolve) => setTimeout(resolve, realMs));
  }
}
