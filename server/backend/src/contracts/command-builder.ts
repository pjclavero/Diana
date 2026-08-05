import { randomUUID } from 'crypto';

/**
 * Construcción de comandos conforme al contrato §6 y al dosier 23.3.
 *
 * Todo comando lleva `command_id`, `issued_at_ms`, `expires_in_ms` y `nonce`
 * monotónico por emisor. El módulo descarta comandos repetidos, con nonce no
 * creciente o caducados.
 */

export const DEFAULT_EXPIRES_IN_MS = 5000;
export const MIN_EXPIRES_IN_MS = 100;
export const MAX_EXPIRES_IN_MS = 600000;

export type Issuer = 'backend' | 'coordinator' | 'operator-cli';

/**
 * Fuente de nonces estrictamente crecientes.
 *
 * Se siembra con la hora de arranque en milisegundos: así un reinicio del
 * backend nunca produce un nonce menor que el último emitido, que el módulo
 * descartaría como reenvío (contrato §6.2).
 */
export class NonceSource {
  private last: number;

  constructor(seed: number = Date.now()) {
    this.last = Math.max(0, Math.floor(seed));
  }

  next(now: number = Date.now()): number {
    const candidate = Math.floor(now);
    this.last = candidate > this.last ? candidate : this.last + 1;
    return this.last;
  }

  peek(): number {
    return this.last;
  }
}

export interface CommandEnvelope {
  schema_version: number;
  command_id: string;
  issued_at_ms: number;
  expires_in_ms: number;
  nonce: number;
  issuer: Issuer;
}

export interface BuildOptions {
  issuer?: Issuer;
  expiresInMs?: number;
  commandId?: string;
  issuedAtMs?: number;
}

/**
 * Repertorio CERRADO de `module-maintenance-command.schema.json`
 * (ampliación v1.1). No lo confundas con `action` de `module-command`: son
 * dos listas disjuntas por diseño — juego vs. mantenimiento.
 */
export type MaintenanceCommandType =
  | 'led_test'
  | 'piezo_test'
  | 'request_telemetry'
  | 'self_test'
  | 'identify'
  | 'query_version'
  | 'query_status'
  | 'start_calibration'
  | 'abort_calibration';

/** Origen humano de una orden de mantenimiento (`requested_by` del esquema). */
export interface MaintenanceRequestedBy {
  actor_type: 'user' | 'operator';
  actor_id: string;
}

export interface MaintenanceBuildOptions {
  expiresInMs?: number;
  requestId?: string;
  issuedAtMs?: number;
}

export class CommandBuilder {
  constructor(
    private readonly nonces: NonceSource = new NonceSource(),
    private readonly defaultIssuer: Issuer = 'backend',
    /**
     * Espacio de nonces INDEPENDIENTE del de `module/{id}/command` (contrato
     * v1.1, campo `nonce` de `module-maintenance-command.schema.json`): un
     * replay capturado en un canal no debe consumir ni bloquear el contador
     * del otro. Por eso es una `NonceSource` propia, no la misma instancia.
     */
    private readonly maintenanceNonces: NonceSource = new NonceSource(),
  ) {}

  envelope(options: BuildOptions = {}): CommandEnvelope {
    const expires = options.expiresInMs ?? DEFAULT_EXPIRES_IN_MS;
    if (!Number.isInteger(expires) || expires < MIN_EXPIRES_IN_MS || expires > MAX_EXPIRES_IN_MS) {
      throw new Error(
        `expires_in_ms debe ser un entero entre ${MIN_EXPIRES_IN_MS} y ${MAX_EXPIRES_IN_MS}, recibido ${expires}`,
      );
    }
    const issuedAt = options.issuedAtMs ?? Date.now();
    return {
      schema_version: 1,
      command_id: options.commandId ?? randomUUID(),
      issued_at_ms: issuedAt,
      expires_in_ms: expires,
      nonce: this.nonces.next(issuedAt),
      issuer: options.issuer ?? this.defaultIssuer,
    };
  }

