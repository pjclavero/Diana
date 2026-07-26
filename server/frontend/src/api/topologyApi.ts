import { ApiError } from "./client";
import { getToken } from "../auth/tokenStore";

/**
 * API REAL del editor de matrices (X-21): paneles, su matriz 3×3 y las
 * matrices favoritas (G-H). Sustituye a los datos simulados de `getTopology`.
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

export interface PanelSummary {
  id: string;
  slug: string;
  name: string;
  modulesExpected: number;
  moduleCount: number;
  placedCount: number;
}
export interface PanelSlot {
  module_id: string;
  slug: string;
  name: string | null;
  online: boolean;
  x: number;
  y: number;
  rotation: number;
}
export interface PanelModule {
  id: string;
  slug: string;
  friendlyName: string | null;
  online: boolean;
}
export interface PanelMatrix {
  system: { id: string; slug: string; name: string };
  slots: PanelSlot[];
  unassigned: PanelModule[];
}

export function listTopologyPanels(): Promise<{ items: PanelSummary[] }> {
  return req("/topology/panels");
}
export function getPanelMatrix(idOrSlug: string): Promise<PanelMatrix> {
  return req(`/topology/panels/${idOrSlug}`);
}
export function savePanelMatrix(
  idOrSlug: string,
  slots: { module_id: string | null; x: number; y: number; rotation?: number }[],
): Promise<PanelMatrix> {
  return req(`/topology/panels/${idOrSlug}`, { method: "PUT", body: JSON.stringify({ slots }) });
}

export interface MatrixLayout {
  id: string;
  name: string;
  description: string | null;
  ownerId: string | null;
  originSystemId: string | null;
  favorite: boolean;
  cells: { slug: string; x: number; y: number; rotation: number }[];
  moduleCount: number;
}

export function listLayouts(): Promise<{ items: MatrixLayout[]; ownCount: number; maxOwn: number }> {
  return req("/matrix-layouts");
}
export function captureLayout(name: string, targetSystemId: string, favorite = false): Promise<MatrixLayout> {
  return req("/matrix-layouts/capture", {
    method: "POST",
    body: JSON.stringify({ name, target_system_id: targetSystemId, favorite }),
  });
}
export function applyLayout(
  id: string,
  targetSystemId: string,
): Promise<{ applied: { slug: string }[]; missing: string[] }> {
  return req(`/matrix-layouts/${id}/apply`, {
    method: "POST",
    body: JSON.stringify({ target_system_id: targetSystemId }),
  });
}
export function toggleFavoriteLayout(id: string, favorite: boolean): Promise<MatrixLayout> {
  return req(`/matrix-layouts/${id}`, { method: "PATCH", body: JSON.stringify({ favorite }) });
}
export function deleteLayout(id: string): Promise<void> {
  return req(`/matrix-layouts/${id}`, { method: "DELETE" });
}
