import { ApiError } from "./client";
import { apiRequestAs } from "./typedRequest";

/**
 * API REAL del plano de APROVISIONAMIENTO (T2). Dos rutas, y ninguna de las dos
 * hace lo que su nombre podría sugerir a primera vista:
 *
 *   - `POST /api/provisioning/modules/{deviceId}/orders` (`provisioning:issue`)
 *     NO devuelve «aceptado». Devuelve el RESULTADO REAL de la publicación MQTT
 *     que hizo el backend. Una denegación de ACL del broker no se distingue por
 *     el código de retorno del cliente MQTT: lo único que la delata es el
 *     `reason_code` del PUBACK. Por eso la respuesta trae `delivered`, `denied`,
 *     `timed_out` y `reason_code` por separado, y por eso este cliente NO los
 *     colapsa en un booleano de éxito: el matiz tiene que llegar al operador.
 *
 *   - `GET /api/provisioning/modules/{deviceId}/state` (`provisioning:read`)
 *     devuelve la última fotografía OBSERVACIONAL: lo que el módulo DIJO, no
 *     una verdad del sistema ni un `desired state` ejecutable. El backend lo
 *     marca él mismo con `observational_only: true`.
 *
 * NINGUNO de los dos permisos figura en ningún conjunto de roles del backend
 * (`src/domain/rbac/permissions.ts`): hoy sólo el `*` del administrador los
 * cubre, y NO se heredan de `commands:publish`. La pantalla lo tiene en cuenta.
 *
 * El panel NUNCA genera credenciales: la huella de la clave de aprovisionamiento
 * (`provisioning_key_fingerprint`) es un dato que el operador APORTA, no algo
 * que aquí se calcule, se derive ni se invente.
 *
 * Todas las peticiones pasan por la puerta tipada (`apiRequestAs`), como el
 * resto de `src/api/`: nada de `fetch` propio.
 */

/** Las tres acciones que el DTO del backend (`IssueOrderDto`) admite. */
export type AccionAprovisionamiento = "PROVISION" | "PREPARE" | "COMMIT";
export type ModoAprovisionamiento = "NORMAL" | "EMERGENCY";

/** Cuerpo de la orden, en la forma `snake_case` que el backend valida. */
export interface OrdenAprovisionamiento {
  system_id: string;
  action: AccionAprovisionamiento;
  mode?: ModoAprovisionamiento;
  /** 64 caracteres hexadecimales. Lo APORTA el operador: el panel no lo genera. */
  provisioning_key_fingerprint: string;
  rotation_id?: string;
  current_epoch?: string;
  next_epoch?: string;
  epoch?: string;
  provision_id?: string;
}

/**
 * Lo que de verdad contesta el POST. Nótese que NO hay campo «ok»: el éxito no
 * es un dato del backend, es una conclusión que sólo se puede sacar mirando las
 * tres banderas a la vez (ver `resultadoDePublicacion`).
 */
export interface ResultadoOrden {
  request_id: string;
  provisioning_sequence: string | number;
  topic: string;
  delivered: boolean;
  denied: boolean;
  timed_out: boolean;
  reason_code: number | null;
}

/** Fotografía observacional. `observational_only` siempre viene a `true`. */
export interface EstadoAprovisionamientoObservado {
  device_id: string;
  system_id: string | null;
  request_id: string | null;
  correlated: boolean;
  result: string | null;
  state: string | null;
  active_epoch: string | null;
  pending_epoch: string | null;
  rotation_id: string | null;
  provision_id: string | null;
  last_provisioning_sequence: string | null;
  last_delegation_sequence: string | null;
  provisioning_key_fingerprint: string | null;
  reason: string | null;
  received_at: string;
  observational_only: boolean;
}

/** Emite la orden firmada. El frontend no publica MQTT: se lo pide al backend. */
export function issueProvisioningOrder(
  deviceId: string,
  orden: OrdenAprovisionamiento,
): Promise<ResultadoOrden> {
  return apiRequestAs<ResultadoOrden>()<"/api/provisioning/modules/{deviceId}/orders", "post">(
    "/api/provisioning/modules/{deviceId}/orders",
    `/api/provisioning/modules/${encodeURIComponent(deviceId)}/orders`,
    { method: "POST", body: JSON.stringify(orden), preferServerDetail: true },
  );
}

