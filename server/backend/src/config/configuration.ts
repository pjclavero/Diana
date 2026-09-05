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
    /** PEM de la CA con la que se valida al broker. Obligatorio si la URL es TLS. */
    caFile: string | null;
    username: string | null;
    password: string | null;
    clientId: string;
    enabled: boolean;
    /**
     * Plazo máximo de espera del PUBACK, en ms. mqtt.js no impone ninguno, y
     * el arranque de partida espera esa confirmación con el cerrojo del panel
     * tomado: sin plazo, un broker mudo bloquea el panel indefinidamente.
     */
    publishAckTimeoutMs: number;
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

/** Tope por defecto del binario de firmware (bytes). Compartido por la config y
 *  por el límite del FileInterceptor de subida, para que sean coherentes. */
export const FIRMWARE_MAX_BYTES_DEFAULT = 16 * 1024 * 1024;

/**
 * Plazo máximo de espera del PUBACK. mqtt.js NO tiene plazo de ACK por
 * defecto: un broker que acepta el socket y nunca confirma (partición,
 * sobrecarga) deja la llamada colgada para siempre. Eso era inofensivo cuando
 * publicar era síncrono, pero `GamesService.start()` espera el PUBACK DENTRO
 * de `$transaction` y después de `pg_advisory_xact_lock`: sin plazo, un broker
 * mudo dejaba el cerrojo del panel tomado indefinidamente y ningún otro
 * arranque podía usar ese panel. Este plazo acota el peor caso.
 */
export const PUBLISH_ACK_TIMEOUT_MS_DEFAULT = 5000;

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
      // MEDIDO: compose.yml pasaba MQTT_HOST y MQTT_PORT, pero aqui solo se
      // leia MQTT_URL --- asi que el backend usaba SIEMPRE el literal por
      // defecto y cambiar el puerto en compose no tenia efecto ninguno.
      // Configuracion que aparenta gobernar algo que no gobierna. Se construye
      // la URL a partir de las variables que el despliegue realmente define;
      // MQTT_URL sigue mandando si se indica --- y por eso es tambien la via de
      // escape que mqtt.service.ts cierra en produccion.
      url:
        process.env.MQTT_URL ??
        `${process.env.MQTT_PROTOCOL ?? 'mqtts'}://` +
          `${process.env.MQTT_HOST ?? 'mosquitto'}:${process.env.MQTT_PORT ?? '8883'}`,
      // Fichero PEM de la CA que firma el certificado del broker. Es
      // OBLIGATORIO cuando el transporte es TLS: sin el no hay nada contra lo
      // que validar, y aceptar al broker sin validarlo deja pasar exactamente
      // el ataque que el TLS venia a cerrar (un intermediario en la LAN).
      caFile: process.env.MQTT_CA_FILE || null,
      username: process.env.MQTT_USERNAME || null,
      password: process.env.MQTT_PASSWORD || null,
      clientId: process.env.MQTT_CLIENT_ID ?? `diana-backend-${process.pid}`,
      enabled: bool(process.env.MQTT_ENABLED, true),
      publishAckTimeoutMs: int(
        process.env.MQTT_PUBLISH_ACK_TIMEOUT_MS,
        PUBLISH_ACK_TIMEOUT_MS_DEFAULT,
      ),
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
      maxBytes: int(process.env.FIRMWARE_MAX_BYTES, FIRMWARE_MAX_BYTES_DEFAULT),
    },
  };
}

export const CONFIG = Symbol('APP_CONFIG');
