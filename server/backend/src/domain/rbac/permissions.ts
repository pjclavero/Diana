/**
 * Roles y permisos (dosier 23.2).
 *
 * Los permisos son cadenas `recurso:accion`. Un rol es un conjunto cerrado de
 * permisos; no hay herencia implícita salvo la expansión explícita de abajo.
 * `*` sólo lo tiene `administrador`.
 */

export const ROLE = {
  ADMINISTRADOR: 'administrador',
  GESTOR: 'gestor',
  JUGADOR: 'jugador',
  OPERADOR: 'operador',
  ARBITRO: 'arbitro',
  CONSULTA: 'consulta',
  MANTENIMIENTO: 'mantenimiento',
} as const;

export type RoleName = (typeof ROLE)[keyof typeof ROLE];

// El núcleo del modelo de negocio (docs/product/alcance-panel-roles-firmware.md):
//   - administrador = fabricante/dueño del sistema ('*').
//   - gestor        = jugador que posee ≥1 módulo y gestiona partidas, topología,
//                     firmware (acepta OTA), jugadores y diagnóstico.
//   - jugador       = todo usuario; ve SÓLO lo suyo (perfil, partidas, estadísticas).
// operador/arbitro/consulta/mantenimiento se conservan (dosier 23.2) aunque el
// panel de producto gire sobre los tres primeros.
export const ALL_ROLES: RoleName[] = [
  ROLE.ADMINISTRADOR,
  ROLE.GESTOR,
  ROLE.JUGADOR,
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


// El jugador ve SÓLO lo suyo. No recibe lecturas amplias (`games:read`,
// `statistics:read` globales): los endpoints «/me/*» se auto-acotan por el
// usuario autenticado. `profile:read` habilita esa vista propia.
const PLAYER_SELF: string[] = ['profile:read'];

// El gestor = operador (partidas, topología, módulos, jugadores, equipos) + aceptar
// OTA de firmware de SUS módulos (`firmware:deploy`, no `firmware:write`/subida) +
// gestión de propiedad de módulos (`modules:link`) + reinicio de estadística por
// partida (`stats:reset`) + diagnóstico/incidencias.
const GESTOR_EXTRA: string[] = [
  ...OPERATOR_EXTRA,
  'firmware:deploy',
  'modules:link',
  'stats:reset',
  'maintenance:read',
  'maintenance:write',
  'calibration:write',
  'incidents:read',
  'incidents:write',
  'profile:read',
];

export const ROLE_PERMISSIONS: Record<RoleName, string[]> = {
  [ROLE.ADMINISTRADOR]: ['*'],
  [ROLE.GESTOR]: dedupe([...READ_ONLY, ...GESTOR_EXTRA]),
  [ROLE.JUGADOR]: dedupe(PLAYER_SELF),
  [ROLE.OPERADOR]: dedupe([...READ_ONLY, ...OPERATOR_EXTRA]),
  [ROLE.ARBITRO]: dedupe([...READ_ONLY, ...REFEREE_EXTRA]),
  [ROLE.CONSULTA]: dedupe(READ_ONLY),
  [ROLE.MANTENIMIENTO]: dedupe([...READ_ONLY, ...MAINTENANCE_EXTRA]),
};

export const ROLE_DESCRIPTIONS: Record<RoleName, string> = {
  [ROLE.ADMINISTRADOR]: 'Fabricante y dueño del sistema: control total, usuarios, firmware y auditoría.',
  [ROLE.GESTOR]: 'Jugador que posee módulos: gestiona partidas, topología, jugadores, diagnóstico y acepta actualizaciones de firmware de sus módulos.',
  [ROLE.JUGADOR]: 'Usuario jugador: ve sólo sus partidas, estadísticas y logros.',
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
