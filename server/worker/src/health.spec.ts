import { evaluateHealth, HeartbeatState, initialHeartbeat, recordTaskOutcome, touchHeartbeat } from './health';

/** Atajo para construir el estado de una tarea en las pruebas. */
const tarea = (consecutiveFailures: number, lastError: string | null = null, lastSuccessAt: string | null = null) => ({
  consecutiveFailures,
  lastError,
  lastSuccessAt,
});

const THRESHOLDS = { maxAgeMs: 180000, maxConsecutiveFailures: 3 };

describe('initialHeartbeat', () => {
  it('arranca sin fallos y sin éxito registrado', () => {
    const now = new Date('2026-08-04T10:00:00.000Z');
    const state = initialHeartbeat(now);
    expect(state).toEqual<HeartbeatState>({
      updatedAt: now.toISOString(),
      tasks: {},
      lastError: null,
      lastSuccessAt: null,
    });
  });
});

describe('recordTaskOutcome', () => {
  it('un éxito resetea el contador de fallos consecutivos', () => {
    const before: HeartbeatState = {
      updatedAt: '2026-08-04T09:00:00.000Z',
      tasks: { statistics: tarea(2, 'boom anterior', '2026-08-04T08:00:00.000Z') },
      lastError: 'boom anterior',
      lastSuccessAt: '2026-08-04T08:00:00.000Z',
    };
    const now = new Date('2026-08-04T10:00:00.000Z');
    const after = recordTaskOutcome(before, 'statistics', { ok: true }, now);

    expect(after.tasks.statistics.consecutiveFailures).toBe(0);
    expect(after.lastError).toBeNull();
    expect(after.lastSuccessAt).toBe(now.toISOString());
    expect(after.updatedAt).toBe(now.toISOString());
  });

  it('un fallo incrementa el contador y guarda el error, sin tocar el último éxito', () => {
    const before: HeartbeatState = {
      updatedAt: '2026-08-04T09:00:00.000Z',
      tasks: { statistics: tarea(0, null, '2026-08-04T08:00:00.000Z') },
      lastError: null,
      lastSuccessAt: '2026-08-04T08:00:00.000Z',
    };
    const now = new Date('2026-08-04T10:00:00.000Z');
    const after = recordTaskOutcome(before, 'statistics', { ok: false, error: 'Prisma engine mismatch' }, now);

    expect(after.tasks.statistics.consecutiveFailures).toBe(1);
    expect(after.lastError).toBe('Prisma engine mismatch');
    expect(after.lastSuccessAt).toBe('2026-08-04T08:00:00.000Z');
  });

  it('fallos sucesivos acumulan el contador', () => {
    const now = new Date('2026-08-04T10:00:00.000Z');
    let state = initialHeartbeat(now);
    for (let i = 0; i < 5; i += 1) {
      state = recordTaskOutcome(state, 'statistics', { ok: false, error: `fallo ${i}` }, now);
    }
    expect(state.tasks.statistics.consecutiveFailures).toBe(5);
    expect(state.lastError).toBe('fallo 4');
  });
});

/**
 * EL FALLO QUE ENCONTRÓ LA REVISIÓN. Con un ÚNICO contador compartido, el
 * éxito de una tarea frecuente borraba los fallos de una rara: `statistics`
 * corre cada 5 minutos y `retention` cada 24 horas, así que `retention` podía
 * llevar SEMANAS rota sin acumular jamás tres fallos consecutivos, porque cada
 * vuelta de `statistics` reseteaba la cuenta antes de que volviera a
 * intentarlo. Era el mismo fallo silencioso que este módulo venía a eliminar,
 * colado por otra puerta — y `retention` es la purga de datos: que falle sin
 * que nadie se entere acaba llenando el disco.
 */
