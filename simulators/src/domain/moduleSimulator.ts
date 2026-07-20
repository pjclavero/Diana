import type { Clock } from '../clock.js';
import { assertValid } from '../contracts/ajv.js';
import { seededUuid } from '../ids.js';
import type { Rng } from '../rng.js';
import type { IncomingMessage, Transport } from '../transport/types.js';
import { classifyHit } from './classify.js';
import { neighboursOf } from './topology.js';
import { topics } from './topics.js';
import type {
  DeviceTime,
  HitClassification,
  HitEventPayload,
  ModulePosition,
  ModulePresencePayload,
  ModuleRole,
  ModuleRotation,
  ModuleState,
  ModuleStatusPayload,
  SelectorPosition,
  TargetSlot,
  TargetState,
} from './types.js';

export interface ModuleIdentity {
  moduleId: string;
  systemId: string;
  hardwareRevision?: string;
  mac?: string;
  ip?: string;
  serial?: string;
}

export interface ModuleSimulatorOptions {
  identity: ModuleIdentity;
  transport: Transport;
  clock: Clock;
  rng: Rng;
  firmwareVersion?: string;
  selector?: SelectorPosition;
  position?: ModulePosition | null;
  rotation?: ModuleRotation;
  /** Cociente de amplitud por debajo del cual un vecino se descarta como crosstalk (dosier §9.6). */
  neighbourRatio?: number;
  threshold?: number;
  noiseFloor?: number;
  onGameContext?: () => { gameId?: string; roundId?: string } | undefined;
}

const COMMAND_CACHE_SIZE = 128;

/**
 * Simula un módulo ESP32-S3 (satélite o principal, según selector/rol
 * resuelto). Es el sustituto contractual del firmware: publica exactamente
 * lo que contracts/mqtt/*.schema.json exige y nada más.
 */
export class ModuleSimulator {
  readonly moduleId: string;
  readonly systemId: string;
  private readonly transport: Transport;
  private readonly clock: Clock;
  private readonly rng: Rng;
  private readonly firmwareVersion: string;
  private readonly identity: ModuleIdentity;
  private readonly onGameContext: ModuleSimulatorOptions['onGameContext'];

  private selector: SelectorPosition;
  private role: ModuleRole;
  private position: ModulePosition | null;
  private rotation: ModuleRotation;
  private state: ModuleState = 'boot';
  private bootId: string;
  private readonly bootStartedAtUs: number;

  /** Persiste entre reboot() (NVS simulada); se reinicia sólo al "reflashear" (nunca aquí). */
  private localSequence = 0;

  private targets: TargetSlot[];
  private readonly threshold: number;
  private readonly noiseFloor: number;
  private readonly neighbourRatio: number;

  private readonly hitQueue: HitEventPayload[] = [];
  private connected = false;
  private lastHitPayload: HitEventPayload | null = null;

  private readonly commandCache: string[] = [];
  private readonly commandCacheSet = new Set<string>();
  private readonly lastNonceByIssuer = new Map<string, number>();
  private lastCommandResult: ModuleStatusPayload['last_command'] = null;

  private expectedOrder: number[] | null = null; // secuencia estricta [module_local target_index...] sólo relevante en este módulo si aplica
  private strictOrder = false;

  private mqttReconnects = 0;

  constructor(opts: ModuleSimulatorOptions) {
    this.identity = opts.identity;
    this.moduleId = opts.identity.moduleId;
    this.systemId = opts.identity.systemId;
    this.transport = opts.transport;
    this.clock = opts.clock;
    this.rng = opts.rng;
    this.firmwareVersion = opts.firmwareVersion ?? '0.1.0';
    this.selector = opts.selector ?? 'SATELITE';
    this.role = this.resolveRole(this.selector);
    this.position = opts.position ?? null;
    this.rotation = opts.rotation ?? 0;
    this.threshold = opts.threshold ?? 900;
    this.noiseFloor = opts.noiseFloor ?? 140;
    this.neighbourRatio = opts.neighbourRatio ?? 0.35;
    this.onGameContext = opts.onGameContext;
    this.bootId = seededUuid(this.rng.fork(`boot-${this.moduleId}-0`));
    this.bootStartedAtUs = this.clock.nowUs();
    this.targets = Array.from({ length: 9 }, (_, i) => ({
      target_index: i + 1,
      state: 'off' as TargetState,
      enabled: true,
    }));
  }

  private resolveRole(selector: SelectorPosition): ModuleRole {
    if (selector === 'PRINCIPAL') return 'principal';
    if (selector === 'SATELITE') return 'satellite';
    return 'auto';
  }

