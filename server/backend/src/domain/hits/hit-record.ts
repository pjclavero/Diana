/**
 * Traducción de un payload `hit-event` validado a registro persistible.
 *
 * ADR-0002 · REGLA DURA: este mapeador copia T1 (`device.*`) y T2
 * (`coordinator.*`) TAL CUAL vienen del payload. No los calcula, no los
 * completa, no los corrige. T3 (`receivedAt`) y T4 (`persistedAt`) son las
 * únicas marcas que pone el backend, y viven en columnas distintas.
 *
 * Si el evento llega fuera de la ventana admisible, se MARCA
 * (`outOfWindow` + motivo). Marcar no es corregir.
 */

export type HitClassification =
  | 'valid_hit'
  | 'hit_on_safe'
  | 'hit_on_already_hit'
  | 'out_of_order'
  | 'crosstalk_rejected'
  | 'ambiguous'
  | 'during_pause'
  | 'calibration_hit'
  | 'early_shot';

/** Clasificaciones que representan un impacto físico realmente detectado. */
export const DETECTED_CLASSIFICATIONS: readonly HitClassification[] = [
  'valid_hit',
  'hit_on_safe',
  'hit_on_already_hit',
  'out_of_order',
  'during_pause',
  'calibration_hit',
];

/** Clasificaciones que NO son un impacto sobre una diana (no cuentan como detectado). */
export const NON_IMPACT_CLASSIFICATIONS: readonly HitClassification[] = [
  'crosstalk_rejected',
  'ambiguous',
  'early_shot',
];

export function isDetectedHit(classification: HitClassification): boolean {
  return DETECTED_CLASSIFICATIONS.includes(classification);
}

export function countsForScore(classification: HitClassification): boolean {
  return classification === 'valid_hit';
}

/**
 * Cómo detectó el módulo el impacto (ADR-0007, `hit-event.schema.json`).
 *
 * - `analog_envelope`: envolvente por ADC. Trae `amplitude` y `threshold`.
 * - `digital_threshold`: salida DO del módulo comercial. NO hay ADC: la
 *   sensibilidad la fija un potenciómetro físico y no existe amplitud que
 *   medir. Rellenar `amplitude` con 0 para "que pase" está PROHIBIDO: sería un
 *   dato falso poniendo verde una comprobación.
 */
export type DetectionMethod = 'analog_envelope' | 'digital_threshold';

/**
 * ¿Este impacto trae medida analógica? Es la única pregunta que deben hacerse
 * los consumidores antes de leer `amplitude`/`threshold`. Se responde con el
 * DISCRIMINADOR, no con la ausencia del campo: la ausencia sola no distingue
 * un módulo DO-only de un productor averiado (`CONTRACT_GAP-DO-ONLY`).
 */
export function hasAnalogMeasurement(record: {
  detectionMethod: DetectionMethod;
}): boolean {
  return record.detectionMethod === 'analog_envelope';
}

export interface HitEventPayload {
  schema_version: number;
  event_id: string;
  system_id: string;
  module_id: string;
  game_id?: string;
  round_id?: string;
  target_index: number;
  module_position?: { x: number; y: number };
  module_rotation?: number;
  local_sequence: number;
  device: {
    boot_id: string;
    uptime_us: number;
    event_us: number;
    epoch_ms?: number | null;
  };
  coordinator?: {
    recv_us: number;
    elapsed_us: number;
    clock_offset_us: number;
    offset_uncertainty_us?: number;
  } | null;
  /**
   * ADR-0007 · discriminador de perfil de detección. AUSENTE equivale a
   * `analog_envelope` (productores v1 anteriores al ADR), nunca a "digital":
   * el esquema exige `amplitude`/`threshold` salvo que el evento se declare
   * `digital_threshold` de forma explícita.
   */
  detection_method?: DetectionMethod;
  /** Sólo en perfil analógico. En `digital_threshold` el esquema la PROHÍBE. */
  amplitude?: number;
  /** Sólo en perfil analógico. En `digital_threshold` el esquema lo PROHÍBE. */
  threshold?: number;
  noise_floor?: number;
  neighbours?: Array<{ target_index: number; amplitude?: number; delta_us: number }>;
  target_state_before: string;
  classification: HitClassification;
  classification_reason?: string;
  firmware_version: string;
  replay?: boolean;
}

export interface HitRecord {
  eventId: string;
  systemSlug: string;
  moduleSlug: string;
  targetIndex: number;
  gameId: string | null;
  roundId: string | null;
  /**
   * Participante al que se atribuye el impacto, o `null` si el sistema no
   * puede saberlo (varios jugadores compartiendo panel). Lo resuelve el
   * backend en la ingesta: el payload MQTT NO trae jugador.
   */
  participantId: string | null;
  modulePositionX: number | null;
  modulePositionY: number | null;
  moduleRotation: number | null;
  localSequence: bigint;

