import { Controller, Get, Module, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequirePermissions } from '../auth/roles.decorator';

/**
 * Consulta de impactos. Los eventos son INMUTABLES (dosier 21.2): no hay
 * endpoints de modificación ni de borrado individual.
 */
@ApiTags('hits')
@ApiBearerAuth()
@Controller('hits')
export class HitsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('hits:read')
  @ApiOperation({ summary: 'Lista impactos, ordenados por T1 (tiempo del dispositivo)' })
  async list(
    @Query('roundId') roundId?: string,
    @Query('gameId') gameId?: string,
    @Query('moduleSlug') moduleSlug?: string,
    @Query('classification') classification?: string,
    @Query('take') take = '200',
  ) {
    const items = await this.prisma.hitEvent.findMany({
      where: {
        roundId: roundId || undefined,
        gameId: gameId || undefined,
        moduleSlug: moduleSlug || undefined,
        classification: (classification as never) || undefined,
      },
      // Orden por T1: es la única referencia temporal del propio impacto.
      orderBy: [{ deviceEventUs: 'asc' }],
      take: Math.min(Number.parseInt(take, 10) || 200, 1000),
    });
    return { items, total: items.length };
  }

  @Get('by-event/:eventId')
  @RequirePermissions('hits:read')
  get(@Param('eventId') eventId: string) {
    return this.prisma.hitEvent.findUnique({ where: { eventId } });
  }

  @Get('rounds/:roundId/summary')
  @RequirePermissions('hits:read')
  @ApiOperation({ summary: 'Recuento de impactos por clasificación en una ronda' })
  async summary(@Param('roundId') roundId: string) {
    const rows = await this.prisma.hitEvent.groupBy({
      by: ['classification'],
      where: { roundId },
      _count: { _all: true },
    });
    return {
      round_id: roundId,
      by_classification: Object.fromEntries(rows.map((r) => [r.classification, r._count._all])),
    };
  }
}

@Module({ controllers: [HitsController] })
export class HitsModule {}
