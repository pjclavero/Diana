import { apiRequestAs } from "./typedRequest";

/**
 * API REAL de firmware / OTA (F3). Contra el backend de verdad:
 *   - `GET /api/firmware` y `POST /api/firmware` (subir versión, admin);
 *   - `POST /api/firmware/upload` (binario, multipart);
 *   - `GET /api/modules/:id/firmware/available`;
 *   - `POST /api/modules/:id/firmware/deploy`;
 *   - `GET /api/modules/:id/firmware/deployments`.
 *
 * MIGRADO a la puerta del contrato, incluida la subida multipart: la puerta
 * omite `Content-Type` cuando el cuerpo es `FormData`, para que el navegador
 * ponga el suyo con el `boundary`. Prioridad: `listFirmwareVersions`
 * desenvuelve `{items}` (fallo silencioso de tabla vacía).
 */

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
  const page = await apiRequestAs<{ items: FirmwareVersion[] }>()(
    "/api/firmware",
    "/api/firmware?take=500&orderBy=releasedAt&order=desc",
  );
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
  return apiRequestAs<FirmwareVersion>()<"/api/firmware", "post">("/api/firmware", "/api/firmware", {
    method: "POST",
    body: JSON.stringify(payload),
  });
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
  const form = new FormData();
  form.append("binary", file);
  form.append("version", fields.version);
  form.append("target_board", fields.targetBoard);
  if (fields.signature) form.append("signature", fields.signature);
  if (fields.notes) form.append("notes", fields.notes);

  return apiRequestAs<FirmwareVersion>()<"/api/firmware/upload", "post">(
    "/api/firmware/upload",
    "/api/firmware/upload",
    { method: "POST", body: form },
  );
}

export function availableForModule(moduleId: string): Promise<AvailableFirmware> {
  return apiRequestAs<AvailableFirmware>()(
    "/api/modules/{moduleId}/firmware/available",
    `/api/modules/${moduleId}/firmware/available`,
  );
}

export function deployFirmware(moduleId: string, firmwareVersionId: string): Promise<DeploymentRow> {
  return apiRequestAs<DeploymentRow>()<"/api/modules/{moduleId}/firmware/deploy", "post">(
    "/api/modules/{moduleId}/firmware/deploy",
    `/api/modules/${moduleId}/firmware/deploy`,
    { method: "POST", body: JSON.stringify({ firmware_version_id: firmwareVersionId }) },
  );
}

export function listDeployments(moduleId: string): Promise<DeploymentRow[]> {
  return apiRequestAs<DeploymentRow[]>()(
    "/api/modules/{moduleId}/firmware/deployments",
    `/api/modules/${moduleId}/firmware/deployments`,
  );
}
