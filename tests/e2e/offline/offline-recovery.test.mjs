// ============================================================================
// Diana · E2E-2 · OFFLINE / RECOVERY
// ============================================================================
//   módulo online → desconecta → estado offline/stale → reconecta → recuperación
//
// Contra PostgreSQL real, Mosquitto real y el backend real (misma imagen que
// producción). Lo único simulado es el firmware.
//
// Qué se mide, y con qué efecto observable:
//   O-1  Camino feliz (CONTROL POSITIVO): un impacto produce UNA fila en
//        hit_events y sube `accepted`. Sin esto, todo lo demás podría estar
//        pasando en verde sobre un stack que no ingiere nada.
//   O-2  Last Will REAL: el broker publica el LWT del módulo caído (§3 del
//        contrato: QoS 1, retain=true, online=false, reason=lwt) y el backend
//        lo ingiere → modules.online=false, offline_since fijado, incidencia
//        `module_offline`.
//   O-3  Presencia RETENIDA: un suscriptor que llega DESPUÉS lee la última
//        fotografía, con la bandera retain puesta.
//   O-4  Caída por SILENCIO (stale): sin ningún LWT, el barrido declara caído
//        al módulo callado, con un testigo vivo para que no se confunda con un
//        apagón general.
//   O-5  RECUPERACIÓN SIN DUPLICAR EFECTO: al reconectar se reinyecta la cola
//        local. Los reenvíos NO crean filas nuevas y se contabilizan como
//        `duplicates`; los eventos nuevos SÍ entran. Se ejercen los DOS caminos
//        de deduplicación del contrato §5 (event_id y module+boot+sequence).
//
// Nada se afirma por el retorno de una llamada: todo se comprueba contra la
// base de datos y contra los contadores de IngestService.
// ============================================================================

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  API_URL,
  T,
  closeDb,
  collect,
  connectModule,
  connectObserver,
  countHits,
  countHitsByModule,
  hit,
  incidents,
  ingestMetrics,
  killUngracefully,
  moduleRow,
  presence,
  publish,
  sleep,
  sql,
  telemetry,
  uniqueIndexes,
  waitFor,
} from './lib.mjs';

const M03 = 'e2e-module-03';
const M04 = 'e2e-module-04';
const M05 = 'e2e-module-05';

const boot03 = randomUUID();
const boot04 = randomUUID();
const boot05 = randomUUID();

const HIT_PRE = randomUUID();      // impacto anterior a la caída
const HIT_QUEUED = randomUUID();   // impacto ocurrido DURANTE la caída
const HIT_TWIN = randomUUID();     // mismo (módulo, boot, secuencia) que HIT_PRE

const open = [];
async function mod(id, opts) {
  const c = await connectModule(id, opts);
  open.push(c);
  return c;
}

before(async () => {
  // El stack tiene que estar realmente en pie ANTES de medir nada: si el
  // backend no ha conectado con el broker, un LWT que no se ingiere parecería
  // un defecto del dominio cuando sólo sería una prueba mal arrancada.
  const ready = await waitFor(
    'backend listo (base de datos + broker)',
    async () => {
      const m = await ingestMetrics();
      return m._database === true && m._mqtt === true ? m : false;
    },
    { timeoutMs: 120_000 },
  );
  console.log(`[setup] backend listo · métricas iniciales: ${JSON.stringify(ready)}`);

  // Los tres módulos tienen que estar dados de alta o la presencia no se
  // persiste (ResilienceService.record). Se comprueba, no se supone.
  for (const slug of [M03, M04, M05]) {
    assert.ok(await moduleRow(slug), `El módulo ${slug} no está dado de alta: seed.sql no se aplicó`);
  }
});

after(async () => {
  for (const c of open) {
    try {
      c.end(true);
    } catch {
      /* el cierre de un cliente ya muerto no es un fallo de la prueba */
    }
  }
  await closeDb();
});

