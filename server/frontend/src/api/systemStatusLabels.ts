import type { ConflictKind, SystemState } from "../types/domain";

/**
 * Traducción del estado del sistema al lenguaje del operador.
 *
 * El enum real del servidor (`idle|configuring|ready|game_running|degraded|
 * maintenance`, contrato `system-status.schema.json` v1) NO coincide con el
 * que el panel usaba antes (`boot|ready|degraded|conflict|game_active|
 * maintenance|error`, auditoría 2026-08-05 §4, G4): estados que el backend
 * no puede emitir. Se traduce aquí, en la frontera, igual que ya se hace
 * para el WebSocket en `liveContract.ts` (X-06).
 */
export const SYSTEM_STATE_LABEL: Record<SystemState, string> = {
  idle: "Inactivo",
  configuring: "Configurando",
  ready: "Listo",
  game_running: "Partida en curso",
  degraded: "Degradado",
  maintenance: "Mantenimiento",
};

export function systemStateLabel(state: SystemState): string {
  return SYSTEM_STATE_LABEL[state] ?? state;
}

/** Todas las claves declaradas en el contrato v1, detectadas o no. */
export const ALL_CONFLICTS: ConflictKind[] = [
  "dual_principal",
  "duplicate_position",
  "no_principal",
  "schema_mismatch",
  "firmware_mismatch",
];

/**
 * Las únicas dos claves que el backend detecta de verdad hoy (carril E,
 * decisión deliberada y documentada). Las otras tres están en el enum pero
 * nadie las comprueba todavía.
 */
export const CHECKED_CONFLICTS: ConflictKind[] = ["dual_principal", "duplicate_position"];

/** Nombre corto, para las listas de "esto se comprueba" / "esto no". */
const CONFLICT_NAME: Record<ConflictKind, string> = {
  dual_principal: "selector duplicado en PRINCIPAL",
  duplicate_position: "posición duplicada en la matriz",
  no_principal: "ausencia de módulo en PRINCIPAL",
  schema_mismatch: "contrato distinto entre módulos",
  firmware_mismatch: "firmware distinto entre módulos",
};

/** Frase completa, para cuando el conflicto SÍ está presente. */
const CONFLICT_SENTENCE: Record<ConflictKind, string> = {
  dual_principal:
    "Hay más de un módulo en línea con el selector físico en PRINCIPAL. El inicio de partida está bloqueado hasta que se resuelva.",
  duplicate_position: "Dos módulos ocupan la misma casilla de la matriz.",
  no_principal: "Ningún módulo en línea tiene el selector en PRINCIPAL.",
  schema_mismatch: "Un módulo publica un contrato distinto del esperado.",
  firmware_mismatch: "Los módulos no tienen todos la misma versión de firmware.",
};

export function conflictSentence(kind: ConflictKind): string {
  return CONFLICT_SENTENCE[kind] ?? `Conflicto no reconocido: ${kind}.`;
}

export interface ConflictSummary {
  /** Una frase por conflicto activo, en el orden recibido. */
  messages: string[];
  /**
   * Qué comprueba el sistema hoy y qué no, SIEMPRE presente. Sin esto,
   * "sin conflictos" se lee como "no hay", cuando en realidad puede ser
   * "no se mira" (auditoría 2026-08-05 §4, G4).
   */
  scopeNote: string;
}

/**
 * Nunca se afirma «sin conflictos detectados» a secas: se dice qué se
 * comprueba de verdad, siempre, haya o no conflictos activos.
 */
export function summarizeConflicts(conflicts: ConflictKind[]): ConflictSummary {
  const messages = conflicts.map(conflictSentence);
  const checkedNames = CHECKED_CONFLICTS.map((k) => CONFLICT_NAME[k]).join(", ");
  const uncheckedNames = ALL_CONFLICTS.filter((k) => !CHECKED_CONFLICTS.includes(k))
    .map((k) => CONFLICT_NAME[k])
    .join(", ");
  const scopeNote =
    conflicts.length === 0
      ? `Sin conflictos entre los que el sistema comprueba hoy: ${checkedNames}. Todavía no se comprueban: ${uncheckedNames}.`
      : `El sistema comprueba hoy: ${checkedNames}. Todavía no comprueba: ${uncheckedNames}.`;
  return { messages, scopeNote };
}
