import { decidePresenceChange, reconnectCountdown } from '../../src/domain/resilience/resilience';

function change(over: Partial<Parameters<typeof decidePresenceChange>[0]> = {}) {
  return {
    moduleSlug: 'mod-a',
    online: false,
    isCoordinator: false,
    involvedInRound: true,
    gameStatus: 'running',
    ...over,
  };
}

describe('Resiliencia de ronda (G-I) · decisión', () => {
  it('cae un módulo implicado con la ronda en marcha → auto-pausa', () => {
    const d = decidePresenceChange(change());
    expect(d.action).toBe('auto_pause');
    expect(d.needsOperatorDecision).toBe(true);
    expect(d.severity).toBe('error');
  });

  it('cae el coordinador → pausa dura, aunque no aporte dianas a la ronda', () => {
    const d = decidePresenceChange(change({ isCoordinator: true, involvedInRound: false }));
    expect(d.action).toBe('hard_pause');
    expect(d.severity).toBe('critical');
    expect(d.reason).toMatch(/tiempos fiables/);
  });

  it('cae un módulo que NO participa en la ronda → no se toca la ronda', () => {
    const d = decidePresenceChange(change({ involvedInRound: false }));
    expect(d.action).toBe('none');
    expect(d.needsOperatorDecision).toBe(false);
  });

  it('cae un módulo sin ronda viva → sólo se registra', () => {
    for (const gameStatus of [null, 'draft', 'finished', 'aborted', 'armed']) {
      expect(decidePresenceChange(change({ gameStatus })).action).toBe('none');
    }
  });

  it('una ronda ya pausada sigue siendo caso vivo: otra caída también decide', () => {
    expect(decidePresenceChange(change({ gameStatus: 'paused' })).action).toBe('auto_pause');
  });

  it('el módulo vuelve: NO se reanuda solo, decide el operador', () => {
    const d = decidePresenceChange(change({ online: true }));
    expect(d.action).toBe('reconnected');
    expect(d.needsOperatorDecision).toBe(true);
    expect(d.reason).toMatch(/decisión del operador/);
  });

  it('el módulo vuelve sin ronda viva: nada que decidir', () => {
    const d = decidePresenceChange(change({ online: true, gameStatus: 'finished' }));
    expect(d.action).toBe('none');
    expect(d.needsOperatorDecision).toBe(false);
  });
});

describe('Resiliencia de ronda (G-I) · cuenta atrás', () => {
  const since = new Date('2026-07-26T10:00:00Z');

  it('informa del tiempo restante mientras dura el plazo', () => {
    const c = reconnectCountdown({
      since,
      now: new Date('2026-07-26T10:00:20Z'),
      graceMs: 60_000,
    });
    expect(c).toEqual({ elapsedMs: 20_000, remainingMs: 40_000, expired: false });
  });

  it('al agotarse marca `expired` y no da tiempos negativos', () => {
    const c = reconnectCountdown({
      since,
      now: new Date('2026-07-26T10:05:00Z'),
      graceMs: 60_000,
    });
    expect(c.remainingMs).toBe(0);
    expect(c.expired).toBe(true);
  });

  it('un reloj hacia atrás no inventa tiempo transcurrido', () => {
    const c = reconnectCountdown({
      since,
      now: new Date('2026-07-26T09:59:00Z'),
      graceMs: 60_000,
    });
    expect(c.elapsedMs).toBe(0);
    expect(c.remainingMs).toBe(60_000);
  });
});
