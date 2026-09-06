// ============================================================================
// Utilidades del carril E2E-2 · offline / recovery.
// ============================================================================
// Regla de la casa: NADA se da por hecho porque un comando devuelva 0. Todo lo
// que se afirma se mide sobre un efecto observable — una fila en PostgreSQL, un
// contador de la ingesta, un paquete MQTT recibido con su bandera `retain`.
// ============================================================================

import mqtt from 'mqtt';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';

export const MQTT_URL = process.env.E2E_MQTT_URL ?? 'mqtt://127.0.0.1:11883';
export const API_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:13000/api';
export const DB_URL =
  process.env.E2E_DATABASE_URL ??
  'postgresql://diana_e2e:diana_e2e@127.0.0.1:15433/diana_e2e';

export const ROOT = 'targets/v1';
export const SYSTEM = 'e2e-system-a';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Espera activa a una condición. Devuelve el valor; LANZA con contexto si expira. */
export async function waitFor(label, fn, { timeoutMs = 30_000, everyMs = 250 } = {}) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    try {
      last = await fn();
      if (last) return last;
    } catch (error) {
      last = `error: ${error.message}`;
    }
    await sleep(everyMs);
  }
  throw new Error(
    `Tiempo agotado esperando «${label}» tras ${Date.now() - started} ms. Último valor: ${JSON.stringify(last)}`,
  );
}

// ---------------------------------------------------------------- PostgreSQL

let db = null;
export async function sql(text, params = []) {
  if (!db) {
    db = new Client({ connectionString: DB_URL });
    await db.connect();
  }
  const result = await db.query(text, params);
  return result.rows;
}
export async function closeDb() {
  if (db) await db.end();
  db = null;
}

export async function moduleRow(slug) {
  const rows = await sql(
    'SELECT slug, online, boot_id, last_seen_at, offline_since, firmware_version, ip FROM modules WHERE slug = $1',
    [slug],
  );
  return rows[0] ?? null;
}

export async function countHits(eventId) {
  const rows = await sql('SELECT count(*)::int AS n FROM hit_events WHERE event_id = $1', [eventId]);
  return rows[0].n;
}

export async function countHitsByModule(slug) {
  const rows = await sql('SELECT count(*)::int AS n FROM hit_events WHERE module_slug = $1', [slug]);
  return rows[0].n;
}

export async function incidents(kind, slug) {
  return sql(
    'SELECT kind, severity, message FROM incidents WHERE kind = $1 AND (module_slug = $2 OR $2 IS NULL) ORDER BY occurred_at DESC',
    [kind, slug ?? null],
  );
}

/** Índices ÚNICOS vivos sobre una tabla. Es donde ADR-0003 pone la idempotencia. */
export async function uniqueIndexes(table) {
  const rows = await sql(
    `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename=$1
       AND indexdef ILIKE '%UNIQUE%' ORDER BY indexname`,
    [table],
  );
  return rows.map((r) => r.indexname);
}

// ---------------------------------------------------------------- Backend API

/** Métricas REALES de la ingesta (IngestService.getMetrics), vía /health/ready. */
export async function ingestMetrics() {
  const response = await fetch(`${API_URL}/health/ready`);
  if (!response.ok) throw new Error(`/health/ready devolvió ${response.status}`);
  const body = await response.json();
  if (!body.ingest) throw new Error(`/health/ready sin bloque ingest: ${JSON.stringify(body)}`);
  return { ...body.ingest, _database: body.database, _mqtt: body.mqtt };
}

// ---------------------------------------------------------------- MQTT

/**
 * Un módulo simulado. `use_username_as_clientid` no está activo en este broker,
 * pero se respeta la invariante F-02 igualmente: clientId === username ===
 * module_id, sin prefijo (infrastructure/mosquitto/identities.json).
 */
export async function connectModule(moduleId, { keepalive = 60, withWill = true } = {}) {
  const client = mqtt.connect(MQTT_URL, {
    clientId: moduleId,
    username: moduleId,
    protocolVersion: 5,
    keepalive,
    clean: true,
    reconnectPeriod: 0, // una caída es una caída: nadie reconecta por detrás.
    connectTimeout: 10_000,
    // Contrato §3: el Last Will se registra EN EL CONNECT, no se publica luego.
    will: withWill
      ? {
          topic: `${ROOT}/module/${moduleId}/presence`,
          qos: 1,
          retain: true,
          payload: JSON.stringify({
            schema_version: 1,
            module_id: moduleId,
            online: false,
            reason: 'lwt',
          }),
        }
      : undefined,
  });
  await new Promise((resolve, reject) => {
    client.once('connect', resolve);
    client.once('error', reject);
  });
  return client;
}

