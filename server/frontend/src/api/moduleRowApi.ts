import { apiRequestAs } from "./typedRequest";

/**
 * FILA COMPLETA del módulo, tal y como la devuelve `GET /api/modules/{id}`.
 *
 * Existe por un hueco concreto y medido: el panel no tenía NINGÚN sitio donde
 * enseñar la IP de un módulo.
 *
 *  - El resumen (`GET /api/modules/overview`) no la trae.
 *    `server/backend/src/modules/modules/modules-overview.service.ts` compone
 *    los items a mano y selecciona estado, firmware, dueño, posición y las dos
 *    versiones de configuración — pero no `ip`, ni `mac`, ni `serial`, aunque
 *    las tres columnas existen en `model Module` (`prisma/schema.prisma`).
 *  - La ficha (`ModuleDetailPage`) pedía el módulo por
 *    `apiClient.getModule()`, que pasa la fila por `aModuleStatus()`
 *    (`api/backendShapes.ts`). Esa función traduce a `ModuleStatus`, que es la
 *    forma del contrato **MQTT** y no tiene hueco para identidad ni red: los
 *    campos se caían allí sin error, sin hueco pintado y sin aviso.
 *
 * Así que se lee la fila cruda, por la ruta del contrato y por la puerta
 * tipada, sin pasar por el traductor que los descartaba.
 *
 * Todos los campos van OPCIONALES a propósito: son columnas NULLABLE de la
 * tabla `modules`. La pantalla tiene que poder decir «no consta» sin
 * confundirlo con «0», con «—» o con «no he podido preguntar».
 */
export interface FilaModuloCompleta {
  id: string;
  slug: string;
  friendlyName?: string | null;
  serial?: string | null;
  mac?: string | null;
  ip?: string | null;
  hardwareRevision?: string | null;
  targetBoard?: string | null;
  firmwareVersion?: string | null;
  online?: boolean;
  lastSeenAt?: string | null;
  offlineSince?: string | null;
  desiredConfigVersion?: number | null;
  reportedConfigVersion?: number | null;
  configState?: string | null;
  configAppliedAt?: string | null;
}

export function obtenerModulo(moduleId: string): Promise<FilaModuloCompleta> {
  return apiRequestAs<FilaModuloCompleta>()("/api/modules/{id}", `/api/modules/${moduleId}`, {
    notFoundMessage: "No existe ningún módulo con ese identificador.",
  });
}
