/**
 * MODO DEL PANEL (`mock` ↔ `real`): resolución ÚNICA y cerrada por defecto.
 *
 * ── El defecto que esto corrige ──────────────────────────────────────────────
 *
 * `mock` era el valor por defecto en TRES sitios a la vez —`Dockerfile`,
 * `.env.example` y `compose.yml`— y el código lo remataba con
 * `import.meta.env.VITE_API_MODE ?? "mock"`. Es decir: **una imagen de
 * producción construida sin pasar nada salía sirviendo datos de demostración**,
 * y lo hacía en silencio, con la misma apariencia que la de verdad. Un panel
 * que enseña módulos inventados a un operador es peor que un panel caído: el
 * caído se nota.
 *
 * Aquí se invierten las dos mitades del problema:
 *
 *  1. **El defecto pasa a ser `real`.** Ausencia de configuración ya no
 *     significa demostración.
 *  2. **`mock` en una build de producción está prohibido**, no desaconsejado.
 *     `resolverModoApi` lanza, y la carga del módulo `src/api/index.ts` la
 *     propaga: el panel no arranca en vez de arrancar mintiendo. La misma
 *     regla se aplica antes, en el propio `vite build` (ver el complemento
 *     `guardaDeModoProductivo` de `vite.config.ts`), de modo que ni siquiera
 *     llega a existir un bundle de producción con el adaptador de demostración
 *     dentro.
 *
 * Las dos comprobaciones son deliberadamente redundantes y NO son la misma:
 * la de `vite.config.ts` mira el entorno de compilación (puede saltarse
 * ejecutando `vite build --mode development`), y ésta mira lo que quedó
 * *horneado* en el bundle (`import.meta.env.PROD`), que es lo que de verdad se
 * sirve. Falsable: fuerza una build productiva en `mock` y falla; ver
 * `apiMode.test.ts` y el README.
 */

export type ApiMode = "mock" | "real";

/** Ausencia de configuración = producto real. Nunca demostración. */
export const MODO_POR_DEFECTO: ApiMode = "real";

const MODOS: readonly ApiMode[] = ["mock", "real"];

/** Fallo de configuración, no de red: se distingue para no tratarlo como avería del backend. */
export class ConfiguracionDeModoInvalida extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ConfiguracionDeModoInvalida";
  }
}

/** Subconjunto de `import.meta.env` que hace falta aquí (y que las pruebas pueden fabricar). */
export interface EntornoDeModo {
  VITE_API_MODE?: string;
  /** `true` en un bundle compilado para producción (`vite build`). */
  PROD?: boolean;
  /** Modo de Vite: `production`, `development`, `test`… */
  MODE?: string;
  /** Presente cuando el bundle se compiló con `NODE_ENV=production`. */
  NODE_ENV?: string;
}

/** ¿Este bundle se compiló como producción? Cualquiera de las tres señales basta. */
export function esCompilacionDeProduccion(env: EntornoDeModo): boolean {
  return env.PROD === true || env.MODE === "production" || env.NODE_ENV === "production";
}

/**
 * Devuelve el modo efectivo o LANZA. No hay tercera salida: devolver `mock`
 * "por si acaso" es precisamente el comportamiento que se está eliminando.
 */
export function resolverModoApi(env: EntornoDeModo): ApiMode {
  const bruto = (env.VITE_API_MODE ?? "").trim();

  if (bruto === "") {
    // Ausencia = `real`. Y si además es producción, `real` es lo correcto,
    // así que no hay nada que avisar.
    return MODO_POR_DEFECTO;
  }

  if (!MODOS.includes(bruto as ApiMode)) {
    // Antes esto se casteaba a ciegas (`as "mock" | "real"`) y cualquier
    // errata —`REAL`, `prod`, `true`— caía en la rama de demostración por ser
    // "distinto de real". Una errata no puede activar los datos falsos.
    throw new ConfiguracionDeModoInvalida(
      `VITE_API_MODE="${bruto}" no es un modo válido. Valores admitidos: ${MODOS.join(", ")}. ` +
        `El panel no arranca con un modo desconocido: hacerlo significaría elegir uno por él.`,
    );
  }

  const modo = bruto as ApiMode;

  if (modo === "mock" && esCompilacionDeProduccion(env)) {
    throw new ConfiguracionDeModoInvalida(
      "CONFIGURACIÓN PROHIBIDA: VITE_API_MODE=mock en una compilación de producción. " +
        "El panel serviría datos de DEMOSTRACIÓN (módulos, partidas e incidencias inventados) " +
        "con la apariencia del sistema real. Compila con VITE_API_MODE=real, o usa una build " +
        "de desarrollo (`vite build --mode development`) si de verdad quieres la demostración.",
    );
  }

  return modo;
}
