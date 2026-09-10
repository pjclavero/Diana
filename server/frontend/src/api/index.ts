import type { DianaApiClient } from "./client";
import type { GameSocket } from "./gameSocket";
import { mockApiClient } from "./mockAdapter";
import { createRealApiClient } from "./realAdapter";
import { MockGameSocket } from "./mockGameSocket";
import { resolverModoApi } from "./apiMode";
import { RealGameSocket } from "./realGameSocket";

/**
 * Único punto de decisión mock↔real. Cambiar de adaptador es cuestión de
 * `VITE_API_MODE` (y `VITE_API_BASE_URL` / `VITE_WS_URL`), nunca de tocar una
 * pantalla. Ver README.md § "Cómo pasar de mock a API real".
 *
 * El defecto es `real` y `mock` está PROHIBIDO en una compilación de
 * producción: la regla vive entera en `apiMode.ts` y aquí sólo se aplica. Si
 * la configuración es inválida, esta línea lanza al cargar el módulo y el
 * panel no arranca — que es exactamente lo que se quiere: antes arrancaba
 * enseñando datos de demostración sin decirlo.
 */
const API_MODE = resolverModoApi(import.meta.env);
// La base REST ya no se pasa a mano: la resuelve `typedRequest.ts`, que es el
// único sitio que sabe que las rutas del contrato ya traen el prefijo `/api` y
// que por tanto hay que quitárselo a `VITE_API_BASE_URL` (ver `baseOrigin`).
// Tenerla en dos sitios era lo que producía `/api/api/...` (X-21).
const WS_BASE_URL = import.meta.env.VITE_WS_URL ?? "/ws";

export const apiClient: DianaApiClient = API_MODE === "real" ? createRealApiClient() : mockApiClient;

export function createGameSocket(): GameSocket {
  return API_MODE === "real" ? new RealGameSocket(WS_BASE_URL) : new MockGameSocket();
}

export { ApiError } from "./client";
export type { DianaApiClient, GamePreset, Incident, Topology, TopologySlot } from "./client";
export * from "./gameSocket";
