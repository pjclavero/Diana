import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsInt,
  Max,
  Min,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/roles.decorator';
import { MatrixLayoutsService } from './matrix-layouts.service';

class CellDto {
  @IsString()
  @MinLength(1)
  @MaxLength(63)
  slug!: string;

  @IsInt()
  @Min(-1)
  @Max(1)
  x!: number;

  @IsInt()
  @Min(-1)
  @Max(1)
  y!: number;

  @IsOptional()
  @IsInt()
  rotation?: number;
}

class CreateLayoutDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CellDto)
  cells!: CellDto[];

  @IsOptional()
  @IsUUID()
  origin_system_id?: string;

  @IsOptional()
  @IsBoolean()
  favorite?: boolean;
}

class CaptureLayoutDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string;

  @IsUUID()
  target_system_id!: string;

  @IsOptional()
  @IsBoolean()
  favorite?: boolean;
}

class UpdateLayoutDto {
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
  @IsBoolean()
  favorite?: boolean;
}

class ApplyLayoutDto {
  @IsUUID()
  target_system_id!: string;
}

/**
 * Matrices favoritas (G-H). Lectura con `topology:read`; guardar/aplicar con
 * `topology:write`. El scoping por dueño lo hace el servicio.
 */
@ApiTags('matrix-layouts')
@ApiBearerAuth()
@Controller('matrix-layouts')
export class MatrixLayoutsController {
  constructor(
    private readonly layouts: MatrixLayoutsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('topology:read')
  @ApiOperation({ summary: 'Lista las matrices guardadas visibles (favoritas primero)' })
  list(@Req() req: { user: AuthenticatedUser }) {
    return this.layouts.list(req.user);
  }

  @Get(':id')
  @RequirePermissions('topology:read')
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: AuthenticatedUser }) {
    return this.layouts.get(id, req.user);
  }

  @Post()
  @RequirePermissions('topology:write')
  @ApiOperation({ summary: 'Guarda una matriz explícita' })
  async create(@Body() dto: CreateLayoutDto, @Req() req: { user: AuthenticatedUser }) {
    const layout = await this.layouts.create(
      {
        name: dto.name,
        description: dto.description,
        cells: dto.cells.map((c) => ({ slug: c.slug, x: c.x, y: c.y, rotation: c.rotation ?? 0 })),
        origin_system_id: dto.origin_system_id ?? null,
        favorite: dto.favorite,
      },
      req.user,
    );
    await this.audit.record({
      user: req.user,
      action: 'create',
      entity: 'matrix-layout',
      entityId: layout.id,
      after: layout,
    });
    return layout;
  }

  @Post('capture')
  @RequirePermissions('topology:write')
  @ApiOperation({ summary: 'Guarda como matriz la colocación actual de un panel' })
  async capture(@Body() dto: CaptureLayoutDto, @Req() req: { user: AuthenticatedUser }) {
    const layout = await this.layouts.captureFromSystem(
      {
        name: dto.name,
        description: dto.description,
        target_system_id: dto.target_system_id,
        favorite: dto.favorite,
      },
      req.user,
    );
    await this.audit.record({
      user: req.user,
      action: 'matrix-layout.capture',
      entity: 'matrix-layout',
      entityId: layout.id,
      after: layout,
    });
    return layout;
  }

  @Post(':id/apply')
  @RequirePermissions('topology:write')
  @ApiOperation({ summary: 'Aplica la matriz a un panel (recoloca sus módulos)' })
  async apply(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApplyLayoutDto,
    @Req() req: { user: AuthenticatedUser },
  ) {
    const result = await this.layouts.apply(id, dto.target_system_id, req.user);
    await this.audit.record({
      user: req.user,
      action: 'matrix-layout.apply',
      entity: 'target-system',
      entityId: dto.target_system_id,
      after: result,
    });
    return result;
  }

  @Patch(':id')
  @RequirePermissions('topology:write')
  @ApiOperation({ summary: 'Renombra o marca/desmarca como favorita' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLayoutDto,
    @Req() req: { user: AuthenticatedUser },
  ) {
    const layout = await this.layouts.update(id, dto, req.user);
    await this.audit.record({
      user: req.user,
      action: 'update',
      entity: 'matrix-layout',
      entityId: id,
      after: layout,
    });
    return layout;
  }

  @Delete(':id')
  @RequirePermissions('topology:write')
  async remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: AuthenticatedUser }) {
    const result = await this.layouts.remove(id, req.user);
    await this.audit.record({
      user: req.user,
      action: 'delete',
      entity: 'matrix-layout',
      entityId: id,
    });
    return result;
  }
}
