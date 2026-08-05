/**
 * Separación entre lo REAL y lo SIMULADO.
 *
 * La consola de pruebas fabrica presencia, impactos y averías como si fueran de
 * un módulo de verdad. Eso es una herramienta valiosa —permite ejercer el
 * sistema entero sin hardware— y a la vez un riesgo evidente: si un impacto
 * inventado entra en una partida real, la estadística de un tirador queda
 * contaminada con disparos que nunca ocurrieron, y nadie puede distinguirlos
 * después.
 *
 * La protección NO puede ser «tener cuidado de no mezclarlos». Este proyecto ya
 * resolvió un problema idéntico por construcción: un jugador temporal no
 * acumula estadística porque **carece de ficha de jugador**, y la estadística se
 * guarda por ficha. No hay forma de equivocarse. Aquí se hace lo mismo: panel y
 * módulo llevan la marca en la base, y esta regla impide cualquier combinación
 * mixta.
 *
 * Lógica pura, sin base de datos: se puede comprobar entera y se ejerce desde
 * los servicios que asignan un módulo a un panel.
 */

export interface SimulationParticipants {
  /** El panel al que se quiere asignar el módulo. */
  system: { slug: string; simulated: boolean };
  /** El módulo que se asigna. */
  module: { slug: string; simulated: boolean };
}

export interface SimulationVerdict {
  allowed: boolean;
  /** Motivo, redactado para el operador. Vacío si está permitido. */
  reason: string;
}

/**
 * ¿Puede este módulo vivir en este panel?
 *
 * Sólo si ambos son de la misma naturaleza. Se rechazan las dos mezclas, y con
 * mensajes distintos: no es lo mismo colar un módulo inventado en una
 * instalación real (que falsea datos) que colgar hardware de un panel de
 * pruebas (que silencia impactos legítimos).
 */
export function canAttachModule({ system, module }: SimulationParticipants): SimulationVerdict {
  if (system.simulated === module.simulated) {
    return { allowed: true, reason: '' };
  }
  if (module.simulated && !system.simulated) {
    return {
      allowed: false,
      reason:
        `El módulo «${module.slug}» es SIMULADO y el panel «${system.slug}» es real. ` +
        'Un módulo simulado fabrica impactos que nunca han ocurrido: no puede entrar en una ' +
        'instalación real, porque contaminaría la estadística de los tiradores.',
    };
  }
  return {
    allowed: false,
    reason:
      `El módulo «${module.slug}» es real y el panel «${system.slug}» es de SIMULACIÓN. ` +
      'Sus impactos quedarían apartados como si fueran inventados. Use un panel real.',
  };
}

/**
 * ¿Es una partida legítima? Un juego se disputa sobre un panel; si ese panel es
 * simulado, todo lo que salga de él lo es. Lo que NO se admite es que un mismo
 * juego mezcle módulos de las dos naturalezas.
 */
export function isCoherentGameSetup(modules: { slug: string; simulated: boolean }[]): SimulationVerdict {
  if (modules.length === 0) return { allowed: true, reason: '' };
  const simulados = modules.filter((m) => m.simulated);
  if (simulados.length === 0 || simulados.length === modules.length) {
    return { allowed: true, reason: '' };
  }
  const reales = modules.filter((m) => !m.simulated).map((m) => m.slug);
  return {
    allowed: false,
    reason:
      'La partida mezcla módulos simulados y reales ' +
      `(simulados: ${simulados.map((m) => m.slug).join(', ')}; reales: ${reales.join(', ')}). ` +
      'Los resultados no serían interpretables: no se puede saber qué impactos ocurrieron.',
  };
}

/**
 * ¿Debe contarse esta partida en la estadística acumulada de un jugador?
 *
 * No, si se jugó en un panel de simulación. La marca viaja con el panel, así
 * que la respuesta no depende de que nadie se acuerde de excluirla.
 */
export function countsForPlayerRecord(system: { simulated: boolean }): boolean {
  return !system.simulated;
}
