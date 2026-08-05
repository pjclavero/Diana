import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/roles.decorator';
import { SystemStatusService } from './system-status.service';

/**
 * Estado compuesto de un sistema: el mismo que consumía la pantalla `system`
 * (módulos en línea/esperados, partida activa) MÁS los conflictos de verdad
 * (dosier 11/12), antes inexistentes. Permiso `systems:read`: el mismo que ya
 * exige el CRUD de sistemas, ningún rol autenticado queda fuera ni dentro de
 * más de lo que ya estaba.
 */
@ApiTags('systems')
@ApiBearerAuth()
@Controller('systems')
export class SystemStatusController {
  constructor(private readonly service: SystemStatusService) {}

  @Get(':id/status')
  @RequirePermissions('systems:read')
  @ApiOperation({ summary: 'Estado compuesto del sistema, incluidos los conflictos detectados' })
  status(@Param('id') id: string) {
    return this.service.status(id);
  }
}