// ---------------------------------------------------------------------------
// O-0 · La idempotencia vive en la base de datos (ADR-0003). Se comprueba que
// los índices únicos existen ANTES de medir nada: si alguien los quita, el
// resto de este fichero mide otra cosa. En modo calibración se exige lo
// contrario, para que la calibración no pueda pasar por descuido.
// ---------------------------------------------------------------------------
test('O-0 · los índices únicos de hit_events son los que sostienen la idempotencia', async () => {
  const idx = await uniqueIndexes('hit_events');
  console.log(`[O-0] índices únicos vivos: ${JSON.stringify(idx)}`);
  assert.ok(idx.includes('hit_events_event_id_key'), 'Falta hit_events_event_id_key');
  assert.ok(
    idx.includes('hit_events_module_slug_device_boot_id_local_sequence_key'),
    'Falta hit_events_module_slug_device_boot_id_local_sequence_key',
  );
});

// ---------------------------------------------------------------------------
// O-1 · CONTROL POSITIVO. El camino feliz produce efecto.
// ---------------------------------------------------------------------------
test('O-1 · control positivo: módulo online e impacto que SÍ produce efecto', async () => {
  const before = await ingestMetrics();

  const m03 = await mod(M03, { keepalive: 3 });
  await publish(
    m03,
    T.presence(M03),
    presence(M03, { boot_id: boot03, firmware_version: '0.1.0', ip: '192.168.1.61' }),
    { qos: 1, retain: true },
  );

  const online = await waitFor(`${M03} en línea en la base de datos`, async () => {
    const row = await moduleRow(M03);
    return row?.online === true ? row : false;
  });
  assert.equal(online.online, true);
  assert.equal(online.boot_id, boot03, 'El boot_id del CONNECT no se persistió');
  assert.ok(online.last_seen_at, 'last_seen_at sigue vacío tras la presencia');
  assert.equal(online.offline_since, null, 'offline_since debería estar limpio estando en línea');

  // El impacto: efecto = UNA fila nueva. Si esto no ocurre, ninguna aserción de
  // «no pasa nada» del resto del fichero valdría nada.
  await publish(m03, T.hit(M03), hit(M03, { eventId: HIT_PRE, bootId: boot03, localSequence: 100 }));

  await waitFor('la fila del impacto previo', async () => (await countHits(HIT_PRE)) === 1);
  assert.equal(await countHits(HIT_PRE), 1);

  const after = await ingestMetrics();
  assert.ok(
    after.accepted > before.accepted,
    `El contador accepted no subió (${before.accepted} → ${after.accepted}): la ingesta no está viva`,
  );
  console.log(`[O-1] accepted ${before.accepted} → ${after.accepted}`);
});

// ---------------------------------------------------------------------------
// O-2 · Last Will REAL. Se mata el socket sin DISCONNECT y se comprueba, por
// separado, que (a) el BROKER publica el LWT y (b) el BACKEND lo ingiere.
// Comprobar sólo (b) no distinguiría un LWT bien registrado de un backend que
// se inventa la caída por otro camino.
// ---------------------------------------------------------------------------
test('O-2 · el broker publica el Last Will y el backend refleja la caída', async () => {
  const watcher = await connectObserver('e2e-lwt-watcher');
  open.push(watcher);
  const seen = await collect(watcher, T.presence(M03));
  // Descarta el retenido de «online» que el broker entrega al suscribirse: lo
  // que se mide es el mensaje NUEVO que publica el broker al morir la sesión.
  await sleep(500);
  const baseline = seen.length;

  const m03 = open.find((c) => c.options.clientId === M03);
  killUngracefully(m03);

  const lwt = await waitFor(
    'el LWT publicado por el broker',
    () => seen.slice(baseline).find((m) => m.payload?.reason === 'lwt') ?? false,
    { timeoutMs: 30_000 },
  );
  console.log(`[O-2] LWT recibido: ${JSON.stringify(lwt)}`);

  // Contrato §3, literal.
  assert.equal(lwt.payload.online, false);
  assert.equal(lwt.payload.reason, 'lwt');
  assert.equal(lwt.payload.module_id, M03);
  assert.equal(lwt.payload.schema_version, 1);
  assert.equal(lwt.qos, 1, 'El LWT debe llegar con QoS 1');

  // (b) el backend lo INGIERE: efecto en la base de datos.
  const down = await waitFor(`${M03} dado por caído`, async () => {
    const row = await moduleRow(M03);
    return row?.online === false ? row : false;
  });
  assert.ok(down.offline_since, 'offline_since no se fijó en la transición a offline');
  assert.equal(
    new Date(down.last_seen_at) <= new Date(down.offline_since),
    true,
    'last_seen_at no puede avanzar con la caída (defecto D6)',
  );

  const found = await waitFor('la incidencia module_offline', async () => {
    const rows = await incidents('module_offline', M03);
    return rows.length > 0 ? rows : false;
  });
  console.log(`[O-2] incidencia: ${found[0].kind}/${found[0].severity}`);
});