  // ---------------------------------------------------------------- ciclo de vida

  async boot(): Promise<void> {
    this.state = 'boot';
    await this.transport.connect({
      topic: topics.modulePresence(this.moduleId),
      payload: this.presencePayload(false, 'lwt'),
      qos: 1,
      retain: true,
    });
    this.connected = true;

    await this.publishPresence('connect', true);

    this.state = 'selftest';
    this.state = 'network';
    this.state = 'registering';
    this.state = 'ready';
    for (const t of this.targets) t.state = 'safe';

    this.transport.subscribe(topics.moduleCommand(this.moduleId), (msg) => this.onCommand(msg));
    this.transport.subscribe(topics.moduleConfigDesired(this.moduleId), () => void 0);

    await this.publishStatus();
    await this.flushQueue();
  }

  async shutdown(): Promise<void> {
    await this.publishPresence('shutdown', false);
    await this.transport.disconnectGracefully();
    this.connected = false;
  }

  /** Corte de red/alimentación: NO es un shutdown ordenado. Dispara el LWT. */
  async killConnection(): Promise<void> {
    this.connected = false;
    await this.transport.kill();
  }

  async reconnect(): Promise<void> {
    await this.transport.connect({
      topic: topics.modulePresence(this.moduleId),
      payload: this.presencePayload(false, 'lwt'),
      qos: 1,
      retain: true,
    });
    this.connected = true;
    this.mqttReconnects += 1;
    await this.publishPresence('connect', true);
    this.transport.subscribe(topics.moduleCommand(this.moduleId), (msg) => this.onCommand(msg));
    await this.publishStatus();
    await this.flushQueue();
  }

  /** Reinicio del módulo: boot_id nuevo, local_sequence persistente (dosier §13.5 / ADR-0003). */
  async reboot(): Promise<void> {
    if (this.connected) {
      await this.transport.disconnectGracefully();
      this.connected = false;
    }
    this.bootId = seededUuid(this.rng.fork(`boot-${this.moduleId}-${this.localSequence}`));
    for (const t of this.targets) t.state = 'off';
    await this.boot();
  }

  // ---------------------------------------------------------------- selector/rol

  setSelector(selector: SelectorPosition): void {
    this.selector = selector;
    this.role = this.resolveRole(selector);
  }

  /** Sólo tiene efecto si el selector físico está en AUTO (dosier §6.3). */
  setResolvedAutoRole(role: 'principal' | 'satellite'): void {
    if (this.selector === 'AUTO') {
      this.role = role;
    }
  }

  getRole(): ModuleRole {
    return this.role;
  }

  getSelector(): SelectorPosition {
    return this.selector;
  }

  getState(): ModuleState {
    return this.state;
  }

  getTargetsSnapshot(): TargetSlot[] {
    return this.targets.map((t) => ({ ...t }));
  }

  getBootId(): string {
    return this.bootId;
  }

  getQueueDepth(): number {
    return this.hitQueue.length;
  }

  isConnected(): boolean {
    return this.connected;
  }

  setStrictOrder(expectedOrder: number[] | null): void {
    this.strictOrder = expectedOrder !== null;
    this.expectedOrder = expectedOrder;
  }

  setModuleState(state: ModuleState): void {
    this.state = state;
  }

  /** Aplica una activación de dianas ordenada por el coordinador (module-command set_targets). */
  async applyTargetStates(updates: { target_index: number; state: TargetState }[]): Promise<void> {
    for (const u of updates) {
      const slot = this.targets.find((t) => t.target_index === u.target_index);
      if (slot) slot.state = u.state;
    }
    await this.publishStatus();
  }

  // ---------------------------------------------------------------- impactos

  private uptimeUs(): number {
    return this.clock.nowUs() - this.bootStartedAtUs;
  }

  private nextEventId(): string {
    this.localSequence += 1;
    return seededUuid(this.rng.fork(`hit-${this.moduleId}-${this.bootId}-${this.localSequence}`));
  }

  private deviceTime(eventUs: number): DeviceTime {
    return {
      boot_id: this.bootId,
      uptime_us: this.uptimeUs(),
      event_us: eventUs,
      epoch_ms: null,
    };
  }

