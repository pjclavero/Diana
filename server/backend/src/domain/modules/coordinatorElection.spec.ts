import { elegirCoordinador, type CandidatoModulo } from './coordinatorElection';

const AHORA = new Date('2026-09-12T18:00:00.000Z');
const FRESCURA = 120_000; // 2 min, explícito en cada llamada

const mod = (
  slug: string,
  selector: CandidatoModulo['selector'],
  hace = 1000,
  online = true,
): CandidatoModulo => ({
  slug,
  selector,
  selectorObservedAt: new Date(AHORA.getTime() - hace),
  online,
});

describe('elección de coordinador · el interruptor manda', () => {
  it('un solo PRINCIPAL coordina', () => {
    const r = elegirCoordinador(
      [mod('module-01', 'PRINCIPAL'), mod('module-02', 'SATELITE')],
      null,
      AHORA,
      FRESCURA,
    );
    expect(r.coordinador).toBe('module-01');
    expect(r.motivo).toBe('unico_principal');
    expect(r.conflicto).toBe(false);
  });

  it('un SATÉLITE nunca es candidato, ni aunque sea el único módulo', () => {
    const r = elegirCoordinador([mod('module-01', 'SATELITE')], null, AHORA, FRESCURA);
    expect(r.coordinador).toBeNull();
    expect(r.motivo).toBe('sin_candidatos');
  });

  it('sin PRINCIPAL ni AUTO no se inventa uno entre los satélites', () => {
    const r = elegirCoordinador(
      [mod('module-01', 'SATELITE'), mod('module-02', 'SATELITE')],
      null,
      AHORA,
      FRESCURA,
    );
    expect(r.coordinador).toBeNull();
  });
});

describe('CONFLICTO · dos o más PRINCIPAL', () => {
  it('avisa, no bloquea, y no admite dos coordinadores', () => {
    const r = elegirCoordinador(
      [mod('module-02', 'PRINCIPAL'), mod('module-03', 'PRINCIPAL')],
      null,
      AHORA,
      FRESCURA,
    );
    expect(r.conflicto).toBe(true);
    expect(r.principales.sort()).toEqual(['module-02', 'module-03']);
    expect(r.coordinador).toBe('module-02'); // menor slug, determinista
    expect(r.motivo).toBe('menor_id_entre_principales');
  });

  it('si el VIGENTE sigue entre ellos, se mantiene', () => {
    // Cambiar de coordinador por un error de configuración sería peor que el
    // propio error: el que ya manda sigue mandando.
    const r = elegirCoordinador(
      [mod('module-02', 'PRINCIPAL'), mod('module-03', 'PRINCIPAL')],
      'module-03',
      AHORA,
      FRESCURA,
    );
    expect(r.coordinador).toBe('module-03');
    expect(r.motivo).toBe('vigente_sigue_principal');
    expect(r.conflicto).toBe(true);
  });

  it('si el vigente YA NO es PRINCIPAL, se elige el menor de los que sí', () => {
    const r = elegirCoordinador(
      [mod('module-05', 'PRINCIPAL'), mod('module-04', 'PRINCIPAL'), mod('module-01', 'SATELITE')],
      'module-01',
      AHORA,
      FRESCURA,
    );
    expect(r.coordinador).toBe('module-04');
  });

  it('es DETERMINISTA: el orden de entrada no cambia el resultado', () => {
    const a = elegirCoordinador(
      [mod('module-09', 'PRINCIPAL'), mod('module-02', 'PRINCIPAL')],
      null, AHORA, FRESCURA,
    );
    const b = elegirCoordinador(
      [mod('module-02', 'PRINCIPAL'), mod('module-09', 'PRINCIPAL')],
      null, AHORA, FRESCURA,
    );
    expect(a.coordinador).toBe(b.coordinador);
    expect(a.coordinador).toBe('module-02');
  });
});

