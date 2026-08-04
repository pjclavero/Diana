import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ROLE } from '../../domain/rbac/permissions';

export interface StatsResetActor {
  userId: string;
  username: string;
  role: string;
}

export interface StatsResetOutcome {
  gameId: string;
  participantId: string;
  /** Puestos afectados: todos los del jugador en ESA partida (o el temporal). */
  participantIds: string[];
  playerId: string | null;
  playerName: string;
  temporary: boolean;
  /** El actor está reiniciando su propia estadística (queda en la auditoría). */
  selfReset: boolean;
  deleted: {
    results: number;
    penalties: number;
    shotCounts: number;
    statistics: number;
    globalStatistics: number;
  };
  /** Impactos que dejan de estar atribuidos al jugador. NO se borran. */
  hitsDetached: number;
  notes: string[];
}

/** Estados en los que el motor sigue produciendo impactos y resultados. */
const IN_PROGRESS_STATUSES = ['running', 'paused'];

/**
 * Reinicio de la estadística de un jugador **en una partida** concreta
 * (§3.4 de docs/product/alcance-panel-roles-firmware.md). Sólo gestor (de sus
 * partidas) y admin; el rol `jugador` no tiene `stats:reset`.
 *
 * Qué se borra y POR QUÉ:
 * - `Result`, `Penalty` y `ShotCount` del jugador en esa partida: son la
 *   estadística propiamente dicha y las ENTRADAS con las que
 *   `AccuracyService.persistResult` la recalcula. Si sólo se borrase el
 *   `Result`, el primer recálculo resucitaría los números y el reinicio sería
 *   mentira.
 * - Los `HitEvent` NO se borran: son telemetría del firmware (ADR-0002/0003,
 *   T1/T2 inmutables). Se **desatribuyen** (`participantId = NULL`), que es lo
 *   único que los ata a un jugador. El impacto físico se conserva y el marcador
 *   lo contará como «sin atribuir», que es la verdad.
 *
 * Qué pasa con la estadística GLOBAL del jugador registrado (§3.4): hoy **se
 * deriva** de los `Result` (`StatisticsService.forPlayer`, `ScoreboardService`);
 * no existe ningún acumulado escrito en la tabla `Statistic` (no hay escritor).
 * Por eso borrar los `Result` de esta partida descuenta su aportación de forma
 * exacta, sin restar a mano ni arriesgar un doble descuento. Las filas de
 * `Statistic` atadas a esta partida se borran igualmente por si algún día se
 * cachean; las que no lo estén se cuentan y se avisan en vez de borrarlas a
 * ciegas.
 */
@Injectable()
export class StatsResetService {
  constructor(private readonly prisma: PrismaService) {}

  private isAdmin(actor: StatsResetActor) {
    return actor.role === ROLE.ADMINISTRADOR;
  }

  /**
   * Un gestor manda sobre las partidas jugadas en paneles donde tiene módulos
   * suyos (`Module.ownerId`), el mismo criterio que la topología y el dashboard
   * de módulos. Un panel no tiene dueño propio en el modelo.
   */
  private async assertCanManageGame(
    game: { id: string; targetSystemId: string; viewId: string | null },
    actor: StatsResetActor,
  ) {
    if (this.isAdmin(actor)) return;

    const viewPanels = game.viewId
      ? await this.prisma.viewPanel.findMany({
          where: { viewId: game.viewId },
          select: { targetSystemId: true },
        })
      : [];
    const panelIds = [...new Set([game.targetSystemId, ...viewPanels.map((p) => p.targetSystemId)])];

    const owned = await this.prisma.module.count({
      where: { targetSystemId: { in: panelIds }, ownerId: actor.userId },
    });
    if (owned === 0) {
      throw new ForbiddenException(
        'No puede reiniciar estadísticas de esta partida: se jugó en paneles donde usted no tiene ningún módulo vinculado.',
      );
    }
  }

