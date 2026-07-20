/**
 * Estadísticas de ronda (dosier 17.4).
 *
 * Todos los tiempos proceden de T2 (`coordinator_elapsed_us`): el tiempo de
 * juego lo consolida el coordinador. Si un impacto no trae T2 se EXCLUYE de
 * las métricas temporales en vez de sustituirlo por otra marca.
 */

export interface HitSample {
  /** T2, microsegundos. `null` si el coordinador no consolidó el evento. */
  elapsedUs: number | null;
  classification: string;
  moduleSlug: string;
  targetIndex: number;
}

export interface RoundStatistics {
  validHits: number;
  invalidHits: number;
  detectedHits: number;
  /** Impactos válidos sin T2: no entran en las métricas temporales. */
  withoutCoordinatorTime: number;
  firstHitUs: number | null;
  totalTimeUs: number | null;
  meanIntervalUs: number | null;
  bestIntervalUs: number | null;
  worstIntervalUs: number | null;
  /** Desviación típica poblacional de los intervalos. */
  intervalStdDevUs: number | null;
  hitsPerTarget: Record<string, number>;
}

const DETECTED = new Set([
  'valid_hit',
  'hit_on_safe',
  'hit_on_already_hit',
  'out_of_order',
  'during_pause',
  'calibration_hit',
]);

export function computeRoundStatistics(samples: HitSample[]): RoundStatistics {
  const detected = samples.filter((s) => DETECTED.has(s.classification));
  const valid = detected.filter((s) => s.classification === 'valid_hit');

  const timed = valid
    .filter((s): s is HitSample & { elapsedUs: number } => s.elapsedUs !== null)
    .sort((a, b) => a.elapsedUs - b.elapsedUs);

  const intervals: number[] = [];
  for (let i = 1; i < timed.length; i += 1) {
    intervals.push(timed[i].elapsedUs - timed[i - 1].elapsedUs);
  }

  const mean =
    intervals.length > 0 ? intervals.reduce((a, b) => a + b, 0) / intervals.length : null;
  const stdDev =
    mean !== null && intervals.length > 0
      ? Math.sqrt(intervals.reduce((acc, x) => acc + (x - mean) ** 2, 0) / intervals.length)
      : null;

  const hitsPerTarget: Record<string, number> = {};
  for (const sample of valid) {
    const key = `${sample.moduleSlug}#${sample.targetIndex}`;
    hitsPerTarget[key] = (hitsPerTarget[key] ?? 0) + 1;
  }

  return {
    validHits: valid.length,
    invalidHits: detected.length - valid.length,
    detectedHits: detected.length,
    withoutCoordinatorTime: valid.length - timed.length,
    firstHitUs: timed.length > 0 ? timed[0].elapsedUs : null,
    totalTimeUs: timed.length > 0 ? timed[timed.length - 1].elapsedUs : null,
    meanIntervalUs: mean === null ? null : Math.round(mean),
    bestIntervalUs: intervals.length > 0 ? Math.min(...intervals) : null,
    worstIntervalUs: intervals.length > 0 ? Math.max(...intervals) : null,
    intervalStdDevUs: stdDev === null ? null : Math.round(stdDev),
    hitsPerTarget,
  };
}
