import type { paths } from "./generated/schema";
import { ApiError } from "./client";
import { getToken } from "../auth/tokenStore";

/**
 * Helper de peticiones REST tipado contra el contrato generado desde el
 * backend (`contracts/api/openapi.json` → `openapi-typescript` →
 * `./generated/schema.d.ts`). Es la puerta del CONSUMIDOR de la auditoría de
 * pantallas (docs/coordination/AUDITORIA-PANTALLAS-2026-08-05.md §3.3):
 *
 *   - Ruta inexistente o renombrada → error de compilación (`P` deja de
 *     pertenecer a `keyof paths`).
 *   - Método no soportado en esa ruta → error de compilación (`M` deja de
 *     pertenecer a `keyof paths[P]`).
 *   - Forma de la respuesta distinta a la declarada → error de compilación
 *     EN CUANTO el endpoint tenga `@ApiResponse({ type })` en el backend.
 *
 * Lo que la puerta NO atrapa todavía, y qué falta exactamente para que atrape
 * la forma: ver `./README.md`. Resumen: hoy CERO de las 112 rutas del contrato
 * llevan `@ApiResponse({ type })`, así que `ApiResponseOf<P, M>` resuelve a
 * `unknown` en todas y la clase de fallo «forma distinta» (`{items,total}`
 * frente a array) sigue sin cubrirse. Para no fingir lo contrario, los
 * clientes que necesiten una forma concreta la declaran con `apiRequestAs`,
 * que se AUTODESACTIVA en cuanto el contrato sí declara esa forma.
 *
 * NINGÚN cliente de `src/api/` debe llamar a `fetch` por su cuenta: lo impide
 * `./no-fetch-fuera-de-la-puerta.test.ts`, que recorre el AST de todo `src/`.
 */

export type ApiPath = keyof paths;

/**
 * Convierte una plantilla OpenAPI ("/api/modules/{id}") en un patrón de
 * plantilla literal de TypeScript ("/api/modules/${string}"), para poder
 * comprobar en tiempo de compilación las rutas interpoladas con variables
 * (IDs, slugs...) sin perder la comprobación de que la plantilla existe.
 */
type AsUrlPattern<S extends string> = S extends `${infer Head}{${string}}${infer Tail}`
  ? `${Head}${string}${AsUrlPattern<Tail>}`
  : S;

/** Admite además una query string arbitraria detrás de la ruta. */
type ApiUrl<P extends ApiPath> = AsUrlPattern<P> | `${AsUrlPattern<P>}?${string}`;

type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

/**
 * Métodos que el contrato declara PARA ESA RUTA.
 *
 * DEFECTO CORREGIDO AQUÍ, destapado por `puerta-de-tipos.test.ts`: antes el
 * parámetro `M` sólo estaba acotado a `HttpMethod`, así que pedir un método
 * que la ruta NO declara compilaba perfectamente y se limitaba a resolver el
 * tipo de respuesta a `never`. Es decir, la clase de fallo «método equivocado»
 * que la documentación de este fichero daba por cubierta NO lo estaba. Ahora
 * `M` se acota a los métodos reales de la ruta y esa llamada no compila.
 */
type MethodsOf<P extends ApiPath> = Extract<keyof paths[P], HttpMethod>;

type OperationOf<P extends ApiPath, M extends HttpMethod> = M extends keyof paths[P] ? paths[P][M] : never;

type JsonBody<Op> = Op extends { responses: infer R }
  ? R extends Record<PropertyKey, { content?: { "application/json"?: infer B } }>
    ? B
    : unknown
  : never;

/** Respuesta 2xx documentada por el contrato para PATH+MÉTODO. */
export type ApiResponseOf<P extends ApiPath, M extends HttpMethod = "get"> = JsonBody<OperationOf<P, M>>;

/**
 * `true` sólo si el contrato NO dice nada de la forma (hoy: las 112 rutas).
 * `unknown extends T` es cierto únicamente para `unknown` (y `any`), que es
 * exactamente lo que emite el generador cuando falta `@ApiResponse({ type })`.
 */
type EsDesconocido<T> = unknown extends T ? true : false;

/**
 * Marca de tipo IMPOSIBLE de satisfacer con una ruta literal. Se intersecta
 * con `P` cuando el contrato YA declara la forma de esa ruta, de modo que la
 * llamada a `apiRequestAs` deja de compilar y obliga a usar `apiRequest` con
 * el tipo del contrato. Así, anotar un controlador en el backend no puede
 * quedar tapado por una anotación local obsoleta del panel.
 */
type El_contrato_YA_declara_la_forma_de_esta_ruta_use_apiRequest_en_vez_de_apiRequestAs = {
  readonly __marca: never;
};

type SoloSiElContratoCalla<P extends ApiPath, M extends HttpMethod> =
  EsDesconocido<ApiResponseOf<P, M>> extends true
    ? unknown
    : El_contrato_YA_declara_la_forma_de_esta_ruta_use_apiRequest_en_vez_de_apiRequestAs;

