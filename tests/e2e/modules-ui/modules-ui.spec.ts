/**
 * ============================================================================
 * Diana · BROWSER-E2E-REAL — gestión de módulos desde un navegador de verdad
 * ============================================================================
 * Chromium real → panel real (nginx sirviendo el `dist` compilado en modo
 * `real`) → backend real (`NODE_ENV=production`) → PostgreSQL real →
 * Mosquitto real (TLS 8883, `allow_anonymous false`, ACL real del repositorio).
 *
 * LO QUE ESTE FICHERO NO HACE, Y ES EL NÚCLEO DEL ENCARGO:
 *   - NO usa `page.route()` ni ninguna otra forma de interceptar HTTP.
 *   - NO monta un backend falso, ni un adaptador de demostración, ni fixtures
 *     de respuesta. El panel se construye con `VITE_API_MODE=real` y el
 *     guardián de `vite.config.ts` queda intacto.
 *   - NO fabrica heartbeats, ni `provision/state`, ni `config/reported`. En
 *     este escenario hay CERO dispositivos físicos y CERO credenciales de
 *     módulo en el broker: el panel tiene que enseñar 0 módulos EN LÍNEA, y
 *     eso es lo que se comprueba (paso 7), no algo que se maquille.
 *   - NO da por buena una respuesta HTTP. Cada efecto se lee en PostgreSQL con
 *     `psql` contra el contenedor.
 *
 * QUÉ SE HACE POR NAVEGADOR Y QUÉ POR API — dicho aquí para que nadie tenga
 * que deducirlo:
 *   · Por NAVEGADOR: iniciar sesión, abrir «Módulos», leer el estado vacío,
 *     leer la lista y el resumen, desplegar la ficha de un módulo, recargar,
 *     y volver a leer tras reiniciar el backend.
 *   · Por API REAL (no hay flujo de alta ni de edición en la pantalla de
 *     módulos del panel — es de sólo lectura, comprobado en
 *     `server/frontend/src/pages/modules/ModulesPage.tsx`): dar de alta el
 *     módulo, empujar configuración, editar el nombre, emitir y revocar la
 *     credencial MQTT, y los intentos de PATCH prohibidos.
 *   Y en los dos casos el veredicto sale de la BASE DE DATOS.
 *
 * Levantar antes:   ./tests/e2e/modules-ui/harness/up.sh
 * Derribar después: ./tests/e2e/modules-ui/harness/down.sh
 * ============================================================================
 */
import { test, expect, type Page } from "@playwright/test";
import {
  api,
  comprobarAcl,
  conectarMqtt,
  docker,
  esperarBackend,
  leerEntorno,
  leerPasswdDelBroker,
  login,
  modoPasswd,
  psql,
  senalarVigilante,
  psqlUno,
  type Entorno,
} from "./harness/lib";

const env: Entorno = leerEntorno();

/**
 * SLUG DECLARADO, no inventado. Al principio este carril usaba un slug
 * aleatorio y el paso 8 se topó con un guardarraíl REAL:
 *
 *   «El módulo 'e2e-modui-…' no está declarado en la fuente única de
 *    identidades (infrastructure/mosquitto/generate-identities.mjs).
 *    Declararlo allí y regenerar la ACL es requisito previo: una credencial
 *    sin regla de ACL autentica y no queda confinada a su subárbol.»
 *
 * Es la invariante F-02 haciendo su trabajo, y no se rodea: se usa un
 * `module_id` que SÍ está en `infrastructure/mosquitto/identities.json` (el
 * mismo fichero del que sale la ACL que monta el arnés). Que sea fijo no crea
 * dependencia entre ejecuciones porque `up.sh` verifica que la tabla `modules`
 * empieza vacía y aborta si no lo está.
 */
const SLUG = "module-01";
const NOMBRE_INICIAL = "Módulo de banco E2E";
const NOMBRE_EDITADO = "Módulo de banco E2E (reconfigurado)";

let adminToken = "";
let moduleId = "";
/** La credencial del paso 8, que usan los pasos 11 y 12 contra el broker real. */
let credencialEmitida: { username: string; secret: string; fingerprint: string } | null = null;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  adminToken = await login(env, env.adminUsername, env.adminPassword);
});

// ---------------------------------------------------------------- navegador
/**
 * Inicia sesión EN EL NAVEGADOR, rellenando el formulario real. No se inyecta
 * el token en `localStorage`: eso saltaría precisamente el camino que hay que
 * demostrar.
 */
