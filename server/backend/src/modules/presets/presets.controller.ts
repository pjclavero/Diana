import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/roles.decorator';
import { PresetsService } from './presets.service';

class CreatePresetDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string;

  @IsString()
  @MaxLength(64)
  mode!: string;

  @IsObject()
  config!: Record<string, unknown>;
}

class UpdatePresetDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  mode?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

/**
 * Presets de partida (G-F). El gestor gestiona los suyos (máx. 5) y ve los de
 * muestra; el admin gestiona todos. La propiedad y el límite viven en el servicio.
 */
@ApiTags('presets')
@ApiBearerAuth()
@Controller('presets')
export class PresetsController {
  constructor(
    private readonly presets: PresetsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('presets:read')
  @ApiOperation({ summary: 'Presets visibles (propios + de muestra) y el uso del límite' })
  list(@Req() req: { user: AuthenticatedUser }) {
    return this.presets.list(req.user);
  }

  @Get(':id')
  @RequirePermissions('presets:read')
  @ApiOperation({ summary: 'Obtiene un preset visible por id' })
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: AuthenticatedUser }) {
    return this.presets.get(id, req.user);
  }

  @Post()
  @RequirePermissions('presets:write')
  @ApiOperation({ summary: 'Crea un preset (gestor: propio con límite de 5; admin: de muestra)' })
  async create(@Body() dto: CreatePresetDto, @Req() req: { user: AuthenticatedUser }) {
    const created = await this.presets.create(
      { name: dto.name, description: dto.description ?? null, mode: dto.mode, config: dto.config },
      req.user,
    );
    await this.audit.record({ user: req.user, action: 'create', entity: 'gamePreset', entityId: created.id, after: created });
    return created;
  }

  @Patch(':id')
  @RequirePermissions('presets:write')
  @ApiOperation({ summary: 'Edita un preset propio (admin: cualquiera)' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePresetDto, @Req() req: { user: AuthenticatedUser }) {
    const updated = await this.presets.update(
      id,
      { name: dto.name, description: dto.description, mode: dto.mode, config: dto.config },
      req.user,
    );
    await this.audit.record({ user: req.user, action: 'update', entity: 'gamePreset', entityId: id, after: updated });
    return updated;
  }

  @Delete(':id')
  @RequirePermissions('presets:write')
  @ApiOperation({ summary: 'Borra un preset propio (admin: cualquiera)' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: AuthenticatedUser }) {
    const result = await this.presets.remove(id, req.user);
    await this.audit.record({ user: req.user, action: 'delete', entity: 'gamePreset', entityId: id });
    return result;
  }
}
