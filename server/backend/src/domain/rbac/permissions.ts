/**
 * Roles y permisos (dosier 23.2).
 *
 * Los permisos son cadenas `recurso:accion`. Un rol es un conjunto cerrado de
 * permisos; no hay herencia implícita salvo la expansión explícita de abajo.
 * `*` sólo lo tiene `administrador`.
 */

export const ROLE = {
  ADMINISTRADOR: 'administrador',
  OPERADOR: 'operador',
  ARBITRO: 'arbitro',
  CONSULTA: 'consulta',
  MANTENIMIENTO: 'mantenimiento',
} as const;

export type RoleName = (typeof ROLE)[keyof typeof ROLE];

export const ALL_ROLES: RoleName[] = [
  ROLE.ADMINISTRADOR,
  ROLE.OPERADOR,
  ROLE.ARBITRO,
  ROLE.CONSULTA,
  ROLE.MANTENIMIENTO,
];

/** Permisos de lectura comunes a todos los roles autenticados. */
const READ_ONLY: string[] = [
  'systems:read',
  'modules:read',
  'targets:read',
  'topology:read',
  'calibration:read',
  'players:read',
  'teams:read',
  'games:read',
  'rounds:read',
  'participants:read',
  'hits:read',
  'penalties:read',
  'ammo:read',
  'accuracy:read',
  'statistics:read',
  'game-modes:read',
  'presets:read',
  'firmware:read',
  'exports:read',
];

const OPERATOR_EXTRA: string[] = [
  'systems:write',
  'modules:write',
  'topology:write',
  'targets:write',
  'games:write',
  'games:control',
  'rounds:write',
  'participants:write',
  'presets:write',
  'players:write',
  'teams:write',
  'ammo:write',
  'commands:publish',
  'exports:create',
];

const REFEREE_EXTRA: string[] = [
  'games:control',
  'rounds:write',
  'participants:write',
  'penalties:write',
  'hits:annotate',
  'ammo:write',
  'exports:create',
];

const MAINTENANCE_EXTRA: string[] = [
  'modules:write',
  'calibration:write',
  'maintenance:read',
  'maintenance:write',
  'firmware:write',
  'firmware:deploy',
  'incidents:read',
  'incidents:write',
  'commands:publish',
];

export const ROLE_PERMISSIONS: Record<RoleName, string[]> = {
  [ROLE.ADMINISTRADOR]: ['*'],
  [ROLE.OPERADOR]: dedupe([...READ_ONLY, ...OPERATOR_EXTRA]),
  [ROLE.ARBITRO]: dedupe([...READ_ONLY, ...REFEREE_EXTRA]),
  [ROLE.CONSULTA]: dedupe(READ_ONLY),
  [ROLE.MANTENIMIENTO]: dedupe([...READ_ONLY, ...MAINTENANCE_EXTRA]),
};

export const ROLE_DESCRIPTIONS: Record<RoleName, string> = {
  [ROLE.ADMINISTRADOR]: 'Control total, incluida la gestión de usuarios y la auditoría.',
  [ROLE.OPERADOR]: 'Prepara y dirige partidas, gestiona topología y módulos.',
  [ROLE.ARBITRO]: 'Controla la partida en curso, penalizaciones y munición.',
  [ROLE.CONSULTA]: 'Sólo lectura.',
  [ROLE.MANTENIMIENTO]: 'Calibración, firmware, diagnóstico e incidencias.',
};

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

/** ¿El conjunto de permisos concedido cubre el permiso requerido? */
export function hasPermission(granted: readonly string[], required: string): boolean {
  if (granted.includes('*')) return true;
  if (granted.includes(required)) return true;
  const [resource] = required.split(':');
  return granted.includes(`${resource}:*`);
}

/** ¿El rol cubre TODOS los permisos requeridos? */
export function roleAllows(role: string, required: readonly string[]): boolean {
  const granted = ROLE_PERMISSIONS[role as RoleName];
  if (!granted) return false;
  return required.every((permission) => hasPermission(granted, permission));
}
