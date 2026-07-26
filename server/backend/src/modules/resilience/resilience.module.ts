import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/roles.decorator';
import { ResilienceService } from './resilience.service';

class DecisionDto {
  @IsIn(['resume', 'resume_without', 'abort'])
  action!: 'resume' | 'resume_without' | 'abort';
}

/**
 * Resiliencia de ronda (G-I). La lectura del estado va con `games:read`; la
 * decisión (reanudar sin un módulo o abortar) exige `games:control`, porque
 * cambia las condiciones de la prueba.
 */
@ApiTags('resilience')
@ApiBearerAuth()
@Controller('resilience')
export class ResilienceController {
  constructor(
    private readonly resilience: ResilienceService,
    private readonly audit: AuditService,
  ) {}

  @Get('games/:gameId')
  @RequirePermissions('games:read')
  @ApiOperation({ summary: 'Módulos caídos, cuenta atrás de reconexión y opciones' })
  status(@Param('gameId', ParseUUIDPipe) gameId: string) {
    return this.resilience.statusOf(gameId);
  }

  @Post('games/:gameId/decision')
  @RequirePermissions('games:control')
  @ApiOperation({ summary: 'Decisión del operador: reanudar sin el módulo o abortar' })
  async decide(
    @Param('gameId', ParseUUIDPipe) gameId: string,
    @Body() dto: DecisionDto,
    @Req() req: { user: AuthenticatedUser },
  ) {
    const result = await this.resilience.decide(gameId, dto.action, req.user?.username);
    await this.audit.record({
      user: req.user,
      action: `resilience.${dto.action}`,
      entity: 'game',
      entityId: gameId,
      after: result,
    });
    return result;
  }
}

@Module({
  // `ResilienceService` lo provee `MqttModule` (@Global): es el sumidero de
  // presencia y necesita `MqttService` para ordenar la pausa.
  controllers: [ResilienceController],
})
export class ResilienceModule {}
