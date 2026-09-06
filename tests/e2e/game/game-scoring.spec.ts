/**
 * ============================================================================
 * Diana · E2E-1 GAME — crear partida → iniciar → hit por MQTT → puntuación
 * ============================================================================
 * Un escenario REAL, no un `test.fixme`. Contra PostgreSQL real, Mosquitto
 * real (TLS + autenticación + la ACL REAL del repositorio) y el backend real
 * corriendo desde su propia imagen con `NODE_ENV=production`.
 *
 * El `hit` entra por donde entraría el de un módulo de verdad: publicado en
 * `targets/v1/module/module-01/hit` por un cliente MQTT autenticado como
 * `module-01` (el usuario MQTT de un módulo es exactamente su `module_id`),
 * validado contra el esquema congelado del contrato.
 *
 * MEDIDO POR EFECTO, nunca por el log:
 *   - la fila de `hit_events` se lee con `psql` contra la base de datos;
 *   - la puntuación se lee de `GET /api/scoreboard/games/:id`.
 * Cada aserción puede ponerse roja (ver README.md §Calibración).
 *
 * Levantar el escenario antes:  ./harness/up.sh
 * Derribarlo después:           ./harness/down.sh
 * ============================================================================
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import mqtt from "mqtt";

// --------------------------------------------------------------- contrato
interface Env {
  apiBaseUrl: string;
  mqttUrl: string;
  mqttCaFile: string;
  adminUsername: string;
  adminPassword: string;
  modules: Record<string, string>;
  postgres: { container: string; user: string; database: string };
  containers: { postgres: string; mosquitto: string; backend: string };
}

const ENV_FILE = path.join(__dirname, ".tmp", "env.json");

function loadEnv(): Env {
  try {
    return JSON.parse(readFileSync(ENV_FILE, "utf8")) as Env;
  } catch {
    throw new Error(
      `No existe ${ENV_FILE}. El escenario no está levantado: ejecuta ` +
        `tests/e2e/game/harness/up.sh antes de esta prueba. ` +
        `Saltarla en silencio sería un aprobado falso.`,
    );
  }
}

const env = loadEnv();

/** Consulta directa a la base de datos: el efecto, no el log. */
function sql(query: string): string {
  return execFileSync(
    "docker",
    ["exec", env.postgres.container, "psql", "-U", env.postgres.user, "-d", env.postgres.database, "-tAc", query],
    { encoding: "utf8" },
  ).trim();
}

// ------------------------------------------------------- cliente MQTT módulo
/**
 * Publica un mensaje como lo haría un módulo: TLS validando la CA, usuario =
 * module_id, QoS 1, y se ESPERA el PUBACK.
 *
 * OJO (medido en este proyecto): una denegación de ACL NO da error aquí — el
 * broker acepta la conexión y descarta el PUBLISH en silencio (con MQTT 3.1.1
 * ni siquiera hay reasonCode). Por eso el resultado de publicar NUNCA se usa
 * como prueba de nada: lo que se comprueba después es la fila en la base.
 */
async function publishAsModule(moduleId: string, payload: unknown): Promise<void> {
  const password = env.modules[moduleId];
  if (!password) throw new Error(`Sin credencial MQTT para ${moduleId}`);

  const client = await mqtt.connectAsync(env.mqttUrl, {
    username: moduleId,
    password,
    clientId: moduleId,
    protocolVersion: 4,
    ca: [readFileSync(env.mqttCaFile)],
    rejectUnauthorized: true,
    servername: "localhost",
    connectTimeout: 10_000,
    reconnectPeriod: 0,
  });
  try {
    await client.publishAsync(`targets/v1/module/${moduleId}/hit`, JSON.stringify(payload), {
      qos: 1,
    });
  } finally {
    await client.endAsync();
  }
}

// ------------------------------------------------------------ payload de hit
let sequence = 1000;
const BOOT_ID = randomUUID();

