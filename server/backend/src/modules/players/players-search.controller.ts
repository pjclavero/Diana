import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/roles.decorator';
import { PlayersSearchService } from './players-search.service';

/**
 * Búsqueda de jugadores (G-D). Ruta estática `GET /players/search`, registrada
 * ANTES del CRUD para que no la capture `GET /players/:id`.
 */
@ApiTags('players')
@ApiBearerAuth()
@Controller('players')
export class PlayersSearchController {
  constructor(private readonly search: PlayersSearchService) {}

  @Get('search')
  @RequirePermissions('players:read')
  @ApiOperation({ summary: 'Busca jugadores por nombre, apellidos, licencia o usuario vinculado' })
  find(@Query('q') q?: string, @Query('take') take?: string) {
    return this.search.search(q, take ? Number.parseInt(take, 10) : undefined);
  }
}