  // T1 · sólo copia
  deviceBootId: string;
  deviceUptimeUs: bigint;
  deviceEventUs: bigint;
  deviceEpochMs: bigint | null;

  // T2 · sólo copia
  coordinatorRecvUs: bigint | null;
  coordinatorElapsedUs: bigint | null;
  clockOffsetUs: bigint | null;
  offsetUncertaintyUs: bigint | null;

  // T3 · única marca temporal que aporta el backend en la ingesta
  receivedAt: Date;

  /**
   * Perfil de detección resuelto (ADR-0007). Nunca es null: si el payload no
   * lo trae, es `analog_envelope`, que es lo que el esquema le ha exigido.
   * Es lo que permite leer un `amplitude` nulo como "este hardware no mide"
   * en vez de como "se perdió el dato".
   */
  detectionMethod: DetectionMethod;
  /** null SÓLO cuando `detectionMethod` es `digital_threshold`. */
  amplitude: number | null;
  /** null SÓLO cuando `detectionMethod` es `digital_threshold`. */
  threshold: number | null;
  noiseFloor: number | null;
  neighbours: unknown;
  targetStateBefore: string;
  classification: HitClassification;
  classificationReason: string | null;
  firmwareVersion: string;
  replay: boolean;

  outOfWindow: boolean;
  outOfWindowReason: string | null;
  countsForScore: boolean;

  rawPayload: unknown;
}

/**
 * @param payload  payload MQTT ya validado contra `hit-event.schema.json`.
 * @param receivedAt  T3, momento de recepción del mensaje en el backend.
 */
export function toHitRecord(payload: HitEventPayload, receivedAt: Date): HitRecord {
  const device = payload.device;
  const coordinator = payload.coordinator ?? null;

  return {
    eventId: payload.event_id,
    systemSlug: payload.system_id,
    moduleSlug: payload.module_id,
    targetIndex: payload.target_index,
    gameId: payload.game_id ?? null,
    roundId: payload.round_id ?? null,
    // Se resuelve en la ingesta con el estado de la ronda; el payload no lo trae.
    participantId: null,
    modulePositionX: payload.module_position ? payload.module_position.x : null,
    modulePositionY: payload.module_position ? payload.module_position.y : null,
    moduleRotation: payload.module_rotation ?? null,
    localSequence: BigInt(payload.local_sequence),

    deviceBootId: device.boot_id,
    deviceUptimeUs: BigInt(device.uptime_us),
    deviceEventUs: BigInt(device.event_us),
    deviceEpochMs:
      device.epoch_ms === undefined || device.epoch_ms === null ? null : BigInt(device.epoch_ms),

    coordinatorRecvUs: coordinator ? BigInt(coordinator.recv_us) : null,
    coordinatorElapsedUs: coordinator ? BigInt(coordinator.elapsed_us) : null,
    clockOffsetUs: coordinator ? BigInt(coordinator.clock_offset_us) : null,
    offsetUncertaintyUs:
      coordinator && coordinator.offset_uncertainty_us !== undefined
        ? BigInt(coordinator.offset_uncertainty_us)
        : null,

    receivedAt,

    detectionMethod: payload.detection_method ?? 'analog_envelope',
    amplitude: payload.amplitude ?? null,
    threshold: payload.threshold ?? null,
    noiseFloor: payload.noise_floor ?? null,
    neighbours: payload.neighbours ?? null,
    targetStateBefore: payload.target_state_before,
    classification: payload.classification,
    classificationReason: payload.classification_reason ?? null,
    firmwareVersion: payload.firmware_version,
    replay: payload.replay ?? false,

    outOfWindow: false,
    outOfWindowReason: null,
    countsForScore: countsForScore(payload.classification),

    rawPayload: payload,
  };
}

export interface LatenessPolicy {
  /** Retraso máximo admisible entre T3 y la recepción esperada, en ms. */
  maxLatencyMs: number;
}

/**
 * Marca (no corrige) un evento cuya llegada al backend excede la ventana.
 *
 * La comparación se hace con marcas del BACKEND (T3 frente al instante de
 * evaluación) porque T1 es un reloj monotónico del módulo y no es comparable
 * con la hora de pared. Devuelve un registro nuevo con T1 y T2 intactos.
 */
export function markIfOutOfWindow(
  record: HitRecord,
  evaluatedAt: Date,
  policy: LatenessPolicy,
): HitRecord {
  const latencyMs = evaluatedAt.getTime() - record.receivedAt.getTime();
  if (latencyMs <= policy.maxLatencyMs) return record;
  return {
    ...record,
    outOfWindow: true,
    outOfWindowReason:
      `Persistido ${latencyMs} ms después de la recepción, por encima del límite ` +
      `de ${policy.maxLatencyMs} ms. T1 y T2 se conservan sin modificar.`,
  };
}
