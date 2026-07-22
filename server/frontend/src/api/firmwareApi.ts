import { ApiError } from "./client";
import { getToken } from "../auth/tokenStore";

/**
 * API REAL de firmware / OTA (F3). Contra el backend de verdad:
 *   - `GET /api/firmware` y `POST /api/firmware` (subir versión, admin);
 *   - `GET /api/modules/:id/firmware/available` (versiones firmadas para un módulo);
 *   - `POST /api/modules/:id/firmware/deploy` (gestor/admin acepta y dispara la OTA);
 *   - `GET /api/modules/:id/firmware/deployments` (historial).
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
      detail = ((await res.json()) as { message?: string }).message ?? "";
    } catch {
      /* sin cuerpo */
    }
    throw new ApiError(detail || "El servidor no ha podido completar la operación.");
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface FirmwareVersion {
  id: string;
  version: string;
  targetBoard: string;
  url: string;
  sha256: string;
  sizeBytes: number;
  signed: boolean;
  notes: string | null;
  releasedAt: string;
}

export interface AvailableFirmware {
  module: { id: string; slug: string; friendlyName: string | null };
  current_version: string | null;
  deployment_in_progress: { id: string; status: string; firmwareVersionId: string } | null;
  available: Array<{
    id: string;
    version: string;
    targetBoard: string;
    sha256: string;
    sizeBytes: number;
    signed: boolean;
    releasedAt: string;
    notes: string | null;
    is_current: boolean;
  }>;
}

export interface DeploymentRow {
  id: string;
  status: string;
  previousVersion: string | null;
  requestedBy: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  firmwareVersion: { version: string; targetBoard: string; sha256: string };
}

export async function listFirmwareVersions(): Promise<FirmwareVersion[]> {
  const page = await req<{ items: FirmwareVersion[] }>("/firmware?take=500&orderBy=releasedAt&order=desc");
  return page.items;
}

export interface NewFirmwareVersion {
  version: string;
  targetBoard: string;
  url: string;
  sha256: string;
  sizeBytes: number;
  signature: string;
  signed: boolean;
  notes?: string;
}

export function createFirmwareVersion(payload: NewFirmwareVersion): Promise<FirmwareVersion> {
  return req<FirmwareVersion>("/firmware", { method: "POST", body: JSON.stringify(payload) });
}

export interface UploadFirmwareFields {
  version: string;
  targetBoard: string;
  signature?: string;
  notes?: string;
}

/**
 * Sube el BINARIO de firmware (multipart). El backend calcula sha256/tamaño del
 * archivo y sirve la descarga; no se envía Content-Type (lo pone el navegador con
 * el boundary de multipart).
 */
export async function uploadFirmwareBinary(file: File, fields: UploadFirmwareFields): Promise<FirmwareVersion> {
  const token = getToken();
  const form = new FormData();
  form.append("binary", file);
  form.append("version", fields.version);
  form.append("target_board", fields.targetBoard);
  if (fields.signature) form.append("signature", fields.signature);
  if (fields.notes) form.append("notes", fields.notes);

  let res: Response;
  try {
    res = await fetch(`${BASE}/firmware/upload`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
  } catch {
    throw new ApiError("No se puede contactar con el servidor.");
  }
  if (res.status === 401 || res.status === 403) throw new ApiError("No tiene permiso para subir firmware.");
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { message?: string }).message ?? "";
    } catch {
      /* sin cuerpo */
    }
    throw new ApiError(detail || "No se ha podido subir el binario.");
  }
  return (await res.json()) as FirmwareVersion;
}

export function availableForModule(moduleId: string): Promise<AvailableFirmware> {
  return req<AvailableFirmware>(`/modules/${moduleId}/firmware/available`);
}

export function deployFirmware(moduleId: string, firmwareVersionId: string): Promise<DeploymentRow> {
  return req<DeploymentRow>(`/modules/${moduleId}/firmware/deploy`, {
    method: "POST",
    body: JSON.stringify({ firmware_version_id: firmwareVersionId }),
  });
}

export function listDeployments(moduleId: string): Promise<DeploymentRow[]> {
  return req<DeploymentRow[]>(`/modules/${moduleId}/firmware/deployments`);
}
