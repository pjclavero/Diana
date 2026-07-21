// Generador de carga MQTT para Diana (L-01..L-04 de TEST_MATRIX).
//
// - L-01: 9 módulos y 81 dianas (9x9) activos a la vez.
// - L-02: ráfagas de impactos.
// - L-03: telemetría continua a 1 Hz por módulo.
// - L-04: reconexión y retransmisión (un ciclo de desconexión por módulo).
//
// Emite payloads CONFORMES con los contratos congelados (hit-event,
// module-telemetry, module-presence). No pretende afirmar rendimiento por sí
// solo: produce la carga y registra cuántos mensajes envió y errores de
// publicación. La verificación del lado servidor (idempotencia, sin pérdidas)
// la hacen los tests de integración/E2E con los datos resultantes.
//
// Configuración por entorno:
//   MQTT_URL        (def. mqtt://localhost:1883)
//   MQTT_USERNAME / MQTT_PASSWORD (opcionales)
//   DURATION_S      (def. 60)   duración total
//   HIT_HZ          (def. 20)   impactos/segundo agregados en todo el sistema
//   BURST_EVERY_S   (def. 10)   cada cuánto se dispara una ráfaga
//   BURST_SIZE      (def. 200)  impactos por ráfaga

import mqtt from "mqtt";
import { randomUUID } from "node:crypto";

const URL = process.env.MQTT_URL ?? "mqtt://localhost:1883";
const DURATION_S = Number(process.env.DURATION_S ?? 60);
const HIT_HZ = Number(process.env.HIT_HZ ?? 20);
const BURST_EVERY_S = Number(process.env.BURST_EVERY_S ?? 10);
const BURST_SIZE = Number(process.env.BURST_SIZE ?? 200);

const SYSTEM_ID = "system-a";
const GAME_ID = randomUUID();
const ROUND_ID = randomUUID();
const MODULES = Array.from({ length: 9 }, (_, i) => `module-${String(i + 1).padStart(2, "0")}`);
const FW = "0.1.0";

const stats = { hits: 0, telemetry: 0, presence: 0, errors: 0 };
const bootId = new Map(MODULES.map((m) => [m, randomUUID()]));
const seq = new Map(MODULES.map((m) => [m, 0]));

const client = mqtt.connect(URL, {
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
  reconnectPeriod: 1000,
  connectTimeout: 10_000,
});

function pub(topic, payload, opts = { qos: 1 }) {
  client.publish(topic, JSON.stringify(payload), opts, (err) => {
    if (err) stats.errors += 1;
  });
}

function now_us() {
  return Math.floor(performance.now() * 1000);
}

function presence(moduleId, online) {
  pub(
    `targets/v1/module/${moduleId}/presence`,
    online
      ? { schema_version: 1, module_id: moduleId, online: true, reason: "connect" }
      : { schema_version: 1, module_id: moduleId, online: false, reason: "lwt" },
    { qos: 1, retain: true },
  );
  stats.presence += 1;
}

function telemetry(moduleId, uptimeS) {
  pub(
    `targets/v1/module/${moduleId}/telemetry`,
    {
      schema_version: 1,
      module_id: moduleId,
      uptime_s: uptimeS,
      free_heap_bytes: 180_000 + Math.floor(Math.random() * 20_000),
      link_up: true,
      queue_depth: 0,
      device: { boot_id: bootId.get(moduleId), uptime_us: uptimeS * 1_000_000 },
    },
    { qos: 0 },
  );
  stats.telemetry += 1;
}

function hit(moduleId, replay = false) {
  const s = seq.get(moduleId) + 1;
  seq.set(moduleId, s);
  const targetIndex = 1 + Math.floor(Math.random() * 9); // 1..9 -> 81 dianas totales
  const t = now_us();
  pub(`targets/v1/module/${moduleId}/hit`, {
    schema_version: 1,
    event_id: randomUUID(),
    system_id: SYSTEM_ID,
    module_id: moduleId,
    game_id: GAME_ID,
    round_id: ROUND_ID,
    target_index: targetIndex,
    local_sequence: s,
    device: { boot_id: bootId.get(moduleId), uptime_us: t, event_us: t - 40 },
    coordinator: null,
    amplitude: 2000 + Math.floor(Math.random() * 1000),
    threshold: 900,
    noise_floor: 140,
    target_state_before: "active",
    classification: "valid_hit",
    firmware_version: FW,
    replay,
  });
  stats.hits += 1;
}

function randomModule() {
  return MODULES[Math.floor(Math.random() * MODULES.length)];
}

client.on("error", (e) => {
  stats.errors += 1;
  console.error("[carga] error MQTT:", e.message);
});

client.on("connect", () => {
  console.log(`[carga] conectado a ${URL}. Duración ${DURATION_S}s, ${HIT_HZ} hit/s.`);
  const t0 = Date.now();

  // L-01: alta de los 9 módulos.
  for (const m of MODULES) presence(m, true);

  // L-03: telemetría continua a 1 Hz por módulo.
  const telemetryTimer = setInterval(() => {
    const uptime = Math.floor((Date.now() - t0) / 1000);
    for (const m of MODULES) telemetry(m, uptime);
  }, 1000);

  // Impactos de fondo: HIT_HZ repartidos por todo el sistema.
  const hitTimer = setInterval(() => {
    hit(randomModule());
  }, Math.max(1, Math.floor(1000 / HIT_HZ)));

  // L-02: ráfagas periódicas.
  const burstTimer = setInterval(() => {
    for (let i = 0; i < BURST_SIZE; i += 1) hit(randomModule());
    console.log(`[carga] ráfaga de ${BURST_SIZE} impactos emitida.`);
  }, BURST_EVERY_S * 1000);

  // L-04: a mitad de la prueba, un módulo se desconecta y vuelve; al reconectar
  // reenvía algunos impactos con replay=true (misma lógica que la cola local).
  const reconnectTimer = setTimeout(
    () => {
      const m = MODULES[0];
      console.log(`[carga] ${m} simula desconexión (LWT) y reconexión con reenvío.`);
      presence(m, false);
      setTimeout(() => {
        presence(m, true);
        for (let i = 0; i < 10; i += 1) hit(m, true);
      }, 2000);
    },
    Math.floor((DURATION_S * 1000) / 2),
  );

  setTimeout(() => {
    clearInterval(telemetryTimer);
    clearInterval(hitTimer);
    clearInterval(burstTimer);
    clearTimeout(reconnectTimer);
    for (const m of MODULES) presence(m, false);
    console.log("[carga] fin. Resumen:", JSON.stringify(stats));
    client.end(false, {}, () => process.exit(stats.errors > 0 ? 1 : 0));
  }, DURATION_S * 1000);
});
