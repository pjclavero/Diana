import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'diana:permissions';
export const PUBLIC_KEY = 'diana:public';

/** Exige los permisos indicados para acceder al manejador. */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** Marca una ruta como accesible sin autenticación (login, salud). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
