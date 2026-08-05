/**
 * Detección de conflictos del sistema (dosier 11/12, RISKS.md).
 *
 * El dosier exige un coordinador único, elegido por selector físico, y prohíbe
 * arrancar una partida si dos módulos se declaran principal a la vez
 * («El sistema no permitirá iniciar una partida si detecta dos módulos
 * forzados como principal»). Hasta esta pieza, NADIE comprobaba esa condición:
 * la tarjeta «Conflictos» del panel decía «Sin conflictos detectados» porque la
 * lista siempre venía vacía, no porque se hubiera mirado.
 *
 * Lógica PURA, sin base de datos (al estilo de `decidePresenceChange`): recibe
 * los datos que el backend ya tiene sobre los módulos de UN sistema y dice qué
 * conflictos son ciertos ahora mismo. Los valores devueltos son un subconjunto
 * del enum `conflicts` de `contracts/mqtt/system-status.schema.json` (contrato
 * v1 congelado): sólo se emiten los que aquí se pueden sostener con evidencia
 * real. `duplicate_position`, `no_principal`, `schema_mismatch` y
 * `firmware_mismatch` están en el contrato pero NO se detectan todavía salvo
 * `duplicate_position` (ver abajo); afirmar los demás sin poder verificarlos
 * repetiría el defecto que esta pieza corrige.
 */

/** Subconjunto del enum del contrato que este módulo sabe detectar de verdad. */
export type SystemConflict = 'dual_principal' | 'duplicate_position';

export interface ConflictModuleInput {
  /** Identificador legible del módulo (slug MQTT), para el mensaje de la incidencia. */
  slug: string;
  /** Rol declarado por el módulo (telemetría / selector físico), si consta. */
  role: 'principal' | 'satellite' | 'auto' | null;
  /** ¿Consta en línea? Un módulo apagado no puede coordinar ahora mismo. */
  online: boolean;
  /** Posición en la matriz, si tiene una asignada. */
  position: { x: number; y: number } | null;
}

export interface ConflictReport {
  conflicts: SystemConflict[];
  /** Evidencia legible por conflicto detectado: qué módulos lo causan. */
  detail: Record<SystemConflict, string[]>;
}

/**
 * `dual_principal`: dos o más módulos EN LÍNEA del mismo sistema declaran el
 * rol `principal` a la vez. Se exige `online` porque un selector puesto a
 * PRINCIPAL en un módulo apagado no compite por coordinar nada todavía; el
 * peligro real (dos autoridades dando órdenes) sólo existe cuando ambos
 * pueden hablar.
 *
 * `duplicate_position`: dos módulos del mismo sistema declaran la misma casilla
 * de la matriz (x,y). Hoy la base de datos impide este estado con un índice
 * único (`module_positions_target_system_id_x_y_key`), así que en condiciones
 * normales esta lista siempre estará vacía; se conserva como comprobación de
 * verdad —y no de confianza ciega en que ninguna vía futura vaya a escribir
 * sin pasar por Prisma— en vez de darla por imposible sin comprobarla.
 */
export function detectSystemConflicts(modules: ConflictModuleInput[]): ConflictReport {
  const detail: Record<SystemConflict, string[]> = {
    dual_principal: [],
    duplicate_position: [],
  };

  const principalsOnline = modules.filter((m) => m.online && m.role === 'principal');
  if (principalsOnline.length >= 2) {
    detail.dual_principal = principalsOnline.map((m) => m.slug).sort();
  }

  const byPosition = new Map<string, string[]>();
  for (const m of modules) {
    if (!m.position) continue;
    const key = `${m.position.x},${m.position.y}`;
    const list = byPosition.get(key) ?? [];
    list.push(m.slug);
    byPosition.set(key, list);
  }
  for (const slugs of byPosition.values()) {
    if (slugs.length >= 2) detail.duplicate_position.push(...slugs.sort());
  }

  const conflicts: SystemConflict[] = [];
  if (detail.dual_principal.length > 0) conflicts.push('dual_principal');
  if (detail.duplicate_position.length > 0) conflicts.push('duplicate_position');

  return { conflicts, detail };
}
