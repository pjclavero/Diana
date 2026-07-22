import { ApiError } from "./client";
import { getToken } from "../auth/tokenStore";

/** API REAL de presets de partida (G-F). Contra `/api/presets` y `/api/games/modes`. */
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
  if (res.status === 401 || res.status === 403) throw new ApiError("No tiene permiso para esta acción.");
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { message?: string | string[] }).message as string;
    } catch {
      /* sin cuerpo */
    }
    throw new ApiError((Array.isArray(detail) ? detail[0] : detail) || "El servidor no ha podido completar la operación.");
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface GameModeOption {
  key: string;
  name: string;
  description: string;
}

export interface Preset {
  id: string;
  name: string;
  description: string | null;
  isSample: boolean;
  ownerId: string | null;
  config: Record<string, unknown>;
  gameMode: { key: string; displayName: string };
  owner?: { id: string; username: string; displayName: string | null } | null;
}

export interface PresetList {
  items: Preset[];
  ownCount: number;
  maxOwn: number;
}

export interface NewPreset {
  name: string;
  description?: string;
  mode: string;
  config: Record<string, unknown>;
}

export function listGameModes(): Promise<GameModeOption[]> {
  return req<GameModeOption[]>("/games/modes");
}

export function listPresets(): Promise<PresetList> {
  return req<PresetList>("/presets");
}

export function createPreset(payload: NewPreset): Promise<Preset> {
  return req<Preset>("/presets", { method: "POST", body: JSON.stringify(payload) });
}

export function deletePreset(id: string): Promise<void> {
  return req<void>(`/presets/${id}`, { method: "DELETE" });
}
