#!/usr/bin/env node
/**
 * ============================================================================
 * Diana · H2I — generador de artefactos desde la FUENTE ÚNICA de identidades
 * ============================================================================
 * Lee `identities.json` (o el que se pase con --source) y genera, de forma
 * determinista, los CINCO artefactos que antes se mantenían a mano:
 *
 *   1. ACL de Mosquitto            → <out>/acl            (reglas `user <username>`)
 *   2. lista de usuarios a crear   → <out>/users.generated.txt
 *   3. config/credenciales módulo  → <out>/modules.generated.json
 *   4. plantilla de entorno        → <out>/identities.generated.env.example
 *   5. fixtures del simulador      → simulators/test/fixtures/identities.generated.json
 *
 * NINGUNO lleva contraseñas: las contraseñas las genera generate-users.sh con
 * mosquitto_passwd y nunca entran en git.
 *
 * Uso:
 *   node generate-identities.mjs            # escribe los artefactos
 *   node generate-identities.mjs --check    # NO escribe; sale 1 si hay drift
 *   node generate-identities.mjs --source X --out Y --sim-out Z
 *   node generate-identities.mjs --list-users     # sólo los usuarios, uno por línea
 *   node generate-identities.mjs --module-id-of <username>
 *   node generate-identities.mjs --username-of <module_id>
 *
 * MP0-A: la ACL generada NO contiene ni `%c` ni `%u`. Cada regla nombra al
 * usuario autenticado y lleva el module_id LITERAL en el tópico, así que la
 * autorización se apoya en la identidad autenticada y no en el `client_id`
 * que el cliente declara.
 *
 * F-02 (CERRADO, no se reabre): además de lo anterior, esta rama CONSERVA la
 * invariante con la que se cerró el hallazgo — usuario == module_id — y
 * `use_username_as_clientid true` en mosquitto.conf. `identity_equals_module_id`
 * en la fuente hace que el generador ABORTE si alguien introduce un par
 * username/module_id distinto. Divergencia deliberada respecto de la rama
 * `ola/h2i`, que desacopla username (module-01) de module_id (m01): ese
 * desacoplo exige cambiar tests/fixtures/topology.json, simulators/src,
 * contracts y firmware, que NO son propiedad de este carril. Ver
 * docs/security/evidence/identity-generator.md.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const has = (name) => args.includes(name);

const SOURCE = resolve(flag('--source', resolve(HERE, 'identities.json')));
const OUT_DIR = resolve(flag('--out', HERE));
const SIM_OUT = resolve(
  flag('--sim-out', resolve(REPO, 'simulators/test/fixtures/identities.generated.json')),
);

const ID_RE = /^[a-z0-9][a-z0-9-]{2,62}$/; // contracts/mqtt/README.md sección 1

// ---------------------------------------------------------------------------
// Carga y validación de la fuente. Un error aquí es preferible a generar una
// ACL silenciosamente incoherente.
// ---------------------------------------------------------------------------
export function loadSource(path = SOURCE) {
  const src = JSON.parse(readFileSync(path, 'utf-8'));
  const errors = [];
  const root = src.topic_root;
  if (typeof root !== 'string' || !root) errors.push('topic_root ausente');

  const reserved = new Set(src.reserved_module_ids ?? []);
  const users = new Set();
  const moduleIds = new Set();

  const svc = src.service_identities ?? {};
  for (const [k, v] of Object.entries(svc)) {
    if (!v?.username) errors.push(`service_identities.${k}: falta username`);
    else if (users.has(v.username)) errors.push(`usuario duplicado: ${v.username}`);
    else users.add(v.username);
  }

  for (const m of src.modules ?? []) {
    if (!m.username) errors.push('módulo sin username');
    if (!m.module_id) errors.push(`módulo ${m.username}: sin module_id`);
    if (m.module_id && !ID_RE.test(m.module_id)) {
      errors.push(`module_id '${m.module_id}' no cumple ${ID_RE} (contrato sección 1)`);
    }
    if (m.username && !ID_RE.test(m.username)) {
      errors.push(`username '${m.username}' no cumple ${ID_RE}`);
    }
    if (reserved.has(m.module_id)) errors.push(`module_id reservado: ${m.module_id}`);
    if (reserved.has(m.username) ) errors.push(`username reservado: ${m.username}`);
    if (users.has(m.username)) errors.push(`usuario duplicado: ${m.username}`);
    users.add(m.username);
    if (moduleIds.has(m.module_id)) errors.push(`module_id duplicado: ${m.module_id}`);
    moduleIds.add(m.module_id);
    // F-02: en esta rama la invariante de cierre es usuario == module_id.
    if (src.identity_equals_module_id === true && m.username !== m.module_id) {
      errors.push(
        `F-02: username '${m.username}' != module_id '${m.module_id}' con ` +
          'identity_equals_module_id=true (la ACL, el passwd y use_username_as_clientid ' +
          'dejarían de estar alineados)',
      );
    }
  }

  if (errors.length) {
    throw new Error(`identities.json inválido:\n  - ${errors.join('\n  - ')}`);
  }
  return src;
}

// ---------------------------------------------------------------------------
// Tópicos por identidad. Copia literal de contracts/mqtt/README.md sección 8,
// tópico a tópico (nunca un comodín sobre module/<id>/#: eso permitiría a un
// módulo comprometido escribirse su propio config/desired o su ota).
// ---------------------------------------------------------------------------
export function moduleTopics(root, moduleId) {
  const base = `${root}/module/${moduleId}`;
  return {
    write: [
      `${base}/presence`,
      `${base}/status`,
      `${base}/telemetry`,
      `${base}/hit`,
      `${base}/diagnostic`,
      `${base}/config/reported`,
      // v1.2 (ADR-0008) · plano de provisioning: el módulo publica SU estado
      // reportado y NADA más. `provision/state` es un subtópico de `provision`,
      // así que la regla de escritura tiene que ser el tópico completo: un
      // `provision/#` dejaría al módulo escribirse su propia orden.
      `${base}/provision/state`,
    ],
    read: [
      `${base}/command`,
      // v1.2 (ADR-0008) · la orden de aprovisionamiento la emite el backend;
      // el módulo SÓLO la lee, y sólo la suya (module_id literal).
      `${base}/provision`,
      `${base}/maintenance/command`,
      `${base}/config/desired`,
      `${base}/ota`,
      `${root}/system/+/game/state`,
    ],
  };
}

export function backendTopics(root) {
  return {
    read: ['#'],
    write: [
      `${root}/system/#`,
      `${root}/module/+/config/desired`,
      `${root}/module/+/ota`,
      `${root}/module/+/maintenance/command`,
      // v1.2 (ADR-0008) · el backend es el ÚNICO emisor de la orden de
      // aprovisionamiento. `+` casa un solo nivel, así que esta regla NO
      // alcanza `.../provision/state`: el estado reportado lo escribe el
      // módulo y el backend sólo lo lee (su `topic read #` ya lo cubre).
      `${root}/module/+/provision`,
    ],
  };
}

const COORD_START = '# >>> COORDINATOR-BLOCK (generado por set-coordinator.sh; no editar a mano)';
const COORD_END = '# <<< COORDINATOR-BLOCK';
const COORD_INACTIVE = '# (inactivo: ejecuta ./set-coordinator.sh <module_id> para activarlo)';

/** Conserva el bloque de coordinador que hubiera en la ACL actual (lo gestiona set-coordinator.sh). */
function currentCoordinatorBody(aclPath) {
  try {
    const lines = readFileSync(aclPath, 'utf-8').split('\n');
    const a = lines.indexOf(COORD_START);
    const b = lines.indexOf(COORD_END);
    if (a >= 0 && b > a) return lines.slice(a + 1, b).join('\n');
  } catch {
    /* fichero aún inexistente */
  }
  return COORD_INACTIVE;
}