// ---------------------------------------------------------------------------
// O-3 · Presencia RETENIDA: quien llega tarde lee la última fotografía.
// ---------------------------------------------------------------------------
test('O-3 · un suscriptor posterior recibe la presencia retenida (online=false)', async () => {
  const late = await connectObserver('e2e-late-subscriber');
  open.push(late);
  const seen = await collect(late, T.presence(M03));

  const snapshot = await waitFor(
    'la fotografía retenida de presencia',
    () => seen[0] ?? false,
    { timeoutMs: 15_000 },
  );
  console.log(`[O-3] retenido: ${JSON.stringify(snapshot)}`);
  assert.equal(snapshot.retain, true, 'El mensaje no llegó marcado como retenido');
  assert.equal(snapshot.payload.online, false);
  assert.equal(snapshot.payload.reason, 'lwt');
});

// ---------------------------------------------------------------------------
// O-4 · Caída por SILENCIO, sin ningún LWT. El testigo vivo es imprescindible:
// si callan TODOS a la vez el dominio lo trata como apagón del camino común y
// no declara a nadie (isBlackout), de modo que sin testigo esta prueba mediría
// justo lo contrario de lo que dice medir.
// ---------------------------------------------------------------------------
test(
  'O-4 · el barrido declara caído al módulo callado (stale) con un testigo vivo',
  { timeout: 300_000 },
  async () => {
    const m04 = await mod(M04, { withWill: false });
    const m05 = await mod(M05, { withWill: false });

    await publish(m04, T.presence(M04), presence(M04, { boot_id: boot04 }), { qos: 1, retain: true });
    await publish(m05, T.presence(M05), presence(M05, { boot_id: boot05 }), { qos: 1, retain: true });
    await waitFor('ambos módulos en línea', async () =>
      (await moduleRow(M04))?.online === true && (await moduleRow(M05))?.online === true);

    // M05 se calla para siempre. M04 sigue vivo con TELEMETRÍA: es el único
    // tráfico que el dominio acepta como señal de vida (el `status` es retenido
    // y no resucita a nadie, D6).
    const heartbeat = setInterval(() => {
      publish(m04, T.telemetry(M04), telemetry(M04, boot04), { qos: 0 }).catch(() => undefined);
    }, 5_000);

    try {
      // STALE_AFTER_MS = 90 s y el barrido además exige llevar ese mismo plazo
      // OYENDO al broker (si no, el silencio es sordera propia). Se espera de
      // verdad: acortar la constante desde el entorno sería falsear la medida.
      const stale = await waitFor(
        `${M05} declarado caído por silencio`,
        async () => {
          const row = await moduleRow(M05);
          return row?.online === false ? row : false;
        },
        { timeoutMs: 240_000, everyMs: 2_000 },
      );
      assert.ok(stale.offline_since, 'offline_since no se fijó al declarar la caída por silencio');

      const rows = await waitFor('la incidencia module_stale', async () => {
        const found = await incidents('module_stale', M05);
        return found.length > 0 ? found : false;
      });
      console.log(`[O-4] ${rows[0].kind}: ${rows[0].message.slice(0, 120)}`);

      // El testigo NO puede haber caído: si cayó, lo que se midió fue un apagón.
      const witness = await moduleRow(M04);
      assert.equal(witness.online, true, 'El testigo vivo también se declaró caído: se midió un apagón, no un stale');
    } finally {
      clearInterval(heartbeat);
    }
  },
);