/**
 * Última observación del módulo, o `null` si NUNCA ha reportado.
 *
 * El `null` es deliberado y no es un atajo: el backend responde 404 en ese caso,
 * y hoy —sin ningún dispositivo físico conectado— ése es el caso NORMAL, no una
 * avería. Cualquier otro fallo (500, red caída, 403 por falta de
 * `provisioning:read`) se PROPAGA como `ApiError`, para que la pantalla lo
 * pinte como error y no como «no hay nada». Confundir «no hay nada» con «no he
 * podido preguntar» es el defecto que ya se coló una vez en este panel.
 */
export async function getProvisioningState(
  deviceId: string,
): Promise<EstadoAprovisionamientoObservado | null> {
  try {
    return await apiRequestAs<EstadoAprovisionamientoObservado>()(
      "/api/provisioning/modules/{deviceId}/state",
      `/api/provisioning/modules/${encodeURIComponent(deviceId)}/state`,
    );
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export type VeredictoPublicacion = "entregada" | "denegada" | "sin-acuse" | "no-entregada";

export interface LecturaDelResultado {
  veredicto: VeredictoPublicacion;
  /** Etiqueta corta. Nunca «OK» a secas cuando el broker no lo confirmó. */
  etiqueta: string;
  /** Frase para el operador, con el `reason_code` dentro cuando lo hay. */
  motivo: string;
  /** ¿Puede el operador dar la orden por buena? Sólo `entregada`. */
  correcto: boolean;
}

/**
 * Traduce el resultado REAL de la publicación a algo que un operador pueda leer,
 * SIN colapsarlo en éxito/fracaso antes de tiempo.
 *
 * El orden de las ramas importa y es la propiedad que se calibra en la prueba:
 * `denied` se mira ANTES que `delivered`. Escribirlo al revés —o mirar sólo
 * `delivered`— es exactamente cómo una denegación de ACL del broker acabaría
 * pintada como «orden enviada correctamente», que es la mentira concreta que
 * este carril tiene prohibida.
 */
export function resultadoDePublicacion(r: ResultadoOrden): LecturaDelResultado {
  const codigo = r.reason_code === null || r.reason_code === undefined ? null : r.reason_code;
  const conCodigo = codigo === null ? "El broker no ha devuelto ningún reason_code." : `reason_code ${codigo}.`;

  if (r.denied) {
    return {
      veredicto: "denegada",
      etiqueta: "DENEGADA por el broker",
      motivo:
        `El broker RECHAZÓ la publicación en «${r.topic}»: la orden NO ha salido hacia el módulo. ` +
        `${conCodigo} Es una denegación de ACL, no un fallo de red: revise los permisos MQTT del backend.`,
      correcto: false,
    };
  }
  if (r.timed_out) {
    return {
      veredicto: "sin-acuse",
      etiqueta: "SIN ACUSE (tiempo agotado)",
      motivo:
        `Se publicó en «${r.topic}» y el acuse (PUBACK) no llegó a tiempo. NO se puede afirmar ` +
        `que la orden haya llegado, ni que no. ${conCodigo} Compruebe el estado observado antes de repetirla.`,
      correcto: false,
    };
  }
  if (r.delivered) {
    return {
      veredicto: "entregada",
      etiqueta: "Entregada al broker",
      motivo:
        `El broker acusó la publicación en «${r.topic}». ${conCodigo} ` +
        `Esto confirma la ENTREGA AL BROKER, no que el módulo la haya aplicado: eso sólo lo dice ` +
        `el estado observado que reporte el propio módulo.`,
      correcto: true,
    };
  }
  return {
    veredicto: "no-entregada",
    etiqueta: "NO entregada",
    motivo:
      `La publicación en «${r.topic}» no consta entregada y el backend no la marca ni denegada ni ` +
      `caducada. ${conCodigo} No dé la orden por emitida.`,
    correcto: false,
  };
}
