import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasPermission } from '../../domain/rbac/permissions';
import { PERMISSIONS_KEY } from './roles.decorator';

export interface AuthenticatedUser {
  userId: string;
  username: string;
  role: string;
  permissions: string[];
}

/**
 * Autorización por permisos. El rol del usuario se traduce a permisos al
 * emitir el token; aquí sólo se comprueba la intersección.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) throw new ForbiddenException('Sin usuario autenticado');

    const granted = user.permissions ?? [];
    const missing = required.filter((permission) => !hasPermission(granted, permission));
    if (missing.length > 0) {
      throw new ForbiddenException(
        `El rol '${user.role}' no tiene los permisos necesarios: ${missing.join(', ')}`,
      );
    }
    return true;
  }
}