  /**
   * Sobre de `module-command.schema.json` — el canal de JUEGO.
   *
   * ATENCIÓN, esto NO es un camino de salida del backend: desde la ampliación
   * v1.1 ningún código de `src/` publica en `module/{id}/command`, y no queda
   * ningún método de `MqttService` capaz de hacerlo. Este constructor
   * sobrevive únicamente para poder CONSTRUIR y VALIDAR sobres de ese canal
   * (pruebas de conformidad con el esquema, utillaje de contrato). Construir
   * no es publicar.
   *
   * `issuer` es OBLIGATORIO y explícito, a diferencia del resto de métodos:
   * el `defaultIssuer` de la clase es `'backend'`, valor que el enum `issuer`
   * de este esquema ya NO admite (se retiró en v1.1). Heredarlo aquí
   * fabricaba, en silencio, un mensaje que el propio contrato declara
   * inválido. Obligando a decirlo, quien lo escriba tiene que elegir un
   * emisor legítimo (`coordinator` o `operator-cli`) — o pedir `'backend'` a
   * propósito, como hace la prueba que demuestra que el esquema lo rechaza.
   */
  moduleCommand(
    moduleId: string,
    action: string,
    params: Record<string, unknown> | undefined,
    options: BuildOptions & { issuer: Issuer },
  ): Record<string, unknown> {
    const command: Record<string, unknown> = {
      ...this.envelope(options),
      module_id: moduleId,
      action,
    };
    if (params && Object.keys(params).length > 0) command.params = params;
    return command;
  }

  /**
   * Orden de mantenimiento (`module-maintenance-command.schema.json`,
   * ampliación v1.1). Canal EXCLUSIVO del backend — nunca se publica esto en
   * `moduleCommand()`. La forma del sobre es DISTINTA a la de `moduleCommand`
   * (`request_id` en vez de `command_id`, `requested_by` en vez de `issuer`,
   * SIN el campo `issuer`): el esquema tiene `additionalProperties: false`,
   * así que reutilizar `envelope()` colaría un campo que el validador de
   * salida rechazaría.
   */
  maintenanceCommand(
    moduleId: string,
    commandType: MaintenanceCommandType,
    requestedBy: MaintenanceRequestedBy,
    params?: Record<string, unknown>,
    options: MaintenanceBuildOptions = {},
  ): Record<string, unknown> {
    const expires = options.expiresInMs ?? DEFAULT_EXPIRES_IN_MS;
    if (!Number.isInteger(expires) || expires < MIN_EXPIRES_IN_MS || expires > MAX_EXPIRES_IN_MS) {
      throw new Error(
        `expires_in_ms debe ser un entero entre ${MIN_EXPIRES_IN_MS} y ${MAX_EXPIRES_IN_MS}, recibido ${expires}`,
      );
    }
    const issuedAt = options.issuedAtMs ?? Date.now();
    const command: Record<string, unknown> = {
      schema_version: 1,
      request_id: options.requestId ?? randomUUID(),
      module_id: moduleId,
      command_type: commandType,
      issued_at_ms: issuedAt,
      expires_in_ms: expires,
      nonce: this.maintenanceNonces.next(issuedAt),
      requested_by: requestedBy,
    };
    if (params && Object.keys(params).length > 0) command.params = params;
    return command;
  }

  /** Comando dirigido al sistema (`system-command.schema.json`). */
  systemCommand(
    systemId: string,
    action: string,
    extra: Record<string, unknown> = {},
    options: BuildOptions = {},
  ): Record<string, unknown> {
    return {
      ...this.envelope(options),
      system_id: systemId,
      action,
      ...extra,
    };
  }

  /** Comando OTA (`ota-command.schema.json`). La firma es obligatoria para `update`. */
  otaCommand(
    moduleId: string,
    action: 'update' | 'confirm' | 'rollback' | 'cancel',
    firmware?: Record<string, unknown>,
    options: BuildOptions = {},
  ): Record<string, unknown> {
    if (action === 'update') {
      if (!firmware) throw new Error('Un comando OTA `update` exige el bloque firmware');
      if (!firmware.signature) {
        throw new Error('OTA sin firma: prohibido por el dosier 23.3');
      }
    }
    const command: Record<string, unknown> = {
      ...this.envelope({ expiresInMs: 600000, ...options }),
      module_id: moduleId,
      action,
    };
    if (firmware) command.firmware = firmware;
    return command;
  }
}
