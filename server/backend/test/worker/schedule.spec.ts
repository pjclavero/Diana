import {
  canPurgeRound,
  dueTasks,
  isDue,
  retentionCutoff,
  TaskDefinition,
} from '../../../worker/src/schedule';

function task(overrides: Partial<TaskDefinition> = {}): TaskDefinition {
  return { name: 't', intervalMs: 60000, lastRunAt: null, enabled: true, ...overrides };
}

/** Lógica pura del worker: comprobable sin base de datos ni relojes reales. */
describe('Planificador del worker', () => {
  const now = new Date('2026-07-20T12:00:00Z');

  it('una tarea que nunca se ejecutó toca ya', () => {
    expect(isDue(task(), now)).toBe(true);
  });

  it('una tarea deshabilitada no toca nunca', () => {
    expect(isDue(task({ enabled: false }), now)).toBe(false);
  });

  it('respeta el intervalo', () => {
    expect(isDue(task({ lastRunAt: new Date('2026-07-20T11:59:30Z') }), now)).toBe(false);
    expect(isDue(task({ lastRunAt: new Date('2026-07-20T11:58:59Z') }), now)).toBe(true);
  });

  it('dueTasks filtra correctamente', () => {
    const tasks = [
      task({ name: 'a' }),
      task({ name: 'b', enabled: false }),
      task({ name: 'c', lastRunAt: now }),
    ];
    expect(dueTasks(tasks, now).map((t) => t.name)).toEqual(['a']);
  });
});

describe('Retención', () => {
  const now = new Date('2026-07-20T12:00:00Z');

  it('calcula la fecha de corte', () => {
    expect(retentionCutoff(now, 30).toISOString()).toBe('2026-06-20T12:00:00.000Z');
    expect(retentionCutoff(now, 0).toISOString()).toBe(now.toISOString());
  });

  it('rechaza una retención inválida', () => {
    expect(() => retentionCutoff(now, -1)).toThrow();
  });

  it('NO purga una ronda sin resultados calculados', () => {
    expect(canPurgeRound({ hasResults: false, finishedAt: now })).toBe(false);
  });

  it('NO purga una ronda sin terminar', () => {
    expect(canPurgeRound({ hasResults: true, finishedAt: null })).toBe(false);
  });

  it('purga una ronda terminada y con resultados', () => {
    expect(canPurgeRound({ hasResults: true, finishedAt: now })).toBe(true);
  });
});
