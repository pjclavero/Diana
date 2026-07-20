import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { ChangePasswordDto, LoginDto } from './dto';
import { AuthenticatedUser } from './permissions.guard';
import { Public } from './roles.decorator';
import { ROLE_DESCRIPTIONS, ROLE_PERMISSIONS } from '../../domain/rbac/permissions';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Inicia sesión y devuelve un token JWT' })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.username, dto.password);
  }

  @Get('me')
  @ApiOperation({ summary: 'Devuelve la identidad y los permisos del token actual' })
  me(@Req() req: { user: AuthenticatedUser }) {
    return req.user;
  }

  @Post('change-password')
  @HttpCode(204)
  @ApiOperation({ summary: 'Cambia la contraseña del usuario autenticado' })
  async changePassword(@Req() req: { user: AuthenticatedUser }, @Body() dto: ChangePasswordDto) {
    await this.auth.changePassword(req.user.userId, dto.current_password, dto.new_password);
  }

  @Public()
  @Get('roles')
  @ApiOperation({ summary: 'Catálogo de roles y permisos (dosier 23.2)' })
  roles() {
    return Object.entries(ROLE_PERMISSIONS).map(([name, permissions]) => ({
      name,
      description: ROLE_DESCRIPTIONS[name as keyof typeof ROLE_DESCRIPTIONS],
      permissions,
    }));
  }
}
