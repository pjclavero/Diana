import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AuthenticatedUser } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/roles.decorator';
import { ModuleOwnershipService } from './module-ownership.service';
import { ModulesOverviewService } from './modules-overview.service';
import { ModuleConfigService } from './module-config.service';

export class LinkModuleDto {
  @ApiProperty({ description: 'Usuario al que se vincula el módulo. Un no-admin sólo puede indicar su propio id.' })
  @IsString()
  @IsUUID()
  user_id!: string;
}

class NetworkDto {
  @IsIn(['dhcp', 'static'])
  mode!: 'dhcp' | 'static';

  @IsOptional()
  @IsString()
  ip?: string | null;

  @IsOptional()
  @IsString()
  netmask?: string | null;

  @IsOptional()
  @IsString()
  gateway?: string | null;
}

export class PushConfigDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => NetworkDto)
  network?: NetworkDto;
}

@ApiTags('modules')
@ApiBearerAuth()
@Controller('modules')
export class ModuleOwnershipController {
  constructor(
    private readonly ownership: ModuleOwnershipService,
    private readonly overviewService: ModulesOverviewService,
    private readonly config: ModuleConfigService,
  ) {}

  @Get('mine')
  @RequirePermissions('profile:read')
  @ApiOperation({ summary: 'Módulos de los que el usuario autenticado es dueño' })
  mine(@Req() req: { user: AuthenticatedUser }) {
    return this.ownership.listOwnedBy(req.user.userId);
  }

  @Get('overview')
  @RequirePermissions('modules:read')
  @ApiOperation({ summary: 'Resumen de módulos + estado de actualización (dashboard). Admin: todos; gestor: los suyos' })
  overview(@Req() req: { user: AuthenticatedUser }) {
    return this.overviewService.overview(req.user);
  }

  @Get(':id/config/desired')
  @RequirePermissions('modules:read')
  @ApiOperation({ summary: 'Configuración deseada que se enviaría al módulo (sin publicar)' })
  buildConfig(@Param('id', ParseUUIDPipe) id: string) {
    return this.config.build(id);
  }

  @Post(':id/config/push')
  @RequirePermissions('modules:write')
  @ApiOperation({
    summary: 'Publica la configuración deseada (coordinador a seguir, red, calibración)',
  })
  pushConfig(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PushConfigDto) {
    return this.config.push(id, dto.network);
  }

  @Post(':id/link')
  @RequirePermissions('modules:link')
  @ApiOperation({ summary: 'Vincula un módulo a un usuario (admin: a cualquiera; gestor: a sí mismo)' })
  link(@Param('id') id: string, @Body() dto: LinkModuleDto, @Req() req: { user: AuthenticatedUser }) {
    return this.ownership.link(id, dto.user_id, req.user);
  }

  @Post(':id/unlink')
  @RequirePermissions('modules:link')
  @ApiOperation({ summary: 'Desvincula un módulo (admin: cualquiera; gestor: los suyos)' })
  unlink(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) {
    return this.ownership.unlink(id, req.user);
  }
}
