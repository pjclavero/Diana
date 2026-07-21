import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/roles.decorator';
import { FirmwareDeploymentService } from './firmware-deployment.service';

class DeployFirmwareDto {
  @IsUUID()
  firmware_version_id!: string;
}

/**
 * OTA por módulo (F3). Rutas anidadas bajo `/api/modules/:moduleId/firmware/*`
 * para dejar claro que la operación es sobre un módulo concreto y su dueño.
 *
 * - `available` y `deployments`: lectura (`firmware:read`, común a los roles);
 *   el servicio acota además por propiedad para los no-admin.
 * - `deploy`: aceptar la actualización (`firmware:deploy`, gestor/admin). La
 *   **subida** de versiones es del CRUD `POST /api/firmware` (`firmware:write`).
 */
@ApiTags('firmware')
@ApiBearerAuth()
@Controller('modules')
export class FirmwareDeploymentController {
  constructor(
    private readonly deployments: FirmwareDeploymentService,
    private readonly audit: AuditService,
  ) {}

  @Get(':moduleId/firmware/available')
  @RequirePermissions('firmware:read')
  @ApiOperation({ summary: 'Versiones de firmware firmadas disponibles para un módulo' })
  available(@Param('moduleId', ParseUUIDPipe) moduleId: string, @Req() req: { user: AuthenticatedUser }) {
    return this.deployments.availableForModule(moduleId, req.user);
  }

  @Get(':moduleId/firmware/deployments')
  @RequirePermissions('firmware:read')
  @ApiOperation({ summary: 'Historial de despliegues OTA de un módulo' })
  history(@Param('moduleId', ParseUUIDPipe) moduleId: string, @Req() req: { user: AuthenticatedUser }) {
    return this.deployments.listDeployments(moduleId, req.user);
  }

  @Post(':moduleId/firmware/deploy')
  @RequirePermissions('firmware:deploy')
  @ApiOperation({ summary: 'Acepta y dispara la OTA de una versión a un módulo' })
  async deploy(
    @Param('moduleId', ParseUUIDPipe) moduleId: string,
    @Body() body: DeployFirmwareDto,
    @Req() req: { user: AuthenticatedUser },
  ) {
    const deployment = await this.deployments.deploy(moduleId, body.firmware_version_id, req.user);
    await this.audit.record({
      user: req.user,
      action: 'firmware.deploy',
      entity: 'deployment',
      entityId: (deployment as { id?: string }).id ?? null,
      after: deployment,
    });
    return deployment;
  }
}