async function entrar(page: Page): Promise<void> {
  await page.goto(`${env.webBaseUrl}/`);
  await expect(page.getByRole("heading", { name: /Iniciar sesión/i })).toBeVisible();
  await page.locator('input[name="username"]').fill(env.adminUsername);
  await page.locator('input[name="password"]').fill(env.adminPassword);
  await page.getByRole("button", { name: "Entrar" }).click();
  // Se espera al ARMAZÓN de la aplicación, no a un título que contenga
  // «Diana»: la propia pantalla de acceso se llama «Diana · Iniciar sesión» y
  // esperarla habría dado por buena una sesión que no cuajó (pasó: el paso 1
  // se fue a `/modulos` sin sesión y no encontró la pantalla). «Cerrar
  // sesión» sólo existe cuando hay usuario Y no queda cambio de contraseña
  // pendiente.
  await expect(page.getByRole("button", { name: /Cerrar sesión/i }).first()).toBeVisible({
    timeout: 20_000,
  });
}

async function abrirModulos(page: Page): Promise<void> {
  await page.goto(`${env.webBaseUrl}/modulos`);
  await expect(page.getByRole("heading", { name: "Módulos", level: 1 })).toBeVisible({
    timeout: 20_000,
  });
  // La pantalla arranca en «Consultando módulos…»; se espera al DESENLACE, no
  // a un tiempo fijo. Los tres finales posibles se distinguen a propósito
  // (vacío ≠ error), que es justo el defecto que este panel ya tuvo una vez.
  await expect(
    page
      .locator(".module-summary")
      .or(page.getByText("0 módulos registrados"))
      .or(page.getByRole("button", { name: /Reintentar/i }))
      .first(),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Consultando módulos…")).toHaveCount(0);
}

/** Ficha desplegada de un módulo por su slug. */
async function desplegarFicha(page: Page, slug: string) {
  const toggle = page.getByRole("button", { name: new RegExp(slug) });
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  // El detalle es HERMANO de la cabecera dentro de la misma tarjeta, y NO
  // repite el slug: filtrar el detalle por el slug no encuentra nada (medido).
  // El panel sólo permite una ficha desplegada a la vez, así que la única
  // `.module-row__detail` visible es la de este módulo — y se comprueba que
  // hay exactamente una, en vez de suponerlo.
  const detalle = page.locator(".module-row__detail");
  await expect(detalle).toHaveCount(1);
  return detalle.first();
}

/** Fila del módulo tal y como está EN LA BASE. Ni un campo derivado del panel. */
function filaEnBd(slug: string) {
  const [
    id,
    online,
    lastSeen,
    desired,
    reported,
    configState,
    friendly,
    maintenance,
  ] = psqlUno(
    env,
    `select id, online, coalesce(last_seen_at::text,'NULL'), desired_config_version,
            coalesce(reported_config_version::text,'NULL'), config_state,
            coalesce(friendly_name,'NULL'), maintenance
       from modules where slug = '${slug}';`,
  );
  return {
    id,
    online: online === "t",
    lastSeenAt: lastSeen,
    desiredConfigVersion: Number.parseInt(desired, 10),
    reportedConfigVersion: reported,
    configState,
    friendlyName: friendly,
    maintenance: maintenance === "t",
  };
}

// ============================================================================
// 1 · Estado vacío REAL
// ============================================================================
test("1 · el panel abre «Módulos» y declara el vacío REAL (0 filas en la BD)", async ({ page }) => {
  // Punto de partida comprobado en la BASE, antes de mirar la pantalla.
  const [total] = psqlUno(env, "select count(*) from modules;");
  expect(total, "el escenario debe empezar con la tabla `modules` vacía").toBe("0");

  await entrar(page);
  await abrirModulos(page);

  // El panel dice «he preguntado y no hay ninguno», no «no he podido
  // preguntar»: son dos cosas distintas y las pinta distinto a propósito.
  await expect(page.getByText("0 módulos registrados")).toBeVisible();
  await expect(page.getByText(/comprobado ahora mismo contra el backend/i)).toBeVisible();
  // Y no inventa ni una fila.
  await expect(page.locator(".module-row__toggle")).toHaveCount(0);
  await expect(page.locator(".module-summary")).toHaveCount(0);
});

// ============================================================================
// 2 · Alta (por API: la pantalla de módulos del panel es de sólo lectura)
// ============================================================================
test("2 · dar de alta un módulo crea la FILA en PostgreSQL y el panel la refleja", async ({ page }) => {
  const r = await api(env, "POST", "/api/modules", {
    token: adminToken,
    body: { slug: SLUG, friendlyName: NOMBRE_INICIAL, targetBoard: "esp32s3-devkitc-1" },
  });
  expect(r.status, `alta rechazada: ${JSON.stringify(r.body)}`).toBe(201);

  // EL 201 NO ES LA EVIDENCIA. La evidencia es la fila.
  const fila = filaEnBd(SLUG);
  moduleId = fila.id;
  expect(moduleId).toMatch(/^[0-9a-f-]{36}$/);
  // Recién dado de alta: no ha conectado nunca y nadie le ha empujado nada.
  expect(fila.online).toBe(false);
  expect(fila.lastSeenAt).toBe("NULL");
  expect(fila.desiredConfigVersion).toBe(0);
  expect(fila.reportedConfigVersion).toBe("NULL");
  expect(fila.friendlyName).toBe(NOMBRE_INICIAL);

  // Y ahora, EN EL NAVEGADOR.
  await entrar(page);
  await abrirModulos(page);
  await expect(page.getByText("0 módulos registrados")).toHaveCount(0);
  await expect(page.locator(".module-summary")).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(SLUG) })).toBeVisible();
});