export async function connectObserver(clientId = `e2e-observer-${randomUUID().slice(0, 8)}`) {
  const client = mqtt.connect(MQTT_URL, {
    clientId,
    protocolVersion: 5,
    clean: true,
    reconnectPeriod: 0,
    connectTimeout: 10_000,
  });
  await new Promise((resolve, reject) => {
    client.once('connect', resolve);
    client.once('error', reject);
  });
  return client;
}

/** Publica y ESPERA el PUBACK. Un `publish` sin callback no prueba nada. */
export function publish(client, topic, payload, { qos = 1, retain = false } = {}) {
  return new Promise((resolve, reject) => {
    client.publish(topic, JSON.stringify(payload), { qos, retain }, (error, packet) => {
      if (error) return reject(error);
      // Aviso medido en este proyecto: una DENEGACIÓN de ACL llega como
      // reasonCode ≥ 0x80 en el PUBACK, no como error de socket. Aquí el broker
      // es anónimo, así que cualquier reasonCode de error es un fallo real.
      const rc = packet?.reasonCode ?? 0;
      if (rc >= 0x80) return reject(new Error(`PUBACK con reasonCode ${rc} en ${topic}`));
      resolve(rc);
    });
  });
}

/** Suscribe y recoge mensajes en un array vivo (con su bandera `retain`). */
export async function collect(client, filter, { qos = 1 } = {}) {
  const received = [];
  client.on('message', (topic, payload, packet) => {
    if (!matches(filter, topic)) return;
    let parsed = null;
    try {
      parsed = JSON.parse(payload.toString());
    } catch {
      parsed = { _unparsable: payload.toString() };
    }
    received.push({ topic, payload: parsed, retain: Boolean(packet.retain), qos: packet.qos });
  });
  await new Promise((resolve, reject) =>
    client.subscribe(filter, { qos }, (error, granted) => {
      if (error) return reject(error);
      if (!granted?.length || granted[0].qos >= 0x80) {
        return reject(new Error(`Suscripción denegada a ${filter}: ${JSON.stringify(granted)}`));
      }
      resolve();
    }),
  );
  return received;
}

function matches(filter, topic) {
  const f = filter.split('/');
  const t = topic.split('/');
  for (let i = 0; i < f.length; i += 1) {
    if (f[i] === '#') return true;
    if (f[i] === '+') continue;
    if (f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}

/** Cierre SUCIO: destruye el socket sin DISCONNECT. Es lo que dispara el LWT. */
export function killUngracefully(client) {
  const stream = client.stream;
  client.options.reconnectPeriod = 0;
  stream.destroy();
}

// ---------------------------------------------------------------- Payloads

export const presence = (moduleId, extra = {}) => ({
  schema_version: 1,
  module_id: moduleId,
  online: true,
  reason: 'connect',
  ...extra,
});

export const telemetry = (moduleId, bootId) => ({
  schema_version: 1,
  module_id: moduleId,
  uptime_s: Math.max(1, Math.floor(process.uptime())),
  free_heap_bytes: 120_000,
  link_up: true,
  queue_depth: 0,
  device: { boot_id: bootId, uptime_us: Math.max(1, Math.floor(process.uptime() * 1e6)) },
});

/**
 * Impacto válido. `eventId`, `bootId` y `localSequence` son los tres campos que
 * gobiernan la idempotencia (contrato §5): el arnés los controla a mano para
 * poder ejercer los DOS caminos de deduplicación por separado.
 */
export const hit = (moduleId, { eventId, bootId, localSequence, replay = false, targetIndex = 3 }) => ({
  schema_version: 1,
  event_id: eventId,
  system_id: SYSTEM,
  module_id: moduleId,
  target_index: targetIndex,
  local_sequence: localSequence,
  device: {
    boot_id: bootId,
    uptime_us: 1_000_000 + localSequence * 1000,
    event_us: 1_000_000 + localSequence * 1000 - 50,
  },
  amplitude: 2710,
  threshold: 920,
  noise_floor: 140,
  target_state_before: 'active',
  classification: 'valid_hit',
  firmware_version: '0.1.0',
  replay,
});

export const T = {
  presence: (m) => `${ROOT}/module/${m}/presence`,
  telemetry: (m) => `${ROOT}/module/${m}/telemetry`,
  hit: (m) => `${ROOT}/module/${m}/hit`,
};
