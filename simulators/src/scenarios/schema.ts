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
  | { type: 'start_autoplayer'; reactionMs?: [number, number]; errorRate?: number }
  | { type: 'arm_and_start'; game: ScenarioGame }
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
