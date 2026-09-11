/**
 * Utilidades del carril BROWSER-E2E-REAL. Todo lo que hay aquí toca el
 * despliegue de verdad: PostgreSQL por `psql` dentro del contenedor y la API
 * por HTTP real. NO hay ni un `page.route`, ni un doble, ni un servidor falso.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import mqtt from "mqtt";

// `__dirname` y no `import.meta.url`: Playwright transpila esta suite a CJS
// (no hay `"type": "module"` en tests/e2e/package.json), igual que hace el
// carril GAME. Con `import.meta` la suite ni siquiera cargaría.
export const LANE_DIR = path.resolve(__dirname, "..");
export const ENV_FILE = path.join(LANE_DIR, ".tmp", "env.json");

export interface Entorno {
  webBaseUrl: string;
  apiBaseUrl: string;
  adminUsername: string;
  adminPassword: string;
  viewerUsername: string;
  viewerPassword: string;
  mqttUrl: string;
  mqttCaFile: string;
  /** Volumen con el `passwd` REAL del broker. Se inspecciona, no se edita. */
  mqttCredentialsVolume: string;
  postgres: { container: string; user: string; database: string; hostPort: number };
  containers: { postgres: string; mosquitto: string; backend: string; frontend: string };
}

/**
 * Lee el contrato del arnés. Si no existe, FALLA EN VOZ ALTA con la orden
 * exacta que hay que ejecutar: saltarse el escenario en silencio convertiría
 * «no se levantó» en «pasó».
 */
export function leerEntorno(): Entorno {
  try {
    return JSON.parse(readFileSync(ENV_FILE, "utf8")) as Entorno;
  } catch (e) {
    throw new Error(
      `No existe ${ENV_FILE}: el escenario NO está levantado y este carril no ` +
        `puede medir nada sin él.\n` +
        `  Levántalo con:  ./tests/e2e/modules-ui/harness/up.sh\n` +
        `  (antes: docker build -f tests/e2e/game/harness/Dockerfile.e2e -t diana/backend:e2emodules . ` +
        `y ./tests/e2e/modules-ui/harness/build-frontend.sh)\n` +
        `Causa original: ${(e as Error).message}`,
    );
  }
}

/**
 * Consulta a PostgreSQL POR EFECTO, con `psql` dentro del contenedor.
 *
 * `-qtAX` = sin adornos, sin cabecera, sin `.psqlrc`: una fila por línea y las
 * columnas separadas por `|`. La contraseña no hace falta porque se ejecuta
 * como el usuario del contenedor (peer/trust local), así que ningún secreto
 * pasa por argv.
 *
 * El código de salida se comprueba SIEMPRE: `execFileSync` lanza si no es 0,
 * y aquí se convierte en un error que dice qué consulta falló. Una cadena
 * vacía devuelta por un `psql` que reventó se leería como «cero filas», que es
 * justo la confusión que este carril no puede permitirse.
 */
export function psql(env: Entorno, sql: string): string[][] {
  let salida: string;
  try {
    salida = execFileSync(
      "docker",
      ["exec", env.postgres.container, "psql", "-qtAX", "-U", env.postgres.user, "-d", env.postgres.database, "-c", sql],
      { encoding: "utf8" },
    );
  } catch (e) {
    const err = e as { status?: number; stderr?: string | Buffer };
    throw new Error(
      `psql falló (rc=${err.status ?? "?"}) con la consulta:\n  ${sql}\n${String(err.stderr ?? "")}`,
    );
  }
  return salida
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => l.split("|"));
}

/** Una sola celda. Falla si la consulta no devolvió exactamente una fila. */
export function psqlUno(env: Entorno, sql: string): string[] {
  const filas = psql(env, sql);
  if (filas.length !== 1) {
    throw new Error(`Se esperaba EXACTAMENTE una fila y llegaron ${filas.length}.\n  ${sql}`);
  }
  return filas[0];
}

/** `docker` arbitrario con rc explícito (el paso 4 reinicia el backend). */
export function docker(args: string[]): string {
  try {
    return execFileSync("docker", args, { encoding: "utf8" });
  } catch (e) {
    const err = e as { status?: number; stderr?: string | Buffer };
    throw new Error(`docker ${args.join(" ")} falló (rc=${err.status ?? "?"}): ${String(err.stderr ?? "")}`);
  }
}

