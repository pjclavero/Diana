import { ApiError } from "./client";
import { getToken } from "../auth/tokenStore";

/** API REAL de invitaciones y SMTP (G-D/F5). */
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

export interface Invitation {
  id: string;
  email: string;
  displayName: string | null;
  code: string;
  status: string;
  dispatchNote: string | null;
  expiresAt: string;
  createdAt: string;
}

export function listInvitations(): Promise<Invitation[]> {
  return req<Invitation[]>("/invitations");
}
export function createInvitation(email: string, displayName?: string): Promise<Invitation> {
  return req<Invitation>("/invitations", { method: "POST", body: JSON.stringify({ email, display_name: displayName || undefined }) });
}
export function resendInvitation(id: string): Promise<Invitation> {
  return req<Invitation>(`/invitations/${id}/resend`, { method: "POST" });
}
export function revokeInvitation(id: string): Promise<Invitation> {
  return req<Invitation>(`/invitations/${id}/revoke`, { method: "POST" });
}

export interface SmtpSettings {
  host: string | null;
  port: number | null;
  secure: boolean;
  username: string | null;
  fromAddress: string | null;
  hasPassword: boolean;
  configured: boolean;
}

export function getSmtp(): Promise<SmtpSettings> {
  return req<SmtpSettings>("/smtp-settings");
}
export function updateSmtp(input: {
  host: string | null;
  port: number | null;
  secure: boolean;
  username: string | null;
  password?: string | null;
  from_address: string | null;
}): Promise<SmtpSettings> {
  return req<SmtpSettings>("/smtp-settings", { method: "PUT", body: JSON.stringify(input) });
}

// --- Aceptación pública ---
export interface InvitationInfo {
  email: string;
  displayName: string | null;
  status: string;
  acceptable: boolean;
  expired: boolean;
}
export function invitationByCode(code: string): Promise<InvitationInfo> {
  return req<InvitationInfo>(`/invitations/accept/${encodeURIComponent(code)}`);
}
export function acceptInvitation(code: string, displayName: string): Promise<{ playerId: string; displayName: string }> {
  return req(`/invitations/accept/${encodeURIComponent(code)}`, { method: "POST", body: JSON.stringify({ display_name: displayName }) });
}
