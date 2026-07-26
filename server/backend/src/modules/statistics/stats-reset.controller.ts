import { Controller, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/roles.decorator';
import { StatsResetService } from './stats-reset.service';

/**
 * Reinicio de la estadística de un jugador en UNA partida (§3.4).
 *
 * `stats:reset` sólo lo tienen gestor y admin: el rol `jugador` no puede
 * reiniciar la suya. La ruta lleva la partida además del puesto para que un
 * error de partida se detecte antes de borrar (lo comprueba el servicio).
 */
@ApiTags('statistics')
@ApiBearerAuth()
@Controller('statistics')
export class StatsResetController {
  constructor(
    private readonly statsReset: StatsResetService,
    private readonly audit: AuditService,
  ) {}

  @Post('games/:gameId/participants/:participantId/reset')
  @RequirePermissions('stats:reset')
  @ApiOperation({
    summary:
      'Reinicia la estadística de un jugador en esa partida (borra resultados, penalizaciones y munición; desatribuye sus impactos, que no se borran)',
  })
  async reset(
    @Param('gameId', ParseUUIDPipe) gameId: string,
    @Param('participantId', ParseUUIDPipe) participantId: string,
    @Req() req: { user: AuthenticatedUser },
  ) {
    const outcome = await this.statsReset.resetParticipant(gameId, participantId, req.user);
    // Borrar estadística es irreversible: la auditoría guarda el alcance exacto
    // (qué puestos y cuántas filas) y si el actor se reinició a sí mismo.
    await this.audit.record({
      user: req.user,
      action: 'stats.reset',
      entity: 'participant',
      entityId: participantId,
      after: outcome,
    });
    return outcome;
  }
}
