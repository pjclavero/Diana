import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AppConfig, CONFIG } from '../../config/configuration';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthenticatedUser } from './permissions.guard';

export interface JwtPayload {
  sub: string;
  username: string;
  role: string;
  permissions: string[];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @Inject(CONFIG) config: AppConfig,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.jwt.secret,
    });
  }

  /**
   * El rol y los permisos se leen de la BASE, no del token.
   *
   * El token los llevaba congelados hasta 8 h. Con F5 el cambio de rol pasa a
   * ser rutinario —se asciende al activar y se degrada al perder el último
   * módulo—, así que esa foto vieja tenía dos consecuencias reales: un ex-gestor
   * degradado conservaba sus permisos toda la vida del token, y un comprador
   * recién ascendido veía menús de gestor mientras el backend le respondía 403.
   * Revocar sus códigos no servía de nada si la credencial que importa —su
   * token— seguía viva.
   *
   * Cuesta una consulta por petición. Es un precio razonable por que el permiso
   * que se aplica sea el que el sistema cree tener ahora mismo.
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, username: true, active: true, role: { select: { name: true, permissions: true } } },
    });
    if (!user || !user.active) {
      throw new UnauthorizedException('La cuenta ya no está activa.');
    }
    return {
      userId: user.id,
      username: user.username,
      role: user.role.name,
      permissions: user.role.permissions,
    };
  }
}
