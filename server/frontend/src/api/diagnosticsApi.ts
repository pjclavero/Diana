import { ApiError } from "./client";
import { getToken } from "../auth/tokenStore";

/**
 * API REAL de diagnóstico de módulo y diana (F6).
 *
 * Las tres pantallas de diagnóstico —prueba de LED, prueba de sensores y
 * calibración— eran las últimas de su familia que seguían colgando del
 * adaptador de demostración: el operador ordenaba una prueba y la respuesta se
 * la inventaba el navegador. Con este cliente hablan con `/api` de verdad, como
 * el resto de pantallas nuevas, sin depender del interruptor global
 * `VITE_API_MODE`.
 *
 * Se mantiene aparte de `realAdapter` a propósito: cablear pantalla a pantalla
 * es lo que permite ir vaciando el adaptador sin romper las heredadas.
 */
const BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers as Record<string, string>),
      },
    });
  } catch {
    throw new ApiError("No se puede contactar con el servidor.");
  }
  if (res.status === 401 || res.status === 403) {
    throw new ApiError("No tiene permiso para esta acción.");
  }
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { message?: string | string[] };
      detail = (Array.isArray(body.message) ? body.message[0] : body.message) ?? "";
    } catch {
      /* sin cuerpo */
    }
    throw new ApiError(detail || "El servidor no ha podido completar la operación.");
  }
  return (await res.json()) as T;
}

/**
 * Estados de diana del contrato MQTT v1, congelado. No son «patrones» de
 * animación: son los estados que el firmware entiende. Inventar uno hace que el
 * validador de salida tumbe la orden y el comando no salga nunca.
 */
export const TARGET_STATES = [
  "off",
  "safe",
  "active",
  "hit",
  "countdown",
  "penalty",
  "error",
  "calibration",
  "locked",
  "sensor_error",
  "maintenance",
  "disabled",
] as const;
export type TargetState = (typeof TARGET_STATES)[number];

/**
 * Respuesta a una orden de MANTENIMIENTO, tal y como la devuelve el backend.
 *
 * `delivered: true` significa EXCLUSIVAMENTE que el backend publicó en el
 * broker. No dice nada del hardware: la confirmación de ejecución sólo puede
 * venir del módulo, por `diagnostic` correlado con `request_id`.
 *
 * Esta interfaz declaraba `action` y `command_id`, que el backend NO envía
 * (devuelve `command_type` y `request_id`), y OMITÍA `denied` —de modo que una
 * denegación del broker por ACL se le presentaba al operador como «la orden
 * queda encolada», que es falso—. Ahora es la forma real de `dispatch()`.
 */
export interface CommandAck {
  module_id: string;
  command_type: string;
  request_id: string;
  delivered: boolean;
  /** El broker DENEGÓ la publicación (ACL). No es un encolado. */
  denied?: boolean;
  /** El backend ya había cursado esta misma `request_id`: no republica. */
  duplicate?: boolean;
  note: string;
  /** Diana a la que se refería la petición, si la había. */
  target_index?: number;
  /**
   * ALCANCE REAL de la orden. El contrato v1 no tiene prueba de sensor ni
   * calibración por diana: ambas son del MÓDULO completo. El backend lo declara
   * aquí para que la pantalla no sugiera que actúa sobre una diana suelta.
   */
  scope?: "module" | "target";
}

export interface DiagnosticItem {
  id: string;
  kind: string;
  severity: "info" | "warning" | "error" | "critical";
  message: string;
  detail: Record<string, unknown> | null;
  /** Hora del SUCESO según el módulo. `null` si el módulo no tiene reloj. */
  occurredAt: string | null;
  /** Hora en que lo recibió el backend. Siempre presente. */
  receivedAt: string;
  timeBasis: "module_epoch" | "ingest_received";
  /**
   * Correlación con la orden que lo originó. `null` en los diagnósticos
   * espontáneos (boot, sensor_error, low_voltage…). Es el ÚNICO campo que
   * permite saber si este diagnóstico responde a la orden que se acaba de
   * dar: filtrar por `kind` presentaba como respuesta un diagnóstico de hace
   * dos horas.
   */
  requestId: string | null;
}

export interface DiagnosticResults {
  module: string;
  moduleRegistered: boolean;
  items: DiagnosticItem[];
  note: string | null;
}

export const identifyModule = (idOrSlug: string, durationMs = 4000, requestId?: string) =>
  req<CommandAck>(`/modules/${encodeURIComponent(idOrSlug)}/commands/identify`, {
    method: "POST",
    body: JSON.stringify({ duration_ms: durationMs, ...(requestId ? { request_id: requestId } : {}) }),
  });

/**
 * Prueba de LED de una diana.
 *
 * La ampliación v1.1 del contrato quitó `state` de este canal: el LED de
 * MANTENIMIENTO se prueba por DURACIÓN, porque `state` era un campo del tópico
 * de juego (`module-command`), que el backend ya no escribe. El panel seguía
 * mandando `{ state }` y el backend corre con `forbidNonWhitelisted`, así que
 * respondía 400 y la orden no llegaba a publicarse: el botón de la pantalla de
 * prueba de LED no encendía nada. Las pruebas del panel no podían verlo porque
 * mockean esta función, no el cuerpo que viaja.
 *
 * El toggle de la pantalla se conserva traduciéndolo aquí: apagar es una
 * duración de 0, y encender omite el campo para que mande el valor por defecto
 * del servidor en vez de fijar una segunda copia del mismo número en el cliente.
 */
export const testLed = (
  idOrSlug: string,
  targetIndex: number,
  state: TargetState,
  requestId?: string,
) =>
  req<CommandAck>(
    `/modules/${encodeURIComponent(idOrSlug)}/targets/${targetIndex}/test-led`,
    {
      method: "POST",
      body: JSON.stringify({
        ...(state === "off" ? { duration_ms: 0 } : {}),
        // El identificador lo elige el CLIENTE y viaja hasta la respuesta del
        // módulo. Sin él, el backend genera uno y la pantalla no tiene con qué
        // correlar el diagnóstico que vuelve.
        ...(requestId ? { request_id: requestId } : {}),
      }),
    },
  );

export const testSensor = (idOrSlug: string, targetIndex: number, requestId?: string) =>
  req<CommandAck>(
    `/modules/${encodeURIComponent(idOrSlug)}/targets/${targetIndex}/test-sensor`,
    { method: "POST", body: JSON.stringify(requestId ? { request_id: requestId } : {}) },
  );

export const calibrateTarget = (idOrSlug: string, targetIndex: number, requestId?: string) =>
  req<CommandAck>(
    `/modules/${encodeURIComponent(idOrSlug)}/targets/${targetIndex}/calibrate`,
    { method: "POST", body: JSON.stringify(requestId ? { request_id: requestId } : {}) },
  );

export const abortCalibration = (idOrSlug: string, requestId?: string) =>
  req<CommandAck>(`/modules/${encodeURIComponent(idOrSlug)}/commands/abort-calibration`, {
    method: "POST",
    body: JSON.stringify(requestId ? { request_id: requestId } : {}),
  });

export const getDiagnostics = (idOrSlug: string, take = 20) =>
  req<DiagnosticResults>(
    `/modules/${encodeURIComponent(idOrSlug)}/diagnostics?take=${take}`,
  );
