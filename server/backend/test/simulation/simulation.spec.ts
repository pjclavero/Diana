import {
  canAttachModule,
  countsForPlayerRecord,
  isCoherentGameSetup,
} from '../../src/domain/simulation/simulation';

/**
 * La consola de simulación fabrica impactos que nunca ocurrieron. Que eso no
 * contamine los datos reales NO puede depender de que nadie se equivoque: se
 * hace imposible, igual que un jugador temporal no puede acumular estadística
 * porque carece de ficha.
 *
 * Estas reglas son la barrera. Si alguna cae, la mezcla vuelve a ser posible.
 */

const real = (slug: string) => ({ slug, simulated: false });
const simulado = (slug: string) => ({ slug, simulated: true });

describe('canAttachModule · lo simulado y lo real no se mezclan', () => {
  it('un módulo real va a un panel real', () => {
    expect(canAttachModule({ system: real('panel-1'), module: real('mod-a') }).allowed).toBe(true);
  });

  it('un módulo simulado va a un panel simulado', () => {
    expect(
      canAttachModule({ system: simulado('panel-sim'), module: simulado('mod-sim') }).allowed,
    ).toBe(true);
  });

  it('RECHAZA meter un módulo simulado en un panel real', () => {
    // Es el caso peligroso: impactos inventados entrando en la instalación
    // buena y sumando a la estadística de tiradores de verdad.
    const v = canAttachModule({ system: real('panel-1'), module: simulado('mod-sim') });
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/contaminar/i);
    expect(v.reason).toContain('mod-sim');
    expect(v.reason).toContain('panel-1');
  });

  it('RECHAZA colgar hardware real de un panel de simulación', () => {
    // El daño es el contrario, pero también es daño: impactos legítimos
    // apartados como si fueran inventados.
    const v = canAttachModule({ system: simulado('panel-sim'), module: real('mod-a') });
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/apartados/i);
  });

  it('los dos rechazos se explican DISTINTO: no son el mismo error', () => {
    const aReal = canAttachModule({ system: real('p'), module: simulado('m') }).reason;
    const aSim = canAttachModule({ system: simulado('p'), module: real('m') }).reason;
    expect(aReal).not.toBe(aSim);
  });

  it('permitir no lleva motivo: no se justifica lo que no se impide', () => {
    expect(canAttachModule({ system: real('p'), module: real('m') }).reason).toBe('');
  });
});

describe('isCoherentGameSetup · una partida no mezcla naturalezas', () => {
  it('todos reales: adelante', () => {
    expect(isCoherentGameSetup([real('a'), real('b')]).allowed).toBe(true);
  });

  it('todos simulados: adelante, es una partida de pruebas', () => {
    expect(isCoherentGameSetup([simulado('a'), simulado('b')]).allowed).toBe(true);
  });

  it('mezcla: se rechaza y se dice CUÁLES son de cada clase', () => {
    const v = isCoherentGameSetup([real('a'), simulado('b'), real('c')]);
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain('b');
    expect(v.reason).toContain('a');
    expect(v.reason).toContain('c');
  });

  it('sin módulos no se inventa un problema', () => {
    expect(isCoherentGameSetup([]).allowed).toBe(true);
  });
});

describe('countsForPlayerRecord · lo jugado en simulación no entra en el histórico', () => {
  it('un panel real cuenta', () => {
    expect(countsForPlayerRecord({ simulated: false })).toBe(true);
  });

  it('un panel de simulación NO cuenta', () => {
    // La marca viaja con el panel, así que excluirlo no depende de que nadie
    // se acuerde de filtrar al hacer un informe.
    expect(countsForPlayerRecord({ simulated: true })).toBe(false);
  });
});
