import { apiRequestAs } from "./typedRequest";

/**
 * API REAL de vistas (grupos de paneles, G-H) y paneles/sistemas.
 *
 * MIGRADO a la puerta del contrato. Prioridad: `listPanels` desenvuelve
 * `{items}` de `/api/systems` (fallo silencioso de tabla vacía).
 */

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
  return apiRequestAs<View[]>()("/api/views", "/api/views");
}
export function createView(name: string, description?: string): Promise<View> {
  return apiRequestAs<View>()<"/api/views", "post">("/api/views", "/api/views", {
    method: "POST",
    body: JSON.stringify({ name, description: description || undefined }),
  });
}
export function deleteView(id: string): Promise<void> {
  return apiRequestAs<void>()<"/api/views/{id}", "delete">("/api/views/{id}", `/api/views/${id}`, {
    method: "DELETE",
  });
}
export function addViewPanel(viewId: string, targetSystemId: string): Promise<View> {
  return apiRequestAs<View>()<"/api/views/{id}/panels", "post">(
    "/api/views/{id}/panels",
    `/api/views/${viewId}/panels`,
    { method: "POST", body: JSON.stringify({ target_system_id: targetSystemId }) },
  );
}
export function removeViewPanel(viewId: string, targetSystemId: string): Promise<View> {
  return apiRequestAs<View>()<"/api/views/{id}/panels/{targetSystemId}", "delete">(
    "/api/views/{id}/panels/{targetSystemId}",
    `/api/views/${viewId}/panels/${targetSystemId}`,
    { method: "DELETE" },
  );
}
export function dueloReadiness(viewId: string): Promise<{ ready: boolean; reason: string | null; panels: ViewPanel[] }> {
  return apiRequestAs<{ ready: boolean; reason: string | null; panels: ViewPanel[] }>()(
    "/api/views/{id}/duelo-readiness",
    `/api/views/${viewId}/duelo-readiness`,
  );
}

export async function listPanels(): Promise<Panel[]> {
  const page = await apiRequestAs<{ items: Panel[] }>()("/api/systems", "/api/systems?take=500&orderBy=name&order=asc");
  return page.items;
}
