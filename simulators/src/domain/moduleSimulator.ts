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
 * Categoría por consecuencia (contrato §6-bis / module-maintenance-command.schema.json).
 *
 * FUENTE ÚNICA de la categoría: un `command_type` aparece en EXACTAMENTE una
 * entrada de este mapa. Se eligió deliberadamente un único `Record` en vez de
 * varios `Set` independientes (uno por categoría) porque con Sets separados
 * un `command_type` puede acabar EN DOS categorías a la vez sin que nada lo
 * detecte — p.ej. añadir `abort_calibration` a un "MAINTENANCE_ACT_COMMANDS"
 * mientras sigue listado también como "seguridad" en otro Set no rompe nada
 * visiblemente si el código consulta primero el Set de seguridad. Con un
 * único mapa, "reclasificar por parecido" (el error que este comentario y
 * las pruebas de test/module-maintenance-command.test.ts existen para
 * impedir) es la única forma de cambiar la categoría, y cambia de verdad el
 * comportamiento — por lo que una prueba de comportamiento (no de tipos) lo
 * detecta siempre.
 *
 * - 'read' — no actúan sobre el hardware: se acepta sin reloj (§6-bis) y se
 *   acepta con partida activa.
 * - 'act' — arrancan un proceso o mueven un actuador: se rechaza por
 *   'expired' sin reloj o con TTL vencido, y por 'game_in_progress' si hay
 *   partida activa.
 * - 'safety' — para lo que otra orden 'act' arrancó (hoy, la única:
 *   `abort_calibration`). Se acepta SIEMPRE: ni la regla de reloj/caducidad
 *   ni game_in_progress se le aplican. NO es 'act' pese al parecido con
 *   `start_calibration` — es justo el error a evitar: un "para" tardío
 *   sigue queriendo decir "para", y el coste de aceptarlo de más es cero
 *   frente al de dejar un actuador en marcha sin freno.
 *
 *   PENDIENTE DE CONFIRMACIÓN DEL OPERADOR HUMANO (revisión de este carril):
 *   la exención frente a game_in_progress es gratis HOY porque la categoría
 *   'safety' tiene una única orden y esa orden no tiene efecto motor real
 *   propio — sólo apaga lo que otra orden encendió. El día que se añada a
 *   esta categoría una segunda orden de seguridad que SÍ mueva algo por sí
 *   misma (no sólo pare), esta exención deja de ser gratuita sin más
 *   revisión y hay que volver a evaluarla con partida activa delante. No
 *   añadir un command_type a 'safety' sin repasar este párrafo primero.
 */
type MaintenanceCommandCategory = 'read' | 'act' | 'safety';

const MAINTENANCE_COMMAND_CATEGORY: Readonly<Record<string, MaintenanceCommandCategory>> = {
  request_telemetry: 'read',
  identify: 'read',
  query_version: 'read',
  query_status: 'read',
  led_test: 'act',
  piezo_test: 'act',
  self_test: 'act',
  start_calibration: 'act',
  abort_calibration: 'safety',
};

const MAINTENANCE_KNOWN_COMMANDS = new Set(Object.keys(MAINTENANCE_COMMAND_CATEGORY));

/**
 * Límites de `params.duration_ms` MÁS ESTRICTOS que el rango genérico del
 * esquema congelado (0..60000): el esquema fija el techo compartido de todo
 * el canal, pero cada actuador tiene su propio límite físico razonable
 * (cadena de LED, driver del piezo). Un valor dentro del rango del esquema
 * pero fuera de este límite se rechaza con `params_out_of_range`: es una
 * validación de firmware, no del contrato de transporte.
 */
const MAINTENANCE_DURATION_LIMITS_MS: Partial<Record<string, [number, number]>> = {
  led_test: [1, 5000],
  piezo_test: [1, 3000],
  identify: [1, 30000],
};