describe('recordTaskOutcome · cada tarea lleva SU cuenta', () => {
  const now = new Date('2026-08-04T10:00:00.000Z');

  it('el éxito de una tarea NO borra los fallos de otra', () => {
    let state = initialHeartbeat(now);
    state = recordTaskOutcome(state, 'retention', { ok: false, error: 'disco lleno' }, now);
    state = recordTaskOutcome(state, 'statistics', { ok: true }, now);

    expect(state.tasks.retention.consecutiveFailures).toBe(1);
    expect(state.tasks.statistics.consecutiveFailures).toBe(0);
  });

  it('una tarea rara y rota acaba declarando el worker NO sano, aunque la frecuente vaya bien', () => {
    // Reproduce el escenario completo: retention falla una vez al día,
    // statistics acierta cada 5 minutos entre medias.
    let state = initialHeartbeat(now);
    for (let dia = 0; dia < 3; dia += 1) {
      state = recordTaskOutcome(state, 'retention', { ok: false, error: 'disco lleno' }, now);
      for (let vuelta = 0; vuelta < 288; vuelta += 1) {
        state = recordTaskOutcome(state, 'statistics', { ok: true }, now);
      }
    }

    expect(state.tasks.retention.consecutiveFailures).toBe(3);
    const result = evaluateHealth(state, now, THRESHOLDS);
    expect(result.healthy).toBe(false);
    expect(result.reason).toMatch(/retention/);
  });

  it('el error de cabecera es el de la tarea rota, no el silencio de la que va bien', () => {
    let state = initialHeartbeat(now);
    state = recordTaskOutcome(state, 'retention', { ok: false, error: 'disco lleno' }, now);
    state = recordTaskOutcome(state, 'statistics', { ok: true }, now);
    expect(state.lastError).toBe('disco lleno');
  });

  it('cuando la tarea rota se recupera, el worker vuelve a estar sano', () => {
    let state = initialHeartbeat(now);
    for (let i = 0; i < 4; i += 1) {
      state = recordTaskOutcome(state, 'retention', { ok: false, error: 'disco lleno' }, now);
    }
    expect(evaluateHealth(state, now, THRESHOLDS).healthy).toBe(false);

    state = recordTaskOutcome(state, 'retention', { ok: true }, now);
    expect(evaluateHealth(state, now, THRESHOLDS).healthy).toBe(true);
    expect(state.lastError).toBeNull();
  });
});

describe('touchHeartbeat', () => {
  it('actualiza updatedAt sin tocar el contador de fallos', () => {
    const before: HeartbeatState = {
      updatedAt: '2026-08-04T09:00:00.000Z',
      tasks: { statistics: tarea(2, 'algo') },
      lastError: 'algo',
      lastSuccessAt: null,
    };
    const now = new Date('2026-08-04T10:00:00.000Z');
    const after = touchHeartbeat(before, now);

    expect(after.updatedAt).toBe(now.toISOString());
    expect(after.tasks.statistics.consecutiveFailures).toBe(2);
    expect(after.lastError).toBe('algo');
  });
});

