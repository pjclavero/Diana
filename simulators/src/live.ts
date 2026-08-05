/**
 * Modo «módulo vivo»: un único módulo simulado conectado a un Mosquitto REAL,
 * pensado para ejercer el sistema de extremo a extremo sin hardware.
 *
 * A diferencia de los escenarios (que son deterministas, de duración finita y
 * pensados para pruebas reproducibles), este modo:
 *   - se queda corriendo indefinidamente,
 *   - usa el reloj real,
 *   - publica telemetría y estado de forma periódica (un módulo real habla
 *     cada segundo: de eso depende el barrido de obsolescencia del backend,
 *     `STALE_AFTER_MS`),
 *   - opcionalmente genera impactos cada cierto tiempo,
 *   - y responde a los comandos de diagnóstico (`self_test`,
 *     `start_calibration`, `led_test`, `identify`, `set_targets`…) por la vía
 *     normal de `ModuleSimulator`.
 *
 * Todo se configura por variables de entorno (ver `LiveModuleConfig`), para
 * poder lanzarlo como un contenedor o un servicio sin tocar código.
 *
 * El `client_id` MQTT es SIEMPRE igual al `module_id`: la ACL de Mosquitto
 * (`infrastructure/mosquitto/acl`) se apoya en esa igualdad con el patrón %c.
 */
import { RealTimeClock } from './clock.js';
import type { ModuleSimulator } from './domain/moduleSimulator.js';
import type { ModulePosition, ModuleRotation, SelectorPosition } from './domain/types.js';
import { Simulation } from './simulation.js';

export interface LiveModuleConfig {
  /** URL del broker, p. ej. mqtt://127.0.0.1:1883 */
  url: string;
  username?: string;
  password?: string;
  moduleId: string;
  systemId: string;
  seed: number;
  selector: SelectorPosition;
  position: ModulePosition | null;
  rotation: ModuleRotation;
  firmwareVersion?: string;
  /** Periodo de telemetría en ms. 0 = desactivada. */
  telemetryMs: number;
  /** Periodo de `status` en ms. 0 = sólo al arrancar y tras cada evento. */
  statusMs: number;
  /** Periodo de impactos automáticos en ms. 0 = ninguno (sólo bajo demanda). */
  hitEveryMs: number;
  /** Índices de diana (1..9) sobre los que se generan impactos automáticos. */
  hitTargets: number[];
  /** Si es true, los impactos automáticos no generan vibración cruzada. */
  suppressCrosstalk: boolean;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${name} no es un número: "${raw}"`);
  return n;
}

function envIntList(name: string, fallback: number[]): number[] {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const list = raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n));
  if (list.length === 0) throw new Error(`${name} no contiene índices válidos: "${raw}"`);
  for (const n of list) {
    if (n < 1 || n > 9) throw new Error(`${name}: índice de diana fuera de 1..9: ${n}`);
  }
  return list;
}

/**
 * Lee la configuración del entorno. `overrides` (banderas del CLI) tiene
 * prioridad sobre las variables de entorno, y éstas sobre los valores por
 * defecto.
 */
export function liveConfigFromEnv(overrides: Partial<LiveModuleConfig> = {}): LiveModuleConfig {
  const posRaw = process.env.DIANA_MODULE_POSITION; // "x,y"
  let position: ModulePosition | null = null;
  if (posRaw) {
    const [x, y] = posRaw.split(',').map((s) => Number(s.trim()));
    const valid = [-1, 0, 1];
    if (!valid.includes(x as number) || !valid.includes(y as number)) {
      throw new Error(`DIANA_MODULE_POSITION debe ser "x,y" con x,y ∈ {-1,0,1}: "${posRaw}"`);
    }
    position = { x: x as ModulePosition['x'], y: y as ModulePosition['y'] };
  }

  const selector = (process.env.DIANA_MODULE_SELECTOR ?? 'SATELITE') as SelectorPosition;

  const cfg: LiveModuleConfig = {
    url: process.env.DIANA_MQTT_URL ?? 'mqtt://127.0.0.1:1883',
    username: process.env.DIANA_MQTT_USERNAME || undefined,
    password: process.env.DIANA_MQTT_PASSWORD || undefined,
    moduleId: process.env.DIANA_MODULE_ID ?? 'module-01',
    systemId: process.env.DIANA_SYSTEM_ID ?? 'system-a',
    seed: envInt('DIANA_SEED', 1),
    selector,
    position,
    rotation: (envInt('DIANA_MODULE_ROTATION', 0) as ModuleRotation) ?? 0,
    firmwareVersion: process.env.DIANA_FIRMWARE_VERSION || undefined,
    telemetryMs: envInt('DIANA_TELEMETRY_MS', 1000),
    statusMs: envInt('DIANA_STATUS_MS', 0),
    hitEveryMs: envInt('DIANA_HIT_EVERY_MS', 0),
    hitTargets: envIntList('DIANA_HIT_TARGETS', [1, 2, 3, 4, 5, 6, 7, 8, 9]),
    suppressCrosstalk: (process.env.DIANA_SUPPRESS_CROSSTALK ?? 'false') === 'true',
    ...overrides,
  };
  return cfg;
}

export interface LiveModuleHandle {
  module: ModuleSimulator;
  simulation: Simulation;
  /** Genera un impacto sobre una diana concreta, bajo demanda. */
  hit(targetIndex: number): Promise<string>;
  /** Presencia `offline` ordenada + desconexión limpia (sin disparar el LWT). */
  stop(): Promise<void>;
}

/**
 * Arranca el módulo y devuelve el mando. NO bloquea: los bucles periódicos
 * quedan corriendo con temporizadores `unref`ados, para que quien llame decida
 * cuánto vive el proceso.
 */
export async function startLiveModule(cfg: LiveModuleConfig): Promise<LiveModuleHandle> {
  const clock = new RealTimeClock(1);
  const simulation = new Simulation({
    systemId: cfg.systemId,
    seed: cfg.seed,
    clock,
    mqtt: { url: cfg.url, username: cfg.username, password: cfg.password },
  });

  const module = simulation.addModule({
    moduleId: cfg.moduleId,
    position: cfg.position ?? undefined,
    rotation: cfg.rotation,
    selector: cfg.selector,
    firmwareVersion: cfg.firmwareVersion,
  });

  await module.boot(); // presencia (con LWT registrado antes) + status

  const timers: NodeJS.Timeout[] = [];
  const periodic = (ms: number, fn: () => Promise<unknown>, label: string): void => {
    if (ms <= 0) return;
    const t = setInterval(() => {
      void fn().catch((error: unknown) => {
        // Un fallo periódico no puede tumbar el módulo: un módulo real
        // reintenta en el siguiente ciclo.
        console.error(`[diana-sim] ${label}: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, ms);
    t.unref();
    timers.push(t);
  };

  periodic(cfg.telemetryMs, () => module.publishTelemetry(), 'telemetría');
  periodic(cfg.statusMs, () => module.publishStatus(), 'status');

  let nextHit = 0;
  periodic(
    cfg.hitEveryMs,
    async () => {
      const target = cfg.hitTargets[nextHit % cfg.hitTargets.length] as number;
      nextHit += 1;
      await module.hitTarget(target, { suppressCrosstalk: cfg.suppressCrosstalk });
    },
    'impacto automático',
  );

  return {
    module,
    simulation,
    hit: (targetIndex: number) => module.hitTarget(targetIndex, { suppressCrosstalk: cfg.suppressCrosstalk }),
    async stop() {
      for (const t of timers) clearInterval(t);
      await module.shutdown();
    },
  };
}
