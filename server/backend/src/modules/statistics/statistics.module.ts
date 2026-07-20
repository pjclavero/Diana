import { Controller, Get, Injectable, Module, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  computeRoundStatistics,
  HitSample,
  RoundStatistics,
} from '../../domain/statistics/round-statistics';
import { RequirePermissions } from '../auth/roles.decorator';

@Injectable()
export class StatisticsService {
  constructor(private readonly prisma: PrismaService) {}

  async forRound(roundId: string): Promise<RoundStatistics & { round_id: string }> {
    const rows = await this.prisma.hitEvent.findMany({
      where: { roundId },
      select: {
        coordinatorElapsedUs: true,
        classification: true,
        moduleSlug: true,
        targetIndex: true,
      },
    });
    const samples: HitSample[] = rows.map((row) => ({
      elapsedUs: row.coordinatorElapsedUs === null ? null : Number(row.coordinatorElapsedUs),
      classification: row.classification,
      moduleSlug: row.moduleSlug,
      targetIndex: row.targetIndex,
    }));
    return { ...computeRoundStatistics(samples), round_id: roundId };
  }

  /** Evolución histórica de un jugador (dosier 17.4). */
  async forPlayer(playerId: string, take = 50) {
    const results = await this.prisma.result.findMany({
      where: { participant: { playerId } },
      orderBy: { computedAt: 'desc' },
      take,
      include: { round: { select: { id: true, mode: true, startedAt: true } } },
    });
    const computable = results.filter((r) => r.accuracyStatus === 'computed');
    const averageAccuracy =
      computable.length > 0
        ? computable.reduce((acc, r) => acc + (r.accuracyValid ?? 0), 0) / computable.length
        : null;

    return {
      player_id: playerId,
      rounds: results.length,
      total_valid_hits: results.reduce((acc, r) => acc + r.validHits, 0),
      // Sólo promedia lo que es calculable: los `not_computable` no cuentan
      // como cero (sería inventar precisión).
      average_accuracy_valid: averageAccuracy === null ? null : Math.round(averageAccuracy * 100) / 100,
      rounds_without_accuracy: results.length - computable.length,
      results,
    };
  }
}

@ApiTags('statistics')
@ApiBearerAuth()
@Controller('statistics')
export class StatisticsController {
  constructor(private readonly statistics: StatisticsService) {}

  @Get('rounds/:roundId')
  @RequirePermissions('statistics:read')
  @ApiOperation({ summary: 'Estadísticas de una ronda a partir de T2 (dosier 17.4)' })
  round(@Param('roundId') roundId: string) {
    return this.statistics.forRound(roundId);
  }

  @Get('players/:playerId')
  @RequirePermissions('statistics:read')
  @ApiOperation({ summary: 'Evolución histórica de un jugador' })
  player(@Param('playerId') playerId: string, @Query('take') take = '50') {
    return this.statistics.forPlayer(playerId, Math.min(Number.parseInt(take, 10) || 50, 200));
  }
}

@Module({
  controllers: [StatisticsController],
  providers: [StatisticsService],
  exports: [StatisticsService],
})
export class StatisticsModule {}
