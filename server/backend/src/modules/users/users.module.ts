import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsOptional, IsString, MinLength } from 'class-validator';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/roles.decorator';
import { BCRYPT_ROUNDS } from '../auth/auth.service';

export class CreateUserDto {
  @ApiProperty() @IsString() @MinLength(3) username!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsEmail() email?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() display_name?: string;
  @ApiProperty({ description: 'Mínimo 12 caracteres. Nunca se almacena en claro.' })
  @IsString()
  @MinLength(12)
  password!: string;
  @ApiProperty({ description: 'Nombre del rol: administrador, operador, arbitro, consulta, mantenimiento.' })
  @IsString()
  role!: string;
}

export class UpdateUserDto {
  @ApiProperty({ required: false }) @IsOptional() @IsEmail() email?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() display_name?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() role?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() active?: boolean;
}

/** Proyección pública de un usuario: NUNCA incluye el hash de la contraseña. */
const PUBLIC_SELECT = {
  id: true,
  username: true,
  email: true,
  displayName: true,
  active: true,
  mustChangePassword: true,
  lastLoginAt: true,
  createdAt: true,
  role: { select: { id: true, name: true, permissions: true } },
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const items = await this.prisma.user.findMany({
      select: PUBLIC_SELECT,
      orderBy: { username: 'asc' },
    });
    return { items, total: items.length };
  }

  async get(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: PUBLIC_SELECT });
    if (!user) throw new NotFoundException(`Usuario ${id} no encontrado`);
    return user;
  }

  private async roleIdByName(name: string): Promise<string> {
    const role = await this.prisma.role.findUnique({ where: { name } });
    if (!role) throw new BadRequestException(`Rol desconocido: ${name}`);
    return role.id;
  }

  async create(dto: CreateUserDto) {
    return this.prisma.user.create({
      data: {
        username: dto.username,
        email: dto.email ?? null,
        displayName: dto.display_name ?? null,
        passwordHash: await bcrypt.hash(dto.password, BCRYPT_ROUNDS),
        mustChangePassword: true,
        roleId: await this.roleIdByName(dto.role),
      },
      select: PUBLIC_SELECT,
    });
  }

  async update(id: string, dto: UpdateUserDto) {
    await this.get(id);
    return this.prisma.user.update({
      where: { id },
      data: {
        email: dto.email,
        displayName: dto.display_name,
        active: dto.active,
        roleId: dto.role ? await this.roleIdByName(dto.role) : undefined,
      },
      select: PUBLIC_SELECT,
    });
  }

  async remove(id: string) {
    await this.get(id);
    // Baja lógica: el histórico de auditoría referencia al usuario.
    await this.prisma.user.update({ where: { id }, data: { active: false } });
    return { id, deactivated: true };
  }
}

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('users:read')
  @ApiOperation({ summary: 'Lista usuarios (sin credenciales)' })
  list() {
    return this.users.list();
  }

  @Get(':id')
  @RequirePermissions('users:read')
  get(@Param('id') id: string) {
    return this.users.get(id);
  }

  @Post()
  @RequirePermissions('users:write')
  @ApiOperation({ summary: 'Crea un usuario. La contraseña se pide en el primer acceso.' })
  async create(@Body() dto: CreateUserDto, @Req() req: { user?: AuthenticatedUser }) {
    const created = await this.users.create(dto);
    await this.audit.record({
      user: req.user,
      action: 'create',
      entity: 'user',
      entityId: created.id,
      after: created,
    });
    return created;
  }

  @Patch(':id')
  @RequirePermissions('users:write')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @Req() req: { user?: AuthenticatedUser },
  ) {
    const before = await this.users.get(id);
    const after = await this.users.update(id, dto);
    await this.audit.record({
      user: req.user,
      action: 'update',
      entity: 'user',
      entityId: id,
      before,
      after,
    });
    return after;
  }

  @Delete(':id')
  @RequirePermissions('users:write')
  @ApiOperation({ summary: 'Desactiva un usuario (baja lógica)' })
  async remove(@Param('id') id: string, @Req() req: { user?: AuthenticatedUser }) {
    const before = await this.users.get(id);
    const result = await this.users.remove(id);
    await this.audit.record({
      user: req.user,
      action: 'deactivate',
      entity: 'user',
      entityId: id,
      before,
    });
    return result;
  }
}

@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
