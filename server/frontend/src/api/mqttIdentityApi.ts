import { ApiError } from "./client";
import { apiRequestAs } from "./typedRequest";

/**
 * CREDENCIAL MQTT individual de un módulo (T4).
 *
 * Tres rutas, un solo principio: **el servidor es la única autoridad**. El
 * panel no genera contraseñas, ni las deriva, ni las guarda. Se limita a pedir
 * la emisión, a enseñar UNA vez lo que el backend devuelve y a olvidarlo.
 *
 *  - `POST /api/modules/{id}/mqtt-identity` (`provisioning:issue`, hoy sólo el
 *    rol `administrador`) EMITE o ROTA. Devuelve `secret` en claro y es la
 *    única vez que existe fuera del broker: no se persiste, no se registra y no
 *    hay endpoint que lo devuelva.
 *  - `GET` devuelve METADATOS. Por construcción no puede traer el secreto: el
 *    backend guarda un hash bcrypt, no la contraseña. Cuando el módulo no tiene
 *    credencial contesta 200 con `{ issued: false, note }`, no un 404 — por eso
 *    aquí hay una unión discriminada y no un `| null` que se confundiría con
 *    «no he podido preguntar».
 *  - `DELETE` revoca (retira del broker y marca la fila; no la borra).
 *
 * El 409 de reemisión NO es un fallo del sistema: es la respuesta correcta a
 * pedir dos veces lo que sólo se entrega una. `preferServerDetail: true` deja
 * que su mensaje real —que ya explica que hay que ROTAR, no recuperar— llegue
 * al operador, y `esConflictoDeCredencial` permite a la pantalla pintarlo como
 * lo que es.
 */

/** Lo que devuelve la EMISIÓN. `secret` sólo vive en memoria y sólo un rato. */
export interface CredencialEmitida {
  moduleId: string;
  slug: string;
  username: string;
  /** `client_id` que el broker IMPONE (`use_username_as_clientid`). */
  clientId: string;
  /** La contraseña en claro. NUNCA se almacena ni se registra en el panel. */
  secret: string;
  fingerprint: string;
  generation: number;
  issuedAt: string;
  warning: string;
}

/** Metadatos de una credencial ya emitida. Sin secreto, por construcción. */
export interface MetadatosCredencial {
  moduleId: string;
  slug: string;
  username: string;
  clientId: string;
  fingerprint: string;
  generation: number;
  issuedAt: string;
  deliveredAt: string;
  revokedAt: string | null;
  issuedByUsername: string | null;
}

/** Respuesta del backend cuando el módulo NUNCA ha tenido credencial. */
export interface SinCredencial {
  issued: false;
  note: string;
}

export type ConsultaCredencial = MetadatosCredencial | SinCredencial;

/** Discriminador explícito: no se deduce de que falte un campo. */
export function tieneCredencial(c: ConsultaCredencial): c is MetadatosCredencial {
  return (c as SinCredencial).issued !== false;
}

export function emitirCredencialMqtt(moduleId: string, rotar = false): Promise<CredencialEmitida> {
  return apiRequestAs<CredencialEmitida>()<"/api/modules/{id}/mqtt-identity", "post">(
    "/api/modules/{id}/mqtt-identity",
    `/api/modules/${encodeURIComponent(moduleId)}/mqtt-identity`,
    { method: "POST", body: JSON.stringify({ rotate: rotar }), preferServerDetail: true },
  );
}

export function consultarCredencialMqtt(moduleId: string): Promise<ConsultaCredencial> {
  return apiRequestAs<ConsultaCredencial>()(
    "/api/modules/{id}/mqtt-identity",
    `/api/modules/${encodeURIComponent(moduleId)}/mqtt-identity`,
    { preferServerDetail: true },
  );
}

export function revocarCredencialMqtt(
  moduleId: string,
): Promise<{ username: string; revokedAt: string }> {
  return apiRequestAs<{ username: string; revokedAt: string }>()<
    "/api/modules/{id}/mqtt-identity",
    "delete"
  >(
    "/api/modules/{id}/mqtt-identity",
    `/api/modules/${encodeURIComponent(moduleId)}/mqtt-identity`,
    { method: "DELETE", preferServerDetail: true },
  );
}

/** ¿Es el 409 de «ya tiene credencial»? Se pinta como conflicto, no como avería. */
export function esConflictoDeCredencial(e: unknown): e is ApiError {
  return e instanceof ApiError && e.status === 409;
}