export function renderAcl(src, coordinatorBody = COORD_INACTIVE) {
  const root = src.topic_root;
  const L = [];
  L.push('# ==============================================================================');
  L.push('# Diana · ACL de Mosquitto — GENERADO. NO EDITAR A MANO.');
  L.push('# ==============================================================================');
  L.push('# Fuente única: infrastructure/mosquitto/identities.json');
  L.push('# Regenerar:   node infrastructure/mosquitto/generate-identities.mjs');
  L.push('# Verificar:   node infrastructure/mosquitto/generate-identities.mjs --check');
  L.push('#');
  L.push('# MP0-A — la autorización se apoya en la IDENTIDAD AUTENTICADA:');
  L.push('#   Este fichero NO contiene ni `%c` ni `%u`. Cada regla nombra al usuario');
  L.push('#   autenticado (`user <username>`) y lleva el module_id LITERAL en el');
  L.push('#   tópico. El `client_id` lo elige el cliente y por tanto no autoriza');
  L.push('#   nada: un módulo puede conectar con el client_id que quiera (incluso');
  L.push('#   uno ajeno o aleatorio) y sus permisos son exactamente los de su');
  L.push('#   usuario.');
  L.push('#');
  L.push('# F-02 (CERRADO, no se reabre) — DOS barreras independientes:');
  L.push('#   1. esta ACL no autoriza por client_id (no hay %c ni %u), y');
  L.push('#   2. usuario == module_id + `use_username_as_clientid true` en');
  L.push('#      mosquitto.conf, que fue el cierre original del hallazgo.');
  L.push('#   Se conservan las dos. Retirar cualquiera de ellas debe hacer fallar');
  L.push('#   simulators/test/identidades-no-se-mezclan.test.ts.');
  L.push('#');
  L.push('# Escritura tópico a tópico, nunca un comodín sobre module/<id>/#: un');
  L.push('# comodín dejaría a un módulo comprometido escribirse su config/desired');
  L.push('# o su ota, que son sólo-lectura para el módulo.');
  L.push('# ==============================================================================');
  L.push('');

  const backend = src.service_identities?.backend;
  if (backend) {
    const t = backendTopics(root);
    L.push('# --- Backend: único emisor de system/#, config/desired, ota y');
    L.push('#     maintenance/command. Lectura total (es el agregador). NUNCA module/+/command:');
    L.push('#     el canal de juego es autoridad exclusiva del coordinador.');
    L.push(`user ${backend.username}`);
    for (const x of t.read) L.push(`topic read ${x}`);
    for (const x of t.write) L.push(`topic write ${x}`);
    L.push('');
  }

  L.push('# --- Módulos: una regla explícita por identidad autenticada -----------------');
  for (const m of src.modules ?? []) {
    const t = moduleTopics(root, m.module_id);
    L.push(`# ${m.username} → module_id ${m.module_id}`);
    L.push(`user ${m.username}`);
    for (const x of t.write) L.push(`topic write ${x}`);
    for (const x of t.read) L.push(`topic read ${x}`);
    L.push('');
  }

  L.push('# --- Coordinador (rol PRINCIPAL): lo gestiona ./set-coordinator.sh ----------');
  L.push('# Estado por defecto en git: SIN coordinador activo (estado seguro).');
  L.push(COORD_START);
  L.push(coordinatorBody);
  L.push(COORD_END);
  L.push('');

  const hc = src.service_identities?.healthcheck;
  if (hc) {
    L.push('# --- Healthcheck: sólo prueba de conectividad, fuera de targets/v1 ---------');
    L.push(`user ${hc.username}`);
    L.push(`topic readwrite ${hc.topic ?? '_health/probe'}`);
    L.push('');
  }
  return L.join('\n');
}

