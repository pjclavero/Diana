import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AccuracyService } from '../../src/modules/accuracy/accuracy.service';
import { StatisticsService } from '../../src/modules/statistics/statistics.module';
import {
  StatsResetService,
  type StatsResetActor,
} from '../../src/modules/statistics/stats-reset.service';
import { FakePrisma } from '../helpers/fake-prisma';
import { StatsResetController } from '../../src/modules/statistics/stats-reset.controller';
import { PERMISSIONS_KEY } from '../../src/modules/auth/roles.decorator';
import { ROLE, roleAllows } from '../../src/domain/rbac/permissions';

const G1 = 'game-1';
const G2 = 'game-2';
const R1 = 'round-1';
const R2 = 'round-2';
const ANA = 'player-ana';
const BEA = 'player-bea';

const ADMIN: StatsResetActor = { userId: 'u-admin', username: 'admin', role: 'administrador' };
const GESTOR: StatsResetActor = { userId: 'u-gestor', username: 'gestor', role: 'gestor' };
const OTRO_GESTOR: StatsResetActor = { userId: 'u-otro', username: 'otro', role: 'gestor' };

function hit(id: string, roundId: string, participantId: string | null, classification: string) {
  return {
    id,
    roundId,
    gameId: roundId === R1 ? G1 : G2,
    participantId,
    classification,
    deviceEventUs: Number(id.replace(/\D/g, '')),
    coordinatorElapsedUs: 1_000_000 + Number(id.replace(/\D/g, '')),
    countsForScore: classification === 'valid_hit',
  };
}

function result(id: string, roundId: string, participantId: string, validHits: number) {
  return {
    id,
    roundId,
    participantId,
    validHits,
    invalidHits: 0,
    detectedHits: validHits,
    score: validHits,
    penaltiesCount: 0,
    penaltiesMs: 0,
    totalTimeUs: 5_000_000,
    accuracyValid: 0.8,
    accuracyStatus: 'computed',
    computedAt: new Date(`2026-07-2${id.length}T10:00:00Z`),
  };
}

/**
 * Escenario: dos partidas terminadas sobre el mismo panel. Ana juega en ambas
 * (y en la primera ocupa además el puesto de la ronda), Bea sólo en la primera
 * y hay dos temporales llamados igual en partidas distintas (§3.4: no tienen
 * ninguna relación entre sí).
 */
function seed(over: { gameStatus?: string; viewId?: string | null; panel?: string } = {}) {
  return new FakePrisma({
    players: [
      { id: ANA, displayName: 'Ana', userId: 'u-ana' },
      { id: BEA, displayName: 'Bea', userId: null },
    ],
    games: [
      {
        id: G1,
        status: over.gameStatus ?? 'finished',
        targetSystemId: over.panel ?? 'panel-1',
        viewId: over.viewId ?? null,
      },
      { id: G2, status: 'finished', targetSystemId: 'panel-1', viewId: null },
    ],
    rounds: [
      { id: R1, gameId: G1, roundIndex: 1, mode: 'secuencia', startedAt: null },
      { id: R2, gameId: G2, roundIndex: 1, mode: 'secuencia', startedAt: null },
    ],
    participants: [
      { id: 'pa1', gameId: G1, roundId: null, playerId: ANA, guestName: null, slot: 1 },
      { id: 'pa1r', gameId: G1, roundId: R1, playerId: ANA, guestName: null, slot: 1 },
      { id: 'pb1', gameId: G1, roundId: null, playerId: BEA, guestName: null, slot: 2 },
      { id: 'pt1', gameId: G1, roundId: null, playerId: null, guestName: 'Invitado', slot: 3 },
      { id: 'pa2', gameId: G2, roundId: null, playerId: ANA, guestName: null, slot: 1 },
      { id: 'pt2', gameId: G2, roundId: null, playerId: null, guestName: 'Invitado', slot: 2 },
    ],
    results: [
      result('res1', R1, 'pa1', 5),
      result('res2', R1, 'pa1r', 5),
      result('res3', R1, 'pb1', 3),
      result('res4', R1, 'pt1', 2),
      result('res5', R2, 'pa2', 7),
      result('res6', R2, 'pt2', 1),
    ],
    penalties: [
      { id: 'pen1', roundId: R1, participantId: 'pa1', penaltyMs: 500 },
      { id: 'pen2', roundId: R1, participantId: 'pb1', penaltyMs: 500 },
    ],
    shotCounts: [
      { id: 'sc1', participantId: 'pa1', initialAmmo: 10, remainingAmmo: 4, remainingKnown: true, mustUseAllAmmo: false, recordedAt: new Date('2026-07-20T10:00:00Z') },
      { id: 'sc2', participantId: 'pa2', initialAmmo: 10, remainingAmmo: 2, remainingKnown: true, mustUseAllAmmo: false, recordedAt: new Date('2026-07-21T10:00:00Z') },
    ],
    hitEvents: [
      hit('h1', R1, 'pa1', 'valid_hit'),
      hit('h2', R1, 'pa1', 'valid_hit'),
      hit('h3', R1, 'pa1', 'hit_on_safe'),
      hit('h4', R1, 'pb1', 'valid_hit'),
      hit('h5', R1, 'pt1', 'valid_hit'),
      hit('h6', R2, 'pa2', 'valid_hit'),
    ],
    statistics: [],
    modules: [{ id: 'mod-1', targetSystemId: 'panel-1', ownerId: 'u-gestor' }],
    viewPanels: [],
  });
}

