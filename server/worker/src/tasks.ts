import { PrismaClient } from '@prisma/client';
import { canPurgeRound, retentionCutoff } from './schedule';

/**
 * El worker comparte el esquema Prisma del backend
 * (`server/backend/prisma/schema.prisma`) pero genera su propio cliente. Para
 * que el `typecheck` no dependa de que el cliente esté generado, las filas que
 * se consumen aquí se tipan de forma explícita.
 */
interface ResultRow {
  validHits: number;
  accuracyValid: number | null;
  accuracyStatus: string;
  totalTimeUs: bigint | null;
}

interface IdRow {
  id: string;
}

interface RoundRow {
  id: string;
  finishedAt: Date | null;
  _count: { results: number };
}

export interface WorkerConfig {
  hitEventsDays: number;
  telemetryDays: number;
  auditDays: number;
  exportsDir: string;
  dryRun: boolean;
}

export interface TaskResult {
  task: string;
  affected: number;
  detail?: string;
}

/**
 * Recalcula estadísticas agregadas por jugador a partir de los resultados ya
 * calculados. Se ejecuta en diferido porque no es necesario en tiempo real.
 *
 * IMPORTANTE: los resultados `not_computable` NO se promedian como cero. Se
 * cuentan aparte (ADR-0006).
 */
export async function recomputePlayerStatistics(
  prisma: PrismaClient,
  config: WorkerConfig,
): Promise<TaskResult> {
  const players = await prisma.player.findMany({ where: { active: true }, select: { id: true } });
  let written = 0;

  for (const player of players) {
    const results = await prisma.result.findMany({
      where: { participant: { playerId: player.id } },
      select: { validHits: true, accuracyValid: true, accuracyStatus: true, totalTimeUs: true },
    });
    if (results.length === 0) {
      // SIN RESULTADOS NO SE SALTA: se borra lo que hubiera. Saltar dejaba los
      // totales anteriores congelados para siempre —el caso real es un jugador
      // al que se le reinicia su única partida (F4): seguía figurando con sus
      // aciertos de antes y nada volvía a tocarlos jamás—.
      if (!config.dryRun) {
        const stale = await prisma.statistic.deleteMany({
          where: { scope: 'player', playerId: player.id, gameId: null, roundId: null },
        });
        written += stale.count;
      }
      continue;
    }

    const rows: ResultRow[] = results;
    const computable = rows.filter((r) => r.accuracyStatus === 'computed' && r.accuracyValid !== null);
    const averageAccuracy =
      computable.length > 0
        ? computable.reduce((acc: number, r: ResultRow) => acc + (r.accuracyValid ?? 0), 0) / computable.length
        : null;

    const metrics: Array<[string, number | null]> = [
      ['rounds_played', rows.length],
      ['total_valid_hits', rows.reduce((acc: number, r: ResultRow) => acc + r.validHits, 0)],
      ['average_accuracy_valid', averageAccuracy],
      ['rounds_without_accuracy', rows.length - computable.length],
    ];

    for (const [metric, value] of metrics) {
      if (config.dryRun) {
        written += 1;
        continue;
      }
      // La clave única (scope, metric, playerId, gameId, roundId, periodStart)
      // incluye columnas ANULABLES (gameId/roundId/periodStart), que aquí van a
      // null para la estadística "por jugador". No se puede usar `upsert` sobre
      // esa clave: Prisma no admite null en el `where` único (typing) y, además,
      // en SQL NULL != NULL, así que el upsert insertaría un duplicado nuevo en
      // cada ejecución (crecimiento sin control). Se hace un find-by-null +
      // update/create explícito. (Hotfix WP-08 para desbloquear la imagen del
      // worker; revisar en WP-02.)
      const existing = await prisma.statistic.findFirst({
        where: {
          scope: 'player',
          metric,
          playerId: player.id,
          gameId: null,
          roundId: null,
          periodStart: null,
        },
        select: { id: true },
      });
      if (existing) {
        await prisma.statistic.update({
          where: { id: existing.id },
          data: { value, computedAt: new Date() },
        });
      } else {
        await prisma.statistic.create({
          data: { scope: 'player', metric, playerId: player.id, value },
        });
      }
      written += 1;
    }
  }

  return { task: 'recomputePlayerStatistics', affected: written };
}

/** Purga de telemetría y de incidencias resueltas antiguas. */
export async function applyRetention(
  prisma: PrismaClient,
  config: WorkerConfig,
  now: Date = new Date(),
): Promise<TaskResult[]> {
  const results: TaskResult[] = [];

  const incidentCutoff = retentionCutoff(now, config.telemetryDays);
  const incidents = await prisma.incident.findMany({
    where: { resolvedAt: { not: null, lt: incidentCutoff } },
    select: { id: true },
  });
  if (!config.dryRun && incidents.length > 0) {
    await prisma.incident.deleteMany({
      where: { id: { in: (incidents as IdRow[]).map((i) => i.id) } },
    });
  }
  results.push({
    task: 'retention:incidents',
    affected: incidents.length,
    detail: `resueltas antes de ${incidentCutoff.toISOString()}`,
  });

  const auditCutoff = retentionCutoff(now, config.auditDays);
  const audit = await prisma.auditLog.count({ where: { createdAt: { lt: auditCutoff } } });
  if (!config.dryRun && audit > 0) {
    await prisma.auditLog.deleteMany({ where: { createdAt: { lt: auditCutoff } } });
  }
  results.push({ task: 'retention:audit', affected: audit });

  // Impactos: sólo se purgan rondas terminadas Y con resultados calculados.
  const hitCutoff = retentionCutoff(now, config.hitEventsDays);
  const rounds = await prisma.round.findMany({
    where: { finishedAt: { not: null, lt: hitCutoff } },
    select: { id: true, finishedAt: true, _count: { select: { results: true } } },
  });
  const purgeable = (rounds as RoundRow[]).filter((round) =>
    canPurgeRound({ hasResults: round._count.results > 0, finishedAt: round.finishedAt }),
  );
  let purgedHits = 0;
  for (const round of purgeable) {
    const count = await prisma.hitEvent.count({ where: { roundId: round.id } });
    if (!config.dryRun && count > 0) {
      await prisma.hitEvent.deleteMany({ where: { roundId: round.id } });
    }
    purgedHits += count;
  }
  results.push({
    task: 'retention:hit_events',
    affected: purgedHits,
    detail: `${purgeable.length} rondas purgables de ${rounds.length} candidatas`,
  });

  return results;
}