/** Espera a que el backend vuelva a responder tras un reinicio. Por EFECTO. */
export async function esperarBackend(env: Entorno, intentos = 90): Promise<void> {
  for (let i = 0; i < intentos; i += 1) {
    try {
      const r = await fetch(`${env.apiBaseUrl}/api/health`);
      if (r.ok) return;
    } catch {
      /* aún no escucha */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`El backend no volvió a responder en ${intentos}s tras el reinicio.`);
}

export interface Respuesta {
  status: number;
  body: unknown;
}

/** Petición HTTP REAL a la API. Devuelve estado y cuerpo; nunca lanza por 4xx. */
export async function api(
  env: Entorno,
  metodo: string,
  ruta: string,
  opciones: { token?: string; body?: unknown } = {},
): Promise<Respuesta> {
  const r = await fetch(`${env.apiBaseUrl}${ruta}`, {
    method: metodo,
    headers: {
      "Content-Type": "application/json",
      ...(opciones.token ? { Authorization: `Bearer ${opciones.token}` } : {}),
    },
    body: opciones.body === undefined ? undefined : JSON.stringify(opciones.body),
  });
  const texto = await r.text();
  let body: unknown = texto;
  try {
    body = texto.length > 0 ? JSON.parse(texto) : null;
  } catch {
    /* respuesta no-JSON: se conserva el texto */
  }
  return { status: r.status, body };
}

export async function login(env: Entorno, usuario: string, contrasena: string): Promise<string> {
  const r = await api(env, "POST", "/api/auth/login", { body: { username: usuario, password: contrasena } });
  const token = (r.body as { access_token?: string } | null)?.access_token;
  if (r.status !== 200 || !token) {
    throw new Error(`Login de ${usuario} falló (HTTP ${r.status}): ${JSON.stringify(r.body)}`);
  }
  return token;
}


/**
 * Lee el `passwd` REAL tal y como lo ve el BROKER.
 *
 * Se lee desde dentro del contenedor de mosquitto y no desde el host: el
 * fichero vive en un volumen, y el punto de la comprobación es justamente que
 * lo que escribe el backend es lo que el broker acaba viendo.
 */
export function leerPasswdDelBroker(env: Entorno): string {
  return docker(["exec", env.containers.mosquitto, "cat", "/mosquitto/credentials/passwd"]);
}

/** Modo octal del `passwd`, visto por el broker. */
export function modoPasswd(env: Entorno): string {
  return docker([
    "exec", env.containers.mosquitto, "stat", "-c", "%a", "/mosquitto/credentials/passwd",
  ]).trim();
}

/**
 * PID del VIGILANTE de recarga dentro del contenedor del broker.
 *
 * Se busca por sus argumentos y se descarta el PID 1, que es el mismo script
 * haciendo de supervisor. El que queda es el subshell que sondea el `passwd`.
 * Se localiza así y no con un número fijo porque un PID escrito a mano
 * convierte esta comprobación en algo que deja de medir en cuanto cambia el
 * orden de arranque, y lo hace en silencio.
 */
export function pidVigilante(env: Entorno): number {
  const salida = docker(["exec", env.containers.mosquitto, "ps", "-o", "pid,args"]);
  const pids = salida
    .split("\n")
    .filter((l) => l.includes("reload-on-passwd-change"))
    .map((l) => Number.parseInt(l.trim().split(/\s+/)[0], 10))
    .filter((n) => Number.isFinite(n) && n !== 1);
  if (pids.length !== 1) {
    throw new Error(`Se esperaba EXACTAMENTE un vigilante y hay ${pids.length}:\n${salida}`);
  }
  return pids[0];
}

/** Congela o reanuda el vigilante. `-STOP` / `-CONT`, sin matarlo. */
export function senalarVigilante(env: Entorno, senal: "STOP" | "CONT"): void {
  docker(["exec", env.containers.mosquitto, "kill", `-${senal}`, String(pidVigilante(env))]);
}

// ============================================================================
// Cliente MQTT REAL contra el broker del escenario
// ============================================================================
/*
 * Se usa la librería `mqtt` de Node y NO `mosquitto_pub`, y la razón está
 * medida: con `mosquitto_pub`, una publicación DENEGADA por ACL sale con
 * **rc=0** y un `Warning: ... Not authorized` en stderr. Un arnés que mire el
 * código de salida da por buena una denegación. El cliente de Node en
 * `protocolVersion: 5` entrega el reason code del PUBACK como un
 * `ErrorWithReasonCode`, que es evidencia y no un aviso.
 *
 * El SUBACK NO sirve para lo mismo: mosquitto concede QoS 1 a una suscripción
 * que la ACL deniega y simplemente no entrega nada. Por eso el control
 * POSITIVO de lectura se hace por EFECTO — recibiendo el mensaje retenido —
 * y no leyendo el SUBACK.
 */

export interface ResultadoConexion {
  conectado: boolean;
  /** Reason code MQTT 5 del CONNACK cuando el broker rechaza (135 = no autorizado). */
  codigo: number | null;
  mensaje: string;
}

function opciones(env: Entorno, usuario: string, contrasena: string) {
  return {
    protocolVersion: 5 as const,
    username: usuario,
    password: contrasena,
    ca: readFileSync(env.mqttCaFile),
    // El certificado del broker lleva `localhost` en su SAN; la URL del arnés
    // es 127.0.0.1. Se valida la CA y se fija el nombre esperado a mano en vez
    // de desactivar la verificación: apagarla haría pasar la prueba con
    // cualquier certificado, que es justo lo que no se quiere comprobar.
    servername: "localhost",
    rejectUnauthorized: true,
    reconnectPeriod: 0,
    connectTimeout: 8000,
    clean: true,
  };
}

/** Intenta CONECTAR. No lanza: devuelve el veredicto y el motivo. */
export function conectarMqtt(env: Entorno, usuario: string, contrasena: string): Promise<ResultadoConexion> {
  return new Promise((resolve) => {
    const cliente = mqtt.connect(env.mqttUrl, opciones(env, usuario, contrasena));
    const cerrar = (r: ResultadoConexion) => {
      cliente.end(true, {}, () => resolve(r));
    };
    cliente.on("connect", () => cerrar({ conectado: true, codigo: 0, mensaje: "CONNACK aceptado" }));
    cliente.on("error", (e: Error & { code?: number }) =>
      cerrar({ conectado: false, codigo: e.code ?? null, mensaje: e.message }),
    );
  });
}

export interface ResultadoAcl {
  /** El mensaje retenido recibido en la suscripción, si llegó. */
  recibido: string | null;
  /** Error de la publicación denegada, con su reason code. */
  publicacionDenegada: { codigo: number | null; mensaje: string } | null;
  publicacionAceptada: boolean;
}

/**
 * Comprueba la ACL de un módulo YA autenticado, sin fabricar presencia.
 *
 * - LECTURA permitida: se suscribe a su propio `config/desired` y espera el
 *   mensaje RETENIDO que el backend publicó. Que llegue es la prueba.
 * - ESCRITURA denegada: publica en el subárbol de OTRO módulo. Debe salir
 *   rechazado. No se publica nada en el subárbol propio: hacerlo inventaría un
 *   dispositivo que no existe.
 */
export function comprobarAcl(
  env: Entorno,
  usuario: string,
  contrasena: string,
  temaPropio: string,
  temaAjeno: string,
): Promise<ResultadoAcl> {
  return new Promise((resolve, reject) => {
    const cliente = mqtt.connect(env.mqttUrl, opciones(env, usuario, contrasena));
    const r: ResultadoAcl = { recibido: null, publicacionDenegada: null, publicacionAceptada: false };
    const temporizador = setTimeout(() => {
      cliente.end(true, {}, () => resolve(r));
    }, 8000);
    const terminar = () => {
      clearTimeout(temporizador);
      cliente.end(true, {}, () => resolve(r));
    };

    cliente.on("error", (e) => {
      clearTimeout(temporizador);
      cliente.end(true, {}, () => reject(e));
    });
    cliente.on("message", (_t, carga) => {
      r.recibido = carga.toString();
      if (r.publicacionDenegada !== null || r.publicacionAceptada) terminar();
    });
    cliente.on("connect", () => {
      cliente.subscribe(temaPropio, { qos: 1 }, () => {
        // La publicación al subárbol AJENO va después de la suscripción para
        // que el retenido tenga tiempo de llegar en la misma sesión.
        cliente.publish(temaAjeno, JSON.stringify({ prueba: "acl" }), { qos: 1 }, (error) => {
          const e = error as (Error & { code?: number }) | null | undefined;
          if (e) r.publicacionDenegada = { codigo: e.code ?? null, mensaje: e.message };
          else r.publicacionAceptada = true;
          if (r.recibido !== null) terminar();
        });
      });
    });
  });
}
