import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/roles.decorator';
import { LED_PATTERNS, ModuleDiagnosticsService } from './module-diagnostics.service';

class IdentifyDto {
  @IsOptional()
  @IsInt()
  @Min(500)
  @Max(60_000)
  duration_ms?: number;
}

class LedTestDto {
  @IsIn(LED_PATTERNS as unknown as string[])
  pattern!: string;
}

class ResultsQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;
}

/**
 * Diagnóstico de módulo y diana (F6).
 *
 * Las rutas son las que el panel ya llamaba y el backend no servía: hasta ahora
 * la pantalla de diagnóstico funcionaba contra el adaptador de demostración, de
 * modo que «probar un LED» no encendía ningún LED.
 *
 * Ninguna de estas llamadas devuelve el RESULTADO de la prueba: los comandos van
 * por MQTT y el módulo responde cuando puede. El resultado se lee en
 * `GET .../diagnostics`.
 */
@ApiTags('modules')
@ApiBearerAuth()
@Controller('modules')
export class ModuleDiagnosticsController {
  constructor(
    private readonly diagnostics: ModuleDiagnosticsService,
    private readonly audit: AuditService,
  ) {}

  private actor(req: { user?: AuthenticatedUser }) {
    return { userId: req.user?.userId, role: req.user?.role };
  }

  @Post(':idOrSlug/commands/identify')
  @RequirePermissions('modules:write')
  @ApiOperation({ summary: 'Ordena al módulo identificarse (parpadeo) para localizarlo' })
  async identify(
    @Param('idOrSlug') idOrSlug: string,
    @Body() dto: IdentifyDto,
    @Req() req: { user?: AuthenticatedUser },
  ) {
    const result = await this.diagnostics.identify(
      idOrSlug,
      dto.duration_ms ?? 4000,
      this.actor(req),
    );
    await this.audit.record({
      user: req.user,
      action: 'module.identify',
      entity: 'module',
      entityId: idOrSlug,
      after: result,
    });
    return result;
  }

  @Post(':idOrSlug/targets/:targetIndex/test-led')
  @RequirePermissions('maintenance:write')
  @ApiOperation({ summary: 'Prueba de LED de una diana' })
  async testLed(
    @Param('idOrSlug') idOrSlug: string,
    @Param('targetIndex', ParseIntPipe) targetIndex: number,
    @Body() dto: LedTestDto,
    @Req() req: { user?: AuthenticatedUser },
  ) {
    const result = await this.diagnostics.testLed(
      idOrSlug,
      targetIndex,
      dto.pattern,
      this.actor(req),
    );
    await this.audit.record({
      user: req.user,
      action: 'module.test_led',
      entity: 'module',
      entityId: idOrSlug,
      after: result,
    });
    return result;
  }

  @Post(':idOrSlug/targets/:targetIndex/test-sensor')
  @RequirePermissions('maintenance:write')
  @ApiOperation({ summary: 'Pide el autodiagnóstico del módulo (no hay prueba por diana en v1)' })
  async testSensor(
    @Param('idOrSlug') idOrSlug: string,
    @Param('targetIndex', ParseIntPipe) targetIndex: number,
    @Req() req: { user?: AuthenticatedUser },
  ) {
    const result = await this.diagnostics.testSensor(idOrSlug, targetIndex, this.actor(req));
    await this.audit.record({
      user: req.user,
      action: 'module.test_sensor',
      entity: 'module',
      entityId: idOrSlug,
      after: result,
    });
    return result;
  }

  @Post(':idOrSlug/targets/:targetIndex/calibrate')
  @RequirePermissions('calibration:write')
  @ApiOperation({ summary: 'Arranca la calibración de una diana' })
  async calibrate(
    @Param('idOrSlug') idOrSlug: string,
    @Param('targetIndex', ParseIntPipe) targetIndex: number,
    @Req() req: { user?: AuthenticatedUser },
  ) {
    const result = await this.diagnostics.calibrate(idOrSlug, targetIndex, this.actor(req));
    await this.audit.record({
      user: req.user,
      action: 'module.calibrate',
      entity: 'module',
      entityId: idOrSlug,
      after: result,
    });
    return result;
  }

  @Post(':idOrSlug/commands/abort-calibration')
  @RequirePermissions('calibration:write')
  @ApiOperation({ summary: 'Aborta la calibración en curso' })
  async abortCalibration(
    @Param('idOrSlug') idOrSlug: string,
    @Req() req: { user?: AuthenticatedUser },
  ) {
    const result = await this.diagnostics.abortCalibration(idOrSlug, this.actor(req));
    await this.audit.record({
      user: req.user,
      action: 'module.abort_calibration',
      entity: 'module',
      entityId: idOrSlug,
      after: result,
    });
    return result;
  }

  @Get(':idOrSlug/diagnostics')
  @RequirePermissions('incidents:read')
  @ApiOperation({ summary: 'Resultados que el módulo ha devuelto de verdad' })
  results(
    @Param('idOrSlug') idOrSlug: string,
    @Query() query: ResultsQueryDto,
    @Req() req: { user?: AuthenticatedUser },
  ) {
    return this.diagnostics.results(idOrSlug, this.actor(req), query.take ?? 20);
  }
}
