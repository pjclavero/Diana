import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/roles.decorator';
import { ACTIVATION_STATUS, ManagerActivationService } from './manager-activation.service';

class ActivateDto {
  @IsString()
  @Length(4, 16)
  code!: string;
}

class ListQueryDto {
  @IsOptional()
  @IsIn(Object.values(ACTIVATION_STATUS))
  status?: string;
}

/**
 * Ascenso de jugador a gestor por venta de módulo (F5, §3.1).
 *
 * `activate` es del **propio usuario**, no del admin: quien acepta el acceso de
 * gestor es el comprador. El resto son operaciones de administración.
 */
@ApiTags('manager-activations')
@ApiBearerAuth()
@Controller('manager-activations')
export class ManagerActivationController {
  constructor(
    private readonly activations: ManagerActivationService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('users:read')
  @ApiOperation({ summary: 'Ascensos generados: a quién, cuándo y si se pudo entregar' })
  list(@Query() query: ListQueryDto) {
    return this.activations.list(query.status);
  }

  @Get('mine')
  @ApiOperation({ summary: '¿Tengo un ascenso a gestor pendiente?' })
  mine(@Req() req: { user: AuthenticatedUser }) {
    return this.activations.mine(req.user.userId);
  }

  @Post('activate')
  @ApiOperation({ summary: 'El comprador introduce su código y su acceso de gestor queda activo' })
  async activate(@Body() dto: ActivateDto, @Req() req: { user: AuthenticatedUser }) {
    try {
      const result = await this.activations.activate(dto.code, { userId: req.user.userId });
      await this.audit.record({
        user: req.user,
        action: 'manager.activate',
        entity: 'user',
        entityId: req.user.userId,
        after: result,
      });
      return result;
    } catch (error) {
      // LOS INTENTOS FALLIDOS TAMBIÉN SE AUDITAN. Sin esto, probar códigos no
      // dejaba ni rastro: nadie podría distinguir un dedazo de alguien
      // tanteando. El código NO se registra, sólo el motivo del rechazo.
      await this.audit.record({
        user: req.user,
        action: 'manager.activate_failed',
        entity: 'user',
        entityId: req.user.userId,
        after: { reason: (error as Error).message },
      });
      throw error;
    }
  }

  @Post(':id/regenerate')
  @RequirePermissions('users:write')
  @ApiOperation({ summary: 'Regenera el código y reintenta la entrega' })
  async regenerate(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: { user: AuthenticatedUser },
  ) {
    const activation = await this.activations.regenerate(id, req.user.username);
    await this.audit.record({
      user: req.user,
      action: 'manager.activation_regenerate',
      entity: 'manager_activation',
      entityId: id,
      after: { expiresAt: activation.expiresAt, dispatchNote: activation.dispatchNote },
    });
    return activation;
  }

  @Post(':id/revoke')
  @RequirePermissions('users:write')
  @ApiOperation({ summary: 'Anula un ascenso pendiente' })
  async revoke(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: AuthenticatedUser }) {
    const activation = await this.activations.revoke(id);
    await this.audit.record({
      user: req.user,
      action: 'manager.activation_revoke',
      entity: 'manager_activation',
      entityId: id,
      after: { status: activation.status },
    });
    return activation;
  }
}
