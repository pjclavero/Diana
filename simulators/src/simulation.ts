import { Autoplayer, type AutoplayerOptions } from './autoplayer/autoplayer.js';
import type { Clock } from './clock.js';
import { Coordinator, type StartGameOptions } from './domain/coordinator.js';
import { ModuleSimulator } from './domain/moduleSimulator.js';
import type { ModulePosition, ModuleRotation, SelectorPosition } from './domain/types.js';
import { Rng } from './rng.js';
import { MemoryBroker } from './transport/memoryBroker.js';
import { MemoryTransport } from './transport/memoryTransport.js';
import { MqttJsTransport, type MqttJsTransportOptions } from './transport/mqttjsTransport.js';
import type { Transport } from './transport/types.js';

export interface ModuleTopologyEntry {
  moduleId: string;
  position?: ModulePosition;
  rotation?: ModuleRotation;
  selector?: SelectorPosition;
  firmwareVersion?: string;
}

export interface SimulationOptions {
  systemId: string;
  seed: number;
  clock: Clock;
  /** Si se omite, se crea un MemoryBroker interno (sin broker MQTT real). */
  broker?: MemoryBroker;
  /** Si se define, cada módulo se conecta a este broker MQTT real vía mqtt.js en vez de en memoria. */
  mqtt?: Omit<MqttJsTransportOptions, 'url'> & { url: string };
}

function defaultModuleId(index: number): string {
  return `module-${String(index).padStart(2, '0')}`;
}

/** Genera las 9 coordenadas de módulo del dosier §6.1, en orden de lectura. */
export function defaultTopology(count: number): { position: ModulePosition; rotation: ModuleRotation }[] {
  const coords: ModulePosition[] = [
    { x: -1, y: -1 },
    { x: 0, y: -1 },
    { x: 1, y: -1 },
    { x: -1, y: 0 },
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: -1, y: 1 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
  ];
  return coords.slice(0, count).map((position) => ({ position, rotation: 0 as ModuleRotation }));
}

/**
 * Orquesta un conjunto de ModuleSimulator + un Coordinator + un Autoplayer
 * opcional, todos comunicándose por MQTT (broker en memoria o real). Es el
 * punto de entrada que usan el CLI y el runner de escenarios.
 */
export class Simulation {
  readonly systemId: string;
  private readonly rootRng: Rng;
  private readonly clock: Clock;
  private readonly broker: MemoryBroker | null;
  private readonly mqttOpts: SimulationOptions['mqtt'] | null;

  readonly modules = new Map<string, ModuleSimulator>();
  private readonly transports = new Map<string, Transport>();
  /** Coordinador "activo" para la API de conveniencia (armAndStart, startAutoplayer, …). */
  coordinator: Coordinator | null = null;
  /**
   * TODOS los coordinadores vivos, indexados por moduleId. Normalmente
   * tiene 0 ó 1 entradas. Puede tener 2+ deliberadamente para reproducir el
   * conflicto de doble PRINCIPAL (dosier §6.3: "el sistema no permitirá
   * iniciar una partida si detecta dos módulos forzados como principal") de
   * forma determinista: cada módulo con el selector en PRINCIPAL actúa
   * como autoridad de partida por su cuenta, sin saber del otro — que es
   * exactamente la situación que el backend (WP-02) debe detectar y
   * bloquear.
   */
  readonly coordinators = new Map<string, Coordinator>();
  autoplayer: Autoplayer | null = null;
  private operatorTransport: Transport | null = null;

  private activeGameContext: { gameId?: string; roundId?: string } | undefined;

  constructor(opts: SimulationOptions) {
    this.systemId = opts.systemId;
    this.rootRng = new Rng(opts.seed);
    this.clock = opts.clock;
    this.broker = opts.mqtt ? null : (opts.broker ?? new MemoryBroker());
    this.mqttOpts = opts.mqtt ?? null;
  }

  getBroker(): MemoryBroker | null {
    return this.broker;
  }

  getClock(): Clock {
    return this.clock;
  }

  private makeTransport(clientId: string): Transport {
    if (this.mqttOpts) {
      return new MqttJsTransport(clientId, { ...this.mqttOpts, url: this.mqttOpts.url });
    }
    if (!this.broker) throw new Error('Simulation: ni broker en memoria ni mqtt configurados');
    return new MemoryTransport(clientId, this.broker);
  }

