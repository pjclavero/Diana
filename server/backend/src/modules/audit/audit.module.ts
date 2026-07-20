import { Controller, Get, Global, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequirePermissions } from '../auth/roles.decorator';
import { AuditService } from './audit.service';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('audit:read')
  @ApiOperation({ summary: 'Consulta el registro de auditoría administrativa' })
  async list(
    @Query('entity') entity?: string,
    @Query('entityId') entityId?: string,
    @Query('take') take = '100',
  ) {
    const items = await this.prisma.auditLog.findMany({
      where: { entity: entity || undefined, entityId: entityId || undefined },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number.parseInt(take, 10) || 100, 500),
    });
    return { items, total: items.length };
  }
}

@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