// ============================================================================
// 3 · Recargar el navegador
// ============================================================================
test("3 · recargar el navegador no pierde el módulo (viene de la BD, no del estado del panel)", async ({ page }) => {
  await entrar(page);
  await abrirModulos(page);
  await expect(page.getByRole("button", { name: new RegExp(SLUG) })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Módulos", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(SLUG) })).toBeVisible({ timeout: 20_000 });

  expect(filaEnBd(SLUG).id).toBe(moduleId);
});

// ============================================================================
// 4 · Reiniciar el contenedor del backend
// ============================================================================
test("4 · el módulo sobrevive a `docker restart` del backend", async ({ page }) => {
  const antes = filaEnBd(SLUG);

  // Es SEGURO: contenedor efímero de este carril, nombre exacto, nada de
  // producción ni de la VM109.
  docker(["restart", env.containers.backend]);
  await esperarBackend(env);

  // La fila es la MISMA (mismo id), no una recreada.
  const despues = filaEnBd(SLUG);
  expect(despues.id).toBe(antes.id);
  expect(despues.friendlyName).toBe(antes.friendlyName);
  expect(despues.desiredConfigVersion).toBe(antes.desiredConfigVersion);

  await entrar(page);
  await abrirModulos(page);
  await expect(page.getByRole("button", { name: new RegExp(SLUG) })).toBeVisible();
});

// ============================================================================
// 5 · Editar configuración → `config_version` avanza EXACTAMENTE una vez
// ============================================================================
test("5 · un empujón de configuración sube desired_config_version en EXACTAMENTE 1", async () => {
  // ── El módulo VIRGEN se rechaza con 400, y sin efectos ───────────────────
  // Un módulo recién dado de alta no tiene dianas, y el contrato congelado
  // `contracts/mqtt/module-config.schema.json` exige `calibration` con 9
  // elementos. Este carril MIDIÓ antes un **500** aquí: el backend se negaba a
  // publicar un mensaje inválido (bien) con el código equivocado (mal), y
  // además quemaba una versión deseada por el camino. Una precondición del
  // recurso es un 4xx y no debe dejar rastro.
  const virgen = filaEnBd(SLUG);
  const sinDianas = await api(env, "POST", `/api/modules/${moduleId}/config/push`, {
    token: adminToken,
    body: { network: { mode: "dhcp" } },
  });
  expect(sinDianas.status, "un módulo sin 9 dianas calibradas: error de ENTRADA, no del servidor").toBe(400);
  expect(JSON.stringify(sinDianas.body)).toContain("0 de 9 dianas");
  // Y no se reserva número: rechazar antes de tocar nada es lo que hace que
  // reintentarlo tras calibrar sea una operación limpia.
  expect(
    filaEnBd(SLUG).desiredConfigVersion,
    "un rechazo de entrada NO puede consumir versión deseada",
  ).toBe(virgen.desiredConfigVersion);

  // ── preparación: las 9 dianas y su calibración, por la API REAL ──────────
  for (let i = 1; i <= 9; i += 1) {
    const t = await api(env, "POST", "/api/targets", {
      token: adminToken,
      body: { moduleId, targetIndex: i, label: `Diana ${i}` },
    });
    expect(t.status, `alta de la diana ${i}: ${JSON.stringify(t.body)}`).toBe(201);
    const targetId = (t.body as { id: string }).id;
    const c = await api(env, "POST", "/api/calibration", {
      token: adminToken,
      body: {
        targetId,
        threshold: 1200,
        hysteresis: 80,
        noiseFloor: 40,
        blankingUs: 5000,
        groupWindowUs: 2000,
        neighbourRatio: 0.35,
      },
    });
    expect(c.status, `calibración de la diana ${i}: ${JSON.stringify(c.body)}`).toBe(201);
  }
  expect(psqlUno(env, `select count(*) from targets where module_id='${moduleId}';`)[0]).toBe("9");

  const antes = filaEnBd(SLUG);

  const r = await api(env, "POST", `/api/modules/${moduleId}/config/push`, {
    token: adminToken,
    body: { network: { mode: "dhcp" } },
  });
  expect(r.status, `push rechazado: ${JSON.stringify(r.body)}`).toBe(201);

  // MEDIDO EN LA BASE, no en el cuerpo de la respuesta. El backend separa
  // DESEADA (`desired_config_version`, propiedad exclusiva suya) de REPORTADA
  // (`reported_config_version`, lo que el módulo dice tener).
  const despues = filaEnBd(SLUG);
  expect(despues.desiredConfigVersion - antes.desiredConfigVersion).toBe(1);

  // Y el estado es `pending`, no `applied`: nadie ha reportado nada porque no
  // hay ningún dispositivo. `reported_config_version` sigue NULL.
  expect(despues.configState).toBe("pending");
  expect(despues.reportedConfigVersion).toBe("NULL");
  expect(
    psqlUno(env, `select coalesce(config_applied_at::text,'NULL') from modules where slug='${SLUG}';`)[0],
  ).toBe("NULL");

  // Un segundo empujón sube otra vez EXACTAMENTE 1 (no 0 por idempotencia
  // accidental, ni 2 por doble escritura).
  const r2 = await api(env, "POST", `/api/modules/${moduleId}/config/push`, {
    token: adminToken,
    body: { network: { mode: "dhcp" } },
  });
  expect(r2.status).toBe(201);
  expect(filaEnBd(SLUG).desiredConfigVersion - despues.desiredConfigVersion).toBe(1);

  // Edición de datos de configuración del módulo (nombre visible), que SÍ es
  // un campo del DTO de actualización.
  const r3 = await api(env, "PATCH", `/api/modules/${moduleId}`, {
    token: adminToken,
    body: { friendlyName: NOMBRE_EDITADO },
  });
  expect(r3.status).toBe(200);
  expect(filaEnBd(SLUG).friendlyName).toBe(NOMBRE_EDITADO);
  // Editar el nombre NO es empujar configuración: la versión deseada no se
  // mueve por un PATCH. Si se moviera, «exactamente una vez por empujón»
  // dejaría de ser cierto.
  expect(filaEnBd(SLUG).desiredConfigVersion).toBe(despues.desiredConfigVersion + 1);
});

// ============================================================================
// 6 · Recargar → la configuración persiste
// ============================================================================
test("6 · tras recargar, el panel enseña la configuración editada y NO la da por aplicada", async ({ page }) => {
  await entrar(page);
  await abrirModulos(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Módulos", level: 1 })).toBeVisible();

  // El nombre editado, servido por el backend desde la BD.
  await expect(page.getByText(NOMBRE_EDITADO)).toBeVisible({ timeout: 20_000 });

  const ficha = await desplegarFicha(page, SLUG);
  const texto = (await ficha.innerText()).toLowerCase();

  // LA AFIRMACIÓN QUE IMPORTA: con `config_state = 'pending'` en la base y
  // ningún `config/reported` recibido, el panel NO puede decir «aplicada».
  // Puede decir «pendiente» (si traduce el contrato) o «desconocida» (si el
  // campo aún no le llega con ese nombre); las dos son honestas. «Aplicada»
  // no lo sería.
  //
  // Se PARSEA el veredicto, no se cuenta el texto. Un `not.toContain("aplicada")`
  // daba rojo por la razón equivocada (medido): el panel escribe «no se puede
  // afirmar que esté aplicada», que dice exactamente lo contrario de lo que
  // esa comprobación creía estar detectando.
  const veredicto = /configuración:\s*(aplicada|pendiente|fallida|desconocida)/.exec(texto)?.[1];
  expect(veredicto, `no se encontró el veredicto de configuración en:\n${texto}`).toBeDefined();
  expect(veredicto, "con config_state='pending' en la BD el panel NO puede decir «aplicada»").not.toBe("aplicada");
  expect(["pendiente", "desconocida"]).toContain(veredicto);

  // HALLAZGO ANOTADO (ver README §Hallazgos): hoy sale «desconocida», no
  // «pendiente». El backend emite `desiredConfigVersion` /
  // `reportedConfigVersion` / `configState`
  // (`modules-overview.service.ts`) y el panel lee `configVersionDesired` /
  // `configVersionReported` / `configStatus` (`api/modulesApi.ts`): los
  // nombres no casan y el estado llega `undefined`. El panel lo traduce a
  // «desconocida» en vez de a «aplicada», que es el comportamiento correcto
  // ante un dato ausente — el fallo es visible, no silencioso. Esta prueba
  // acepta las dos redacciones honestas justamente para no bloquear al carril
  // que está arreglando el nombre, y sigue prohibiendo la deshonesta.

  // Y la base sigue diciendo lo mismo.
  expect(filaEnBd(SLUG).configState).toBe("pending");
});

// ============================================================================
// 7 · EL PASO MÁS IMPORTANTE: sin haber conectado nunca, NO está ONLINE
// ============================================================================
test("7 · un módulo que nunca ha conectado NO aparece ONLINE: se ve como pendiente", async ({ page }) => {
  // (a) En la BASE: la bandera está a falso y no hay ninguna señal de vida.
  const fila = filaEnBd(SLUG);
  expect(fila.online, "nadie ha puesto este módulo en línea").toBe(false);
  expect(fila.lastSeenAt, "no ha llegado ni una señal de este módulo").toBe("NULL");

  // (b) En la BASE, para TODO el escenario: cero módulos en línea, cero vistos.
  const [enLinea] = psqlUno(env, "select count(*) from modules where online = true;");
  expect(enLinea).toBe("0");
  const [vistos] = psqlUno(env, "select count(*) from modules where last_seen_at is not null;");
  expect(vistos).toBe("0");

  // (c) En el NAVEGADOR: el resumen dice 0 en línea y 1 pendiente de primera
  //     conexión, y la insignia de la fila dice «pendiente».
  await entrar(page);
  await abrirModulos(page);

  const resumen = page.locator(".module-summary");
  await expect(resumen).toBeVisible();
  const textoResumen = (await resumen.innerText()).replace(/\s+/g, " ");
  expect(textoResumen).toMatch(/\b0 en línea\b/);
  expect(textoResumen).toMatch(/\b1 pendientes de primera conexión\b/);

  const insignia = page.locator(".module-row__head").filter({ hasText: SLUG }).locator(".badge").first();
  await expect(insignia).toHaveText("pendiente");
  // «pendiente» NO comparte el color del «en línea»: la clase lo demuestra.
  await expect(insignia).toHaveClass(/badge--muted/);
  await expect(insignia).not.toHaveClass(/badge--ok/);

  const ficha = await desplegarFicha(page, SLUG);
  await expect(ficha).toContainText("todavía sin primera señal");
  await expect(ficha).toContainText("Última señal: —");
});

// ============================================================================
// 8 · Revocar / deshabilitar
// ============================================================================
test("8 · emitir credencial MQTT escribe en el broker REAL y sólo enseña la contraseña una vez", async ({ page }) => {
  // Antes este paso medía un FALLO CERRADO: la emisión no era ejecutable en el
  // despliegue porque a la imagen del backend le faltaban tres piezas —la
  // fuente única de identidades, `DIANA_MOSQUITTO_PASSWD_FILE` y el binario
  // `mosquitto_passwd`— y `compose.yml` no montaba ninguna. Ya están las tres,
  // y lo que se comprueba ahora es la emisión de verdad.
  //
  // El `passwd` del broker se lee DEL DISCO, no de la respuesta de la API:
  // que el backend conteste 201 no demuestra que haya escrito nada.
  const passwdAntes = leerPasswdDelBroker(env);
  expect(passwdAntes, "el broker NO debe conocer a module-01 todavía").not.toContain(`${SLUG}:`);
  expect(psqlUno(env, `select count(*) from module_mqtt_credentials where module_id='${moduleId}';`)[0]).toBe("0");

  const emit = await api(env, "POST", `/api/modules/${moduleId}/mqtt-identity`, {
    token: adminToken,
    body: {},
  });
  expect(emit.status, `emisión rechazada: ${JSON.stringify(emit.body)}`).toBe(201);
  const credencial = emit.body as {
    username: string;
    clientId: string;
    secret: string;
    fingerprint: string;
    generation: number;
  };

  // F-02, medida y no supuesta: usuario == module_id == client_id, sin prefijo.
  expect(credencial.username).toBe(SLUG);
  expect(credencial.clientId).toBe(SLUG);
  expect(credencial.generation).toBe(1);
  expect(credencial.secret.length).toBeGreaterThanOrEqual(24);

  // ── El secreto llegó AL BROKER, y llegó cifrado ──────────────────────────
  const passwdDespues = leerPasswdDelBroker(env);
  expect(passwdDespues).toMatch(new RegExp(`^${SLUG}:\\$7\\$`, "m"));
  expect(
    passwdDespues,
    "la contraseña EN CLARO no puede aparecer en el fichero de credenciales",
  ).not.toContain(credencial.secret);
  // Y no se ha llevado por delante al usuario que ya estaba.
  expect(passwdDespues, "emitir una credencial no puede borrar las demás").toContain("backend:");

  // Permisos: dueño lee/escribe, grupo del broker lee, nadie más.
  expect(modoPasswd(env), "el passwd no puede quedar legible por todo el mundo").toBe("640");

  // ── La contraseña NO se puede volver a leer ──────────────────────────────
  const consulta = await api(env, "GET", `/api/modules/${moduleId}/mqtt-identity`, { token: adminToken });
  expect(consulta.status).toBe(200);
  expect(JSON.stringify(consulta.body), "el secreto no puede volver por ninguna lectura").not.toContain(
    credencial.secret,
  );
  expect((consulta.body as { fingerprint: string }).fingerprint).toBe(credencial.fingerprint);

  // Reemitir sin pedir rotación es un CONFLICTO, no una segunda contraseña.
  const otra = await api(env, "POST", `/api/modules/${moduleId}/mqtt-identity`, {
    token: adminToken,
    body: {},
  });
  expect(otra.status).toBe(409);

  // ── Y el secreto no está en los registros del backend ────────────────────
  const registros = docker(["logs", env.containers.backend]);
  expect(registros, "ningún secreto puede aparecer en los logs").not.toContain(credencial.secret);
  expect(registros, "la huella pública SÍ, para poder auditar").toContain(credencial.fingerprint);

  // ── Emitir credencial NO conecta nada ────────────────────────────────────
  // Es la comprobación que impide que este paso se lea como «el módulo ya
  // está». No hay ESP32: el módulo sigue sin haberse visto nunca.
  expect(filaEnBd(SLUG).online).toBe(false);
  expect(filaEnBd(SLUG).lastSeenAt).toBe("NULL");

  credencialEmitida = credencial;

  // ── DESHABILITAR, que SÍ funciona, y se comprueba por efecto en la BD ────
  const antes = filaEnBd(SLUG);
  expect(antes.maintenance).toBe(false);

  const patch = await api(env, "PATCH", `/api/modules/${moduleId}`, {
    token: adminToken,
    body: { maintenance: true },
  });
  expect(patch.status).toBe(200);
  expect(filaEnBd(SLUG).maintenance, "la columna `maintenance` tiene que estar a true").toBe(true);

  // Y se ve en el navegador, que es donde lo lee el operador.
  await entrar(page);
  await abrirModulos(page);
  const ficha = await desplegarFicha(page, SLUG);
  await expect(ficha).toContainText("en mantenimiento");

  // Reversible: se vuelve a habilitar y la base lo refleja.
  expect((await api(env, "PATCH", `/api/modules/${moduleId}`, { token: adminToken, body: { maintenance: false } })).status).toBe(200);
  expect(filaEnBd(SLUG).maintenance).toBe(false);
});

// ============================================================================
// 9 · Permisos
// ============================================================================
test("9 · un usuario sin el permiso no puede: `consulta` recibe 403 y la BD no cambia", async () => {
  const viewer = await login(env, env.viewerUsername, env.viewerPassword);

  // Control POSITIVO: el rol `consulta` SÍ tiene `modules:read`, así que la
  // lectura funciona. Sin esto, un 403 podría venir de un token roto y la
  // prueba pasaría por el motivo equivocado.
  const lectura = await api(env, "GET", "/api/modules/overview", { token: viewer });
  expect(lectura.status, "el control positivo debe pasar: `consulta` tiene modules:read").toBe(200);

  const antes = filaEnBd(SLUG);

  // (a) Escritura de módulos: `modules:write` no lo tiene `consulta`.
  const alta = await api(env, "POST", "/api/modules", {
    token: viewer,
    body: { slug: `${SLUG}-prohibido` },
  });
  expect(alta.status).toBe(403);

  const edicion = await api(env, "PATCH", `/api/modules/${moduleId}`, {
    token: viewer,
    body: { friendlyName: "no debería poder" },
  });
  expect(edicion.status).toBe(403);

  const empujon = await api(env, "POST", `/api/modules/${moduleId}/config/push`, {
    token: viewer,
    body: { network: { mode: "dhcp" } },
  });
  expect(empujon.status).toBe(403);

  // (b) Aprovisionamiento: `provisioning:issue` y `provisioning:read` NO los
  //     tiene NINGÚN rol salvo el `*` del administrador.
  const emitir = await api(env, "POST", `/api/modules/${moduleId}/mqtt-identity`, {
    token: viewer,
    body: {},
  });
  expect(emitir.status).toBe(403);
  const leerIdentidad = await api(env, "GET", `/api/modules/${moduleId}/mqtt-identity`, { token: viewer });
  expect(leerIdentidad.status).toBe(403);
  const estado = await api(env, "GET", `/api/provisioning/modules/${SLUG}/state`, { token: viewer });
  expect(estado.status).toBe(403);

  // (c) La afirmación «no los tiene ningún rol salvo administrador» se
  //     comprueba contra el catálogo real que sirve el backend, no contra el
  //     fichero fuente.
  const catalogo = (await api(env, "GET", "/api/auth/roles")).body as Array<{
    name: string;
    permissions: string[];
  }>;
  for (const rol of catalogo) {
    const tiene = rol.permissions.some((p) => p.startsWith("provisioning:"));
    if (rol.name === "administrador") {
      expect(rol.permissions).toContain("*");
    } else {
      expect(tiene, `el rol ${rol.name} NO debería traer permisos provisioning:*`).toBe(false);
      expect(rol.permissions).not.toContain("*");
    }
  }

  // (d) Y NADA de eso dejó rastro: la fila está exactamente como estaba, y no
  //     nació ningún módulo nuevo.
  expect(filaEnBd(SLUG)).toEqual(antes);
  const [prohibidos] = psqlUno(env, `select count(*) from modules where slug = '${SLUG}-prohibido';`);
  expect(prohibidos).toBe("0");
});

// ============================================================================
// 10 · Identidad y config_version NO son parcheables
// ============================================================================
test("10 · PATCH de `slug` o de `configVersion` se rechaza con 400 y la fila NO cambia", async () => {
  const antes = filaEnBd(SLUG);

  const casos: Array<[string, Record<string, unknown>]> = [
    ["identidad MQTT (slug)", { slug: "otro" }],
    ["versión de configuración (configVersion)", { configVersion: 999 }],
    ["versión deseada (desiredConfigVersion)", { desiredConfigVersion: 999 }],
    ["versión reportada (reportedConfigVersion)", { reportedConfigVersion: 999 }],
    ["estado de configuración (configState)", { configState: "applied" }],
    ["bandera de conexión (online)", { online: true }],
    ["última señal (lastSeenAt)", { lastSeenAt: new Date().toISOString() }],
    ["identidad + campo válido en el mismo cuerpo", { slug: "otro", friendlyName: "x" }],
  ];

  for (const [motivo, cuerpo] of casos) {
    const r = await api(env, "PATCH", `/api/modules/${moduleId}`, { token: adminToken, body: cuerpo });
    expect(r.status, `${motivo}: se esperaba 400 y llegó ${r.status} — ${JSON.stringify(r.body)}`).toBe(400);
  }

  // Rechazar no basta: hay que demostrar que no se coló nada. Se comparan
  // TODOS los campos leídos de la base, incluido el caso mixto (que traía un
  // `friendlyName` perfectamente válido junto al `slug` prohibido: si el
  // backend hubiera aplicado la mitad buena, esto lo delata).
  expect(filaEnBd(SLUG)).toEqual(antes);
  const [conOtroSlug] = psqlUno(env, "select count(*) from modules where slug = 'otro';");
  expect(conOtroSlug).toBe("0");
});

// ============================================================================
// Cierre: el escenario entero terminó sin un solo módulo en línea.
// ============================================================================
test.afterAll(() => {
  const filas = psql(env, "select slug, online, coalesce(last_seen_at::text,'NULL') from modules;");
  for (const [slug, online, visto] of filas) {
    expect(online, `${slug} acabó marcado como en línea sin haber conectado nunca`).toBe("f");
    expect(visto, `${slug} acabó con una señal de vida que nadie envió`).toBe("NULL");
  }
});

// ============================================================================
// 11 · La credencial emitida SIRVE contra el broker real (TLS 8883)
// ============================================================================
test("11 · un cliente MQTT REAL se autentica con la credencial emitida por el servidor", async () => {
  const cred = credencialEmitida;
  expect(cred, "el paso 8 tiene que haber emitido la credencial").not.toBeNull();
  if (!cred) return;

  // TLS de verdad contra el 8883, validando la CA. No hay 1883 en este arnés:
  // `harness/mosquitto.conf` no declara el listener en claro.
  expect(env.mqttUrl.startsWith("mqtts://"), "el camino es TLS, no texto en claro").toBe(true);

  const r = await conectarMqtt(env, cred.username, cred.secret);
  expect(r.conectado, `el broker rechazó la credencial recién emitida: ${r.mensaje}`).toBe(true);

  // Autenticarse NO es estar operativo: el módulo sigue sin haberse visto
  // nunca, porque nadie ha publicado presencia — y este carril no la publica.
  expect(filaEnBd(SLUG).online).toBe(false);
  expect(filaEnBd(SLUG).lastSeenAt).toBe("NULL");
});

test("11b · CONTROL NEGATIVO: con la contraseña equivocada el broker NIEGA la conexión", async () => {
  const cred = credencialEmitida;
  expect(cred).not.toBeNull();
  if (!cred) return;

  // Sin este control, el paso 11 sólo demostraría que el broker acepta
  // conexiones — no que comprueba la contraseña. Se altera un carácter del
  // secreto bueno: mismo usuario, misma longitud, misma forma.
  const mala = `${cred.secret.slice(0, -1)}${cred.secret.endsWith("Z") ? "Y" : "Z"}`;
  expect(mala).not.toBe(cred.secret);

  const r = await conectarMqtt(env, cred.username, mala);
  expect(r.conectado, "una contraseña equivocada NO puede autenticar").toBe(false);
  // 135 = "Not authorized" (MQTT 5). Se comprueba el código y no sólo el
  // veredicto: un fallo de red también daría `conectado=false`, y eso pondría
  // la prueba en verde por la razón equivocada.
  expect(r.codigo, `motivo del rechazo: ${r.mensaje}`).toBe(135);
});

// ============================================================================
// 12 · La ACL confina la credencial a su propio subárbol
// ============================================================================
test("12 · la credencial lee lo suyo y NO puede escribir en el subárbol de otro módulo", async () => {
  const cred = credencialEmitida;
  expect(cred).not.toBeNull();
  if (!cred) return;

  const r = await comprobarAcl(
    env,
    cred.username,
    cred.secret,
    `targets/v1/module/${SLUG}/config/desired`,
    // module-02 existe en la ACL y NO es este módulo: es el caso que de verdad
    // importa, la suplantación de un vecino con credencial propia válida.
    "targets/v1/module/module-02/presence",
  );

  // POSITIVO, por EFECTO: llega el mensaje RETENIDO que el backend publicó en
  // el paso 5. No se mira el SUBACK — mosquitto concede QoS 1 a una
  // suscripción denegada y simplemente no entrega nada, así que un SUBACK
  // correcto no prueba que la lectura esté permitida. Que el mensaje llegue,
  // sí.
  expect(r.recibido, "el módulo tiene que poder LEER su propia config/desired").not.toBeNull();
  expect(JSON.parse(r.recibido as string).module_id).toBe(SLUG);

  // NEGATIVO: escribir en el subárbol de module-02 se rechaza.
  expect(r.publicacionAceptada, "module-01 NO puede publicar como module-02").toBe(false);
  expect(r.publicacionDenegada, "la denegación tiene que ser explícita").not.toBeNull();
  expect(r.publicacionDenegada?.codigo, `motivo: ${r.publicacionDenegada?.mensaje}`).toBe(135);

  // Nada de esto ha creado presencia de ningún dispositivo.
  expect(filaEnBd(SLUG).online).toBe(false);
  expect(psqlUno(env, "select count(*) from modules where online = true;")[0]).toBe("0");
});

// ============================================================================
// 13 · CALIBRACIÓN: el vigilante de recarga es indispensable
// ============================================================================
test("13 · sin el SIGHUP del vigilante, la credencial recién emitida NO autentica", async () => {
  // ── Por qué existe este paso ─────────────────────────────────────────────
  // Mosquitto lee `password_file` al arrancar y sólo vuelve a leerlo con
  // SIGHUP. El vigilante que vive en el contenedor del broker se lo manda
  // cuando el backend escribe. Si algún día ese vigilante desaparece —un
  // `command:` que se pierde en un merge, un refactor del compose— TODO lo
  // demás de este carril seguiría en verde: la API devolvería 201, el `passwd`
  // tendría la línea, la BD tendría la fila… y el primer ESP32 real recibiría
  // «not authorised» con la contraseña correcta.
  //
  // Los pasos 11 y 12 no pueden detectar eso, porque para cuando se ejecutan
  // el SIGHUP ya ocurrió. Así que aquí se congela el vigilante a propósito y
  // se comprueba que SIN él la credencial no vale. Es la prueba de que los
  // pasos anteriores miden algo que puede ponerse rojo.
  const SLUG_2 = "module-02";
  const alta = await api(env, "POST", "/api/modules", {
    token: adminToken,
    body: { slug: SLUG_2, friendlyName: "Módulo de calibración" },
  });
  expect(alta.status, `alta de ${SLUG_2}: ${JSON.stringify(alta.body)}`).toBe(201);
  const id2 = (alta.body as { id: string }).id;

  let secreto = "";
  try {
    senalarVigilante(env, "STOP");

    const emit = await api(env, "POST", `/api/modules/${id2}/mqtt-identity`, {
      token: adminToken,
      body: {},
    });
    expect(emit.status).toBe(201);
    secreto = (emit.body as { secret: string }).secret;

    // Margen holgado sobre el intervalo de sondeo (2 s): si el vigilante
    // estuviera vivo, ya habría recargado.
    await new Promise((r) => setTimeout(r, 5000));

    const sinRecarga = await conectarMqtt(env, SLUG_2, secreto);
    expect(
      sinRecarga.conectado,
      "con el vigilante congelado el broker NO puede conocer la credencial nueva",
    ).toBe(false);
    expect(sinRecarga.codigo).toBe(135);
  } finally {
    // Pase lo que pase, el vigilante se reanuda: dejarlo congelado rompería
    // cualquier ejecución posterior contra este mismo escenario.
    senalarVigilante(env, "CONT");
  }

  // Y en cuanto vuelve, la MISMA credencial —sin reemitir nada— sí vale.
  await new Promise((r) => setTimeout(r, 5000));
  const conRecarga = await conectarMqtt(env, SLUG_2, secreto);
  expect(conRecarga.conectado, `el broker sigue rechazando: ${conRecarga.mensaje}`).toBe(true);

  // Nada de esto ha puesto en línea a ningún módulo.
  expect(psqlUno(env, "select count(*) from modules where online = true;")[0]).toBe("0");
});
