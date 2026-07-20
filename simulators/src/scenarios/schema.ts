import type { ModulePosition, ModuleRotation, SelectorPosition } from '../domain/types.js';
import type { GameMode } from '../domain/coordinator.js';

export interface ScenarioModule {
  moduleId: string;
  position?: ModulePosition;
  rotation?: ModuleRotation;
  selector?: SelectorPosition;
  firmwareVersion?: string;
}

export interface ScenarioGame {
  gameId: string;
  roundId: string;
  mode: GameMode;
  targets: { module_id: string; target_index: number }[];
  sequence?: { module_id: string; target_index: number }[] | null;
  penaltyMs?: number;
  strictOrder?: boolean;
  reactionDelayMs?: [number, number] | null;
  seed?: number;
}

export type ScenarioStep =
  | { type: 'boot_all' }
  | { type: 'wait_ms'; ms: number }
  | { type: 'set_selector'; moduleId: string; selector: SelectorPosition }
  /**
   * A diferencia de "set_selector" (sólo mueve el selector físico), esto
   * crea de verdad un Coordinator para ese módulo. Llamarlo dos veces con
   * módulos distintos crea DOS coordinadores independientes a la vez — es
   * el mecanismo para provocar el conflicto de doble PRINCIPAL de forma
   * determinista (ver escenario 06).
   */
  | { type: 'set_principal'; moduleId: string }
  | { type: 'start_autoplayer'; reactionMs?: [number, number]; errorRate?: number }
  | { type: 'arm_and_start'; game: ScenarioGame }
  /** Emitido por un actor "operator-cli"/backend, nunca por un módulo (H-06/H-01). */
  | { type: 'system_command'; action: string; game?: ScenarioGame }
  | { type: 'pause_game' }
  | { type: 'resume_game' }
  | { type: 'abort_game' }
  | { type: 'hit'; moduleId: string; targetIndex: number; amplitude?: number; suppressCrosstalk?: boolean }
  | { type: 'duplicate_last_hit'; moduleId: string }
  | { type: 'kill_connection'; moduleId: string }
  | { type: 'reconnect'; moduleId: string }
  | { type: 'shutdown'; moduleId: string }
  | { type: 'reboot'; moduleId: string }
  | { type: 'low_voltage'; moduleId: string; voltage5vMv: number }
  | { type: 'telemetry'; moduleId: string }
  | { type: 'settle'; ticks?: number };

export interface Scenario {
  name: string;
  description?: string;
  systemId: string;
  seed: number;
  moduleCount?: number;
  modules?: ScenarioModule[];
  principal?: string;
  steps: ScenarioStep[];
}
