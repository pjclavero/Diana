import { Body, Controller, Get, Injectable, Module, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { resolveShotsFired } from '../../domain/accuracy/accuracy';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/roles.decorator';

export class RecordAmmoDto {
  @ApiProperty({ description: 'Munición inicial disponible.' })
  @IsInt()
  @Min(0)
  initial_ammo!: number;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Munición restante contada. Omitir si NO se ha contado: no se estima.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  remaining_ammo?: number | null;

  @ApiProperty({ description: '¿Se ha contado realmente la munición restante?', default: false })
  @IsOptional()
  @IsBoolean()
  remaining_known?: boolean;

  @ApiProperty({ description: 'La partida exigía consumir toda la munición.', default: false })
  @IsOptional()
  @IsBoolean()
  must_use_all_ammo?: boolean;

  @ApiProperty({ required: false, enum: ['manual', 'auto_counter', 'full_magazine'] })
  @IsOptional()
  @IsString()
  source?: 'manual' | 'auto_counter' | 'full_magazine';
}

/**
 * Munición de un participante (dosier 17.2).
 *
 * Cada concepto se guarda por separado. `shots_fired` sólo se persiste cuando
 * es derivable; en caso contrario queda `null` y la precisión será
 * `not_computable` (ADR-0006).
 */
@Injectable()
export class AmmoService {
  constructor(private readonly prisma: PrismaService) {}

  async record(participantId: string, dto: RecordAmmoDto, recordedBy?: string) {
    const remainingKnown = dto.remaining_known ?? dto.remaining_ammo !== undefined;
    const mustUseAll = dto.must_use_all_ammo ?? false;

    const shotsFired = resolveShotsFired({
      initialAmmo: dto.initial_ammo,
      remainingAmmo: dto.remaining_ammo ?? null,
      remainingKnown,
      mustUseAllAmmo: mustUseAll,
      detectedHits: 0,
      validHits: 0,
      invalidHits: 0,
    });

    return this.prisma.shotCount.create({
      data: {
        participantId,
        source: (dto.source ?? (mustUseAll ? 'full_magazine' : 'manual')) as never,
        initialAmmo: dto.initial_ammo,
        remainingAmmo: remainingKnown ? (dto.remaining_ammo ?? null) : null,
        remainingKnown,
        mustUseAllAmmo: mustUseAll,
        shotsFired,
        recordedBy: recordedBy ?? null,
      },
    });
  }

  async history(participantId: string) {
    const items = await this.prisma.shotCount.findMany({
      where: { participantId },
      orderBy: { recordedAt: 'desc' },
    });
    return { items, total: items.length };
  }
}

@ApiTags('ammo')
@ApiBearerAuth()
@Controller('ammo')
export class AmmoController {
  constructor(
    private readonly ammo: AmmoService,
    private readonly audit: AuditService,
  ) {}

  @Get('participants/:participantId')
  @RequirePermissions('ammo:read')
  history(@Param('participantId') participantId: string) {
    return this.ammo.history(participantId);
  }

  @Post('participants/:participantId')
  @RequirePermissions('ammo:write')
  @ApiOperation({
    summary: 'Registra la munición de un participante',
    description:
      'Si no se aporta `remaining_ammo` y la partida no exigía consumir toda la munición, ' +
      '`shots_fired` queda null y la precisión no será calculable. Es el comportamiento ' +
      'correcto: inventar disparos está prohibido (ADR-0006).',
  })
  async record(
    @Param('participantId') participantId: string,
    @Body() dto: RecordAmmoDto,
    @Req() req: { user?: AuthenticatedUser },
  ) {
    const created = await this.ammo.record(participantId, dto, req.user?.username);
    await this.audit.record({
      user: req.user,
      action: 'record_ammo',
      entity: 'shot_count',
      entityId: created.id,
      after: created,
    });
    return created;
  }
}

@Module({
  controllers: [AmmoController],
  providers: [AmmoService],
  exports: [AmmoService],
})
export class AmmoModule {}
