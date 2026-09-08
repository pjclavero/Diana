import { evaluateHealth, HealthThresholds, HeartbeatState, initialHeartbeat, recordTaskOutcome, touchHeartbeat } from './health';
import { probeDatabase, TAREA_SONDA } from './probe';

/**
 * SALUD = ACTIVIDAD REAL, no proceso vivo ni latido fresco.
 *
 * El healthcheck ya no era `pgrep`, pero seguía teniendo el mismo agujero un
 * escalón más arriba: `touchHeartbeat` refresca el latido en CADA vuelta del
 * bucle, tenga o no tareas que hacer. Un worker que arranca, no consigue
 * hablar con PostgreSQL y se limita a girar quedaba con `tasks: {}` y el
 * latido al día — y `evaluateHealth` decía SANO. Para acumular fallos hay que
 * llegar a intentar una tarea, y las tareas sólo se intentan cuando les toca
 * (estadísticas cada 5 min, retención cada 24 h).
 *
 * Es la misma avería que un panel que pinta «sin alertas» porque no le llegó
 * nada: la ausencia de datos presentada como buena noticia.
 *
 * Las pruebas van por pares control positivo / control negativo: cada regla se
 * comprueba en el caso que debe declarar sano Y en el que debe declarar
 * enfermo, para que ninguna pueda pasar por estar siempre en verde.
 */
const UMBRALES: HealthThresholds = {
  maxAgeMs: 180_000,
  maxConsecutiveFailures: 3,
  maxSuccessAgeMs: 300_000,
  startupGraceMs: 180_000,
};

const AHORA = new Date('2026-09-08T10:00:00.000Z');
const hace = (ms: number) => new Date(AHORA.getTime() - ms);

describe('evaluateHealth · ausencia de trabajo no es salud', () => {
  it('NEGATIVO: arrancó hace más del margen y no ha completado ninguna tarea → NO sano', () => {
    // Latido fresquísimo: el bucle gira. Pero nunca ha terminado nada.
    let state = initialHeartbeat(hace(UMBRALES.startupGraceMs + 1000));
    state = touchHeartbeat(state, AHORA);

    const result = evaluateHealth(state, AHORA, UMBRALES);
    expect(result.healthy).toBe(false);
    expect(result.reason).toMatch(/NINGUNA tarea/);
  });

  it('POSITIVO: recién arrancado, dentro del margen y sin éxitos todavía → sano', () => {
    let state = initialHeartbeat(hace(UMBRALES.startupGraceMs - 1000));
    state = touchHeartbeat(state, AHORA);

    expect(evaluateHealth(state, AHORA, UMBRALES).healthy).toBe(true);
  });

  it('NEGATIVO: lleva más de maxSuccessAgeMs sin que nada acabe bien → NO sano', () => {
    let state = initialHeartbeat(hace(3_600_000));
    state = recordTaskOutcome(state, TAREA_SONDA, { ok: true }, hace(UMBRALES.maxSuccessAgeMs + 1000));
    state = touchHeartbeat(state, AHORA); // el bucle sigue vivo; el trabajo no

    const result = evaluateHealth(state, AHORA, UMBRALES);
    expect(result.healthy).toBe(false);
    expect(result.reason).toMatch(/no está sirviendo/);
  });

  it('POSITIVO: mismo escenario con un éxito dentro de la ventana → sano', () => {
    let state = initialHeartbeat(hace(3_600_000));
    state = recordTaskOutcome(state, TAREA_SONDA, { ok: true }, hace(UMBRALES.maxSuccessAgeMs - 1000));
    state = touchHeartbeat(state, AHORA);

    expect(evaluateHealth(state, AHORA, UMBRALES).healthy).toBe(true);
  });

  it('un latido antiguo sin `startedAt` (versión previa) no se declara sano por omisión', () => {
    const state: HeartbeatState = {
      updatedAt: AHORA.toISOString(),
      tasks: {},
      lastError: null,
      lastSuccessAt: null,
    };
    const result = evaluateHealth(state, AHORA, UMBRALES);
    expect(result.healthy).toBe(false);
    expect(result.reason).toMatch(/ni cuándo arrancó/);
  });

  it('`startedAt` sobrevive a recordTaskOutcome y a touchHeartbeat', () => {
    // Si se perdiera, la regla del margen de arranque se reiniciaría sola en
    // cada vuelta y el worker volvería a poder estar «arrancando» para siempre.
    const inicio = hace(600_000);
    let state = initialHeartbeat(inicio);
    state = recordTaskOutcome(state, 'statistics', { ok: false, error: 'boom' }, hace(1000));
    state = touchHeartbeat(state, AHORA);
    expect(state.startedAt).toBe(inicio.toISOString());
  });
});

describe('probeDatabase · sonda funcional, no un ping al proceso', () => {
  it('POSITIVO: si la consulta vuelve, la sonda da ok', async () => {
    const consultas: string[] = [];
    const prisma = {
      $queryRawUnsafe: async (q: string) => {
        consultas.push(q);
        return [{ '?column?': 1 }];
      },
    };
    await expect(probeDatabase(prisma)).resolves.toEqual({ ok: true });
    // Efecto observable: ha viajado una consulta de verdad, no un `connect()`
    // perezoso que no habría detectado el motor Prisma equivocado.
    expect(consultas).toEqual(['SELECT 1']);
  });

  it('NEGATIVO: si la consulta revienta, la sonda devuelve el error, no ok', async () => {
    const prisma = {
      $queryRawUnsafe: async () => {
        throw new Error('Prisma Client could not locate the Query Engine');
      },
    };
    await expect(probeDatabase(prisma)).resolves.toEqual({
      ok: false,
      error: 'Prisma Client could not locate the Query Engine',
    });
  });

  it('CASO REAL, extremo a extremo: base caída → el healthcheck lo ve en pocas vueltas', async () => {
    // El motor equivocado del Dockerfile: Prisma conecta y revienta en la
    // PRIMERA consulta. Con `pgrep` esto era `healthy`; con el latido a secas,
    // también, hasta que a estadísticas le tocara turno tres veces.
    const prisma = {
      $queryRawUnsafe: async () => {
        throw new Error('Query engine incompatible con libssl');
      },
    };
    let state = initialHeartbeat(hace(1000));
    let reloj = hace(1000).getTime();
    for (let vuelta = 0; vuelta < UMBRALES.maxConsecutiveFailures; vuelta += 1) {
      reloj += 60_000;
      const sonda = await probeDatabase(prisma);
      expect(sonda.ok).toBe(false);
      state = recordTaskOutcome(
        state,
        TAREA_SONDA,
        sonda.ok ? { ok: true } : { ok: false, error: sonda.error },
        new Date(reloj),
      );
    }
    const result = evaluateHealth(state, new Date(reloj), UMBRALES);
    expect(result.healthy).toBe(false);
    expect(result.reason).toMatch(/database/);
    expect(result.reason).toMatch(/libssl/);
  });
});
