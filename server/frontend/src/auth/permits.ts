/**
 * ¿El conjunto de permisos del usuario cubre el requerido? Réplica en cliente de
 * la lógica del backend (`domain/rbac/permissions.ts`): comodín total `*` y
 * comodín por recurso `recurso:*`. Sólo decide qué se muestra; la autorización
 * real la impone el backend.
 */
export function permits(permissions: readonly string[], required: string): boolean {
  if (permissions.includes("*")) return true;
  if (permissions.includes(required)) return true;
  const [resource] = required.split(":");
  return permissions.includes(`${resource}:*`);
}
