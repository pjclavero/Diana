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

export class CommandBuilder {
  constructor(
    private readonly nonces: NonceSource = new NonceSource(),
    private readonly defaultIssuer: Issuer = 'backend',
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

  /** Comando dirigido a un módulo (`module-command.schema.json`). */
  moduleCommand(
    moduleId: string,
    action: string,
    params?: Record<string, unknown>,
    options: BuildOptions = {},
  ): Record<string, unknown> {
    const command: Record<string, unknown> = {
      ...this.envelope(options),
      module_id: moduleId,
      action,
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