  addModule(entry: ModuleTopologyEntry): ModuleSimulator {
    const transport = this.makeTransport(entry.moduleId);
    this.transports.set(entry.moduleId, transport);
    const module = new ModuleSimulator({
      identity: {
        moduleId: entry.moduleId,
        systemId: this.systemId,
        serial: `DIANA-${entry.moduleId.toUpperCase()}`,
      },
      transport,
      clock: this.clock,
      rng: this.rootRng.fork(`module-${entry.moduleId}`),
      firmwareVersion: entry.firmwareVersion,
      selector: entry.selector ?? 'SATELITE',
      position: entry.position ?? null,
      rotation: entry.rotation ?? 0,
      onGameContext: () => this.activeGameContext,
    });
    this.modules.set(entry.moduleId, module);
    return module;
  }

  /** Añade `count` módulos con la topología 3x3 por defecto del dosier §6.1. */
  addDefaultModules(count: number, opts?: { firmwareVersion?: string }): ModuleSimulator[] {
    const topo = defaultTopology(count);
    const created: ModuleSimulator[] = [];
    for (let i = 0; i < count; i++) {
      const moduleId = defaultModuleId(i + 1);
      const t = topo[i] as { position: ModulePosition; rotation: ModuleRotation };
      created.push(
        this.addModule({
          moduleId,
          position: t.position,
          rotation: t.rotation,
          firmwareVersion: opts?.firmwareVersion,
        }),
      );
    }
    return created;
  }

  async bootAll(): Promise<void> {
    for (const m of this.modules.values()) {
      await m.boot();
    }
  }

  /** Designa el módulo principal, crea el Coordinator y registra todos los módulos conocidos en él. */
  setPrincipal(moduleId: string): Coordinator {
    const module = this.modules.get(moduleId);
    if (!module) throw new Error(`módulo desconocido: ${moduleId}`);
    module.setSelector('PRINCIPAL');
    const transport = this.transports.get(moduleId);
    if (!transport) throw new Error(`sin transporte para ${moduleId}`);

    const coordinator = new Coordinator({
      systemId: this.systemId,
      coordinatorModuleId: moduleId,
      transport,
      clock: this.clock,
      rng: this.rootRng.fork('coordinator'),
    });
    for (const m of this.modules.values()) coordinator.registerModule(m);
    this.coordinators.set(moduleId, coordinator);
    this.coordinator = coordinator; // "el más reciente", conveniencia para el caso de un solo principal
    return coordinator;
  }

  /**
   * Publica un system-command tal como lo emitiría el backend/operator-cli
   * (no un módulo): usa un cliente MQTT propio "operator-cli", nunca el de
   * un módulo (coherente con H-06/H-01 — este actor no es un módulo y no
   * escribe en ningún tópico de módulo). Si hay varios coordinadores
   * activos (conflicto de doble PRINCIPAL), TODOS lo reciben, porque todos
   * están suscritos a system/{sys}/command: exactamente el escenario que
   * el backend real debe impedir antes de llegar aquí.
   */
  async broadcastSystemCommand(payload: Record<string, unknown>): Promise<void> {
    if (!this.operatorTransport) {
      this.operatorTransport = this.makeTransport('operator-cli');
      await this.operatorTransport.connect();
    }
    await this.operatorTransport.publish(`targets/v1/system/${this.systemId}/command`, payload, {
      qos: 1,
      retain: false,
    });
  }

  startAutoplayer(opts?: Partial<Omit<AutoplayerOptions, 'systemId' | 'transport' | 'modules' | 'clock' | 'rng'>>): Autoplayer {
    if (!this.coordinator) throw new Error('startAutoplayer: define un principal primero (setPrincipal)');
    const anyTransport = this.transports.values().next().value as Transport;
    const autoplayer = new Autoplayer({
      systemId: this.systemId,
      transport: anyTransport,
      modules: this.modules,
      clock: this.clock,
      rng: this.rootRng.fork('autoplayer'),
      reactionMs: opts?.reactionMs,
      errorRate: opts?.errorRate,
    });
    autoplayer.start();
    this.autoplayer = autoplayer;
    return autoplayer;
  }

  async armAndStart(opts: StartGameOptions): Promise<void> {
    if (!this.coordinator) throw new Error('armAndStart: sin coordinador');
    this.activeGameContext = { gameId: opts.gameId, roundId: opts.roundId };
    await this.coordinator.armGame(opts);
    await this.settle();
    await this.coordinator.startArmedGame();
  }

  /** Deja que las promesas encoladas (handlers MQTT internos) se asienten sin usar temporizadores reales. */
  async settle(ticks = 8): Promise<void> {
    for (let i = 0; i < ticks; i++) {
      await this.clock.sleep(0);
    }
  }
}