export function allUsernames(src) {
  return [
    ...Object.values(src.service_identities ?? {}).map((s) => s.username),
    ...(src.modules ?? []).map((m) => m.username),
  ];
}

export function renderUsers(src) {
  return [
    '# GENERADO desde identities.json — no editar a mano.',
    '# Un usuario por línea. Crear/rotar todos con:',
    '#   ./generate-users.sh --all',
    ...allUsernames(src),
    '',
  ].join('\n');
}

/** Artefacto 3: config del módulo (lo que necesita firmware/simulador para conectar). */
export function renderModules(src) {
  const root = src.topic_root;
  return `${JSON.stringify(
    {
      _generated_from: 'infrastructure/mosquitto/identities.json',
      _warning: 'GENERADO — no editar a mano; regenerar con generate-identities.mjs',
      topic_root: root,
      backend: {
        username: src.service_identities?.backend?.username,
        env_var_password: 'MQTT_BACKEND_PASSWORD',
      },
      modules: (src.modules ?? []).map((m) => ({
        username: m.username,
        module_id: m.module_id,
        // El client_id ya NO autoriza nada (H2I·A). Se sigue fijando al
        // module_id por trazabilidad en los logs del broker, y se declara
        // aquí como VALOR ESPERADO para poder afirmarlo en las pruebas.
        expected_client_id: m.module_id,
        env_var_password: `MQTT_PASSWORD_${m.username.toUpperCase().replace(/-/g, '_')}`,
        topics: moduleTopics(root, m.module_id),
      })),
    },
    null,
    2,
  )}\n`;
}

