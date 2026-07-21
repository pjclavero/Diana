import { Inject, Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AppConfig, CONFIG } from '../../config/configuration';
import { ALL_ROLES, ROLE, ROLE_DESCRIPTIONS, ROLE_PERMISSIONS } from '../../domain/rbac/permissions';

export interface LoginResult {
  access_token: string;
  token_type: 'Bearer';
  expires_in: string;
  user: { id: string; username: string; role: string; must_change_password: boolean };
}

export const BCRYPT_ROUNDS = 12;

/**
 * Autenticación por JWT.
 *
 * SIN CONTRASEÑAS POR DEFECTO EN EL CÓDIGO (encargo §14): la cuenta inicial se
 * crea en el arranque con la credencial de `DIANA_ADMIN_PASSWORD` o, si no
 * existe, con una generada aleatoriamente que se escribe UNA vez en el log y
 * obliga a cambiarla en el primer acceso.
 */
@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.DIANA_SKIP_BOOTSTRAP === '1') return;
    try {
      await this.ensureRoles();
      await this.ensureInitialAdmin();
    } catch (error) {
      this.logger.error(`No se pudo preparar la cuenta inicial: ${(error as Error).message}`);
    }
  }

  /** Crea los cinco roles del dosier 23.2 si no existen. */
  async ensureRoles(): Promise<void> {
    for (const name of ALL_ROLES) {
      await this.prisma.role.upsert({
        where: { name },
        update: { permissions: ROLE_PERMISSIONS[name], description: ROLE_DESCRIPTIONS[name] },
        create: {
          name,
          description: ROLE_DESCRIPTIONS[name],
          permissions: ROLE_PERMISSIONS[name],
          builtin: true,
        },
      });
    }
  }

  /** Crea la cuenta de administrador sólo si NO hay ningún usuario todavía. */
  async ensureInitialAdmin(): Promise<void> {
    const existing = await this.prisma.user.count();
    if (existing > 0) return;

    const role = await this.prisma.role.findUniqueOrThrow({ where: { name: ROLE.ADMINISTRADOR } });
    const fromEnv = this.config.admin.password;
    const password = fromEnv ?? randomBytes(18).toString('base64url');

    await this.prisma.user.create({
      data: {
        username: this.config.admin.username,
        email: this.config.admin.email,
        displayName: 'Administrador inicial',
        passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
        mustChangePassword: true,
        roleId: role.id,
      },
    });

    if (fromEnv) {
      this.logger.warn(
        `Cuenta inicial '${this.config.admin.username}' creada con la contraseña de ` +
          'DIANA_ADMIN_PASSWORD. Debe cambiarse en el primer acceso.',
      );
    } else {
      // Único punto del sistema donde se escribe una credencial, y sólo porque
      // se acaba de generar y no hay otra forma de entregarla al operador.
      this.logger.warn(
        `Cuenta inicial creada. Usuario: ${this.config.admin.username} · ` +
          `Contraseña generada: ${password} · Cámbiela en el primer acceso.`,
      );
    }
  }

  async validate(username: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { username },
      include: { role: true },
    });
    // Comparación siempre ejecutada para no filtrar la existencia del usuario.
    const hash = user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
    const ok = await bcrypt.compare(password, hash);
    if (!user || !ok || !user.active) {
      throw new UnauthorizedException('Credenciales no válidas');
    }
    return user;
  }

  async login(username: string, password: string): Promise<LoginResult> {
    const user = await this.validate(username, password);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const permissions = user.role.permissions;
    const token = await this.jwt.signAsync({
      sub: user.id,
      username: user.username,
      role: user.role.name,
      permissions,
    });

    return {
      access_token: token,
      token_type: 'Bearer',
      expires_in: this.config.jwt.expiresIn,
      user: {
        id: user.id,
        username: user.username,
        role: user.role.name,
        must_change_password: user.mustChangePassword,
      },
    };
  }

  /**
   * Identidad vigente del usuario leída de la BD (no del token), para que
   * `GET /auth/me` refleje el estado real —incluido `must_change_password`—
   * tanto en el login como al recargar con un token guardado.
   */
  async currentUser(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { role: true },
    });
    return {
      userId: user.id,
      username: user.username,
      role: user.role.name,
      permissions: user.role.permissions,
      must_change_password: user.mustChangePassword,
    };
  }

  async changePassword(userId: string, current: string, next: string): Promise<void> {
    if (next.length < 12) {
      throw new UnauthorizedException('La nueva contraseña debe tener al menos 12 caracteres');
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const ok = await bcrypt.compare(current, user.passwordHash);
    if (!ok) throw new UnauthorizedException('La contraseña actual no es correcta');

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await bcrypt.hash(next, BCRYPT_ROUNDS),
        mustChangePassword: false,
      },
    });
  }
}