  /**
   * Simula el impacto físico de una bola sobre `targetIndex`, incluida la
   * vibración cruzada en los canales vecinos (dosier §9.6): el canal
   * golpeado registra amplitud alta; los vecinos registran una fracción y
   * el módulo los descarta como crosstalk si están por debajo de
   * neighbourRatio.
   *
   * Devuelve el event_id del impacto principal (útil para reenviar
   * duplicados con publishDuplicate()).
   */
  async hitTarget(
    targetIndex: number,
    opts?: { amplitudeOverride?: number; suppressCrosstalk?: boolean },
  ): Promise<string> {
    const slot = this.targets.find((t) => t.target_index === targetIndex);
    if (!slot) throw new Error(`target_index desconocido: ${targetIndex}`);

    const stateBefore = slot.state;
    const amplitude = opts?.amplitudeOverride ?? this.rng.int(this.threshold + 200, 4000);
    const eventUs = this.uptimeUs();

    const outOfExpectedOrder =
      this.strictOrder &&
      this.expectedOrder !== null &&
      this.expectedOrder[0] !== undefined &&
      this.expectedOrder[0] !== targetIndex;

    const { classification, reason } = classifyHit({
      moduleState: this.state,
      targetState: stateBefore,
      outOfExpectedOrder: Boolean(outOfExpectedOrder),
    });

    if (classification === 'valid_hit') {
      slot.state = 'hit';
      if (this.strictOrder && this.expectedOrder) {
        this.expectedOrder = this.expectedOrder.slice(1);
      }
    }

    const neighbours = neighboursOf(targetIndex);
    const mainEventId = this.nextEventId();
    const ctx = this.onGameContext?.();

    const mainPayload: HitEventPayload = {
      schema_version: 1,
      event_id: mainEventId,
      system_id: this.systemId,
      module_id: this.moduleId,
      ...(ctx?.gameId ? { game_id: ctx.gameId } : {}),
      ...(ctx?.roundId ? { round_id: ctx.roundId } : {}),
      target_index: targetIndex,
      ...(this.position ? { module_position: this.position } : {}),
      module_rotation: this.rotation,
      local_sequence: this.localSequence,
      device: this.deviceTime(eventUs),
      coordinator: null,
      amplitude,
      threshold: this.threshold,
      noise_floor: this.noiseFloor,
      neighbours: neighbours.map((n) => ({
        target_index: n,
        amplitude: Math.round(amplitude * this.rng.float(0.05, this.neighbourRatio * 0.9)),
        delta_us: this.rng.int(50, 900) * (this.rng.chance(0.5) ? 1 : -1),
      })),
      target_state_before: stateBefore,
      classification,
      ...(reason ? { classification_reason: reason } : {}),
      firmware_version: this.firmwareVersion,
      replay: false,
    };

    this.lastHitPayload = mainPayload;
    await this.emitHit(mainPayload);

    if (!opts?.suppressCrosstalk) {
      await this.emitCrosstalkFor(targetIndex, amplitude, eventUs, ctx);
    }

    await this.publishStatus();
    return mainEventId;
  }

  /** Genera los eventos de vibración cruzada en los canales vecinos, rechazados por el módulo. */
  private async emitCrosstalkFor(
    mainIndex: number,
    mainAmplitude: number,
    eventUs: number,
    ctx: { gameId?: string; roundId?: string } | undefined,
  ): Promise<void> {
    const neighbours = neighboursOf(mainIndex);
    // La mitad de los vecinos, escogidos deterministamente, reciben señal detectable.
    for (const n of neighbours) {
      if (!this.rng.chance(0.4)) continue;
      const slot = this.targets.find((t) => t.target_index === n);
      if (!slot) continue;
      const ratio = this.rng.float(0.05, this.neighbourRatio * 0.9);
      const amplitude = Math.max(0, Math.round(mainAmplitude * ratio));
      if (amplitude < this.noiseFloor) continue; // no llega ni a registrarse

      const eventId = this.nextEventId();
      const payload: HitEventPayload = {
        schema_version: 1,
        event_id: eventId,
        system_id: this.systemId,
        module_id: this.moduleId,
        ...(ctx?.gameId ? { game_id: ctx.gameId } : {}),
        ...(ctx?.roundId ? { round_id: ctx.roundId } : {}),
        target_index: n,
        ...(this.position ? { module_position: this.position } : {}),
        module_rotation: this.rotation,
        local_sequence: this.localSequence,
        device: this.deviceTime(eventUs + this.rng.int(50, 900)),
        coordinator: null,
        amplitude,
        threshold: this.threshold,
        noise_floor: this.noiseFloor,
        neighbours: [
          { target_index: mainIndex, amplitude: mainAmplitude, delta_us: this.rng.int(-900, -50) },
        ],
        target_state_before: slot.state,
        classification: 'crosstalk_rejected',
        classification_reason: `amplitud ${ratio.toFixed(2)}x del canal ${mainIndex} dentro de ventana de agrupación`,
        firmware_version: this.firmwareVersion,
        replay: false,
      };
      await this.emitHit(payload);
    }
  }