/**
 * Frontera de caducidad de `maintenance/command` (categorías 'read' y
 * 'act' con reloj sincronizado), DECIDIDA y fijada aquí porque el contrato
 * no la especifica por escrito en ningún sitio: sólo fija que la ventana es
 * `expires_in_ms`, no si el instante exacto en que se agota cuenta como
 * dentro o fuera.
 *
 * Decisión: **inclusiva del lado de aceptar**. Un mensaje cuyo tiempo
 * transcurrido (`nowMs - issuedAtMs`) es EXACTAMENTE igual a `expires_in_ms`
 * se acepta, no se rechaza — llegar en el último milisegundo de su ventana
 * sigue siendo llegar dentro de ella. Sólo se rechaza cuando el transcurrido
 * la SUPERA.
 *
 * Motivo del blindaje explícito: este proyecto ya perdió esta guerra una vez
 * (revisión anterior, canal `module/command`) — una prueba que derivaba el
 * instante límite de la propia constante en vez de fijar un valor literal se
 * movía junto con el mutante que cambiaba el plazo a 40 minutos, y ese
 * mutante sobrevivía sin que nadie lo notara. Aquí la regla vive en una
 * función con nombre, probada con el caso exacto (elapsed === expiresInMs
 * acepta; elapsed === expiresInMs + 1 rechaza), ambos con valores literales,
 * no derivados de esta constante ni de ninguna otra.
 */
export function isMaintenanceCommandExpired(nowMs: number, issuedAtMs: number, expiresInMs: number): boolean {
  return nowMs - issuedAtMs > expiresInMs;
}