/**
 * DEFECTO CORREGIDO AQUÍ (comprobado, no supuesto). Las rutas del contrato ya
 * incluyen el prefijo global del backend (`/api/modules`, no `/modules`), pero
 * `VITE_API_BASE_URL` vale `/api` en producción (`server/frontend/Dockerfile:20`,
 * `compose.yml:84`) y `/api/v1` en `server/frontend/.env.example:4`. Concatenar
 * base + ruta del contrato producía `/api/api/modules` — es decir, la MUESTRA
 * que demostraba la puerta habría dado 404 en cuanto se desplegase, y sólo
 * funcionaba en desarrollo con la variable sin definir. Aquí la base se reduce
 * a su ORIGEN: se le quita el sufijo `/api` (con o sin `/vN`), porque ese
 * segmento ya lo pone el contrato.
 */
export function baseOrigin(raw: string): string {
  return raw.replace(/\/api(\/v\d+)?\/?$/, "");
}

const BASE = baseOrigin(import.meta.env.VITE_API_BASE_URL ?? "");

export interface ApiRequestInit extends Omit<RequestInit, "method"> {
  method?: Uppercase<HttpMethod>;
  /**
   * Conserva el mensaje del servidor también en 401/403. Se usa donde la razón
   * exacta del rechazo le ahorra tiempo al operador («partida en curso»,
   * «panel ajeno») y decirle «no tiene permiso» le despistaría.
   */
  preferServerDetail?: boolean;
  /** Mensaje propio para el 404, si «no encontrado» genérico no sirve. */
  notFoundMessage?: string;
}

async function ejecutar(url: string, init: ApiRequestInit | undefined): Promise<unknown> {
  const { preferServerDetail, notFoundMessage, ...fetchInit } = init ?? {};
  const token = getToken();
  const cabeceras: Record<string, string> = {
    ...(fetchInit.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init?.headers as Record<string, string>),
  };
  let res: Response;
  try {
    res = await fetch(`${BASE}${url}`, { ...fetchInit, headers: cabeceras });
  } catch {
    throw new ApiError("No se puede contactar con el servidor.");
  }
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { message?: string | string[] };
      // Nest devuelve `message` como array en los fallos de validación.
      detail = (Array.isArray(body.message) ? body.message[0] : body.message) ?? "";
    } catch {
      /* sin cuerpo interpretable */
    }
    if (preferServerDetail && detail) throw new ApiError(detail);
    if (res.status === 401 || res.status === 403) throw new ApiError("No tiene permiso para esta acción.");
    if (res.status === 404 && notFoundMessage) throw new ApiError(notFoundMessage);
    throw new ApiError(detail || "El servidor no ha podido completar la operación.");
  }
  if (res.status === 204) return undefined;
  return await res.json();
}

/**
 * `path` es la PLANTILLA del contrato (debe existir literalmente en `paths`,
 * prefijo `/api` incluido); `url` es la URL real ya interpolada y su forma se
 * comprueba contra la plantilla. La respuesta se tipa con lo que el contrato
 * declara para ese PATH+método (hoy `unknown` en todas: ver `./README.md`).
 */
export async function apiRequest<P extends ApiPath, M extends MethodsOf<P> = Extract<"get", MethodsOf<P>>>(
  path: P,
  url: ApiUrl<P>,
  init?: ApiRequestInit,
): Promise<ApiResponseOf<P, M>> {
  void path; // sólo se usa a nivel de tipos, para anclar P
  return (await ejecutar(url, init)) as ApiResponseOf<P, M>;
}

/**
 * Igual que `apiRequest`, pero declarando LOCALMENTE la forma `T` de la
 * respuesta mientras el contrato calla.
 *
 * Sustituye a los `as Promise<X>` que había repartidos por los clientes. La
 * diferencia no es cosmética: un `as` silencia el error PARA SIEMPRE, también
 * el día en que el contrato empiece a declarar una forma DISTINTA de la que el
 * panel supone. Aquí, en cuanto ese endpoint reciba `@ApiResponse({ type })`
 * en el backend, `SoloSiElContratoCalla` deja de resolver a `unknown` y esta
 * llamada NO COMPILA. La anotación local es explícitamente temporal y se
 * autodenuncia.
 *
 * Va CURRIFICADA (`apiRequestAs<T>()(path, url)`) a propósito: TypeScript no
 * infiere unos argumentos de tipo cuando se escriben otros, así que la única
 * forma de fijar `T` a mano SIN perder la inferencia de `P` (y con ella la
 * comprobación de que la URL casa con la plantilla del contrato) es separar
 * las dos aplicaciones. Con una sola lista, escribir `T` obligaría a `P` a
 * caer en su valor por defecto y la puerta dejaría de comprobar la URL.
 */
export function apiRequestAs<T>() {
  return async function <P extends ApiPath, M extends MethodsOf<P> = Extract<"get", MethodsOf<P>>>(
    path: P & SoloSiElContratoCalla<P, M>,
    url: ApiUrl<P>,
    init?: ApiRequestInit,
  ): Promise<T> {
    void path;
    return (await ejecutar(url, init)) as T;
  };
}
