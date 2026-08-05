import { Body, ConflictException, Controller, Get, Module, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/roles.decorator';
import { MqttService } from '../mqtt/mqtt.service';
import { MaintenanceRequestedBy } from '../../contracts/command-builder';
import { GamesModule } from '../games/games.module';
import { GamesService } from '../games/games.service';
import { ROLE } from '../../domain/rbac/permissions';
import { PrismaIncidentSink } from './incident.sink';

/**
 * Mantenimiento: incidencias, modo mantenimiento de módulos y despliegues OTA.
 *
 * Ampliación v1.1: `self-test` e `identify` publicaban en
 * `targets/v1/module/{id}/command` —el canal de JUEGO, exclusivo del
 * coordinador— con `sendModuleCommand`. Doblemente prohibido hoy: el
 * contrato quitó `"backend"` del enum `issuer` de ese tópico y la ACL de
 * F-02 (ya verificada contra un broker real) le deniega la escritura. Se
 * migran, con el mismo patrón que F6 (`module-diagnostics.service.ts`), a
 * `sendModuleMaintenanceCommand` sobre `module/{id}/maintenance/command`.
 *
 * `set_maintenance` NO tiene hueco: no está en el repertorio cerrado de
 * `command_type` de `module-maintenance-command.schema.json` (a diferencia
 * de `self_test`/`identify`, que sí). No se cuela por el canal de juego
 * (prohibido) ni se inventa un `command_type` fuera del esquema (el
 * validador de salida lo rechazaría). El modo mantenimiento se sigue
 * guardando en la base de datos —eso no depende de MQTT—, pero el aviso al
 * módulo queda pendiente de que el carril de contratos amplíe el enum.
 */
@ApiTags('maintenance')
@ApiBearerAuth()
@Controller('maintenance')
export class MaintenanceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mqtt: MqttService,
    private readonly audit: AuditService,
    private readonly games: GamesService,
  ) {}

  private requestedBy(req: { user?: AuthenticatedUser }): MaintenanceRequestedBy {
    const isAdmin = req.user?.role === ROLE.ADMINISTRADOR;
    return {
      actor_type: isAdmin ? 'operator' : 'user',
      actor_id: req.user?.userId ?? 'desconocido',
    };
  }

  /**
   * Mismo guardarraíl DOBLE que F6 (`ModuleDiagnosticsService.assertPanelFreeToAct`):
   * el contrato deja `game_in_progress` en manos del firmware, que nunca se ha
   * compilado, así que el backend comprueba también antes de publicar un
   * comando que ACTÚA (`self_test` sí; `identify` es "leer" y no pasa por aquí).
   * Si el módulo no está dado de alta o no tiene panel asignado, no hay nada
   * que comprobar: no se bloquea por un panel que no existe.
   */
  private async assertPanelFreeToAct(slug: string, commandType: string): Promise<void> {
    const module = await this.prisma.module.findUnique({
      where: { slug },
      select: { targetSystemId: true },
    });
    if (!module?.targetSystemId) return;
    const occupied = await this.games.isPanelOccupied(module.targetSystemId);
    if (occupied) {
      throw new ConflictException(
        `No se puede ordenar «${commandType}» en «${slug}»: su panel tiene una partida activa ` +
          '(armed/running/paused). Motivo game_in_progress.',
      );
    }
  }

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
    await this.audit.record({
      user: req.user,
      action: 'set_maintenance',
      entity: 'module',
      entityId: module.id,
      after: { maintenance: body.enabled },
    });
    // `set_maintenance` NO está en el repertorio cerrado de
    // `module-maintenance-command.schema.json` y este controlador tiene
    // prohibido escribir en `module/{id}/command` (canal de juego). No se
    // inventa ninguna de las dos cosas: se guarda el modo en la base (efecto
    // que no depende de MQTT) y se dice la verdad sobre lo que NO se ha
    // podido avisar al módulo.
    return {
      module,
      command: null,
      note:
        'El modo mantenimiento se ha guardado, pero NO se ha avisado al módulo por MQTT: ' +
        '`set_maintenance` no está en el repertorio de `module/{id}/maintenance/command` (v1.1) ' +
        'y el backend no tiene permiso de escritura sobre `module/{id}/command` (canal de juego). ' +
        'Pendiente de que el carril de contratos amplíe el enum.',
    };
  }

  @Post('modules/:slug/self-test')
  @RequirePermissions('maintenance:write')
  async selfTest(@Param('slug') slug: string, @Req() req: { user?: AuthenticatedUser }) {
    // Categoría "actuar" (dispara el autodiagnóstico físico del módulo):
    // sujeto al guardarraíl doble de game_in_progress, igual que en F6.
    await this.assertPanelFreeToAct(slug, 'self_test');
    return this.mqtt.sendModuleMaintenanceCommand(slug, 'self_test', this.requestedBy(req));
  }

  @Post('modules/:slug/identify')
  @RequirePermissions('modules:write')
  identify(
    @Param('slug') slug: string,
    @Body() body: { duration_ms?: number } | undefined,
    @Req() req: { user?: AuthenticatedUser },
  ) {
    // Categoría "leer" (contrato README §6-bis): permitido siempre, incluso
    // con partida activa — no pasa por `assertPanelFreeToAct`.
    return this.mqtt.sendModuleMaintenanceCommand(slug, 'identify', this.requestedBy(req), {
      duration_ms: body?.duration_ms ?? 4000,
    });
  }
}

@Module({
  imports: [GamesModule],
  controllers: [MaintenanceController],
  providers: [PrismaIncidentSink],
  exports: [PrismaIncidentSink],
})
export class MaintenanceModule {}