type MaintenanceRejectReason =
  | 'expired'
  | 'module_mismatch'
  | 'unknown_command'
  | 'game_in_progress'
  | 'duplicate'
  | 'params_out_of_range';

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

  /** Caché de idempotencia del canal de mantenimiento (contrato §0/§6-bis): espacio
   * INDEPENDIENTE de commandCache/lastNonceByIssuer, que pertenecen a module/{id}/command. */
  private readonly maintenanceCommandCache: string[] = [];
  private readonly maintenanceCommandCacheSet = new Set<string>();
  /**
   * Reloj sincronizado (NTP/hora local del backend). `true` por defecto:
   * refleja un módulo en operación normal. La instalación no tiene salida a
   * Internet ni servidor de hora confirmado (README §6-bis), así que un
   * despliegue real puede arrancar con esto en `false` — de ahí que exista
   * setClockOk() para que los escenarios lo reproduzcan explícitamente.
   */
  private clockOk = true;

  private expectedOrder: number[] | null = null; // secuencia estricta [module_local target_index...] sólo relevante en este módulo si aplica
  private strictOrder = false;

  private mqttReconnects = 0;
  /** Secuencia propia de diagnósticos: evita repetir `event_id` sin alterar la de impactos. */
  private diagnosticSequence = 0;

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
    this.transport.subscribe(topics.moduleMaintenanceCommand(this.moduleId), (msg) =>
      this.onMaintenanceCommand(msg),
    );

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
    this.transport.subscribe(topics.moduleMaintenanceCommand(this.moduleId), (msg) =>
      this.onMaintenanceCommand(msg),
    );
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

  /** Simula la sincronización (o pérdida) del reloj de pared del módulo (README §6-bis). */
  setClockOk(ok: boolean): void {
    this.clockOk = ok;
  }

  getClockOk(): boolean {
    return this.clockOk;
  }

  /** Partida activa desde el punto de vista de este módulo (contrato §6-bis / diagnostic reason 'game_in_progress'). */
  private isGameInProgress(): boolean {
    return (
      this.state === 'game_prepare' ||
      this.state === 'game_countdown' ||
      this.state === 'game_active' ||
      this.state === 'game_paused'
    );
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
    await this.publishDiagnostic(
      'low_voltage',
      voltage5vMv < 4500 ? 'critical' : 'warning',
      `Tensión de 5V en ${voltage5vMv} mV`,
      { voltage_5v_mv: voltage5vMv },
    );
  }

  /**
   * Publica el resultado de una prueba con la forma exacta del contrato MQTT
   * v1. `detail` es el único espacio extensible del esquema congelado.
   */
  private async publishDiagnostic(
    kind: 'low_voltage' | 'calibration_result' | 'self_test_result',
    severity: 'info' | 'warning' | 'error' | 'critical',
    message: string,
    detail: Record<string, unknown>,
    requestId?: string,
  ): Promise<void> {
    this.diagnosticSequence += 1;
    const eventUs = this.uptimeUs();
    const eventId = seededUuid(
      this.rng.fork(`diag-${this.moduleId}-${this.bootId}-${this.diagnosticSequence}`),
    );
    const payload = {
      schema_version: 1 as const,
      module_id: this.moduleId,
      ...(requestId ? { request_id: requestId } : {}),
      event_id: eventId,
      kind,
      severity,
      message,
      device: this.deviceTime(eventUs),
      detail,
      firmware_version: this.firmwareVersion,
    };
    assertValid('module-diagnostic.schema.json', payload);
    await this.safePublish(topics.moduleDiagnostic(this.moduleId), payload, { qos: 1, retain: false });
  }

  /** Publica el rechazo cerrado de una orden de mantenimiento (module-diagnostic kind='command_rejected'). */
  private async publishCommandRejected(
    requestId: string,
    reason: MaintenanceRejectReason,
  ): Promise<void> {
    this.diagnosticSequence += 1;
    const eventUs = this.uptimeUs();
    const eventId = seededUuid(
      this.rng.fork(`diag-${this.moduleId}-${this.bootId}-${this.diagnosticSequence}`),
    );
    const payload = {
      schema_version: 1 as const,
      module_id: this.moduleId,
      request_id: requestId,
      event_id: eventId,
      kind: 'command_rejected' as const,
      severity: 'warning' as const,
      message: `Orden de mantenimiento rechazada: ${reason}`,
      device: this.deviceTime(eventUs),
      detail: { accepted: false as const, reason, request_id: requestId },
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
          for (const target of this.targets) target.state = 'calibration';
          await this.publishDiagnostic(
            'calibration_result',
            'info',
            'Calibración del módulo completada',
            {
              result: 'ok',
              targets: this.targets.map((target) => ({
                target_index: target.target_index,
                threshold: this.threshold,
              })),
            },
          );
          for (const target of this.targets) target.state = 'safe';
          this.state = 'ready';
          break;
        case 'abort_calibration':
          this.state = 'ready';
          break;
        case 'self_test':
          await this.publishDiagnostic(
            'self_test_result',
            'info',
            'Autodiagnóstico del módulo completado sin errores',
            {
              result: 'ok',
              component: 'sensors',
              targets: this.targets.map((target) => ({
                target_index: target.target_index,
                enabled: target.enabled,
              })),
            },
          );
          break;
        case 'led_test': {
          const arr = (params.targets ?? []) as { target_index: number; state: TargetState }[];
          for (const update of arr) {
            const target = this.targets.find((item) => item.target_index === update.target_index);
            if (target) target.state = update.state;
          }
          // El contrato v1 no define `led_test_result`. El resultado positivo
          // se expresa como `self_test_result` y se discrimina en `detail`;
          // `led_chain_error` queda reservado a un fallo real de la cadena.
          await this.publishDiagnostic(
            'self_test_result',
            'info',
            'Prueba de LED aplicada',
            { result: 'ok', component: 'led', targets: arr },
          );
          break;
        }
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

  // ---------------------------------------------------------------- canal de mantenimiento (backend, §0/§6-bis)

  private onMaintenanceCommand(msg: IncomingMessage): Promise<void> {
    return this.handleMaintenanceCommandPayload(msg.payload as Record<string, unknown>);
  }

  /**
   * Aplica LOCALMENTE, en el módulo, el guardarraíl de seguridad del canal
   * `module/{id}/maintenance/command` (contrato §0/§2/§6-bis). Esta es la
   * única implementación existente de esa regla mientras el firmware ESP-IDF
   * no se compile: cualquier motivo de rechazo que falte aquí es un motivo
   * de rechazo que no existe en ningún sitio del sistema real.
   */
  private async handleMaintenanceCommandPayload(payload: Record<string, unknown>): Promise<void> {
    const requestId = payload.request_id as string | undefined;
    const targetModuleId = payload.module_id as string | undefined;
    const commandType = payload.command_type as string | undefined;
    const issuedAtMs = payload.issued_at_ms as number;
    const expiresInMs = payload.expires_in_ms as number;
    const params = (payload.params ?? {}) as Record<string, unknown>;

    // Sin request_id no hay forma conforme al contrato de correlacionar un
    // rechazo (module-diagnostic exige request_id cuando kind='command_rejected').
    // No hay motivo de rechazo cerrado para "falta request_id": se descarta en
    // silencio, igual que un mensaje que no valida contra el esquema congelado.
    if (!requestId) return;

    if (targetModuleId !== this.moduleId) {
      await this.publishCommandRejected(requestId, 'module_mismatch');
      return;
    }

    if (!commandType || !MAINTENANCE_KNOWN_COMMANDS.has(commandType)) {
      await this.publishCommandRejected(requestId, 'unknown_command');
      return;
    }

    // Categoría única (ver comentario de MAINTENANCE_COMMAND_CATEGORY): a
    // esta altura commandType ya pasó MAINTENANCE_KNOWN_COMMANDS, así que
    // SIEMPRE tiene entrada en el mapa.
    const category = MAINTENANCE_COMMAND_CATEGORY[commandType] as MaintenanceCommandCategory;
    const isActCommand = category === 'act';
    const isSafetyCommand = category === 'safety';

    // `abort_calibration` es idempotente por naturaleza: es un "para", y
    // parar dos veces algo que ya está parado (o que nunca llegó a arrancar)
    // no tiene efecto observable distinto de parar una vez. NO se rechaza
    // como duplicado (decisión de este carril, el contrato no lo fija): un
    // backend que reintenta un abort por QoS 1, o un operador que pulsa
    // "parar" dos veces por si acaso, debe recibir SIEMPRE la respuesta real
    // del estado actual (¿había algo que abortar o no?), nunca un rechazo.
    // Rechazarlo por 'duplicate' sería aplicar a una orden de seguridad la
    // misma cautela que a una que sí tiene efectos secundarios no
    // idempotentes (p.ej. volver a mover un actuador) — exactamente lo que
    // esta categoría existe para evitar.
    if (!isSafetyCommand && this.maintenanceCommandCacheSet.has(requestId)) {
      await this.publishCommandRejected(requestId, 'duplicate');
      return;
    }

    // `abort_calibration` se acepta SIEMPRE (contrato §6-bis, ampliación
    // "seguridad"): ni la regla de reloj/caducidad ni game_in_progress se le
    // aplican. No arranca nada — para lo que otra orden arrancó — y un aviso
    // de parada tardío sigue queriendo decir "para".
    if (!isSafetyCommand) {
      if (!this.clockOk) {
        // Sin reloj sincronizado: las órdenes de "leer" se aceptan igual que
        // el resto del contrato (§6); las de "actuar" se rechazan siempre por
        // 'expired', porque no hay forma honesta de acotar su antigüedad.
        if (isActCommand) {
          await this.publishCommandRejected(requestId, 'expired');
          return;
        }
      } else {
        const nowMs = Math.floor(this.clock.nowUs() / 1000);
        if (isMaintenanceCommandExpired(nowMs, issuedAtMs, expiresInMs)) {
          await this.publishCommandRejected(requestId, 'expired');
          return;
        }
      }

      if (isActCommand && this.isGameInProgress()) {
        await this.publishCommandRejected(requestId, 'game_in_progress');
        return;
      }
    }

    if (this.maintenanceParamsOutOfRange(commandType, params)) {
      await this.publishCommandRejected(requestId, 'params_out_of_range');
      return;
    }

    // A partir de aquí la orden se ejecuta: se recuerda ANTES de actuar para
    // que un reintento QoS 1 concurrente no la ejecute dos veces — salvo
    // abort_calibration, que no usa esta caché (ver arriba: es idempotente
    // y siempre debe responder con el estado real).
    if (!isSafetyCommand) {
      this.rememberMaintenanceCommand(requestId);
    }
    await this.executeMaintenanceCommand(commandType, params, requestId);
  }

  private maintenanceParamsOutOfRange(commandType: string, params: Record<string, unknown>): boolean {
    // Number.isFinite(), no `typeof x === 'number'`: NaN es de tipo
    // 'number' en JS, y CUALQUIER comparación (<, >) con NaN da `false`, así
    // que `typeof duration !== 'number'` deja pasar un NaN construido en
    // memoria sin que ninguna de las comparaciones de rango lo atrape (halló
    // el supervisor: no explotable por el canal real hoy, porque JSON.parse
    // nunca produce NaN — se serializa a `null`, que el módulo SÍ rechaza —
    // pero esta función es alcanzable desde cualquier otro sitio del
    // simulador sin pasar por JSON, y no debe depender de esa protección
    // externa para ser segura). Number.isFinite() es `false` para NaN,
    // Infinity y -Infinity, y `false` para cualquier no-número.
    const limits = MAINTENANCE_DURATION_LIMITS_MS[commandType];
    if (limits) {
      const duration = params.duration_ms;
      if (!Number.isFinite(duration) || (duration as number) < limits[0] || (duration as number) > limits[1]) {
        return true;
      }
    }
    if (params.target_index !== undefined) {
      const targetIndex = params.target_index;
      if (!Number.isFinite(targetIndex) || (targetIndex as number) < 1 || (targetIndex as number) > 9) {
        return true;
      }
    }
    return false;
  }

  private async executeMaintenanceCommand(
    commandType: string,
    params: Record<string, unknown>,
    requestId: string,
  ): Promise<void> {
    switch (commandType) {
      case 'request_telemetry':
        await this.publishTelemetry();
        return;
      case 'query_status':
      case 'query_version':
        await this.publishStatus();
        return;
      case 'identify':
        await this.publishDiagnostic(
          'self_test_result',
          'info',
          'Identificación de módulo solicitada por mantenimiento',
          { result: 'ok', component: 'identify', duration_ms: params.duration_ms },
          requestId,
        );
        return;
      case 'self_test':
        await this.publishDiagnostic(
          'self_test_result',
          'info',
          'Autodiagnóstico de mantenimiento completado sin errores',
          {
            result: 'ok',
            component: 'self_test',
            targets: this.targets.map((target) => ({
              target_index: target.target_index,
              enabled: target.enabled,
            })),
          },
          requestId,
        );
        return;
      case 'led_test':
        await this.publishDiagnostic(
          'self_test_result',
          'info',
          'Prueba de LED de mantenimiento aplicada',
          {
            result: 'ok',
            component: 'led',
            duration_ms: params.duration_ms,
            ...(params.target_index !== undefined ? { target_index: params.target_index } : {}),
          },
          requestId,
        );
        return;
      case 'piezo_test':
        await this.publishDiagnostic(
          'self_test_result',
          'info',
          'Prueba de piezo de mantenimiento aplicada',
          {
            result: 'ok',
            component: 'piezo',
            duration_ms: params.duration_ms,
            ...(params.target_index !== undefined ? { target_index: params.target_index } : {}),
          },
          requestId,
        );
        return;
      case 'start_calibration': {
        this.state = 'calibration';
        for (const target of this.targets) target.state = 'calibration';
        await this.publishDiagnostic(
          'calibration_result',
          'info',
          'Calibración de mantenimiento completada',
          {
            result: 'ok',
            targets: this.targets.map((target) => ({
              target_index: target.target_index,
              threshold: this.threshold,
            })),
          },
          requestId,
        );
        for (const target of this.targets) target.state = 'safe';
        this.state = 'ready';
        return;
      }
      case 'abort_calibration': {
        // Categoría "seguridad": SIEMPRE responde, pero distingue si de
        // verdad había algo que parar de si no había ninguna calibración en
        // curso (pregunta explícita del organizador: no es un rechazo por
        // regla, es "no había nada que abortar").
        const targetIndex = params.target_index as number | undefined;
        let aborted = false;

        if (targetIndex !== undefined) {
          const slot = this.targets.find((target) => target.target_index === targetIndex);
          if (slot && slot.state === 'calibration') {
            slot.state = 'safe';
            aborted = true;
          }
          // Si tras abortar esta diana ya ninguna sigue en calibración, el
          // módulo sale del modo calibración (aunque se hubiera arrancado
          // para las 9 a la vez, dosier simplificado: no hay calibración
          // "por diana" real, sólo el filtrado por target_index del abort).
          if (this.state === 'calibration' && !this.targets.some((target) => target.state === 'calibration')) {
            this.state = 'ready';
          }
        } else {
          aborted = this.state === 'calibration' || this.targets.some((target) => target.state === 'calibration');
          for (const target of this.targets) {
            if (target.state === 'calibration') target.state = 'safe';
          }
          if (this.state === 'calibration') this.state = 'ready';
        }

        await this.publishDiagnostic(
          'calibration_result',
          'info',
          aborted
            ? 'Calibración de mantenimiento abortada'
            : 'abort_calibration: no había ninguna calibración en curso',
          {
            result: 'ok',
            aborted,
            ...(targetIndex !== undefined ? { target_index: targetIndex } : {}),
            targets: this.targets.map((target) => ({
              target_index: target.target_index,
              state: target.state,
            })),
          },
          requestId,
        );
        return;
      }
      default:
        // Inalcanzable: commandType ya pasó MAINTENANCE_KNOWN_COMMANDS.
        return;
    }
  }

  private rememberMaintenanceCommand(requestId: string): void {
    this.maintenanceCommandCache.push(requestId);
    this.maintenanceCommandCacheSet.add(requestId);
    if (this.maintenanceCommandCache.length > COMMAND_CACHE_SIZE) {
      const evicted = this.maintenanceCommandCache.shift();
      if (evicted) this.maintenanceCommandCacheSet.delete(evicted);
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

  // Público: el modo «módulo vivo» (live.ts) reemite el estado periódicamente,
  // igual que un módulo real.
  async publishStatus(): Promise<void> {
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
