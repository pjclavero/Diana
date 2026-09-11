import { apiRequestAs } from "./typedRequest";
import type { ModuleEntity } from "./modulesApi";

/**
 * ALTA / EDICIÓN / BAJA de módulos (T4 · panel).
 *
 * Hasta ahora dar de alta un ESP32 exigía `curl` o Swagger: el panel sólo leía
 * (`modulesApi.ts` no tiene un solo verbo de escritura sobre `/api/modules`).
 * Estos tres clientes cierran ese hueco contra las MISMAS rutas del contrato
 * (`POST /api/modules`, `PATCH /api/modules/{id}`, `DELETE /api/modules/{id}`),
 * sin inventar ninguna y pasando por la puerta tipada como el resto de
 * `src/api/`.
 *
 * `preferServerDetail: true` en los tres NO es cosmético: el valor del alta está
 * precisamente en el mensaje del backend. Un 400 de validación dice QUÉ campo
 * está mal («slug debe cumplir el patrón…») y un 409 dice que el slug ya está
 * ocupado; colapsarlos en «el servidor no ha podido completar la operación»
 * obliga al operador a adivinar cuál de los seis campos ha escrito mal.
 */

/**
 * Campos que `CreateModuleDto` admite y que el panel ofrece en el alta.
 *
 * El DTO acepta además `ip`, `targetBoard`, `firmwareVersion`, `role`,
 * `selector`, `state` y `maintenance`; son propiedades que el dispositivo
 * reporta o que fija la operación posterior, no datos que un operador tenga
 * delante al desembalar una placa. Se dejan fuera a propósito: el encargo pide
 * exactamente los campos del alta, «ni uno más».
 */
export interface CrearModuloBody {
  /** `module_id` de MQTT. Obligatorio, inmutable y validado contra el patrón del contrato. */
  slug: string;
  friendlyName?: string;
  targetSystemId?: string;
  hardwareRevision?: string;
  serial?: string;
  mac?: string;
}

/**
 * Campos editables. SIN `slug`: `UpdateModuleDto` no lo declara y el backend
 * responde 400 (`forbidNonWhitelisted`). El panel no lo ofrece siquiera, que es
 * la única forma de que la interfaz no prometa algo que la API prohíbe.
 */
export type ActualizarModuloBody = Omit<CrearModuloBody, "slug">;

/**
 * Patrón de identificador del contrato (`contracts/mqtt/README.md §1`,
 * `IDENTIFIER_PATTERN` en `server/backend/src/contracts/topics.ts`).
 *
 * Duplicado a conciencia, igual que `SILENCIO_MAXIMO_MS`: no hay ruta que lo
 * sirva. Sólo sirve para AVISAR antes de enviar; la validación que manda es la
 * del backend, y su mensaje es el que se enseña si rechaza.
 */
export const PATRON_SLUG = /^[a-z0-9][a-z0-9-]{2,62}$/;

/** Formato MAC que el DTO exige (`AA:BB:CC:DD:EE:FF`). */
export const PATRON_MAC = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;

export function createModule(body: CrearModuloBody): Promise<ModuleEntity> {
  return apiRequestAs<ModuleEntity>()<"/api/modules", "post">("/api/modules", "/api/modules", {
    method: "POST",
    body: JSON.stringify(body),
    preferServerDetail: true,
  });
}

export function updateModule(moduleId: string, body: ActualizarModuloBody): Promise<ModuleEntity> {
  return apiRequestAs<ModuleEntity>()<"/api/modules/{id}", "patch">(
    "/api/modules/{id}",
    `/api/modules/${encodeURIComponent(moduleId)}`,
    { method: "PATCH", body: JSON.stringify(body), preferServerDetail: true },
  );
}

export function deleteModule(moduleId: string): Promise<void> {
  return apiRequestAs<void>()<"/api/modules/{id}", "delete">(
    "/api/modules/{id}",
    `/api/modules/${encodeURIComponent(moduleId)}`,
    { method: "DELETE", preferServerDetail: true },
  );
}

/**
 * Quita del cuerpo los campos opcionales vacíos.
 *
 * No es cosmética: `mac: ""` NO es «sin MAC» para el backend, es una cadena que
 * `@Matches(MAC_PATTERN)` rechaza con 400. Un formulario en el que el operador
 * rellena sólo el slug tiene que enviar sólo el slug.
 */
export function sinVacios<T extends Record<string, string | undefined>>(body: T): T {
  const salida: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) {
    const limpio = (v ?? "").trim();
    if (limpio !== "") salida[k] = limpio;
  }
  return salida as T;
}