  /** Reenvía exactamente el mismo payload (mismo event_id) para probar idempotencia. */
  async publishDuplicate(eventId: string, original: HitEventPayload): Promise<void> {
    void eventId;
    await this.emitHit({ ...original });
  }

  /** Último hit-event "crudo" (coordinator=null) emitido por este módulo, para reenviar duplicados. */
  getLastHitPayload(): HitEventPayload | null {
    return this.lastHitPayload ? { ...this.lastHitPayload } : null;
  }

  private async emitHit(payload: HitEventPayload): Promise<void> {
    assertValid('hit-event.schema.json', payload);
    if (!this.connected) {
      this.hitQueue.push(payload);
      return;
    }
    try {
      await this.transport.publish(topics.moduleHit(this.moduleId), payload, {
        qos: 1,
        retain: false,
      });
    } catch {
      this.hitQueue.push(payload);
    }
  }

  private async flushQueue(): Promise<void> {
    while (this.hitQueue.length > 0 && this.connected) {
      const item = this.hitQueue.shift() as HitEventPayload;
      const replayed: HitEventPayload = { ...item, replay: true };
      assertValid('hit-event.schema.json', replayed);
      await this.transport.publish(topics.moduleHit(this.moduleId), replayed, {
        qos: 1,
        retain: false,
      });
    }
    await this.publishStatus();
  }

  // ---------------------------------------------------------------- baja tensión / diagnóstico

  async lowVoltage(voltage5vMv: number): Promise<void> {
    const eventId = seededUuid(this.rng.fork(`diag-lowv-${this.moduleId}-${this.localSequence}`));
    const payload = {
      schema_version: 1 as const,
      module_id: this.moduleId,
      event_id: eventId,
      kind: 'low_voltage' as const,
      severity: voltage5vMv < 4500 ? ('critical' as const) : ('warning' as const),
      message: `Tensión de 5V en ${voltage5vMv} mV`,
      device: this.deviceTime(this.uptimeUs()),
      detail: { voltage_5v_mv: voltage5vMv },
      firmware_version: this.firmwareVersion,
    };
    assertValid('module-diagnostic.schema.json', payload);
    await this.safePublish(topics.moduleDiagnostic(this.moduleId), payload, { qos: 1, retain: false });
  }

  async publishTelemetry(overrides?: { voltage5vMv?: number; temperatureC?: number }): Promise<void> {
    const payload = {
      schema_version: 1 as const,
      module_id: this.moduleId,
      uptime_s: Math.floor(this.uptimeUs() / 1_000_000),
      free_heap_bytes: 210000 - this.rng.int(0, 8000),
      min_free_heap_bytes: 195000,
      cpu_load_pct: this.rng.float(4, 25),
      temperature_c: overrides?.temperatureC ?? this.rng.float(28, 45),
      voltage_5v_mv: overrides?.voltage5vMv ?? this.rng.int(4900, 5050),
      voltage_12v_mv: this.rng.int(11900, 12100),
      link_up: this.connected,
      mqtt_reconnects: this.mqttReconnects,
      queue_depth: this.hitQueue.length,
      led_chains: [0, 1, 2].map((chain) => ({ chain, ok: true, current_ma: this.rng.int(350, 400) })),
      device: { boot_id: this.bootId, uptime_us: this.uptimeUs() },
    };
    assertValid('module-telemetry.schema.json', payload);
    await this.safePublish(topics.moduleTelemetry(this.moduleId), payload, { qos: 0, retain: false });
  }

  // ---------------------------------------------------------------- comandos

  private onCommand(msg: IncomingMessage): Promise<void> {
    return this.handleCommandPayload(msg.payload as Record<string, unknown>);
  }

