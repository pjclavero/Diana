import { Controller, Get, Header, Injectable, Module, Param, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CsvValue, toCsv } from '../../domain/exports/csv';
import { RequirePermissions } from '../auth/roles.decorator';

const HIT_COLUMNS = [
  'event_id',
  'system_slug',
  'module_slug',
  'target_index',
  'game_id',
  'round_id',
  'classification',
  'classification_reason',
  'device_boot_id',
  'device_event_us',
  'device_uptime_us',
  'coordinator_elapsed_us',
  'coordinator_recv_us',
  'clock_offset_us',
  'received_at',
  'persisted_at',
  'out_of_window',
  'replay',
  'detection_method',
  'amplitude',
  'threshold',
  'firmware_version',
];

const RESULT_COLUMNS = [
  'round_id',
  'participant_id',
  'player',
  'valid_hits',
  'invalid_hits',
  'detected_hits',
  'penalties_count',
  'penalties_ms',
  'initial_ammo',
  'remaining_ammo',
  'shots_fired',
  'accuracy_total',
  'accuracy_valid',
  'accuracy_status',
  'accuracy_reason',
  'first_hit_us',
  'total_time_us',
];

@Injectable()
export class ExportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Impactos de una ronda en CSV. Se exportan las CUATRO marcas temporales por
   * separado: quien audite los datos debe poder distinguirlas (ADR-0002).
   */
  async hitsCsv(roundId: string): Promise<string> {
    const rows = await this.prisma.hitEvent.findMany({
      where: { roundId },
      orderBy: { deviceEventUs: 'asc' },
    });
    return toCsv(
      HIT_COLUMNS,
      rows.map((row): Record<string, CsvValue> => ({
        event_id: row.eventId,
        system_slug: row.systemSlug,
        module_slug: row.moduleSlug,
        target_index: row.targetIndex,
        game_id: row.gameId,
        round_id: row.roundId,
        classification: row.classification,
        classification_reason: row.classificationReason,
        device_boot_id: row.deviceBootId,
        device_event_us: row.deviceEventUs,
        device_uptime_us: row.deviceUptimeUs,
        coordinator_elapsed_us: row.coordinatorElapsedUs,
        coordinator_recv_us: row.coordinatorRecvUs,
        clock_offset_us: row.clockOffsetUs,
        received_at: row.receivedAt,
        persisted_at: row.persistedAt,
        out_of_window: row.outOfWindow,
        replay: row.replay,
        // ADR-0007: la columna del perfil viaja SIEMPRE, y va antes que las
        // medidas. Quien audite el CSV debe poder distinguir una amplitud
        // vacía "porque el hardware no mide" de una vacía por pérdida de dato.
        detection_method: row.detectionMethod,
        amplitude: row.amplitude,
        threshold: row.threshold,
        firmware_version: row.firmwareVersion,
      })),
      { bom: true },
    );
  }

  /** Resultados de una ronda. Las precisiones no calculables quedan VACÍAS. */
  async resultsCsv(roundId: string): Promise<string> {
    const rows = await this.prisma.result.findMany({
      where: { roundId },
      include: { participant: { include: { player: true } } },
      orderBy: { score: 'desc' },
    });
    return toCsv(
      RESULT_COLUMNS,
      rows.map((row): Record<string, CsvValue> => ({
        round_id: row.roundId,
        participant_id: row.participantId,
        player: row.participant.player?.displayName ?? null,
        valid_hits: row.validHits,
        invalid_hits: row.invalidHits,
        detected_hits: row.detectedHits,
        penalties_count: row.penaltiesCount,
        penalties_ms: row.penaltiesMs,
        initial_ammo: row.initialAmmo,
        remaining_ammo: row.remainingAmmo,
        shots_fired: row.shotsFired,
        accuracy_total: row.accuracyTotal,
        accuracy_valid: row.accuracyValid,
        accuracy_status: row.accuracyStatus,
        accuracy_reason: row.accuracyReason,
        first_hit_us: row.firstHitUs,
        total_time_us: row.totalTimeUs,
      })),
      { bom: true },
    );
  }

  async auditCsv(from?: Date, to?: Date): Promise<string> {
    const rows = await this.prisma.auditLog.findMany({
      where: { createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: 'desc' },
      take: 10000,
    });
    return toCsv(
      ['created_at', 'actor_username', 'actor_role', 'action', 'entity', 'entity_id', 'ip'],
      rows.map((row): Record<string, CsvValue> => ({
        created_at: row.createdAt,
        actor_username: row.actorUsername,
        actor_role: row.actorRole,
        action: row.action,
        entity: row.entity,
        entity_id: row.entityId,
        ip: row.ip,
      })),
      { bom: true },
    );
  }
}

@ApiTags('exports')
@ApiBearerAuth()
@Controller('exports')
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @Get('rounds/:roundId/hits.csv')
  @RequirePermissions('exports:read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOperation({ summary: 'Exporta los impactos de una ronda en CSV' })
  async hits(@Param('roundId') roundId: string, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Content-Disposition', `attachment; filename="hits-${roundId}.csv"`);
    return this.exports.hitsCsv(roundId);
  }

  @Get('rounds/:roundId/results.csv')
  @RequirePermissions('exports:read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOperation({ summary: 'Exporta los resultados de una ronda en CSV' })
  async results(@Param('roundId') roundId: string, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Content-Disposition', `attachment; filename="results-${roundId}.csv"`);
    return this.exports.resultsCsv(roundId);
  }

  @Get('audit.csv')
  @RequirePermissions('audit:read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOperation({ summary: 'Exporta la auditoría administrativa en CSV' })
  async audit(
    @Res({ passthrough: true }) res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    res.setHeader('Content-Disposition', 'attachment; filename="audit.csv"');
    return this.exports.auditCsv(
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
  }
}

@Module({
  controllers: [ExportsController],
  providers: [ExportsService],
  exports: [ExportsService],
})
export class ExportsModule {}
