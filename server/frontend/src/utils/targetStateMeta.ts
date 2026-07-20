import type { TargetState } from "../types/domain";

/**
 * Metadatos de accesibilidad para cada estado de diana (dosier §10.5 y §13.4).
 *
 * Requisito duro: el estado de una diana NUNCA se representa sólo por color.
 * Cada estado combina color + patrón/forma + etiqueta de texto + símbolo,
 * y expone un `aria` legible para lectores de pantalla.
 */
export interface TargetStateMeta {
  state: TargetState;
  label: string;
  shortLabel: string;
  color: string;
  pattern: "solid" | "slow-pulse" | "flash-fade" | "countdown" | "fast-blink" | "alternate" | "sweep" | "dim-solid" | "hatched";
  /** Símbolo/glifo textual, independiente del color, para quien no distingue patrones de animación */
  symbol: string;
  aria: string;
}

export const TARGET_STATE_META: Record<TargetState, TargetStateMeta> = {
  off: {
    state: "off",
    label: "Apagada",
    shortLabel: "Apagada",
    color: "#4b5563",
    pattern: "solid",
    symbol: "○",
    aria: "Diana apagada",
  },
  safe: {
    state: "safe",
    label: "Segura",
    shortLabel: "Segura",
    color: "#2563eb",
    pattern: "solid",
    symbol: "■",
    aria: "Diana segura, no disparar",
  },
  active: {
    state: "active",
    label: "Objetivo",
    shortLabel: "Objetivo",
    color: "#dc2626",
    pattern: "slow-pulse",
    symbol: "◎",
    aria: "Diana activa, es objetivo válido",
  },
  hit: {
    state: "hit",
    label: "Acierto",
    shortLabel: "Acierto",
    color: "#16a34a",
    pattern: "flash-fade",
    symbol: "✓",
    aria: "Diana acertada",
  },
  countdown: {
    state: "countdown",
    label: "Preparación",
    shortLabel: "Preparación",
    color: "#ca8a04",
    pattern: "countdown",
    symbol: "◷",
    aria: "Diana en cuenta atrás de preparación",
  },
  penalty: {
    state: "penalty",
    label: "Penalización",
    shortLabel: "Penaliza",
    color: "#c026d3",
    pattern: "fast-blink",
    symbol: "✕",
    aria: "Diana en penalización",
  },
  error: {
    state: "error",
    label: "Error",
    shortLabel: "Error",
    color: "#dc2626",
    pattern: "alternate",
    symbol: "!",
    aria: "Diana en error",
  },
  calibration: {
    state: "calibration",
    label: "Calibración",
    shortLabel: "Calibrando",
    color: "#0891b2",
    pattern: "sweep",
    symbol: "⟳",
    aria: "Diana en calibración",
  },
  locked: {
    state: "locked",
    label: "Bloqueada",
    shortLabel: "Bloqueada",
    color: "#374151",
    pattern: "hatched",
    symbol: "🔒",
    aria: "Posición bloqueada",
  },
  sensor_error: {
    state: "sensor_error",
    label: "Error de sensor",
    shortLabel: "Sensor",
    color: "#ea580c",
    pattern: "fast-blink",
    symbol: "⚠",
    aria: "Error de sensor en la diana",
  },
  maintenance: {
    state: "maintenance",
    label: "Mantenimiento",
    shortLabel: "Manten.",
    color: "#e5e7eb",
    pattern: "dim-solid",
    symbol: "✦",
    aria: "Diana en mantenimiento",
  },
  disabled: {
    state: "disabled",
    label: "Deshabilitada",
    shortLabel: "Deshab.",
    color: "#6b7280",
    pattern: "hatched",
    symbol: "⊘",
    aria: "Diana deshabilitada",
  },
};

export function targetStateMeta(state: TargetState): TargetStateMeta {
  return TARGET_STATE_META[state] ?? TARGET_STATE_META.off;
}