  private async handleCommandPayload(payload: Record<string, unknown>): Promise<void> {
    const commandId = payload.command_id as string;
    const issuer = payload.issuer as string;
    const nonce = payload.nonce as number;
    const expiresInMs = payload.expires_in_ms as number;
    const issuedAtMs = payload.issued_at_ms as number;

    if (this.commandCacheSet.has(commandId)) {
      this.lastCommandResult = { command_id: commandId, result: 'duplicate' };
      await this.publishStatus();
      return;
    }

    const lastNonce = this.lastNonceByIssuer.get(issuer) ?? -1;
    if (nonce <= lastNonce) {
      this.lastCommandResult = { command_id: commandId, result: 'rejected', detail: 'nonce <= último' };
      await this.publishStatus();
      return;
    }

    const nowMs = Math.floor(this.clock.nowUs() / 1000);
    if (nowMs - issuedAtMs > expiresInMs) {
      this.lastCommandResult = { command_id: commandId, result: 'expired' };
      await this.publishStatus();
      return;
    }

    this.rememberCommand(commandId);
    this.lastNonceByIssuer.set(issuer, nonce);

    const action = payload.action as string;
    const params = (payload.params ?? {}) as Record<string, unknown>;

    try {
      switch (action) {
        case 'identify':
          break;
        case 'set_targets': {
          const arr = (params.targets ?? []) as { target_index: number; state: TargetState }[];
          for (const u of arr) {
            const slot = this.targets.find((t) => t.target_index === u.target_index);
            if (slot) slot.state = u.state;
          }
          break;
        }
        case 'set_all_targets': {
          const state = params.state as TargetState;
          for (const t of this.targets) t.state = state;
          break;
        }
        case 'reboot':
          this.lastCommandResult = { command_id: commandId, result: 'accepted' };
          await this.publishStatus();
          await this.reboot();
          return;
        case 'start_calibration':
          this.state = 'calibration';
          break;
        case 'abort_calibration':
          this.state = 'ready';
          break;
        case 'self_test':
          break;
        case 'led_test':
          break;
        case 'flush_queue':
          await this.flushQueue();
          break;
        case 'set_maintenance':
          this.state = params.enabled ? 'maintenance' : 'ready';
          break;
        case 'clear_error':
          if (this.state === 'error') this.state = 'ready';
          break;
        default:
          this.lastCommandResult = { command_id: commandId, result: 'rejected', detail: `acción desconocida: ${action}` };
          await this.publishStatus();
          return;
      }
      this.lastCommandResult = { command_id: commandId, result: 'accepted' };
    } catch (err) {
      this.lastCommandResult = {
        command_id: commandId,
        result: 'failed',
        detail: err instanceof Error ? err.message.slice(0, 120) : 'error',
      };
    }
    await this.publishStatus();
  }

  private rememberCommand(commandId: string): void {
    this.commandCache.push(commandId);
    this.commandCacheSet.add(commandId);
    if (this.commandCache.length > COMMAND_CACHE_SIZE) {
      const evicted = this.commandCache.shift();
      if (evicted) this.commandCacheSet.delete(evicted);
    }
  }

  // ---------------------------------------------------------------- publicaciones de estado

  private presencePayload(online: boolean, reason: 'connect' | 'shutdown' | 'lwt'): ModulePresencePayload {
    return {
      schema_version: 1,
      module_id: this.moduleId,
      online,
      reason,
      boot_id: this.bootId,
      firmware_version: this.firmwareVersion,
      hardware_revision: this.identity.hardwareRevision ?? null,
      mac: this.identity.mac ?? null,
      ip: this.identity.ip ?? null,
      serial: this.identity.serial ?? null,
    };
  }

  private async publishPresence(reason: 'connect' | 'shutdown', online: boolean): Promise<void> {
    const payload = this.presencePayload(online, reason);
    assertValid('module-presence.schema.json', payload);
    await this.transport.publish(topics.modulePresence(this.moduleId), payload, {
      qos: 1,
      retain: true,
    });
  }

  private async publishStatus(): Promise<void> {
    const payload: ModuleStatusPayload = {
      schema_version: 1,
      module_id: this.moduleId,
      system_id: this.systemId,
      state: this.state,
      selector: this.selector,
      role: this.role,
      position: this.position,
      rotation: this.rotation,
      targets: this.targets.map((t) => ({ ...t })),
      queue_depth: this.hitQueue.length,
      last_command: this.lastCommandResult,
      firmware_version: this.firmwareVersion,
      uptime_s: Math.floor(this.uptimeUs() / 1_000_000),
    };
    assertValid('module-status.schema.json', payload);
    await this.safePublish(topics.moduleStatus(this.moduleId), payload, { qos: 1, retain: true });
  }

  private async safePublish(
    topic: string,
    payload: unknown,
    options: { qos: 0 | 1 | 2; retain: boolean },
  ): Promise<void> {
    if (!this.connected) return;
    try {
      await this.transport.publish(topic, payload, options);
    } catch {
      // Telemetría y estado no crítico: se pierde sin más si la red cae
      // justo en ese instante (dosier §15.2, QoS 0/1 según criticidad).
    }
  }
}