interface HitOptions {
  moduleId: string;
  gameId?: string;
  roundId?: string;
  targetIndex?: number;
  classification?: string;
  classificationReason?: string;
  eventId?: string;
}

/** Construye un `hit-event` conforme al esquema congelado v1. */
function hitPayload(o: HitOptions): Record<string, unknown> {
  sequence += 1;
  const us = 1_800_000_000 + sequence * 1000;
  // OJO: NO se envía `_schema`. Los ficheros de contracts/examples/valid/ lo
  // llevan, pero `hit-event.schema.json` declara `additionalProperties: false`
  // y NO lo lista entre sus propiedades: el `ContractValidator` del backend
  // rechaza con `schema_violation` cualquier mensaje que lo incluya (MEDIDO
  // aquí, no deducido). Es una anotación de los ejemplos que despoja
  // `contracts/validate.py`, no un campo del contrato en el cable.
  const payload: Record<string, unknown> = {
    schema_version: 1,
    event_id: o.eventId ?? randomUUID(),
    system_id: "e2e-panel-a",
    module_id: o.moduleId,
    target_index: o.targetIndex ?? 1,
    local_sequence: sequence,
    device: { boot_id: BOOT_ID, uptime_us: us + 500, event_us: us },
    coordinator: {
      recv_us: us + 2000,
      elapsed_us: 1_000_000 + sequence,
      clock_offset_us: -120,
      offset_uncertainty_us: 40,
    },
    amplitude: 2600,
    threshold: 900,
    noise_floor: 130,
    target_state_before: "active",
    classification: o.classification ?? "valid_hit",
    firmware_version: "0.1.0",
    replay: false,
  };
  if (o.gameId) payload.game_id = o.gameId;
  if (o.roundId) payload.round_id = o.roundId;
  if (o.classificationReason) payload.classification_reason = o.classificationReason;
  return payload;
}

