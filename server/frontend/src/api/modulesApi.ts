import { apiRequestAs } from "./typedRequest";

/**
 * API REAL de módulos y propiedad (F2). Igual que la autenticación, habla con el
 * backend de verdad (no depende de VITE_API_MODE): es el primer dominio que sale
 * de los datos de demostración. Contra `/api/modules` (CRUD) + endpoints de
 * propiedad `/modules/:id/link|unlink` y `/modules/mine`.
 *
 * MUESTRA REPRESENTATIVA de la puerta B (docs/coordination/AUDITORIA-PANTALLAS-2026-08-05.md
 * §3.3): las peticiones pasan por `apiRequest`, tipado contra el contrato
 * generado (`./generated/schema.d.ts`). Una ruta que el backend no expone, o
 * que cambia de forma, deja de compilar aquí.
 */

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

export async function listModules(): Promise<ModuleEntity[]> {
  const page = await apiRequestAs<{ items: ModuleEntity[] }>()(
    "/api/modules",
    "/api/modules?take=500&orderBy=slug&order=asc",
  );
  return page.items;
}

export function listMyModules(): Promise<ModuleEntity[]> {
  return apiRequestAs<ModuleEntity[]>()("/api/modules/mine", "/api/modules/mine");
}

export function linkModule(moduleId: string, userId: string): Promise<ModuleEntity> {
  return apiRequestAs<ModuleEntity>()<"/api/modules/{id}/link", "post">(
    "/api/modules/{id}/link",
    `/api/modules/${moduleId}/link`,
    { method: "POST", body: JSON.stringify({ user_id: userId }) },
  );
}

export function unlinkModule(moduleId: string): Promise<ModuleEntity> {
  return apiRequestAs<ModuleEntity>()<"/api/modules/{id}/unlink", "post">(
    "/api/modules/{id}/unlink",
    `/api/modules/${moduleId}/unlink`,
    { method: "POST" },
  );
}

export interface UserOption {
  id: string;
  username: string;
  displayName: string | null;
}

export async function listUsers(): Promise<UserOption[]> {
  const page = await apiRequestAs<{ items: UserOption[] }>()("/api/users", "/api/users?take=500");
  return page.items;
}

export interface ModuleOverviewItem {
  id: string;
  slug: string;
  friendlyName: string | null;
  online: boolean;
  state: string | null;
  role: string | null;
  firmwareVersion: string | null;
  maintenance: boolean;
  lastSeenAt: string | null;
  ownerId: string | null;
  owner?: ModuleOwner | null;
  position: { x: number; y: number } | null;
  updateAvailable: boolean;
  latestSignedVersion: string | null;
}

export interface ModulesOverview {
  summary: { total: number; online: number; offline: number; updatesPending: number };
  items: ModuleOverviewItem[];
}

/** Resumen de módulos para el dashboard (admin: todos; gestor: los suyos). */
export function modulesOverview(): Promise<ModulesOverview> {
  return apiRequestAs<ModulesOverview>()("/api/modules/overview", "/api/modules/overview");
}
