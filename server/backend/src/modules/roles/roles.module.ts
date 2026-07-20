import { Controller, Get, Module, Param, NotFoundException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequirePermissions } from '../auth/roles.decorator';

/**
 * Los roles son fijos (dosier 23.2) y se siembran en el arranque. Se exponen
 * en sólo lectura: cambiar el conjunto de permisos de un rol es una decisión
 * de diseño, no un ajuste de operación.
 */
@ApiTags('roles')
@ApiBearerAuth()
@Controller('roles')
export class RolesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('roles:read')
  @ApiOperation({ summary: 'Lista los roles y sus permisos' })
  async list() {
    const items = await this.prisma.role.findMany({ orderBy: { name: 'asc' } });
    return { items, total: items.length };
  }

  @Get(':name')
  @RequirePermissions('roles:read')
  async get(@Param('name') name: string) {
    const role = await this.prisma.role.findUnique({ where: { name } });
    if (!role) throw new NotFoundException(`Rol ${name} no encontrado`);
    return role;
  }
}

@Module({ controllers: [RolesController] })
export class RolesModule {}
