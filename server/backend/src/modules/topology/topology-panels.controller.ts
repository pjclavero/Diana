import { Body, Controller, Get, Param, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsArray, IsInt, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/roles.decorator';
import { TopologyPanelsService } from './topology-panels.service';

class SlotDto {
  @IsOptional()
  @IsString()
  module_id!: string | null;

  @IsInt()
  @Min(-1)
  @Max(1)
  x!: number;

  @IsInt()
  @Min(-1)
  @Max(1)
  y!: number;

  @IsOptional()
  @IsInt()
  rotation?: number;
}

class SavePanelDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SlotDto)
  slots!: SlotDto[];
}

/**
 * Matriz real por panel (X-21). Se registra ANTES del CRUD genérico de
 * `topology` para que `:id` no capture `panels`.
 */
@ApiTags('topology')
@ApiBearerAuth()
@Controller('topology')
export class TopologyPanelsController {
  constructor(
    private readonly panels: TopologyPanelsService,
    private readonly audit: AuditService,
  ) {}

  @Get('panels')
  @RequirePermissions('topology:read')
  @ApiOperation({ summary: 'Paneles disponibles para el editor de matrices' })
  list() {
    return this.panels.listPanels();
  }

  @Get('panels/:idOrSlug')
  @RequirePermissions('topology:read')
  @ApiOperation({ summary: 'Matriz 3×3 real de un panel + módulos sin colocar' })
  get(@Param('idOrSlug') idOrSlug: string) {
    return this.panels.getPanel(idOrSlug);
  }

  @Put('panels/:idOrSlug')
  @RequirePermissions('topology:write')
  @ApiOperation({ summary: 'Guarda la matriz del panel (reemplazo completo)' })
  async save(
    @Param('idOrSlug') idOrSlug: string,
    @Body() dto: SavePanelDto,
    @Req() req: { user: AuthenticatedUser },
  ) {
    const result = await this.panels.savePanel(idOrSlug, dto.slots, req.user?.username);
    await this.audit.record({
      user: req.user,
      action: 'topology.save',
      entity: 'target-system',
      entityId: result.system.id,
      after: { slots: result.slots.length },
    });
    return result;
  }
}
