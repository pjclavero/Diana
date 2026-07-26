import { recomputePlayerStatistics } from '../../../worker/src/tasks';

/**
 * El acumulado global del jugador lo escribe el WORKER, no el backend. Esto no
 * estaba probado por nadie, y ahí se escondía un fallo real: al reiniciar la
 * estadística de la única partida de un jugador, el worker se saltaba el
 * recálculo (`results.length === 0 → continue`) y sus totales anteriores
 * quedaban congelados para siempre.
 */
function buildPrisma(over: any = {}) {
  const statistics: any[] = over.statistics ?? [];
  return {
    db: { statistics },
    player: {
      findMany: jest.fn().mockResolvedValue(over.players ?? [{ id: 'pl1' }]),
    },
    result: {
      findMany: jest.fn().mockResolvedValue(over.results ?? []),
    },
    statistic: {
      findFirst: jest.fn(async ({ where }: any) =>
        statistics.find((s) => s.playerId === where.playerId && s.metric === where.metric) ?? null,
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const row = statistics.find((s) => s.id === where.id);
        Object.assign(row, data);
        return row;
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `st-${statistics.length + 1}`, ...data };
        statistics.push(row);
        return row;
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        const before = statistics.length;
        for (let i = statistics.length - 1; i >= 0; i -= 1) {
          if (statistics[i].playerId === where.playerId) statistics.splice(i, 1);
        }
        return { count: before - statistics.length };
      }),
    },
  } as any;
}

const config = { dryRun: false } as never;
const resultado = (over: any = {}) => ({
  validHits: 3,
  accuracyValid: 0.75,
  accuracyStatus: 'computed',
  totalTimeUs: 1_000,
  ...over,
});

describe('recomputePlayerStatistics · el acumulado global SÍ se escribe', () => {
  it('escribe las cuatro métricas del jugador', async () => {
    const prisma = buildPrisma({ results: [resultado(), resultado({ validHits: 2 })] });
    await recomputePlayerStatistics(prisma, config);
    const metricas = prisma.db.statistics.map((s: any) => s.metric).sort();
    expect(metricas).toEqual([
      'average_accuracy_valid',
      'rounds_played',
      'rounds_without_accuracy',
      'total_valid_hits',
    ]);
    const total = prisma.db.statistics.find((s: any) => s.metric === 'total_valid_hits');
    expect(total.value).toBe(5);
  });

  it('sin resultados BORRA el acumulado anterior en vez de congelarlo', async () => {
    // Éste es el caso del reinicio de estadística (F4): antes se hacía
    // `continue` y el jugador seguía figurando con sus 47 aciertos de siempre,
    // sin que nada volviera a tocarlos jamás.
    const prisma = buildPrisma({
      results: [],
      statistics: [
        { id: 'st1', scope: 'player', metric: 'total_valid_hits', playerId: 'pl1', value: 47 },
      ],
    });
    await recomputePlayerStatistics(prisma, config);
    expect(prisma.db.statistics).toEqual([]);
  });

  it('en simulacro no borra nada', async () => {
    const prisma = buildPrisma({
      results: [],
      statistics: [{ id: 'st1', metric: 'total_valid_hits', playerId: 'pl1', value: 47 }],
    });
    await recomputePlayerStatistics(prisma, { dryRun: true } as never);
    expect(prisma.db.statistics).toHaveLength(1);
  });

  it('un resultado no calculable NO se promedia como cero (ADR-0006)', async () => {
    const prisma = buildPrisma({
      results: [
        resultado({ accuracyValid: 0.8 }),
        resultado({ accuracyStatus: 'not_computable', accuracyValid: null }),
      ],
    });
    await recomputePlayerStatistics(prisma, config);
    const media = prisma.db.statistics.find((s: any) => s.metric === 'average_accuracy_valid');
    const sinPrecision = prisma.db.statistics.find(
      (s: any) => s.metric === 'rounds_without_accuracy',
    );
    expect(media.value).toBeCloseTo(0.8);
    expect(sinPrecision.value).toBe(1);
  });

  it('sin ninguna precisión calculable la media es null, no cero', async () => {
    const prisma = buildPrisma({
      results: [resultado({ accuracyStatus: 'not_computable', accuracyValid: null })],
    });
    await recomputePlayerStatistics(prisma, config);
    const media = prisma.db.statistics.find((s: any) => s.metric === 'average_accuracy_valid');
    expect(media.value).toBeNull();
  });
});
