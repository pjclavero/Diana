import { Controller, Get, Module, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/roles.decorator';
import { ScoreboardService } from './scoreboard.service';

/**
 * Marcador de partida (G-G). Lectura pura: no cambia ningún estado de juego.
 */
@ApiTags('scoreboard')
@ApiBearerAuth()
@Controller('scoreboard')
export class ScoreboardController {
  constructor(private readonly scoreboard: ScoreboardService) {}

  @Get('games/:gameId')
  @RequirePermissions('statistics:read')
  @ApiOperation({ summary: 'Marcador: resultados + estado de las dianas de la partida' })
  game(
    @Param('gameId', ParseUUIDPipe) gameId: string,
    @Query('round_id', new ParseUUIDPipe({ optional: true })) roundId?: string,
  ) {
    return this.scoreboard.forGame(gameId, roundId);
  }

  @Get('participants/:participantId')
  @RequirePermissions('statistics:read')
  @ApiOperation({ summary: 'Estadística histórica del jugador que ocupa ese puesto' })
  participant(@Param('participantId', ParseUUIDPipe) participantId: string) {
    return this.scoreboard.forParticipant(participantId);
  }
}

@Module({
  controllers: [ScoreboardController],
  providers: [ScoreboardService],
  exports: [ScoreboardService],
})
export class ScoreboardModule {}
