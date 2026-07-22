import type { TopologySlot } from "../../api";

function key(pos: { x: number; y: number }) {
  return `${pos.x},${pos.y}`;
}

/**
 * Coloca `moduleId` en `targetPos` dentro de la matriz. Si el destino está
 * ocupado por otro módulo, se **intercambian** (el ocupante va a la casilla de
 * origen del módulo movido); nunca se machaca al ocupante — ese machaque era el
 * bug por el que la celda central parecía no aceptar sueltas. Devuelve un nuevo
 * array de slots (no muta). No hace nada si el destino está bloqueado o si se
 * suelta el módulo sobre su propia casilla.
 */
export function applyMove(
  slots: TopologySlot[],
  moduleId: string,
  targetPos: { x: number; y: number },
): TopologySlot[] {
  const target = slots.find((s) => key(s.position) === key(targetPos));
  if (!target || target.locked) return slots;
  if (target.module_id === moduleId) return slots;

  const from = slots.find((s) => s.module_id === moduleId);
  const occupant = target.module_id ?? null;

  return slots.map((s) => {
    if (key(s.position) === key(targetPos)) return { ...s, module_id: moduleId };
    if (from && key(s.position) === key(from.position)) return { ...s, module_id: occupant };
    return s;
  });
}
