import { ApiError } from "./client";
import { getToken } from "../auth/tokenStore";

/** API REAL del ascenso a gestor por venta de módulo (F5, §3.1). */
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
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface ManagerActivation {
  id: string;
  code: string;
  status: "pending" | "activated" | "revoked";
  /** Deducido del reloj al leer: `pending` con la fecha pasada ya no sirve. */
  expired: boolean;
  dispatchNote: string | null;
  expiresAt: string;
  activatedAt: string | null;
  createdAt: string;
  createdBy: string | null;
  user: { id: string; username: string; email: string | null; role: { name: string } };
  module: { id: string; slug: string; friendlyName: string | null } | null;
}

export interface ManagerActivationList {
  items: ManagerActivation[];
  /** Sin SMTP, el código lo tiene que dictar el administrador. */
  smtpConfigured: boolean;
}

export interface MyActivation {
  pending: boolean;
  expiresAt: string | null;
  note?: string;
}

export function listManagerActivations(status?: string): Promise<ManagerActivationList> {
  return req(`/manager-activations${status ? `?status=${encodeURIComponent(status)}` : ""}`);
}

export function myActivation(): Promise<MyActivation> {
  return req("/manager-activations/mine");
}

export function activateManager(code: string): Promise<{ activated: boolean; note: string }> {
  return req("/manager-activations/activate", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export function regenerateActivation(id: string): Promise<ManagerActivation> {
  return req(`/manager-activations/${id}/regenerate`, { method: "POST" });
}

export function revokeActivation(id: string): Promise<ManagerActivation> {
  return req(`/manager-activations/${id}/revoke`, { method: "POST" });
}
