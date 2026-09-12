/**
 * Observación del selector físico declarada en `module-status`.
 *
 * POR QUÉ ES UNA FUNCIÓN PURA. La cadena selector → MQTT → backend → DB →
 * elección de coordinador es de las que hay que poder demostrar por ejecución,
 * no por encontrar una llamada en un fichero: tres guardas de este proyecto
 * pasaron en verde comprobando presencia mientras la rama estaba desactivada.
 * Aquí la decisión se prueba sola, sin base de datos ni broker.
 *
 * QUÉ NO HACE, y es deliberado: no elige coordinador, no otorga autoridad y no
 * convierte `role` en un permiso. Sólo dice qué se observó y si es persistible.
 * La elección es 3.2.
 */

/** Posiciones del selector (common.schema.json#/$defs/selectorPosition). */
export type SelectorPosition = 'SATELITE' | 'AUTO' | 'PRINCIPAL';
/** Rol declarado (common.schema.json#/$defs/moduleRole). */
export type ModuleRole = 'principal' | 'satellite' | 'auto';

const POSICIONES: readonly string[] = ['SATELITE', 'AUTO', 'PRINCIPAL'];
const ROLES: readonly string[] = ['principal', 'satellite', 'auto'];

/** Rol que corresponde a cada posición, según el firmware (types.c). */
const ROL_DE: Record<SelectorPosition, ModuleRole> = {
  PRINCIPAL: 'principal',
  SATELITE: 'satellite',
  AUTO: 'auto',
};

export interface ObservacionSelector {
  selector: SelectorPosition;
  role: ModuleRole;
  observedAt: Date;
}

export interface StatusObservable {
  selector?: unknown;
  role?: unknown;
}

/**
 * Extrae la observación de un `module-status`, o `null` si no hay nada
 * persistible.
 *
 * FAIL CLOSED. Un valor que no esté en el enum del contrato NO se persiste y no
 * se aproxima al más parecido: el firmware no publica durante el tránsito del
 * selector —queda demostrado en el banco— así que un valor raro aquí significa
 * que algo va mal, y guardarlo como posición válida sería inventar una posición
 * del interruptor que nadie ha visto.
 *
 * Un status sin estos campos tampoco es un error: el esquema los exige hoy,
 * pero un módulo viejo o un mensaje recortado no puede tumbar la ingesta.
 */
export function leerObservacionSelector(
  status: StatusObservable,
  observedAt: Date,
): ObservacionSelector | null {
  const sel = status.selector;
  if (typeof sel !== 'string' || !POSICIONES.includes(sel)) return null;
  const selector = sel as SelectorPosition;

  // El `role` del mensaje se respeta si es válido; si no, se deriva de la
  // posición. Son la misma información en el firmware, y una incoherencia no
  // debe descartar la observación: la posición es el dato de origen.
  const rol = status.role;
  const role: ModuleRole =
    typeof rol === 'string' && ROLES.includes(rol) ? (rol as ModuleRole) : ROL_DE[selector];

  return { selector, role, observedAt };
}

/**
 * true si la observación es NUEVA respecto a lo ya guardado.
 *
 * Un `module-status` es RETENIDO: el broker lo reentrega en cada reconexión del
 * backend, así que la misma observación llega muchas veces. Reescribir cada vez
 * movería `selectorObservedAt` sin que el selector se hubiera tocado, y 3.2
 * creería que la posición se acaba de confirmar.
 */
export function esObservacionNueva(
  anterior: { selector: string | null; role: string | null } | null,
  nueva: ObservacionSelector,
): boolean {
  if (!anterior) return true;
  return anterior.selector !== nueva.selector || anterior.role !== nueva.role;
}
