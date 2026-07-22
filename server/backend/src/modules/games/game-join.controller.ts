import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/permissions.guard';
import { Public, RequirePermissions } from '../auth/roles.decorator';
import { GameJoinService } from './game-join.service';

class JoinGuestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  guest_name!: string;
}

/**
 * Unirse a una partida por QR (G-D). Un gestor genera el código; el QR codifica la
 * URL de unión; al escanear, un jugador se une como TEMPORAL sin cuenta. Las rutas de
 * unión son PÚBLICAS: el código de unión actúa de autorización.
 */
@ApiTags('games')
@Controller('games')
export class GameJoinController {
  constructor(
    private readonly join: GameJoinService,
    private readonly audit: AuditService,
  ) {}

  @Post(':id/join-code')
  @RequirePermissions('participants:write')
  @ApiOperation({ summary: 'Genera (o regenera con ?regenerate=1) el código de unión de la partida' })
  async code(@Param('id', ParseUUIDPipe) id: string, @Query('regenerate') regenerate: string | undefined, @Req() req: { user: AuthenticatedUser }) {
    const result = await this.join.ensureCode(id, regenerate === '1' || regenerate === 'true');
    await this.audit.record({ user: req.user, action: 'game.join-code', entity: 'game', entityId: id });
    return result;
  }

  @Get('join/:code')
  @Public()
  @ApiOperation({ summary: 'Información pública de una partida por su código de unión' })
  byCode(@Param('code') code: string) {
    return this.join.byCode(code);
  }

  @Post('join/:code/guest')
  @Public()
  @ApiOperation({ summary: 'Se une a la partida como jugador temporal (público; el código autoriza)' })
  joinGuest(@Param('code') code: string, @Body() dto: JoinGuestDto) {
    return this.join.joinAsGuest(code, dto.guest_name);
  }
}
