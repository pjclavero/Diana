import { ApiError } from "./client";
import { getToken } from "../auth/tokenStore";

/** API REAL de vistas (grupos de paneles, G-H) y paneles/sistemas. */
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
      const body = (await res.json()) as { message?: string | string[] };
      detail = (Array.isArray(body.message) ? body.message[0] : body.message) ?? "";
    } catch {
      /* sin cuerpo */
    }
    throw new ApiError(detail || "El servidor no ha podido completar la operación.");
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface ViewPanel {
  targetSystemId: string;
  slug: string;
  name: string;
  position: number;
  moduleCount: number;
}
export interface View {
  id: string;
  name: string;
  description: string | null;
  ownerId: string | null;
  panels: ViewPanel[];
}
export interface Panel {
  id: string;
  slug: string;
  name: string;
}

export function listViews(): Promise<View[]> {
  return req<View[]>("/views");
}
export function createView(name: string, description?: string): Promise<View> {
  return req<View>("/views", { method: "POST", body: JSON.stringify({ name, description: description || undefined }) });
}
export function deleteView(id: string): Promise<void> {
  return req<void>(`/views/${id}`, { method: "DELETE" });
}
export function addViewPanel(viewId: string, targetSystemId: string): Promise<View> {
  return req<View>(`/views/${viewId}/panels`, { method: "POST", body: JSON.stringify({ target_system_id: targetSystemId }) });
}
export function removeViewPanel(viewId: string, targetSystemId: string): Promise<View> {
  return req<View>(`/views/${viewId}/panels/${targetSystemId}`, { method: "DELETE" });
}
export function dueloReadiness(viewId: string): Promise<{ ready: boolean; reason: string | null; panels: ViewPanel[] }> {
  return req(`/views/${viewId}/duelo-readiness`);
}

export async function listPanels(): Promise<Panel[]> {
  const page = await req<{ items: Panel[] }>("/systems?take=500&orderBy=name&order=asc");
  return page.items;
}