  async resetParticipant(
    gameId: string,
    participantId: string,
    actor: StatsResetActor,
  ): Promise<StatsResetOutcome> {
    const participant = await this.prisma.participant.findUnique({
      where: { id: participantId },
      include: {
        player: { select: { id: true, displayName: true, userId: true } },
        game: { select: { id: true, status: true, targetSystemId: true, viewId: true } },
      },
    });
    if (!participant) {
      throw new NotFoundException(`Participante ${participantId} no encontrado`);
    }
    // El identificador de partida va en la ruta a propósito: si no cuadra con el
    // del participante, el operador se ha equivocado de partida y hay que
    // pararlo antes de borrar nada.
    if (participant.gameId !== gameId) {
      throw new NotFoundException(
        `El participante ${participantId} no pertenece a la partida ${gameId}.`,
      );
    }

    const game = participant.game;
    await this.assertCanManageGame(game, actor);

    if (IN_PROGRESS_STATUSES.includes(game.status)) {
      throw new ConflictException(
        `La partida está en curso (estado «${game.status}»): termínela o abórtela antes de reiniciar la estadística, o el motor volvería a calcular los resultados que acaba de borrar.`,
      );
    }

    // Un jugador registrado puede ocupar varios puestos en la MISMA partida (el
    // de la partida y uno por ronda): reiniciarlo es reiniciarlos todos. Un
    // temporal es una identidad por puesto (§3.4), así que sólo se toca el suyo.
    const participantIds = participant.playerId
      ? (
          await this.prisma.participant.findMany({
            where: { gameId, playerId: participant.playerId },
            select: { id: true },
          })
        ).map((p) => p.id)
      : [participant.id];

    const rounds = await this.prisma.round.findMany({ where: { gameId }, select: { id: true } });
    const roundIds = rounds.map((r) => r.id);

    const notes: string[] = [];
    const outcome = await this.prisma.$transaction(async (tx) => {
      // El estado se vuelve a comprobar DENTRO de la transacción: leerlo fuera
      // dejaba una ventana para que la partida se reanudara entre la
      // comprobación y el borrado.
      const fresh = await tx.game.findUnique({ where: { id: gameId }, select: { status: true } });
      if (fresh && IN_PROGRESS_STATUSES.includes(fresh.status)) {
        throw new ConflictException(
          'La partida está en curso: el motor recalcularía lo borrado. Termínela o abórtela antes.',
        );
      }

      // ORDEN IMPORTANTE: primero se apartan los impactos y después se borran
      // los resultados. Al revés quedaba una ventana en la que un recálculo
      // concurrente (`POST /accuracy/rounds/:id/compute`) recreaba el `Result`
      // con los aciertos ORIGINALES intactos, deshaciendo el reinicio entero.
      // Con este orden, lo peor que puede recrear es un resultado a cero.
      const hits = await tx.hitEvent.updateMany({
        where: { participantId: { in: participantIds } },
        data: { participantId: null, statsResetAt: new Date() },
      });
      const results = await tx.result.deleteMany({ where: { participantId: { in: participantIds } } });
      const penalties = await tx.penalty.deleteMany({
        where: { participantId: { in: participantIds } },
      });
      const shotCounts = await tx.shotCount.deleteMany({
        where: { participantId: { in: participantIds } },
      });

      let statistics = 0;
      let globals = 0;
      if (participant.playerId) {
        const scoped = await tx.statistic.deleteMany({
          where: {
            playerId: participant.playerId,
            OR: [{ gameId }, { roundId: { in: roundIds } }],
          },
        });
        statistics = scoped.count;
        // EL ACUMULADO GLOBAL SÍ SE ESCRIBE: lo recalcula el `worker`
        // (`recomputePlayerStatistics`). Dejarlo intacto conservaba los totales
        // anteriores del jugador —y si ésta era su única partida, el worker se
        // saltaba el recálculo y quedaban congelados PARA SIEMPRE—. Se borran:
        // ausencia = no hay dato, que es la verdad hasta el próximo recálculo.
        const global = await tx.statistic.deleteMany({
          where: {
            scope: 'player',
            playerId: participant.playerId,
            gameId: null,
            roundId: null,
          },
        });
        globals = global.count;
      }

      return {
        results: results.count,
        penalties: penalties.count,
        shotCounts: shotCounts.count,
        hitsDetached: hits.count,
        statistics,
        globalsCleared: globals,
      };
    });

    const temporary = participant.playerId === null;
    if (temporary) {
      notes.push(
        'Jugador temporal: no tiene estadística acumulada (§3.4). Sólo se han borrado sus números de esta partida; no había nada global que descontar.',
      );
    } else {
      notes.push(
        'La estadística global del jugador se calcula a partir de los resultados de sus partidas: al borrar los de ésta, su acumulado deja de contarlos automáticamente. Las demás partidas no se tocan.',
      );
    }
    notes.push(
      `Los impactos registrados NO se borran: ${outcome.hitsDetached} quedan apartados del ` +
        'recuento. Siguen en la base como telemetría, pero no se atribuyen a nadie ni se ' +
        'vuelven a deducir para ningún jugador.',
    );
    if (outcome.globalsCleared > 0) {
      notes.push(
        `Se han borrado ${outcome.globalsCleared} fila(s) de estadística acumulada global de este ` +
          'jugador: contenían totales que ya no se sostienen. El worker las recalculará a partir ' +
          'de sus resultados restantes; si no le queda ninguno, no volverán a aparecer.',
      );
    }

    return {
      gameId,
      participantId,
      participantIds,
      playerId: participant.playerId,
      playerName: participant.player?.displayName ?? participant.guestName ?? `Puesto ${participant.slot}`,
      temporary,
      selfReset: participant.player?.userId != null && participant.player.userId === actor.userId,
      deleted: {
        results: outcome.results,
        penalties: outcome.penalties,
        shotCounts: outcome.shotCounts,
        statistics: outcome.statistics,
        globalStatistics: outcome.globalsCleared,
      },
      hitsDetached: outcome.hitsDetached,
      notes,
    };
  }
}
