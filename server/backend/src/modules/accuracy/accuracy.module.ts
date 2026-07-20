import { Controller, Get, Module, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/roles.decorator';
import { AccuracyService } from './accuracy.service';

@ApiTags('accuracy')
@ApiBearerAuth()
@Controller('accuracy')
export class AccuracyController {
  constructor(private readonly accuracy: AccuracyService) {}

  @Get('rounds/:roundId/participants/:participantId')
  @RequirePermissions('accuracy:read')
  @ApiOperation({
    summary: 'Precisión de un participante en una ronda',
    description:
      'Devuelve `accuracy_status: "not_computable"` con su motivo cuando se desconoce la ' +
      'munición restante (ADR-0006). En ese caso `shots_fired`, `accuracy_total` y ' +
      '`accuracy_valid` son null: el sistema NO estima disparos.',
  })
  get(@Param('roundId') roundId: string, @Param('participantId') participantId: string) {
    return this.accuracy.forParticipant(roundId, participantId);
  }

  @Post('rounds/:roundId/compute')
  @RequirePermissions('games:control')
  @ApiOperation({ summary: 'Calcula y guarda los resultados de la ronda' })
  compute(@Param('roundId') roundId: string) {
    return this.accuracy.persistRound(roundId);
  }
}

@Module({
  controllers: [AccuracyController],
  providers: [AccuracyService],
  exports: [AccuracyService],
})
export class AccuracyModule {}
