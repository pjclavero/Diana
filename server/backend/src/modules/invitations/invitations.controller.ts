import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/permissions.guard';
import { Public, RequirePermissions } from '../auth/roles.decorator';
import { InvitationsService } from './invitations.service';
import { SmtpService } from './smtp.service';

class CreateInvitationDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  display_name?: string;
}

class AcceptInvitationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  display_name!: string;
}

class SmtpDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  host?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number | null;

  @IsOptional()
  @IsBoolean()
  secure?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  username?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  password?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  from_address?: string | null;
}

/**
 * Invitaciones de jugador (G-D/F5). Crear/listar/reenviar/revocar por gestor/admin;
 * aceptar es PÚBLICO (el código autoriza). La configuración SMTP es sólo del admin
 * (permiso `smtp:*`, que ningún otro rol posee → sólo lo cubre el `*` del admin).
 */
@ApiTags('invitations')
@Controller()
export class InvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly smtp: SmtpService,
    private readonly audit: AuditService,
  ) {}

  @Get('invitations')
  @ApiBearerAuth()
  @RequirePermissions('players:read')
  @ApiOperation({ summary: 'Lista las invitaciones (con su código y estado de envío)' })
  list() {
    return this.invitations.list();
  }

  @Post('invitations')
  @ApiBearerAuth()
  @RequirePermissions('players:write')
  @ApiOperation({ summary: 'Crea una invitación por correo (código visible; envío real según SMTP)' })
  async create(@Body() dto: CreateInvitationDto, @Req() req: { user: AuthenticatedUser }) {
    const inv = await this.invitations.create({ email: dto.email, displayName: dto.display_name ?? null, invitedBy: req.user.username });
    await this.audit.record({ user: req.user, action: 'invitation.create', entity: 'invitation', entityId: inv.id, after: { email: inv.email } });
    return inv;
  }

  @Post('invitations/:id/resend')
  @ApiBearerAuth()
  @RequirePermissions('players:write')
  @ApiOperation({ summary: 'Regenera el código y reintenta el envío (auditado)' })
  async resend(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: AuthenticatedUser }) {
    const inv = await this.invitations.resend(id);
    await this.audit.record({ user: req.user, action: 'invitation.resend', entity: 'invitation', entityId: id });
    return inv;
  }

  @Post('invitations/:id/revoke')
  @ApiBearerAuth()
  @RequirePermissions('players:write')
  @ApiOperation({ summary: 'Revoca una invitación pendiente' })
  async revoke(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: AuthenticatedUser }) {
    const inv = await this.invitations.revoke(id);
    await this.audit.record({ user: req.user, action: 'invitation.revoke', entity: 'invitation', entityId: id });
    return inv;
  }

  @Get('invitations/accept/:code')
  @Public()
  @ApiOperation({ summary: 'Información pública de una invitación por su código' })
  byCode(@Param('code') code: string) {
    return this.invitations.byCode(code);
  }

  @Post('invitations/accept/:code')
  @Public()
  @ApiOperation({ summary: 'Acepta la invitación: crea un jugador registrado (guarda histórico)' })
  accept(@Param('code') code: string, @Body() dto: AcceptInvitationDto) {
    return this.invitations.accept(code, dto.display_name);
  }

  @Get('smtp-settings')
  @ApiBearerAuth()
  @RequirePermissions('smtp:read')
  @ApiOperation({ summary: 'Configuración SMTP (sin la contraseña). Sólo admin' })
  getSmtp() {
    return this.smtp.get();
  }

  @Put('smtp-settings')
  @ApiBearerAuth()
  @RequirePermissions('smtp:write')
  @ApiOperation({ summary: 'Actualiza la configuración SMTP. Sólo admin' })
  async setSmtp(@Body() dto: SmtpDto, @Req() req: { user: AuthenticatedUser }) {
    const result = await this.smtp.update({
      host: dto.host ?? null,
      port: dto.port ?? null,
      secure: dto.secure,
      username: dto.username ?? null,
      password: dto.password ?? null,
      fromAddress: dto.from_address ?? null,
    });
    await this.audit.record({ user: req.user, action: 'smtp.update', entity: 'smtpSetting', entityId: 'singleton' });
    return result;
  }
}
