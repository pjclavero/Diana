import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/roles.decorator';
import { ParticipantsService } from './participants.service';

class AddParticipantDto {
  @IsUUID()
  game_id!: string;

  @IsOptional()
  @IsUUID()
  player_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  guest_name?: string;

  @IsOptional()
  @IsUUID()
  team_id?: string;
}

class SetParticipantTeamDto {
  // Acepta un UUID de equipo o null (quitar equipo).
  @ValidateIf((o) => o.team_id !== null && o.team_id !== undefined)
  @IsUUID()
  team_id?: string | null;
}

/**
 * Participantes de una partida (G-D.2). Alta de jugadores registrados/plantilla o
 * **temporales** (nombre suelto, sin cuenta ni estadística). Reglas en el servicio.
 */
@ApiTags('participants')
@ApiBearerAuth()
@Controller('participants')
export class ParticipantsController {
  constructor(
    private readonly participants: ParticipantsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('participants:read')
  @ApiOperation({ summary: 'Lista los participantes de una partida (?gameId=)' })
  list(@Query('gameId', ParseUUIDPipe) gameId: string) {
    return this.participants.listForGame(gameId);
  }

  @Post()
  @RequirePermissions('participants:write')
  @ApiOperation({ summary: 'Añade un participante: registrado/plantilla (player_id) o temporal (guest_name)' })
  async add(@Body() dto: AddParticipantDto, @Req() req: { user: AuthenticatedUser }) {
    const created = await this.participants.add({
      gameId: dto.game_id,
      playerId: dto.player_id ?? null,
      guestName: dto.guest_name ?? null,
      teamId: dto.team_id ?? null,
    });
    await this.audit.record({ user: req.user, action: 'create', entity: 'participant', entityId: created.id, after: created });
    return created;
  }

  @Patch(':id/team')
  @RequirePermissions('participants:write')
  @ApiOperation({ summary: 'Reasigna el equipo de un participante (team_id null = sin equipo)' })
  async setTeam(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetParticipantTeamDto, @Req() req: { user: AuthenticatedUser }) {
    const updated = await this.participants.setTeam(id, dto.team_id ?? null);
    await this.audit.record({ user: req.user, action: 'update', entity: 'participant', entityId: id, after: updated });
    return updated;
  }

  @Delete(':id')
  @RequirePermissions('participants:write')
  @ApiOperation({ summary: 'Quita un participante de la partida' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: AuthenticatedUser }) {
    const result = await this.participants.remove(id);
    await this.audit.record({ user: req.user, action: 'delete', entity: 'participant', entityId: id });
    return result;
  }
}
