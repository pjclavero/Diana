import { Body, Controller, Get, Module, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/roles.decorator';
import { MqttService } from '../mqtt/mqtt.service';
import { PrismaIncidentSink } from './incident.sink';

/**
 * Mantenimiento: incidencias, modo mantenimiento de módulos y despliegues OTA.
 */
@ApiTags('maintenance')
@ApiBearerAuth()
@Controller('maintenance')
export class MaintenanceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mqtt: MqttService,
    private readonly audit: AuditService,
  ) {}

  @Get('incidents')
  @RequirePermissions('incidents:read')
  @ApiOperation({ summary: 'Incidencias registradas (rechazos de ingesta, baja tensión, OTA…)' })
  async incidents(@Query('severity') severity?: string, @Query('take') take = '100') {
    const items = await this.prisma.incident.findMany({
      where: { severity: (severity as never) || undefined },
      orderBy: { occurredAt: 'desc' },
      take: Math.min(Number.parseInt(take, 10) || 100, 500),
    });
    return { items, total: items.length };
  }

  @Patch('incidents/:id/resolve')
  @RequirePermissions('incidents:write')
  async resolve(@Param('id') id: string, @Req() req: { user?: AuthenticatedUser }) {
    return this.prisma.incident.update({
      where: { id },
      data: { resolvedAt: new Date(), resolvedBy: req.user?.username ?? null },
    });
  }

  @Post('modules/:slug/maintenance')
  @RequirePermissions('maintenance:write')
  @ApiOperation({ summary: 'Activa o desactiva el modo mantenimiento de un módulo' })
  async setMaintenance(
    @Param('slug') slug: string,
    @Body() body: { enabled: boolean },
    @Req() req: { user?: AuthenticatedUser },
  ) {
    const module = await this.prisma.module.update({
      where: { slug },
      data: { maintenance: body.enabled },
    });
    const command = this.mqtt.sendModuleCommand(slug, 'set_maintenance', {
      enabled: body.enabled,
    });
    await this.audit.record({
      user: req.user,
      action: 'set_maintenance',
      entity: 'module',
      entityId: module.id,
      after: { maintenance: body.enabled },
    });
    return { module, command };
  }

  @Post('modules/:slug/self-test')
  @RequirePermissions('maintenance:write')
  selfTest(@Param('slug') slug: string) {
    return this.mqtt.sendModuleCommand(slug, 'self_test');
  }

  @Post('modules/:slug/identify')
  @RequirePermissions('modules:write')
  identify(@Param('slug') slug: string, @Body() body?: { duration_ms?: number }) {
    return this.mqtt.sendModuleCommand(slug, 'identify', {
      duration_ms: body?.duration_ms ?? 4000,
    });
  }
}

@Module({
  controllers: [MaintenanceController],
  providers: [PrismaIncidentSink],
  exports: [PrismaIncidentSink],
})
export class MaintenanceModule {}