function service(prisma: FakePrisma) {
  return new StatsResetService(prisma as never);
}

describe('StatsResetService · reinicio de estadística por partida (§3.4)', () => {
  it('borra resultados, penalizaciones y munición del jugador SÓLO en esa partida', async () => {
    const prisma = seed();
    const outcome = await service(prisma).resetParticipant(G1, 'pa1', GESTOR);

    // Ana ocupa dos puestos en G1 (partida y ronda): se reinician los dos.
    expect(outcome.participantIds.sort()).toEqual(['pa1', 'pa1r']);
    expect(outcome.deleted.results).toBe(2);
    expect(outcome.deleted.penalties).toBe(1);
    expect(outcome.deleted.shotCounts).toBe(1);
    expect(outcome.temporary).toBe(false);

    // Lo de Bea, lo del temporal y la OTRA partida de Ana siguen intactos.
    const ids = prisma.db.results.map((r) => r.id).sort();
    expect(ids).toEqual(['res3', 'res4', 'res5', 'res6']);
    expect(prisma.db.penalties.map((p) => p.id)).toEqual(['pen2']);
    expect(prisma.db.shotCounts.map((s) => s.id)).toEqual(['sc2']);
  });

  it('NO borra los impactos: los desatribuye (telemetría inmutable, ADR-0002/0003)', async () => {
    const prisma = seed();
    const outcome = await service(prisma).resetParticipant(G1, 'pa1', GESTOR);

    expect(outcome.hitsDetached).toBe(3);
    expect(prisma.db.hitEvents).toHaveLength(6); // no se ha perdido ninguno
    expect(prisma.db.hitEvents.filter((h) => h.participantId === null).map((h) => h.id)).toEqual([
      'h1',
      'h2',
      'h3',
    ]);
    // El impacto de Bea sigue atribuido.
    expect(prisma.db.hitEvents.find((h) => h.id === 'h4')!.participantId).toBe('pb1');
  });

  /**
   * LA MARCA ES LA MITAD DEL ARREGLO, y no la comprobaba nadie: se podía dejar
   * de escribir `statsResetAt` con toda la suite en verde.
   *
   * Desatribuir a secas no basta. En una partida de un solo jugador, el
   * marcador vuelve a DEDUCIR que un impacto sin dueño es suyo (es la única
   * respuesta posible), así que el reinicio se deshacía solo al recargar: el
   * operador pulsaba, veía ceros, recargaba y tenía otra vez sus números. La
   * marca es lo que distingue «no sabemos de quién es» de «se apartó a
   * propósito».
   */
  it('marca los impactos apartados con `statsResetAt`, no sólo los desatribuye', async () => {
    const prisma = seed();
    const antes = Date.now();
    await service(prisma).resetParticipant(G1, 'pa1', GESTOR);

    const apartados = prisma.db.hitEvents.filter((h) => ['h1', 'h2', 'h3'].includes(h.id));
    for (const h of apartados) {
      expect(h.statsResetAt).toBeInstanceOf(Date);
      expect((h.statsResetAt as Date).getTime()).toBeGreaterThanOrEqual(antes);
    }
    // Los ajenos no se marcan: no se ha tocado a Bea ni al temporal.
    expect(prisma.db.hitEvents.find((h) => h.id === 'h4')!.statsResetAt ?? null).toBeNull();
    expect(prisma.db.hitEvents.find((h) => h.id === 'h5')!.statsResetAt ?? null).toBeNull();
  });

  /**
   * ORDEN DE OPERACIONES (bloqueante B3). Apartar primero y borrar después no
   * es una preferencia de estilo: al revés queda una ventana en la que un
   * `POST /accuracy/rounds/:id/compute` concurrente recrea el `Result` con los
   * aciertos ORIGINALES, deshaciendo el reinicio entero. Con este orden, lo
   * peor que puede recrear es un resultado a cero.
   */
  it('aparta los impactos ANTES de borrar los resultados', async () => {
    const prisma = seed();
    const orden: string[] = [];
    // El servicio opera sobre el cliente de la transacción, así que se observa
    // ahí: se le entrega un envoltorio que anota el orden real de las llamadas.
    const original = prisma.$transaction.bind(prisma);
    prisma.$transaction = ((cb: (tx: unknown) => unknown) =>
      original(((tx: Record<string, any>) => {
        const espia = new Proxy(tx, {
          get(target, prop: string) {
            const tabla = target[prop];
            if (prop === 'hitEvent' || prop === 'result') {
              return new Proxy(tabla, {
                get(t: Record<string, any>, m: string) {
                  if (prop === 'hitEvent' && m === 'updateMany') {
                    return (...a: unknown[]) => {
                      orden.push('apartar-impactos');
                      return t[m](...a);
                    };
                  }
                  if (prop === 'result' && m === 'deleteMany') {
                    return (...a: unknown[]) => {
                      orden.push('borrar-resultados');
                      return t[m](...a);
                    };
                  }
                  return typeof t[m] === 'function' ? t[m].bind(t) : t[m];
                },
              });
            }
            return typeof tabla === 'function' ? tabla.bind(target) : tabla;
          },
        });
        return cb(espia);
      }) as never)) as never;

    await service(prisma).resetParticipant(G1, 'pa1', GESTOR);

    expect(orden).toEqual(['apartar-impactos', 'borrar-resultados']);
  });

  /**
   * TOCTOU (bloqueante B3): comprobar el estado ANTES de abrir la transacción
   * deja una ventana para que la partida arranque entre la comprobación y el
   * borrado, y entonces el motor recalcula justo lo que se acaba de borrar.
   */
  it('vuelve a comprobar el estado DENTRO de la transacción', async () => {
    const prisma = seed();
    // La partida arranca justo después de la comprobación previa, ya con la
    // transacción abierta.
    const original = prisma.$transaction.bind(prisma);
    prisma.$transaction = (async (cb: unknown) => {
      prisma.db.games.find((g) => g.id === G1)!.status = 'running';
      return (original as (c: unknown) => unknown)(cb);
    }) as never;

    await expect(service(prisma).resetParticipant(G1, 'pa1', GESTOR)).rejects.toThrow();
    // Y nada se ha borrado: la transacción no llegó a tocar los datos.
    expect(prisma.db.results).toHaveLength(6);
    expect(prisma.db.hitEvents.every((h) => h.statsResetAt == null)).toBe(true);
  });

  it('el recálculo posterior NO resucita los números: da cero y «no calculable»', async () => {
    const prisma = seed();
    await service(prisma).resetParticipant(G1, 'pa1', GESTOR);

    // Es el punto crítico: `AccuracyService` reconstruye el `Result` desde los
    // impactos y la munición. Si el reinicio sólo hubiera borrado el `Result`,
    // aquí volverían los 5 aciertos.
    const recomputed: any = await new AccuracyService(prisma as never).persistResult(R1, 'pa1');
    expect(recomputed.validHits).toBe(0);
    expect(recomputed.detectedHits).toBe(0);
    expect(recomputed.score).toBe(0);
    expect(recomputed.accuracyStatus).toBe('not_computable');
  });

  it('la estadística GLOBAL del jugador deja de contar esa partida y conserva las demás', async () => {
    const prisma = seed();
    const stats = new StatisticsService(prisma as never);

    const before = await stats.forPlayer(ANA);
    expect(before.rounds).toBe(3); // dos puestos en G1 + uno en G2
    expect(before.total_valid_hits).toBe(17);

    await service(prisma).resetParticipant(G1, 'pa1', GESTOR);

    const after = await stats.forPlayer(ANA);
    expect(after.rounds).toBe(1);
    expect(after.total_valid_hits).toBe(7); // sólo lo de la otra partida
  });

  it('es idempotente: la segunda llamada no borra nada más ni falla', async () => {
    const prisma = seed();
    const svc = service(prisma);
    await svc.resetParticipant(G1, 'pa1', GESTOR);
    const second = await svc.resetParticipant(G1, 'pa1', GESTOR);

    expect(second.deleted).toEqual({
      results: 0,
      penalties: 0,
      shotCounts: 0,
      statistics: 0,
      globalStatistics: 0,
    });
    expect(second.hitsDetached).toBe(0);
    expect(prisma.db.results.map((r) => r.id).sort()).toEqual(['res3', 'res4', 'res5', 'res6']);
  });

  it('un jugador TEMPORAL se reinicia solo, sin tocar al que se llama igual en otra partida', async () => {
    const prisma = seed();
    const outcome = await service(prisma).resetParticipant(G1, 'pt1', GESTOR);

    expect(outcome.temporary).toBe(true);
    expect(outcome.playerId).toBeNull();
    expect(outcome.playerName).toBe('Invitado');
    expect(outcome.participantIds).toEqual(['pt1']);
    expect(outcome.notes[0]).toContain('no tiene estadística acumulada');
    // El «Invitado» de la otra partida es otra identidad: no se toca.
    expect(prisma.db.results.some((r) => r.id === 'res6')).toBe(true);
  });

  it('borra la estadística cacheada de esa partida y AVISA de la acumulada que no puede recalcular', async () => {
    const prisma = seed();
    prisma.db.statistics.push(
      { id: 'st1', scope: 'game', metric: 'aciertos', playerId: ANA, gameId: G1, roundId: null },
      { id: 'st2', scope: 'round', metric: 'aciertos', playerId: ANA, gameId: null, roundId: R1 },
      { id: 'st3', scope: 'player', metric: 'aciertos', playerId: ANA, gameId: null, roundId: null },
      // Misma forma de claves nulas, pero otro ámbito: no pertenece al
      // acumulado del jugador y nunca debe caer por compartir `playerId`.
      { id: 'st-global', scope: 'global', metric: 'aciertos', playerId: ANA, gameId: null, roundId: null },
      { id: 'st4', scope: 'game', metric: 'aciertos', playerId: BEA, gameId: G1, roundId: null },
    );

    const outcome = await service(prisma).resetParticipant(G1, 'pa1', GESTOR);

    expect(outcome.deleted.statistics).toBe(2);
    // El acumulado GLOBAL del jugador también se borra: lo escribe el worker
    // (`recomputePlayerStatistics`) y, si no se toca, conserva los totales
    // anteriores. Peor aún: si ésta era su única partida, el worker se salta el
    // recálculo y quedan congelados para siempre.
    expect(outcome.deleted.globalStatistics).toBe(1);
    expect(outcome.notes.join(' ')).toContain('acumulada global');
    // Sobreviven lo de OTRO jugador y el ámbito global, aunque éste comparta
    // `playerId` y las dos claves nulas con el acumulado de Ana.
    expect(prisma.db.statistics.map((s) => s.id).sort()).toEqual(['st-global', 'st4']);
  });

  it('no toca el acumulado global de OTROS jugadores', async () => {
    const prisma = seed();
    prisma.db.statistics.push(
      { id: 'g-ana', scope: 'player', metric: 'aciertos', playerId: ANA, gameId: null, roundId: null },
      { id: 'g-bea', scope: 'player', metric: 'aciertos', playerId: BEA, gameId: null, roundId: null },
    );
    await service(prisma).resetParticipant(G1, 'pa1', GESTOR);
    expect(prisma.db.statistics.map((s) => s.id)).toEqual(['g-bea']);
  });

  it('marca el reinicio de la propia estadística del actor (queda auditado)', async () => {
    // El gestor que juega en su propia partida: puede reiniciarse (el borrado
    // de sus datos ya está a su alcance por otras vías), pero queda marcado.
    const prisma = seed();
    prisma.db.modules[0].ownerId = 'u-ana';
    const propio = await service(prisma).resetParticipant(G1, 'pa1', { ...GESTOR, userId: 'u-ana' });
    expect(propio.selfReset).toBe(true);

    const ajeno = await service(seed()).resetParticipant(G1, 'pa1', GESTOR);
    expect(ajeno.selfReset).toBe(false);
  });

  describe('permisos y propiedad', () => {
    it('un gestor SIN módulos en el panel de la partida no puede reiniciar', async () => {
      const prisma = seed();
      await expect(service(prisma).resetParticipant(G1, 'pa1', OTRO_GESTOR)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      // Y no ha borrado nada por el camino.
      expect(prisma.db.results).toHaveLength(6);
    });

    it('el admin puede aunque no tenga ningún módulo', async () => {
      const prisma = seed();
      const outcome = await service(prisma).resetParticipant(G1, 'pa1', ADMIN);
      expect(outcome.deleted.results).toBe(2);
    });

    it('con partida sobre una VISTA, vale con tener módulos en cualquiera de sus paneles', async () => {
      const prisma = seed({ viewId: 'view-1', panel: 'panel-9' });
      prisma.db.viewPanels.push({ id: 'vp1', viewId: 'view-1', targetSystemId: 'panel-1' });
      const outcome = await service(prisma).resetParticipant(G1, 'pa1', GESTOR);
      expect(outcome.deleted.results).toBe(2);
    });

    it('con partida sobre una VISTA en paneles ajenos, se rechaza', async () => {
      const prisma = seed({ viewId: 'view-1', panel: 'panel-9' });
      prisma.db.viewPanels.push({ id: 'vp1', viewId: 'view-1', targetSystemId: 'panel-8' });
      await expect(service(prisma).resetParticipant(G1, 'pa1', GESTOR)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('salvaguardas', () => {
    it('rechaza mientras la partida está en curso (el motor la recalcularía)', async () => {
      for (const status of ['running', 'paused']) {
        const prisma = seed({ gameStatus: status });
        await expect(service(prisma).resetParticipant(G1, 'pa1', GESTOR)).rejects.toBeInstanceOf(
          ConflictException,
        );
        expect(prisma.db.results).toHaveLength(6);
      }
    });

    it('permite reiniciar una partida preparada o abortada', async () => {
      for (const status of ['draft', 'armed', 'aborted', 'finished']) {
        const prisma = seed({ gameStatus: status });
        await expect(service(prisma).resetParticipant(G1, 'pa1', GESTOR)).resolves.toBeDefined();
      }
    });

    it('rechaza si el puesto no es de esa partida (equivocación de partida)', async () => {
      const prisma = seed();
      await expect(service(prisma).resetParticipant(G2, 'pa1', GESTOR)).rejects.toThrow(
        /no pertenece a la partida/,
      );
      expect(prisma.db.results).toHaveLength(6);
    });

    it('rechaza si el puesto no existe', async () => {
      const prisma = seed();
      await expect(service(prisma).resetParticipant(G1, 'nope', GESTOR)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});

describe('El permiso del endpoint destructivo está FIJADO', () => {
  // Sin esta prueba, cambiar el decorador a un permiso de lectura abría el
  // borrado a cuatro roles más y toda la suite seguía en verde.
  it('reiniciar exige `stats:reset`, no un permiso de lectura', () => {
    const guardado = Reflect.getMetadata(
      PERMISSIONS_KEY,
      StatsResetController.prototype.reset,
    ) as string[];
    expect(guardado).toEqual(['stats:reset']);
  });

  it('`stats:reset` NO lo tiene ningún rol de sólo lectura', () => {
    for (const rol of [ROLE.CONSULTA, ROLE.JUGADOR, ROLE.ARBITRO, ROLE.MANTENIMIENTO]) {
      expect(roleAllows(rol, ['stats:reset'])).toBe(false);
    }
    expect(roleAllows(ROLE.GESTOR, ['stats:reset'])).toBe(true);
    expect(roleAllows(ROLE.ADMINISTRADOR, ['stats:reset'])).toBe(true);
  });
});
