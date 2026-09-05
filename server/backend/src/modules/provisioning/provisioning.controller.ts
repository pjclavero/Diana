import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  IsUUID,
} from 'class-validator';

import { AuthenticatedUser } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/roles.decorator';
import { ProvisioningCommandService } from './provisioning-command.service';
import { ProvisioningStateService } from './provisioning-state.service';
import { IDENTIFIER_PATTERN } from '../../contracts/topics';

export class IssueOrderDto {
  @Matches(IDENTIFIER_PATTERN)
  system_id!: string;

  @IsIn(['PROVISION', 'PREPARE', 'COMMIT'])
  action!: 'PROVISION' | 'PREPARE' | 'COMMIT';

  @IsOptional()
  @IsIn(['NORMAL', 'EMERGENCY'])
  mode?: 'NORMAL' | 'EMERGENCY';

  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  provisioning_key_fingerprint!: string;

  @IsOptional()
  @IsUUID()
  rotation_id?: string;

  @IsOptional()
  @IsUUID()
  current_epoch?: string;

  @IsOptional()
  @IsUUID()
  next_epoch?: string;

  @IsOptional()
  @IsUUID()
  epoch?: string;

  @IsOptional()
  @IsUUID()
  provision_id?: string;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * EL CAMINO ES frontend → backend → dominio → MQTT. NO HAY OTRO.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * El frontend NO publica MQTT nunca: no tiene credenciales de broker, y aunque
 * las tuviera no tiene la clave operativa, así que un mensaje suyo en
 * `module/{id}/provision` sería una orden sin firma que el módulo rechaza. Esta
 * ruta es la única entrada humana al plano, y de ella salen tres cosas
 * inseparables: la orden firmada, el registro de emisión y la auditoría de
 * quién la pidió.
 *
 * ── RBAC ─────────────────────────────────────────────────────────────────────
 *
 * `provisioning:issue` y `provisioning:read` NO figuran en ningún conjunto de
 * `ROLE_PERMISSIONS`. Es deliberado: con `hasPermission()`, eso significa que
 * hoy SÓLO el rol `administrador` (que tiene `*`) puede emitir órdenes de
 * aprovisionamiento. Establecer la autoridad criptográfica de un dispositivo es
 * la operación más privilegiada del sistema, y no debía heredarse de
 * `commands:publish` —permiso que `operador`, `gestor` y `mantenimiento` tienen
 * de serie— ni de `modules:write`.
 *
 * Concedérselos a otro rol es un acto explícito en
 * `src/domain/rbac/permissions.ts`, revisable en un diff, y no un efecto
 * lateral de haber reutilizado un permiso que ya existía.
 */
@ApiTags('provisioning')
@ApiBearerAuth()
@Controller('provisioning')
export class ProvisioningController {
  constructor(
    private readonly commands: ProvisioningCommandService,
    private readonly states: ProvisioningStateService,
  ) {}

  @Post('modules/:deviceId/orders')
  @RequirePermissions('provisioning:issue')
  @ApiOperation({
    summary: 'Emite una orden FIRMADA del plano DEVICE_MANAGEMENT (QoS 1, retain=false)',
  })
  async issue(
    @Param('deviceId') deviceId: string,
    @Body() body: IssueOrderDto,
    @Req() req: { user?: AuthenticatedUser },
  ) {
    const issued = await this.commands.issue(
      {
        deviceId,
        systemId: body.system_id,
        action: body.action,
        mode: body.mode,
        provisioningKeyFingerprint: body.provisioning_key_fingerprint,
        rotationId: body.rotation_id,
        currentEpoch: body.current_epoch,
        nextEpoch: body.next_epoch,
        epoch: body.epoch,
        provisionId: body.provision_id,
      },
      req.user ?? null,
    );

    // Se devuelve el resultado REAL de la publicación, no un «aceptado».
    // Una denegación de ACL del broker no se distingue por el código de
    // retorno del cliente MQTT: lo único que la delata es el `reasonCode` del
    // PUBACK, así que viaja hasta el operador en vez de quedarse en un log.
    return {
      request_id: issued.requestId,
      provisioning_sequence: issued.provisioningSequence,
      topic: issued.topic,
      delivered: issued.publish.delivered,
      denied: issued.publish.denied,
      timed_out: issued.publish.timedOut,
      reason_code: issued.publish.reasonCode,
    };
  }

  @Get('modules/:deviceId/state')
  @RequirePermissions('provisioning:read')
  @ApiOperation({
    summary: 'Última fotografía OBSERVACIONAL del estado de autoridad reportado por el módulo',
    description:
      'Es lo que el módulo DIJO, no una verdad del sistema ni un desired state ' +
      'ejecutable: ninguna acción del backend se dispara desde aquí.',
  })
  async state(@Param('deviceId') deviceId: string) {
    const observed = await this.states.latestObserved(deviceId);
    if (!observed) {
      throw new NotFoundException(`Sin estado de aprovisionamiento observado para ${deviceId}.`);
    }
    return {
      device_id: observed.deviceId,
      system_id: observed.systemId,
      request_id: observed.requestId,
      correlated: observed.correlated,
      result: observed.result,
      state: observed.state,
      active_epoch: observed.activeEpoch,
      pending_epoch: observed.pendingEpoch,
      rotation_id: observed.rotationId,
      provision_id: observed.provisionId,
      last_provisioning_sequence: observed.lastProvisioningSequence.toString(),
      last_delegation_sequence: observed.lastDelegationSequence.toString(),
      provisioning_key_fingerprint: observed.provisioningKeyFingerprint,
      reason: observed.reason,
      received_at: observed.receivedAt.toISOString(),
      /* Etiqueta explícita en la respuesta: quien consuma esta ruta desde el
       * panel debe ver que está leyendo una observación, no una orden. */
      observational_only: true,
    };
  }
}
