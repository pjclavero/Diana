import { ApiError } from "./client";
import { getToken } from "../auth/tokenStore";

/**
 * API REAL de módulos y propiedad (F2). Igual que la autenticación, habla con el
 * backend de verdad (no depende de VITE_API_MODE): es el primer dominio que sale
 * de los datos de demostración. Contra `/api/modules` (CRUD) + endpoints de
 * propiedad `/modules/:id/link|unlink` y `/modules/mine`.
 */
const BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

export interface ModuleOwner {
  id: string;
  username: string;
  displayName: string | null;
  role: { name: string };
}

export interface ModuleEntity {
  id: string;
  slug: string;
  friendlyName: string | null;
  serial: string | null;
  firmwareVersion: string | null;
  state: string | null;
  online: boolean;
  ownerId: string | null;
  owner?: ModuleOwner | null;
}

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
      detail = ((await res.json()) as { message?: string }).message ?? "";
    } catch {
      /* sin cuerpo */
    }
    throw new ApiError(detail || "El servidor no ha podido completar la operación.");
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function listModules(): Promise<ModuleEntity[]> {
  const page = await req<{ items: ModuleEntity[] }>("/modules?take=500&orderBy=slug&order=asc");
  return page.items;
}

export function listMyModules(): Promise<ModuleEntity[]> {
  return req<ModuleEntity[]>("/modules/mine");
}

export function linkModule(moduleId: string, userId: string): Promise<ModuleEntity> {
  return req<ModuleEntity>(`/modules/${moduleId}/link`, { method: "POST", body: JSON.stringify({ user_id: userId }) });
}

export function unlinkModule(moduleId: string): Promise<ModuleEntity> {
  return req<ModuleEntity>(`/modules/${moduleId}/unlink`, { method: "POST" });
}

export interface UserOption {
  id: string;
  username: string;
  displayName: string | null;
}

export async function listUsers(): Promise<UserOption[]> {
  const page = await req<{ items: UserOption[] }>("/users?take=500");
  return page.items;
}
