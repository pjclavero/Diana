/**
 * Utilidades del carril BROWSER-E2E-REAL. Todo lo que hay aquí toca el
 * despliegue de verdad: PostgreSQL por `psql` dentro del contenedor y la API
 * por HTTP real. NO hay ni un `page.route`, ni un doble, ni un servidor falso.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

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
