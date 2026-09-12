import type { SelectorPosition } from './selectorObservation';

/**
 * Elección del coordinador efectivo a partir del selector FÍSICO observado.
 *
 * Es una función pura y determinista: las mismas entradas dan siempre el mismo
 * coordinador. Eso importa porque la alternativa —elegir con una consulta
 * ordenada por lo que devuelva la base— haría que un reinicio pudiera cambiar
 * de coordinador sin que nadie tocara un interruptor.
 *
 * NO concede autoridad. Decir quién coordina y PODER coordinar son cosas
 * distintas: lo segundo lo da la ACL del broker (3.4) y el rol en el firmware.
 * Aquí sólo se decide el nombre.
 */

export interface CandidatoModulo {
  slug: string;
  /** Posición observada en `module-status`; `null` si nunca se observó. */
  selector: SelectorPosition | null;
  /** Cuándo se observó. `null` = nunca. */
  selectorObservedAt: Date | null;
  /**
   * Presencia observada. Un módulo desconectado NO puede coordinar aunque su
   * observación sea fresca: la frescura dice cuándo se vio el interruptor, no
   * si el módulo está ahí para ejercer. Son cosas distintas y hacen falta las
   * dos.
   */
  online: boolean;
}

export type MotivoEleccion =
  | 'unico_principal'
  | 'vigente_sigue_principal'
  | 'menor_id_entre_principales'
  | 'vigente_sigue_auto'
  | 'menor_id_entre_auto'
  | 'sin_candidatos';

export interface ResultadoEleccion {
  /** Slug del coordinador efectivo, o `null` si no hay ninguno. */
  coordinador: string | null;
  motivo: MotivoEleccion;
  /** Hay MÁS DE UN PRINCIPAL: se avisa, no se bloquea. */
  conflicto: boolean;
  /** Todos los que se declaran PRINCIPAL con observación fresca. */
  principales: string[];
  /**
   * Candidatos descartados porque su observación es demasiado vieja. Se
   * enumeran en vez de desaparecer: un módulo que dice ser PRINCIPAL desde hace
   * dos días y lleva apagado desde entonces no debe coordinar, pero tampoco
   * debe hacerlo en silencio.
   */
  ignoradosPorAntiguedad: string[];
  /** Candidatos descartados por estar desconectados. */
  ignoradosPorOffline: string[];
}

/** Orden determinista: el "menor module_id" de las reglas. */
function menor(slugs: string[]): string | null {
  if (slugs.length === 0) return null;
  return [...slugs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))[0];
}

/**
 * @param candidatos      módulos del sistema, con su selector observado.
 * @param vigente         coordinador actual, o `null`.
 * @param ahora           instante de la decisión.
 * @param frescuraMaxMs   antigüedad máxima admisible de una observación.
 *
 * `frescuraMaxMs` es un parámetro EXPLÍCITO y no una constante escondida: es
 * una decisión de producto —cuánto puede fiarse uno de una observación— y debe
 * verse en el sitio donde se toma.
 */
export function elegirCoordinador(
  candidatos: readonly CandidatoModulo[],
  vigente: string | null,
  ahora: Date,
  frescuraMaxMs: number,
): ResultadoEleccion {
  const ignoradosPorAntiguedad: string[] = [];
  const ignoradosPorOffline: string[] = [];

  const esCandidato = (c: CandidatoModulo): boolean => {
    if (c.selector === null) return false;
    if (!c.online) {
      // Se enumera en vez de desaparecer: un módulo en PRINCIPAL que acaba de
      // caerse deja de coordinar, y conviene poder ver por qué.
      ignoradosPorOffline.push(c.slug);
      return false;
    }
    if (c.selectorObservedAt === null) {
      // Nunca observado: no se puede afirmar en qué posición está el
      // interruptor, y una posición guardada sin fecha no es una observación.
      ignoradosPorAntiguedad.push(c.slug);
      return false;
    }
    const edad = ahora.getTime() - c.selectorObservedAt.getTime();
    if (edad > frescuraMaxMs) {
      ignoradosPorAntiguedad.push(c.slug);
      return false;
    }
    return true;
  };

  const vivos = candidatos.filter(esCandidato);
  const principales = vivos.filter((c) => c.selector === 'PRINCIPAL').map((c) => c.slug);
  const autos = vivos.filter((c) => c.selector === 'AUTO').map((c) => c.slug);
  // SATELITE nunca es candidato. No se filtra "lo que no sea satélite": se
  // eligen las posiciones que SÍ pueden coordinar, para que una posición nueva
  // no se cuele por omisión.

  if (principales.length === 1) {
    return {
      coordinador: principales[0],
      motivo: 'unico_principal',
      conflicto: false,
      principales,
      ignoradosPorAntiguedad,
      ignoradosPorOffline,
    };
  }

  if (principales.length > 1) {
    // CONFLICTO: dos o más interruptores en PRINCIPAL. No se bloquea el
    // sistema y no se admiten dos coordinadores: se conserva el vigente si
    // sigue entre ellos —cambiar de coordinador por un error de configuración
    // sería peor que el propio error— y si no, el menor slug, que es
    // determinista.
    const mantener = vigente !== null && principales.includes(vigente);
    return {
      coordinador: mantener ? vigente : menor(principales),
      motivo: mantener ? 'vigente_sigue_principal' : 'menor_id_entre_principales',
      conflicto: true,
      principales,
      ignoradosPorAntiguedad,
      ignoradosPorOffline,
    };
  }

  if (autos.length > 0) {
    // Sin ningún PRINCIPAL, AUTO es el respaldo.
    const mantener = vigente !== null && autos.includes(vigente);
    return {
      coordinador: mantener ? vigente : menor(autos),
      motivo: mantener ? 'vigente_sigue_auto' : 'menor_id_entre_auto',
      conflicto: false,
      principales,
      ignoradosPorAntiguedad,
      ignoradosPorOffline,
    };
  }

  // Ni PRINCIPAL ni AUTO: NO se inventa un coordinador entre los satélites.
  // Quedarse sin coordinador es un estado legítimo y visible; nombrar a uno
  // que el operador no ha elegido sería peor.
  return {
    coordinador: null,
    motivo: 'sin_candidatos',
    conflicto: false,
    principales,
    ignoradosPorAntiguedad,
    ignoradosPorOffline,
  };
}
