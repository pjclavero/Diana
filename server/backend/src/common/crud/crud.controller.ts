/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Type,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiBodyOptions, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DtoValidationPipe } from './dto-validation.pipe';
import { AuditService } from '../../modules/audit/audit.service';
import { AuthenticatedUser } from '../../modules/auth/permissions.guard';
import { RequirePermissions } from '../../modules/auth/roles.decorator';
import { CrudService } from './crud.service';

export interface CrudControllerOptions {
  /** Ruta REST, p. ej. 'players'. */
  path: string;
  /** Etiqueta OpenAPI. */
  tag: string;
  /** Prefijo de permiso, p. ej. 'players' → players:read / players:write. */
  permission: string;
  /** Nombre de la entidad para la auditoría. */
  entity: string;
  /** Token de inyección del servicio CRUD concreto. */
  serviceToken: any;
  /** ¿Se audita la escritura? Por defecto sí (dosier 21.2). */
  audit?: boolean;
  /**
   * DTO del cuerpo de creación. Si se da, el cuerpo se VALIDA contra él y un
   * campo no declarado se rechaza con 400. Si no, se acepta cualquier objeto y
   * la única defensa es la lista blanca del servicio, que DESCARTA en silencio.
   *
   * No es obligatorio para no reescribir de golpe los ~20 controladores de
   * datos de referencia, pero cualquier entidad con identidad o con campos que
   * sean propiedad del sistema debe declararlo.
   */
  createDto?: Type<object>;
  /** DTO del cuerpo de modificación. Ver `createDto`. */
  updateDto?: Type<object>;
}

/**
 * Fabrica un controlador REST estándar para datos de referencia.
 *
 * Devuelve una clase NUEVA en cada llamada, con sus propios metadatos: se
 * registra directamente en `controllers` del módulo.
 */
export function createCrudController(options: CrudControllerOptions): Type<any> {
  const audited = options.audit ?? true;
  // Los pipes se construyen AQUÍ, no se deducen del metatipo del parámetro: la
  // clase se fabrica en tiempo de ejecución y `design:paramtypes` de `create`/
  // `update` dice `Object`, con lo que el `ValidationPipe` global se abstiene.
  const createPipes = options.createDto ? [new DtoValidationPipe(options.createDto)] : [];
  const updatePipes = options.updateDto ? [new DtoValidationPipe(options.updateDto)] : [];
  const createBody: ApiBodyOptions = options.createDto
    ? { type: options.createDto }
    : { schema: { type: 'object' } };
  const updateBody: ApiBodyOptions = options.updateDto
    ? { type: options.updateDto }
    : { schema: { type: 'object' } };

  @ApiTags(options.tag)
  @ApiBearerAuth()
  @Controller(options.path)
  class GenericCrudController {
    constructor(
      readonly service: CrudService,
      readonly auditService: AuditService,
    ) {}

    @Get()
    @RequirePermissions(`${options.permission}:read`)
    @ApiOperation({ summary: `Lista ${options.entity}` })
    list(
      @Query('skip') skip?: string,
      @Query('take') take?: string,
      @Query('orderBy') orderBy?: string,
      @Query('order') order?: 'asc' | 'desc',
    ) {
      return this.service.list({
        skip: skip ? Number.parseInt(skip, 10) : undefined,
        take: take ? Number.parseInt(take, 10) : undefined,
        orderBy,
        order,
      });
    }

    @Get(':id')
    @RequirePermissions(`${options.permission}:read`)
    @ApiOperation({ summary: `Obtiene ${options.entity} por identificador` })
    get(@Param('id') id: string) {
      return this.service.get(id);
    }

    @Post()
    @RequirePermissions(`${options.permission}:write`)
    @ApiBody(createBody)
    @ApiOperation({ summary: `Crea ${options.entity}` })
    async create(
      @Body(...createPipes) body: Record<string, unknown>,
      @Req() req: { user?: AuthenticatedUser },
    ) {
      const created = await this.service.create(body);
      if (audited) {
        await this.auditService.record({
          user: req.user,
          action: 'create',
          entity: options.entity,
          entityId: (created as { id?: string }).id ?? null,
          after: created,
        });
      }
      return created;
    }

    @Patch(':id')
    @RequirePermissions(`${options.permission}:write`)
    @ApiBody(updateBody)
    @ApiOperation({ summary: `Modifica ${options.entity}` })
    async update(
      @Param('id') id: string,
      @Body(...updatePipes) body: Record<string, unknown>,
      @Req() req: { user?: AuthenticatedUser },
    ) {
      const before = await this.service.get(id);
      const after = await this.service.update(id, body);
      if (audited) {
        await this.auditService.record({
          user: req.user,
          action: 'update',
          entity: options.entity,
          entityId: id,
          before,
          after,
        });
      }
      return after;
    }

    @Delete(':id')
    @RequirePermissions(`${options.permission}:write`)
    @ApiOperation({ summary: `Elimina ${options.entity}` })
    async remove(@Param('id') id: string, @Req() req: { user?: AuthenticatedUser }) {
      const before = await this.service.get(id);
      const result = await this.service.remove(id);
      if (audited) {
        await this.auditService.record({
          user: req.user,
          action: 'delete',
          entity: options.entity,
          entityId: id,
          before,
        });
      }
      return result;
    }
  }

  // Nombre único para que Swagger y los mensajes de error sean legibles.
  Object.defineProperty(GenericCrudController, 'name', {
    value: `${options.tag.replace(/(^\w|-\w)/g, (m) => m.replace('-', '').toUpperCase())}Controller`,
  });

  // Inyección explícita: la clase se crea en tiempo de ejecución y no hay
  // metadatos de diseño para el primer parámetro.
  Reflect.defineMetadata(
    'design:paramtypes',
    [options.serviceToken, AuditService],
    GenericCrudController,
  );

  return GenericCrudController;
}
