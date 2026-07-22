import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/roles.decorator';
import { ViewsService } from './views.service';

class CreateViewDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string;
}

class PanelDto {
  @IsUUID()
  target_system_id!: string;
}

/**
 * Vistas (G-H): agrupan paneles. Lectura con `topology:read`; gestión con
 * `topology:write` (gestor/operador/admin). El scoping por dueño lo hace el servicio.
 */
@ApiTags('views')
@ApiBearerAuth()
@Controller('views')
export class ViewsController {
  constructor(
    private readonly views: ViewsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('topology:read')
  @ApiOperation({ summary: 'Lista las vistas (grupos de paneles) visibles' })
  list(@Req() req: { user: AuthenticatedUser }) {
    return this.views.list(req.user);
  }

  @Get(':id')
  @RequirePermissions('topology:read')
  @ApiOperation({ summary: 'Obtiene una vista con sus paneles' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.views.get(id);
  }

  @Get(':id/duelo-readiness')
  @RequirePermissions('topology:read')
  @ApiOperation({ summary: '¿La vista sirve para duelo? (todos los paneles con los mismos módulos)' })
  duelo(@Param('id', ParseUUIDPipe) id: string) {
    return this.views.dueloReadiness(id);
  }

  @Post()
  @RequirePermissions('topology:write')
  @ApiOperation({ summary: 'Crea una vista' })
  async create(@Body() dto: CreateViewDto, @Req() req: { user: AuthenticatedUser }) {
    const view = await this.views.create({ name: dto.name, description: dto.description ?? null }, req.user);
    await this.audit.record({ user: req.user, action: 'create', entity: 'view', entityId: view.id, after: view });
    return view;
  }

  @Post(':id/panels')
  @RequirePermissions('topology:write')
  @ApiOperation({ summary: 'Añade un panel a la vista' })
  async addPanel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PanelDto, @Req() req: { user: AuthenticatedUser }) {
    const view = await this.views.addPanel(id, dto.target_system_id, req.user);
    await this.audit.record({ user: req.user, action: 'view.add-panel', entity: 'view', entityId: id });
    return view;
  }

  @Delete(':id/panels/:targetSystemId')
  @RequirePermissions('topology:write')
  @ApiOperation({ summary: 'Quita un panel de la vista' })
  async removePanel(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('targetSystemId', ParseUUIDPipe) targetSystemId: string,
    @Req() req: { user: AuthenticatedUser },
  ) {
    const view = await this.views.removePanel(id, targetSystemId, req.user);
    await this.audit.record({ user: req.user, action: 'view.remove-panel', entity: 'view', entityId: id });
    return view;
  }

  @Delete(':id')
  @RequirePermissions('topology:write')
  @ApiOperation({ summary: 'Borra una vista' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: AuthenticatedUser }) {
    const result = await this.views.remove(id, req.user);
    await this.audit.record({ user: req.user, action: 'delete', entity: 'view', entityId: id });
    return result;
  }
}
