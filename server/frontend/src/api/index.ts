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
export const API_MODE = resolverModoApi(import.meta.env);

/**
 * ¿Este panel sirve datos de DEMOSTRACIÓN? Se exporta resuelto para que nadie
 * vuelva a re-derivarlo por su cuenta. `AppShell` lo hacía con
 * `(import.meta.env.VITE_API_MODE ?? "mock") !== "real"`, es decir, con el
 * defecto ANTIGUO: un despliegue real sin `VITE_API_MODE` (que es el caso
 * normal, porque el defecto ya es `real`) se auto-rotulaba «datos de
 * demostración». Un panel que miente sobre su propia procedencia es el mismo
 * defecto que `apiMode.ts` corrigió, sólo que en el otro sentido.
 */
export const DATOS_DE_DEMOSTRACION = API_MODE === "mock";
// La base REST ya no se pasa a mano: la resuelve `typedRequest.ts`, que es el
// único sitio que sabe que las rutas del contrato ya traen el prefijo `/api` y
// que por tanto hay que quitárselo a `VITE_API_BASE_URL` (ver `baseOrigin`).
// Tenerla en dos sitios era lo que producía `/api/api/...` (X-21).
const WS_BASE_URL = import.meta.env.VITE_WS_URL ?? "/ws";

/**
 * TERCERA capa del guardián, y la única que se puede COMPROBAR MIRANDO EL
 * ARTEFACTO.
 *
 * `vite.config.ts` promete que «el bundle de producción con el adaptador de
 * demostración dentro no llega a existir». No era cierto, y se midió:
 *
 *     $ npm run build
 *     $ grep -c "Sistema de demostración" dist/assets/*.js   → 1
 *     $ grep -c "module-05"               dist/assets/*.js   → 1
 *
 * El motivo es que `API_MODE` sale de una LLAMADA (`resolverModoApi(...)`), y
 * una llamada no se puede plegar en tiempo de compilación: Rollup no puede
 * demostrar que la rama `mockApiClient` sea inalcanzable, así que arrastra
 * `mockAdapter` → `mockData` → `mockGameEngine` al bundle. El resultado es que
 * TODO navegador que abre el panel de producción se descarga el juego de datos
 * inventados (módulos, sistema, telemetría, incidencias). No se podía activar
 * —`import.meta.env` queda horneado en la compilación—, pero estaba ahí, y una
 * garantía que sólo vale mientras nadie escriba la línea que la alcanza no es
 * una garantía.
 *
 * `import.meta.env.PROD` SÍ lo sustituye Vite por el literal `true` o `false`
 * antes de optimizar. En una build de producción esta condición se pliega a
 * `true`, la rama de demostración queda muerta de forma demostrable y el
 * módulo entero desaparece del artefacto. En desarrollo no cambia nada: se
 * sigue eligiendo por `API_MODE`.
 *
 * Y no es redundante con las otras dos capas, es de otra naturaleza: aquéllas
 * impiden ARRANCAR en modo demostración, ésta impide que el código de
 * demostración VIAJE. Falsable: vuelve a poner el ternario antiguo y los dos
 * `grep` de arriba encuentran los literales otra vez.
 */
export const apiClient: DianaApiClient = import.meta.env.PROD
  ? createRealApiClient()
  : API_MODE === "real"
    ? createRealApiClient()
    : mockApiClient;

export function createGameSocket(): GameSocket {
  // Mismo pliegue que en `apiClient`, y por el mismo motivo: sin él,
  // `mockGameSocket` → `mockGameEngine` viaja en el bundle de producción.
  if (import.meta.env.PROD) return new RealGameSocket(WS_BASE_URL);
  return API_MODE === "real" ? new RealGameSocket(WS_BASE_URL) : new MockGameSocket();
}

export { ApiError } from "./client";
export type { DianaApiClient, GamePreset, Incident, Topology, TopologySlot } from "./client";
export * from "./gameSocket";