// --------------------------------------------------------------- utilidades
async function login(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${env.apiBaseUrl}/api/auth/login`, {
    data: { username: env.adminUsername, password: env.adminPassword },
  });
  expect(res.status(), await res.text()).toBe(200);
  const body = (await res.json()) as { access_token?: string };
  expect(body.access_token, "el login debe devolver un JWT").toBeTruthy();
  return body.access_token as string;
}

/**
 * Forma real de `GET /api/scoreboard/games/:id`
 * (server/backend/src/modules/scoreboard/scoreboard.service.ts): la
 * clasificación viaja en `ranking`, no en `entries`.
 */
interface Scoreboard {
  ranking: Array<{
    participantId: string;
    validHits: number | null;
    invalidHits: number | null;
  }>;
  warnings: string[];
  totals: { detected: number; valid: number; invalid: number; unattributed: number; inferred: number };
}

// ============================================================================
test.describe("E2E-1 · GAME · partida, impacto y puntuación", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });

  let auth: Record<string, string>;
  let panelA: string;
  let panelB: string;
  let gameId: string;
  let roundId: string;
  let p1: string;
  let p2: string;

  const validEventId = randomUUID();

  test("preparación: sesión y paneles reales del despliegue", async ({ request }) => {
    auth = { Authorization: `Bearer ${await login(request)}` };

    const res = await request.get(`${env.apiBaseUrl}/api/topology/panels`, { headers: auth });
    expect(res.status(), await res.text()).toBe(200);
    const raw = (await res.json()) as unknown;
    const panels = (Array.isArray(raw) ? raw : ((raw as { items?: unknown[] }).items ?? [])) as Array<{
      id: string;
      slug: string;
    }>;
    const a = panels.find((p) => p.slug === "e2e-panel-a");
    const b = panels.find((p) => p.slug === "e2e-panel-b");
    expect(a, "falta el panel e2e-panel-a: ¿se sembró la topología?").toBeTruthy();
    expect(b, "falta el panel e2e-panel-b").toBeTruthy();
    panelA = a!.id;
    panelB = b!.id;

    // Deja el panel libre antes de empezar. No es maquillaje: el guardarraíl
    // G-H («un juego activo por panel», games.service.ts) hace fallar el
    // `start` si quedó una partida activa de una ejecución anterior sobre la
    // misma pila. Se cierra con la ORDEN REAL del producto (`abort_game`), no
    // borrando filas por detrás.
    const list = await request.get(`${env.apiBaseUrl}/api/games`, { headers: auth });
    const games = ((await list.json()) as { items: Array<{ id: string; status: string }> }).items;
    for (const g of games.filter((x) => ["armed", "running", "paused"].includes(x.status))) {
      const res = await request.post(`${env.apiBaseUrl}/api/games/${g.id}/control/abort_game`, {
        headers: auth,
      });
      expect(res.ok(), `no se pudo liberar el panel abortando ${g.id}`).toBeTruthy();
    }
    expect(
      sql(`select count(*) from games where status in ('armed','running','paused')`),
      "el panel debe quedar libre antes de empezar",
    ).toBe("0");
  });

  test("crear partida con dos participantes, uno por panel", async ({ request }) => {
    const created = await request.post(`${env.apiBaseUrl}/api/games`, {
      headers: auth,
      data: {
        target_system_id: panelA,
        mode: "all_against_clock",
        name: "E2E-1 GAME",
        seed: 7,
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    gameId = ((await created.json()) as { id: string }).id;

    // La partida existe en la BASE, no sólo en la respuesta.
    expect(sql(`select count(*) from games where id = '${gameId}'`)).toBe("1");

    // DOS participantes, a propósito: con uno solo el marcador ADJUDICA los
    // impactos sin dueño al único jugador («inferred», domain/scoreboard),
    // y el control negativo de atribución no podría distinguirse.
    for (const [name, panel] of [
      ["Jugador Uno", panelA],
      ["Jugador Dos", panelB],
    ] as const) {
      const res = await request.post(`${env.apiBaseUrl}/api/participants`, {
        headers: auth,
        data: { game_id: gameId, guest_name: name },
      });
      expect(res.status(), await res.text()).toBe(201);
      const id = ((await res.json()) as { id: string }).id;
      const panelRes = await request.patch(`${env.apiBaseUrl}/api/participants/${id}/panel`, {
        headers: auth,
        data: { target_system_id: panel },
      });
      expect(panelRes.status(), await panelRes.text()).toBe(200);
      if (name === "Jugador Uno") p1 = id;
      else p2 = id;
    }

    expect(sql(`select count(*) from participants where game_id = '${gameId}'`)).toBe("2");
    expect(
      sql(`select target_system_id from participants where id = '${p1}'`),
      "el jugador 1 debe quedar asignado al panel A: es lo que permite atribuir su impacto",
    ).toBe(panelA);
  });

  test("añadir la ronda y su plan determinista", async ({ request }) => {
    const res = await request.post(`${env.apiBaseUrl}/api/games/${gameId}/rounds`, {
      headers: auth,
      data: {
        targets: [
          { module_id: "module-01", target_index: 1 },
          { module_id: "module-01", target_index: 2 },
        ],
        countdown_ms: 0,
        time_limit_ms: 600_000,
        penalty_ms: 0,
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    roundId = ((await res.json()) as { id: string }).id;

    // El plan se calculó de verdad y quedó guardado: un plan nulo haría que
    // `start` fallase, y entonces esta prueba no mediría el camino real.
    expect(sql(`select plan is not null from rounds where id = '${roundId}'`)).toBe("t");
  });

  test("iniciar la ronda: la orden llega al broker y la partida queda corriendo", async ({
    request,
  }) => {
    const res = await request.post(
      `${env.apiBaseUrl}/api/games/${gameId}/rounds/${roundId}/start`,
      { headers: auth },
    );
    expect(res.status(), await res.text()).toBe(201);
    const body = (await res.json()) as { delivered?: boolean; denied?: boolean; note?: string };

    // EFECTO 1 · el broker confirmó el PUBACK de `start_game`. Si el backend no
    // estuviese conectado por TLS, o la ACL le negase `system/#`, esto sería
    // false/true respectivamente y la prueba se pondría roja.
    expect(body.denied, `el broker DENEGÓ la orden: ${body.note}`).toBeFalsy();
    expect(body.delivered, `la orden no llegó al broker: ${body.note}`).toBe(true);

    // EFECTO 2 · el estado quedó escrito en la base, no sólo en la respuesta.
    expect(sql(`select status from games where id = '${gameId}'`)).toBe("running");
    expect(sql(`select phase from rounds where id = '${roundId}'`)).toBe("countdown");
  });

  test("puntuación de partida: cero antes del primer impacto", async ({ request }) => {
    const res = await request.get(`${env.apiBaseUrl}/api/scoreboard/games/${gameId}`, {
      headers: auth,
    });
    expect(res.status(), await res.text()).toBe(200);
    const board = (await res.json()) as Scoreboard;
    const uno = board.ranking.find((e) => e.participantId === p1);
    expect(uno, "el jugador 1 debe aparecer en el marcador").toBeTruthy();
    expect(uno!.validHits, "sin impactos, la puntuación de partida es 0").toBe(0);
  });

  test("CAMINO FELIZ · un hit de module-01 puntúa para su jugador", async ({ request }) => {
    await publishAsModule(
      "module-01",
      hitPayload({ moduleId: "module-01", gameId, roundId, eventId: validEventId }),
    );

    // EFECTO en la BASE DE DATOS: la fila existe, cuenta y está atribuida.
    await expect
      .poll(() => sql(`select count(*) from hit_events where event_id = '${validEventId}'`), {
        timeout: 20_000,
        message:
          "el impacto publicado por MQTT no llegó a hit_events: o la ACL lo denegó " +
          "(el broker lo descarta en silencio, rc=0), o el backend no lo ingirió",
      })
      .toBe("1");

    const row = sql(
      `select counts_for_score || '|' || coalesce(participant_id::text,'NULL') || '|' ` +
        `|| coalesce(round_id::text,'NULL') from hit_events where event_id = '${validEventId}'`,
    );
    expect(row, "el impacto debe contar y estar atribuido al jugador 1 de la ronda").toBe(
      `true|${p1}|${roundId}`,
    );

    // EFECTO en la API: la puntuación se mueve.
    await expect
      .poll(
        async () => {
          const res = await request.get(`${env.apiBaseUrl}/api/scoreboard/games/${gameId}`, {
            headers: auth,
          });
          const board = (await res.json()) as Scoreboard;
          return board.ranking.find((e) => e.participantId === p1)?.validHits ?? null;
        },
        { timeout: 20_000, message: "la puntuación del jugador 1 no subió tras un hit válido" },
      )
      .toBe(1);
  });

  test("CONTROL NEGATIVO A · un hit de un módulo que no es de nadie NO puntúa", async ({
    request,
  }) => {
    // module-09 está en e2e-panel-c, donde no juega ningún participante.
    // Regla real: server/backend/src/domain/hits/attribution.ts — «Ningún
    // participante está asignado al panel de ese módulo» ⇒ sin atribuir.
    const eventId = randomUUID();
    await publishAsModule(
      "module-09",
      hitPayload({ moduleId: "module-09", gameId, roundId, eventId, targetIndex: 3 }),
    );

    await expect
      .poll(() => sql(`select count(*) from hit_events where event_id = '${eventId}'`), {
        timeout: 20_000,
        message:
          "el impacto de control ni siquiera se ingirió; sin él, el control negativo " +
          "no demuestra nada (un verde por ausencia no es un verde)",
      })
      .toBe("1");

    // El impacto EXISTE y hasta cuenta como válido en sí mismo…
    expect(sql(`select counts_for_score from hit_events where event_id = '${eventId}'`)).toBe("t");
    // …pero NO tiene dueño, y por eso no puede sumar a nadie.
    expect(
      sql(`select coalesce(participant_id::text,'NULL') from hit_events where event_id = '${eventId}'`),
    ).toBe("NULL");

    const res = await request.get(`${env.apiBaseUrl}/api/scoreboard/games/${gameId}`, {
      headers: auth,
    });
    const board = (await res.json()) as Scoreboard;
    expect(
      board.ranking.find((e) => e.participantId === p1)?.validHits,
      "la puntuación del jugador 1 NO puede moverse por un impacto que no es suyo",
    ).toBe(1);
    expect(
      board.ranking.find((e) => e.participantId === p2)?.validHits,
      // NO es 0, y está bien que no lo sea: mientras haya impactos sin
      // atribuir, el jugador que no tiene ninguno propio se declara DESCONOCIDO
      // (`unknown` en domain/scoreboard/scoreboard.ts) en vez de cero. El
      // producto se niega a afirmar un cero que no ha medido. Lo que este
      // control exige es que NO haya subido a 1, y eso es lo que se comprueba:
      // el impacto huérfano no se le adjudica a nadie.
      "el jugador 2 no puede haber puntuado con un impacto que no es suyo",
    ).toBeNull();
    // Y el marcador lo DICE, en vez de repartirlo a ojo.
    expect(
      (board.warnings ?? []).join(" "),
      "el marcador debe avisar de que hay impactos sin atribuir",
    ).toContain("no están atribuidos");
    expect(
      board.totals.unattributed,
      "y contarlos: exactamente uno sin dueño, el de module-09",
    ).toBe(1);
    expect(
      board.totals.inferred,
      "y NO adjudicárselo a nadie por deducción: con dos jugadores no hay deducción forzosa",
    ).toBe(0);
  });

  test("CONTROL NEGATIVO B · un hit que el módulo no clasifica como válido NO puntúa", async ({
    request,
  }) => {
    // Regla real: server/backend/src/domain/hits/hit-record.ts
    //   countsForScore(c) === (c === 'valid_hit')
    const eventId = randomUUID();
    await publishAsModule(
      "module-01",
      hitPayload({
        moduleId: "module-01",
        gameId,
        roundId,
        eventId,
        targetIndex: 2,
        classification: "hit_on_safe",
        classificationReason: "Impacto en diana segura (control negativo E2E)",
      }),
    );

    await expect
      .poll(() => sql(`select count(*) from hit_events where event_id = '${eventId}'`), {
        timeout: 20_000,
        message: "el impacto de control no se ingirió",
      })
      .toBe("1");

    expect(
      sql(
        `select counts_for_score || '|' || coalesce(participant_id::text,'NULL') ` +
          `from hit_events where event_id = '${eventId}'`,
      ),
      "está atribuido al jugador 1, pero no cuenta: 'hit_on_safe' no es 'valid_hit'",
    ).toBe(`false|${p1}`);

    const res = await request.get(`${env.apiBaseUrl}/api/scoreboard/games/${gameId}`, {
      headers: auth,
    });
    const board = (await res.json()) as Scoreboard;
    const uno = board.ranking.find((e) => e.participantId === p1);
    expect(uno!.validHits, "la puntuación válida NO se mueve").toBe(1);
    expect(uno!.invalidHits, "pero el impacto sí se contabiliza como inválido").toBe(1);
  });

  test("estado final: la partida sigue corriendo y el marcador es coherente", async ({
    request,
  }) => {
    const res = await request.get(`${env.apiBaseUrl}/api/games/${gameId}`, { headers: auth });
    expect(res.status()).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("running");

    // Tres impactos ingeridos en la ronda; uno solo puntúa.
    expect(sql(`select count(*) from hit_events where round_id = '${roundId}'`)).toBe("3");
    expect(
      sql(`select count(*) from hit_events where round_id = '${roundId}' and counts_for_score`),
    ).toBe("2");
    expect(
      sql(
        `select count(*) from hit_events where round_id = '${roundId}' ` +
          `and counts_for_score and participant_id is not null`,
      ),
      "de los que cuentan, sólo uno tiene dueño: es el único que puntúa a alguien",
    ).toBe("1");
  });
});