describe('evaluateHealth', () => {
  const now = new Date('2026-08-04T10:00:00.000Z');

  it('no sano si no hay heartbeat (fichero ausente o ilegible)', () => {
    const result = evaluateHealth(null, now, THRESHOLDS);
    expect(result.healthy).toBe(false);
    expect(result.reason).toMatch(/heartbeat/);
  });

  it('no sano si updatedAt no es una fecha válida', () => {
    const state: HeartbeatState = {
      updatedAt: 'no-es-una-fecha',
      tasks: {},
      lastError: null,
      lastSuccessAt: null,
    };
    const result = evaluateHealth(state, now, THRESHOLDS);
    expect(result.healthy).toBe(false);
  });

  it('no sano si el heartbeat está obsoleto (proceso colgado o muerto)', () => {
    const state: HeartbeatState = {
      updatedAt: new Date(now.getTime() - THRESHOLDS.maxAgeMs - 1000).toISOString(),
      tasks: {},
      lastError: null,
      lastSuccessAt: null,
    };
    const result = evaluateHealth(state, now, THRESHOLDS);
    expect(result.healthy).toBe(false);
    expect(result.reason).toMatch(/obsoleto/);
  });

  it('CASO REAL: proceso vivo (heartbeat reciente) pero todas las tareas fallan → no sano', () => {
    // Éste es exactamente el escenario reportado en producción: el proceso
    // node seguía en pie (pgrep lo veía vivo) pero el cliente Prisma con el
    // motor equivocado hacía fallar cada tarea. Antes de esta corrección,
    // `pgrep` habría declarado el contenedor `healthy`.
    const state: HeartbeatState = {
      updatedAt: now.toISOString(),
      tasks: {
        statistics: tarea(
          THRESHOLDS.maxConsecutiveFailures,
          'PrismaClientInitializationError: Prisma Client could not locate the Query Engine',
        ),
      },
      lastError: 'PrismaClientInitializationError: Prisma Client could not locate the Query Engine',
      lastSuccessAt: null,
    };
    const result = evaluateHealth(state, now, THRESHOLDS);
    expect(result.healthy).toBe(false);
    expect(result.reason).toMatch(/fallos consecutivos/);
    expect(result.reason).toMatch(/statistics/);
  });

  it('sano: heartbeat reciente y fallos por debajo del umbral', () => {
    const state: HeartbeatState = {
      updatedAt: now.toISOString(),
      tasks: {
        statistics: tarea(
          THRESHOLDS.maxConsecutiveFailures - 1,
          'fallo aislado, no en racha',
          new Date(now.getTime() - 60000).toISOString(),
        ),
      },
      lastError: 'fallo aislado, no en racha',
      lastSuccessAt: new Date(now.getTime() - 60000).toISOString(),
    };
    const result = evaluateHealth(state, now, THRESHOLDS);
    expect(result.healthy).toBe(true);
  });

  it('sano: heartbeat reciente sin ningún fallo', () => {
    const state = initialHeartbeat(now);
    const result = evaluateHealth(state, now, THRESHOLDS);
    expect(result.healthy).toBe(true);
    expect(result.reason).toBe('ok');
  });
});

/**
 * `readHeartbeat` NO tenía ninguna prueba, y ahí se coló un fallo real que sólo
 * apareció en producción: al pasar los contadores de uno global a uno por
 * tarea, el validador siguió exigiendo el campo viejo y descartaba TODOS los
 * latidos por ilegibles. El worker funcionaba y el healthcheck lo declaraba
 * enfermo. Con las 15 pruebas de la lógica pura en verde.
 */
describe('readHeartbeat · valida la forma REAL del fichero', () => {
  const fs = require('fs') as typeof import('fs');
  const os = require('os') as typeof import('os');
  const path = require('path') as typeof import('path');
  const { readHeartbeat } = require('./healthcheck') as typeof import('./healthcheck');

  const escribir = (contenido: string): string => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hb-')), 'hb.json');
    fs.writeFileSync(file, contenido);
    return file;
  };

  it('acepta el latido que escribe el worker de VERDAD', () => {
    // Contenido copiado de un latido real de producción.
    const real = JSON.stringify({
      updatedAt: '2026-08-04T23:11:39.644Z',
      tasks: {
        statistics: { consecutiveFailures: 0, lastError: null, lastSuccessAt: '2026-08-04T23:10:39.155Z' },
        retention: { consecutiveFailures: 0, lastError: null, lastSuccessAt: '2026-08-04T23:10:39.589Z' },
      },
      lastError: null,
      lastSuccessAt: '2026-08-04T23:10:39.589Z',
    });
    const state = readHeartbeat(escribir(real));
    expect(state).not.toBeNull();
    expect(state!.tasks.statistics.consecutiveFailures).toBe(0);
  });

  it('lo que escribe `initialHeartbeat` también se puede leer', () => {
    // Ata las dos mitades: si una cambia de forma, esta prueba se entera.
    const file = escribir(JSON.stringify(initialHeartbeat(new Date('2026-08-04T10:00:00.000Z'))));
    expect(readHeartbeat(file)).not.toBeNull();
  });

  it('un fichero que no existe da null, no una excepción', () => {
    expect(readHeartbeat('/no/existe/hb.json')).toBeNull();
  });

  it('un JSON corrupto da null', () => {
    expect(readHeartbeat(escribir('{esto no es json'))).toBeNull();
  });

  it('un JSON válido pero sin la forma esperada da null', () => {
    expect(readHeartbeat(escribir('{"updatedAt":"2026-08-04T10:00:00.000Z"}'))).toBeNull();
  });
});