describe('AUTO · respaldo sólo si no hay ningún PRINCIPAL', () => {
  it('con PRINCIPAL presente, AUTO no compite', () => {
    const r = elegirCoordinador(
      [mod('module-01', 'AUTO'), mod('module-07', 'PRINCIPAL')],
      null, AHORA, FRESCURA,
    );
    expect(r.coordinador).toBe('module-07');
  });

  it('sin PRINCIPAL, coordina el menor de los AUTO', () => {
    const r = elegirCoordinador(
      [mod('module-06', 'AUTO'), mod('module-03', 'AUTO')],
      null, AHORA, FRESCURA,
    );
    expect(r.coordinador).toBe('module-03');
    expect(r.motivo).toBe('menor_id_entre_auto');
  });

  it('y si el vigente sigue en AUTO, se mantiene', () => {
    const r = elegirCoordinador(
      [mod('module-06', 'AUTO'), mod('module-03', 'AUTO')],
      'module-06', AHORA, FRESCURA,
    );
    expect(r.coordinador).toBe('module-06');
    expect(r.motivo).toBe('vigente_sigue_auto');
  });
});

describe('FRESCURA · no elegir sobre estado viejo', () => {
  it('una observación demasiado antigua no cuenta, y se dice cuál', () => {
    // El caso real: un módulo que dice ser PRINCIPAL desde hace dos días y
    // lleva apagado desde entonces. `last_seen_at` no serviría: avanza con
    // cada telemetría.
    const r = elegirCoordinador(
      [mod('module-01', 'PRINCIPAL', 10 * 60_000), mod('module-02', 'PRINCIPAL', 5_000)],
      null, AHORA, FRESCURA,
    );
    expect(r.coordinador).toBe('module-02');
    expect(r.ignoradosPorAntiguedad).toContain('module-01');
    expect(r.conflicto).toBe(false); // sólo uno fresco: no hay conflicto real
  });

  it('un selector guardado SIN fecha no es una observación', () => {
    const r = elegirCoordinador(
      [{ slug: 'module-01', selector: 'PRINCIPAL', selectorObservedAt: null, online: true }],
      null, AHORA, FRESCURA,
    );
    expect(r.coordinador).toBeNull();
    expect(r.ignoradosPorAntiguedad).toContain('module-01');
  });

  it('si TODAS son viejas, no hay coordinador: no se coge la menos vieja', () => {
    const r = elegirCoordinador(
      [mod('module-01', 'PRINCIPAL', 10 * 60_000), mod('module-02', 'PRINCIPAL', 9 * 60_000)],
      null, AHORA, FRESCURA,
    );
    expect(r.coordinador).toBeNull();
    expect(r.motivo).toBe('sin_candidatos');
  });

  it('el vigente TAMPOCO se conserva si su observación caducó', () => {
    const r = elegirCoordinador(
      [mod('module-01', 'PRINCIPAL', 10 * 60_000)],
      'module-01', AHORA, FRESCURA,
    );
    expect(r.coordinador).toBeNull();
  });
});

describe('ONLINE · un módulo desconectado no coordina', () => {
  it('un PRINCIPAL offline no es candidato aunque su observación sea fresca', () => {
    // La frescura dice cuándo se vio el interruptor; `online` dice si el módulo
    // está ahí para ejercer. Hacen falta las dos.
    const r = elegirCoordinador(
      [mod('module-01', 'PRINCIPAL', 1000, false)],
      null, AHORA, FRESCURA,
    );
    expect(r.coordinador).toBeNull();
    expect(r.ignoradosPorOffline).toContain('module-01');
  });

  it('el vigente que acaba de caerse DEJA de ser coordinador', () => {
    const r = elegirCoordinador(
      [mod('module-01', 'PRINCIPAL', 1000, false)],
      'module-01', AHORA, FRESCURA,
    );
    expect(r.coordinador).toBeNull();
  });

  it('con dos PRINCIPAL y uno caído, coordina el que sigue en pie', () => {
    const r = elegirCoordinador(
      [mod('module-01', 'PRINCIPAL', 1000, false), mod('module-05', 'PRINCIPAL')],
      'module-01', AHORA, FRESCURA,
    );
    expect(r.coordinador).toBe('module-05');
    expect(r.conflicto).toBe(false); // sólo uno es candidato real
  });

  it('un AUTO offline tampoco sirve de respaldo', () => {
    const r = elegirCoordinador(
      [mod('module-03', 'AUTO', 1000, false)],
      null, AHORA, FRESCURA,
    );
    expect(r.coordinador).toBeNull();
  });
});
