import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { AuthenticatedUser } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/roles.decorator';
import { AuditService } from '../audit/audit.service';
import { MqttIdentityService } from './mqtt-identity.service';

export class IssueIdentityDto {
  /**
   * Rotar una credencial ya emitida. Es explícito y no el comportamiento por
   * defecto: una rotación accidental deja al dispositivo físico fuera del
   * broker hasta que alguien le cargue la nueva credencial a mano.
   */
  @IsOptional()
  @IsBoolean()
  rotate?: boolean;
}

/**
 * Emisión de credenciales MQTT individuales (T4).
 *
 * ── RBAC ─────────────────────────────────────────────────────────────────────
 * Usa `provisioning:issue`, el mismo permiso que la emisión de órdenes
 * firmadas, y por el mismo motivo: `provisioning:issue` no figura en ningún
 * `ROLE_PERMISSIONS`, así que hoy sólo el rol `administrador` (que tiene `*`)
 * llega aquí. Dar credenciales de broker a un dispositivo es establecer su
 * identidad en el sistema; heredarlo de `modules:write` —que tienen gestor y
 * operador— habría convertido «puedo editar la ficha de un módulo» en «puedo
 * fabricarle una identidad».
 *
 * ── El frontend nunca genera credenciales ────────────────────────────────────
 * No podría: el secreto lo produce el servidor con `randomBytes` y lo escribe
 * en el `passwd` del broker, al que el frontend no tiene acceso. Esta ruta es
 * la única entrada, y devuelve el secreto UNA vez.
 */
@ApiTags('provisioning')
@ApiBearerAuth()
@Controller('modules')
export class MqttIdentityController {
  constructor(
    private readonly identities: MqttIdentityService,
    private readonly audit: AuditService,
  ) {}

  @Post(':id/mqtt-identity')
  @RequirePermissions('provisioning:issue')
  @ApiOperation({
    summary: 'Emite (o rota) la credencial MQTT individual de un módulo',
    description:
      'La contraseña se devuelve UNA sola vez y no se puede volver a leer. El módulo NO pasa ' +
      'a ONLINE por esto: sigue en PENDING hasta que el dispositivo publique de verdad.',
  })
  async issue(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: IssueIdentityDto,
    @Req() req: { user?: AuthenticatedUser },
  ) {
    const issued = await this.identities.issue(
      id,
      { userId: req.user?.userId, username: req.user?.username },
      body.rotate === true,
    );

    // La auditoría lleva la HUELLA y la generación, nunca el secreto. Ese es el
    // motivo de que la escritura del registro se construya a mano en vez de
    // volcar el objeto devuelto: un `after: issued` habría metido la
    // contraseña en `audit_log`, que es exactamente la tabla que más gente
    // puede leer.
    await this.audit.record({
      user: req.user,
      action: body.rotate === true ? 'update' : 'create',
      entity: 'moduleMqttCredential',
      entityId: issued.moduleId,
      after: {
        username: issued.username,
        fingerprint: issued.fingerprint,
        generation: issued.generation,
        issuedAt: issued.issuedAt,
      },
    });

    return issued;
  }

  @Get(':id/mqtt-identity')
  @RequirePermissions('provisioning:read')
  @ApiOperation({ summary: 'Metadatos de la credencial MQTT de un módulo (nunca el secreto)' })
  async describe(@Param('id', ParseUUIDPipe) id: string) {
    const meta = await this.identities.describe(id);
    return (
      meta ?? {
        issued: false,
        note: 'Este módulo no tiene credencial MQTT emitida.',
      }
    );
  }

  @Delete(':id/mqtt-identity')
  @RequirePermissions('provisioning:issue')
  @ApiOperation({ summary: 'Revoca la credencial MQTT de un módulo' })
  async revoke(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user?: AuthenticatedUser }) {
    const result = await this.identities.revoke(id);
    await this.audit.record({
      user: req.user,
      action: 'delete',
      entity: 'moduleMqttCredential',
      entityId: id,
      before: { username: result.username },
    });
    return result;
  }
}