// ---------------------------------------------------------------------------
// O-5 · LA PROPIEDAD CENTRAL: la recuperación no duplica efecto.
//
// El módulo vuelve, republica presencia y reinyecta su cola local. Se mide con
// CONTADORES y con FILAS, nunca con el retorno de la publicación:
//   · HIT_PRE reenviado 3 veces  → sigue habiendo 1 fila, y `duplicates` sube 3.
//   · HIT_TWIN (event_id nuevo, mismo módulo+boot+secuencia) → sigue habiendo 1
//     fila para esa terna: el segundo camino de deduplicación del contrato §5.
//   · HIT_QUEUED (evento real ocurrido durante la caída) → SÍ entra. Sin esto,
//     un backend que descartara todo pasaría la prueba.
// ---------------------------------------------------------------------------
test('O-5 · al reconectar, la cola reinyectada NO duplica efecto', async () => {
  const before = await ingestMetrics();
  const hitsBefore = await countHitsByModule(M03);

  const m03 = await mod(M03, { keepalive: 60 });
  await publish(
    m03,
    T.presence(M03),
    presence(M03, { boot_id: boot03, firmware_version: '0.1.0', ip: '192.168.1.61' }),
    { qos: 1, retain: true },
  );
  const back = await waitFor(`${M03} de vuelta en línea`, async () => {
    const row = await moduleRow(M03);
    return row?.online === true ? row : false;
  });
  assert.equal(back.offline_since, null, 'offline_since debe limpiarse al volver en línea');

  // Reinyección de la cola: el MISMO evento, tres veces, marcado replay.
  const replayed = hit(M03, { eventId: HIT_PRE, bootId: boot03, localSequence: 100, replay: true });
  for (let i = 0; i < 3; i += 1) await publish(m03, T.hit(M03), replayed);

  // Mismo (módulo, boot, secuencia) con event_id distinto: el firmware que
  // regenera identificadores al reconectar no puede colar el impacto dos veces.
  await publish(
    m03,
    T.hit(M03),
    hit(M03, { eventId: HIT_TWIN, bootId: boot03, localSequence: 100, replay: true }),
  );

  // Evento NUEVO de la ventana de caída: este sí debe entrar.
  await publish(
    m03,
    T.hit(M03),
    hit(M03, { eventId: HIT_QUEUED, bootId: boot03, localSequence: 101, replay: true, targetIndex: 5 }),
  );

  await waitFor('el impacto nuevo persistido', async () => (await countHits(HIT_QUEUED)) === 1);
  // Margen para que los cuatro reenvíos hayan sido procesados por completo:
  // afirmar «no duplicó» antes de que el backend los haya visto sería un verde
  // por llegar pronto, no por deduplicar.
  await waitFor(
    'los 4 reenvíos procesados',
    async () => {
      const m = await ingestMetrics();
      return m.received - before.received >= 5 ? m : false;
    },
    { timeoutMs: 30_000 },
  );
  await sleep(1_000);

  const after = await ingestMetrics();
  const rowsPre = await countHits(HIT_PRE);
  const rowsTwin = await countHits(HIT_TWIN);
  const rowsQueued = await countHits(HIT_QUEUED);
  const total = await countHitsByModule(M03);
  console.log(
    `[O-5] filas: HIT_PRE=${rowsPre} HIT_TWIN=${rowsTwin} HIT_QUEUED=${rowsQueued} total=${total} ` +
      `· duplicates ${before.duplicates}→${after.duplicates} · accepted ${before.accepted}→${after.accepted}`,
  );

  assert.equal(rowsPre, 1, `El reenvío duplicó el impacto: ${rowsPre} filas para el mismo event_id`);
  assert.equal(rowsTwin, 0, 'El segundo camino de deduplicación (módulo+boot+secuencia) no actuó');
  assert.equal(rowsQueued, 1, 'El impacto NUEVO de la ventana de caída no se persistió');
  assert.equal(
    total - hitsBefore,
    1,
    `La recuperación añadió ${total - hitsBefore} filas; sólo el evento nuevo debía añadirse`,
  );
  assert.equal(
    after.duplicates - before.duplicates,
    4,
    'Los 4 reenvíos deben contarse como duplicados (ADR-0003: métrica, no error)',
  );
  // Se cuenta por CLASE de tópico, no `accepted` a secas: la telemetría del
  // testigo de O-4 podría llegar tarde y contaminar un total global.
  const hitsSeen =
    (after.byTopicKind['module-hit'] ?? 0) - (before.byTopicKind['module-hit'] ?? 0);
  assert.equal(hitsSeen, 5, 'Debían llegar exactamente 5 impactos (3 reenvíos + gemelo + nuevo)');
  assert.equal(
    after.accepted - before.accepted >= 2,
    true,
    'Debían aceptarse al menos la presencia y el impacto nuevo',
  );
  assert.equal(after.rejected, before.rejected, 'Ningún mensaje del escenario debía rechazarse');
});
