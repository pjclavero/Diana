/**
 * Configuración del backend. TODO se toma del entorno: el repositorio no
 * contiene ni una sola credencial (dosier 23.1).
 */
export interface AppConfig {
  port: number;
  globalPrefix: string;
  corsOrigins: string[];
  jwt: {
    /** Sin valor por defecto: si falta, el arranque falla a propósito. */
    secret: string;
    expiresIn: string;
  };
  admin: {
    username: string;
    /** Si no se define, se genera una credencial aleatoria en el primer arranque. */
    password: string | null;
    email: string | null;
  };
  mqtt: {
    url: string;
    username: string | null;
    password: string | null;
    clientId: string;
    enabled: boolean;
  };
  ingest: {
    maxPersistLatencyMs: number;
  };
  retention: {
    hitEventsDays: number;
    telemetryDays: number;
    auditDays: number;
  };
  firmware: {
    /** Directorio donde se guardan los binarios subidos (volumen persistente). */
    dir: string;
    /** Base URL absoluta que el MÓDULO usa para descargar la OTA (red local). */
    publicBaseUrl: string;
    /** Tamaño máximo del binario en bytes. */
    maxBytes: number;
  };
}

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'si', 'sí'].includes(value.toLowerCase());
}

export function loadConfiguration(): AppConfig {
  const secret = process.env.JWT_SECRET ?? '';
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error(
      'JWT_SECRET no está definido. El backend no arranca en producción sin un secreto explícito.',
    );
  }

  return {
    port: int(process.env.PORT, 3000),
    globalPrefix: process.env.API_PREFIX ?? 'api',
    corsOrigins: (process.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    jwt: {
      secret: secret || 'desarrollo-inseguro-cambiar',
      expiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
    },
    admin: {
      username: process.env.DIANA_ADMIN_USERNAME ?? 'admin',
      password: process.env.DIANA_ADMIN_PASSWORD || null,
      email: process.env.DIANA_ADMIN_EMAIL || null,
    },
    mqtt: {
      url: process.env.MQTT_URL ?? 'mqtt://mosquitto:1883',
      username: process.env.MQTT_USERNAME || null,
      password: process.env.MQTT_PASSWORD || null,
      clientId: process.env.MQTT_CLIENT_ID ?? `diana-backend-${process.pid}`,
      enabled: bool(process.env.MQTT_ENABLED, true),
    },
    ingest: {
      maxPersistLatencyMs: int(process.env.INGEST_MAX_PERSIST_LATENCY_MS, 5000),
    },
    retention: {
      hitEventsDays: int(process.env.RETENTION_HIT_EVENTS_DAYS, 730),
      telemetryDays: int(process.env.RETENTION_TELEMETRY_DAYS, 30),
      auditDays: int(process.env.RETENTION_AUDIT_DAYS, 1095),
    },
    firmware: {
      dir: process.env.FIRMWARE_DIR ?? '/app/firmware',
      publicBaseUrl: (process.env.FIRMWARE_PUBLIC_BASE_URL ?? 'http://localhost:8080').replace(/\/+$/, ''),
      maxBytes: int(process.env.FIRMWARE_MAX_BYTES, 16 * 1024 * 1024),
    },
  };
}

export const CONFIG = Symbol('APP_CONFIG');
