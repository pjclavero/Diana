import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString, IsUUID } from 'class-validator';
import { AuthenticatedUser } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/roles.decorator';
import { ModuleOwnershipService } from './module-ownership.service';

export class LinkModuleDto {
  @ApiProperty({ description: 'Usuario al que se vincula el módulo. Un no-admin sólo puede indicar su propio id.' })
  @IsString()
  @IsUUID()
  user_id!: string;
}

@ApiTags('modules')
@ApiBearerAuth()
@Controller('modules')
export class ModuleOwnershipController {
  constructor(private readonly ownership: ModuleOwnershipService) {}

  @Get('mine')
  @RequirePermissions('profile:read')
  @ApiOperation({ summary: 'Módulos de los que el usuario autenticado es dueño' })
  mine(@Req() req: { user: AuthenticatedUser }) {
    return this.ownership.listOwnedBy(req.user.userId);
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
