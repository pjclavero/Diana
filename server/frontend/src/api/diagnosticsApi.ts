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
 * Respuesta a una orden. `delivered: false` significa que la orden quedó
 * ENCOLADA y el módulo no la ha recibido: la pantalla no debe pintar como
 * hecho lo que todavía no ha salido.
 */
export interface CommandAck {
  module_id: string;
  action: string;
  command_id: string;
  delivered: boolean;
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
}

export interface DiagnosticResults {
  module: string;
  moduleRegistered: boolean;
  items: DiagnosticItem[];
  note: string | null;
}

export const identifyModule = (idOrSlug: string, durationMs = 4000) =>
  req<CommandAck>(`/modules/${encodeURIComponent(idOrSlug)}/commands/identify`, {
    method: "POST",
    body: JSON.stringify({ duration_ms: durationMs }),
  });

export const testLed = (idOrSlug: string, targetIndex: number, state: TargetState) =>
  req<CommandAck>(
    `/modules/${encodeURIComponent(idOrSlug)}/targets/${targetIndex}/test-led`,
    { method: "POST", body: JSON.stringify({ state }) },
  );

export const testSensor = (idOrSlug: string, targetIndex: number) =>
  req<CommandAck>(
    `/modules/${encodeURIComponent(idOrSlug)}/targets/${targetIndex}/test-sensor`,
    { method: "POST" },
  );

export const calibrateTarget = (idOrSlug: string, targetIndex: number) =>
  req<CommandAck>(
    `/modules/${encodeURIComponent(idOrSlug)}/targets/${targetIndex}/calibrate`,
    { method: "POST" },
  );

export const abortCalibration = (idOrSlug: string) =>
  req<CommandAck>(`/modules/${encodeURIComponent(idOrSlug)}/commands/abort-calibration`, {
    method: "POST",
  });

export const getDiagnostics = (idOrSlug: string, take = 20) =>
  req<DiagnosticResults>(
    `/modules/${encodeURIComponent(idOrSlug)}/diagnostics?take=${take}`,
  );