/** Artefacto 4: plantilla de entorno (nombres de variables, jamás valores). */
export function renderEnvExample(src) {
  const L = [
    '# GENERADO desde identities.json — no editar a mano.',
    '# Plantilla: NOMBRES de variables de credencial, nunca valores.',
    '# Las contraseñas se generan con ./generate-users.sh y no entran en git.',
    '',
    `MQTT_BACKEND_USERNAME=${src.service_identities?.backend?.username ?? 'backend'}`,
    'MQTT_BACKEND_PASSWORD=CAMBIAR',
    '',
  ];
  for (const m of src.modules ?? []) {
    const v = m.username.toUpperCase().replace(/-/g, '_');
    L.push(`# module_id ${m.module_id}`);
    L.push(`MQTT_USERNAME_${v}=${m.username}`);
    L.push(`MQTT_PASSWORD_${v}=CAMBIAR`);
  }
  L.push('');
  return L.join('\n');
}

/** Artefacto 5: fixtures del simulador. */
export function renderSimFixtures(src) {
  return `${JSON.stringify(
    {
      _generated_from: 'infrastructure/mosquitto/identities.json',
      _warning: 'GENERADO — no editar a mano.',
      topic_root: src.topic_root,
      identities: (src.modules ?? []).map((m) => ({
        username: m.username,
        moduleId: m.module_id,
        expectedClientId: m.module_id,
      })),
      backendUsername: src.service_identities?.backend?.username,
    },
    null,
    2,
  )}\n`;
}

// ---------------------------------------------------------------------------

export function buildArtifacts(src, coordinatorBody) {
  return {
    [resolve(OUT_DIR, 'acl')]: renderAcl(src, coordinatorBody),
    [resolve(OUT_DIR, 'users.generated.txt')]: renderUsers(src),
    [resolve(OUT_DIR, 'modules.generated.json')]: renderModules(src),
    [resolve(OUT_DIR, 'identities.generated.env.example')]: renderEnvExample(src),
    [SIM_OUT]: renderSimFixtures(src),
  };
}

function main() {
  const src = loadSource(SOURCE);

  if (has('--list-users')) {
    process.stdout.write(`${allUsernames(src).join('\n')}\n`);
    return;
  }
  const uOf = flag('--username-of', null);
  if (uOf) {
    const m = (src.modules ?? []).find((x) => x.module_id === uOf);
    if (!m) {
      process.stderr.write(`ERROR: module_id '${uOf}' no está en identities.json\n`);
      process.exit(1);
    }
    process.stdout.write(`${m.username}\n`);
    return;
  }
  const mOf = flag('--module-id-of', null);
  if (mOf) {
    const m = (src.modules ?? []).find((x) => x.username === mOf);
    if (!m) {
      process.stderr.write(`ERROR: usuario '${mOf}' no está en identities.json\n`);
      process.exit(1);
    }
    process.stdout.write(`${m.module_id}\n`);
    return;
  }

  const coordinator = currentCoordinatorBody(resolve(OUT_DIR, 'acl'));
  const artifacts = buildArtifacts(src, coordinator);

  if (has('--check')) {
    const drift = [];
    for (const [path, content] of Object.entries(artifacts)) {
      let actual = null;
      try {
        actual = readFileSync(path, 'utf-8');
      } catch {
        /* no existe */
      }
      if (actual !== content) drift.push(path);
    }
    if (drift.length) {
      process.stderr.write(
        `DRIFT: estos artefactos no coinciden con identities.json:\n  - ${drift.join('\n  - ')}\n` +
          'Regenera con: node infrastructure/mosquitto/generate-identities.mjs\n',
      );
      process.exit(1);
    }
    process.stdout.write('OK: los 5 artefactos coinciden con la fuente única.\n');
    return;
  }

  for (const [path, content] of Object.entries(artifacts)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    process.stderr.write(`generado: ${path}\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
