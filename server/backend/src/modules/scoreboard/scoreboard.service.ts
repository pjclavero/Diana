import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  buildBoard,
  buildRanking,
  participantName,
  type BoardModuleInput,
  type ScoreboardHit,
} from '../../domain/scoreboard/scoreboard';

/**
 * Marcador de partida estilo máquina de dardos (G-G): resultados + estadística
 * del jugador + estado de las dianas, en una sola pantalla.
 */
@Injectable()
export class ScoreboardService {
  constructor(private readonly prisma: PrismaService) {}

  /** Ronda a mostrar: la pedida, o la última de la partida. */
  private async resolveRound(gameId: string, roundId?: string) {
    const round = roundId
      ? await this.prisma.round.findFirst({ where: { id: roundId, gameId } })
      : await this.prisma.round.findFirst({ where: { gameId }, orderBy: { roundIndex: 'desc' } });
    if (roundId && !round) {
      throw new NotFoundException(`Ronda ${roundId} no pertenece a la partida ${gameId}`);
    }
    return round;
  }

  /** Paneles implicados: los de la vista, o el panel único de la partida. */
  private async panelsOfGame(game: { targetSystemId: string; viewId: string | null }) {
    if (!game.viewId) return [game.targetSystemId];
    const panels = await this.prisma.viewPanel.findMany({
      where: { viewId: game.viewId },
      select: { targetSystemId: true },
    });
    return [...new Set([game.targetSystemId, ...panels.map((p) => p.targetSystemId)])];
  }

  async forGame(gameId: string, roundId?: string) {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      include: {
        gameMode: { select: { key: true, name: true } },
        targetSystem: { select: { id: true, slug: true, name: true } },
      },
    });
    if (!game) throw new NotFoundException(`Partida ${gameId} no encontrada`);

    const round = await this.resolveRound(gameId, roundId);

    const participants = await this.prisma.participant.findMany({
      where: { gameId },
      orderBy: { slot: 'asc' },
      include: {
        player: { select: { id: true, displayName: true } },
        team: { select: { name: true } },
      },
    });

    const hitRows = round
      ? await this.prisma.hitEvent.findMany({
          where: { roundId: round.id },
          orderBy: { deviceEventUs: 'asc' },
          select: {
            participantId: true,
            moduleSlug: true,
            targetIndex: true,
            classification: true,
            countsForScore: true,
            statsResetAt: true,
            coordinatorElapsedUs: true,
          },
        })
      : [];
    const hits: ScoreboardHit[] = hitRows.map((h) => ({
      participantId: h.participantId,
      moduleSlug: h.moduleSlug,
      targetIndex: h.targetIndex,
      classification: h.classification,
      countsForScore: h.countsForScore,
      statsResetAt: h.statsResetAt,
      elapsedUs: h.coordinatorElapsedUs === null ? null : Number(h.coordinatorElapsedUs),
    }));

    /** Los que siguen contando: sin la marca que deja un reinicio. */
    const contados = hits.filter((h) => h.statsResetAt == null);

    const resultRows = round
      ? await this.prisma.result.findMany({ where: { roundId: round.id } })
      : [];

    const rankingResult = buildRanking(
      participants.map((p) => ({
        id: p.id,
        slot: p.slot,
        playerId: p.playerId,
        displayName: p.player?.displayName ?? null,
        guestName: p.guestName,
        teamName: p.team?.name ?? null,
      })),
      resultRows.map((r) => ({
        participantId: r.participantId,
        validHits: r.validHits,
        invalidHits: r.invalidHits,
        totalTimeUs: r.totalTimeUs === null ? null : Number(r.totalTimeUs),
        penaltiesMs: r.penaltiesMs,
        accuracyValid: r.accuracyValid,
        accuracyStatus: r.accuracyStatus,
      })),
      hits,
    );

    // Dianas de TODOS los paneles de la partida: si se juega sobre una vista
    // (G-H), la rejilla debe incluir los demás paneles o faltarían aciertos
    // reales sin decirlo.
    const panelIds = await this.panelsOfGame(game);
    const modules = await this.prisma.module.findMany({
      where: { targetSystemId: { in: panelIds } },
      select: {
        slug: true,
        targetSystemId: true,
        targetSystem: { select: { id: true, name: true } },
        position: { select: { x: true, y: true } },
        targets: { select: { targetIndex: true } },
      },
      orderBy: { slug: 'asc' },
    });
    const boardInput: BoardModuleInput[] = modules.map((m) => ({
      moduleSlug: m.slug,
      targetSystemId: m.targetSystemId ?? game.targetSystemId,
      // Con varios paneles, la coordenada sólo se entiende junto al panel.
      panelName: m.targetSystem?.name ?? game.targetSystem.name,
      x: m.position?.x ?? null,
      y: m.position?.y ?? null,
      targetIndexes: m.targets.map((t) => t.targetIndex),
    }));

    return {
      game: {
        id: game.id,
        name: game.name,
        status: game.status,
        mode: { key: game.gameMode.key, name: game.gameMode.name },
        panel: game.targetSystem,
      },
      round: round
        ? { id: round.id, index: round.roundIndex, phase: round.phase, mode: round.mode }
        : null,
      panels: panelIds,
      multiPanel: panelIds.length > 1,
      ranking: rankingResult.entries,
      warnings: rankingResult.warnings,
      // Los impactos apartados por un reinicio quedan FUERA del recuento y de
      // la rejilla, que es justo lo que el panel promete al confirmarlo. Antes
      // sólo salían del ranking: el operador leía «4 válidos» que ya no eran de
      // nadie, con la fila del jugador a cero y las dianas encendidas.
      board: buildBoard(boardInput, contados),
      totals: {
        detected: contados.length,
        valid: contados.filter((h) => h.countsForScore).length,
        invalid: contados.filter((h) => !h.countsForScore).length,
        unattributed: rankingResult.unattributedHits,
        inferred: rankingResult.inferredHits,
        // Los apartados no desaparecen: se declaran aparte. Son telemetría real
        // del firmware y ocultarlos sería tan falso como contarlos.
        reset: rankingResult.resetHits,
      },
    };
  }

  /**
   * Histórico del jugador que ocupa un participante. Un temporal (§3.4) no
   * acumula estadística: se devuelve explícitamente, no un cero engañoso.
   */
  async forParticipant(participantId: string) {
    const participant = await this.prisma.participant.findUnique({
      where: { id: participantId },
      include: { player: { select: { id: true, displayName: true } } },
    });
    if (!participant) throw new NotFoundException(`Participante ${participantId} no encontrado`);

    const name = participantName({
      id: participant.id,
      slot: participant.slot,
      playerId: participant.playerId,
      displayName: participant.player?.displayName ?? null,
      guestName: participant.guestName,
      teamName: null,
    });

    if (!participant.playerId) {
      return {
        participantId,
        name,
        temporary: true,
        history: null,
        note: 'Jugador temporal: no acumula estadística histórica.',
      };
    }

    const results = await this.prisma.result.findMany({
      where: { participant: { playerId: participant.playerId } },
      orderBy: { computedAt: 'desc' },
      take: 20,
      select: {
        roundId: true,
        validHits: true,
        invalidHits: true,
        totalTimeUs: true,
        accuracyValid: true,
        accuracyStatus: true,
        computedAt: true,
      },
    });
    const computable = results.filter((r) => r.accuracyStatus === 'computed');
    const averageAccuracy =
      computable.length > 0
        ? Math.round(
            (computable.reduce((acc, r) => acc + (r.accuracyValid ?? 0), 0) / computable.length) * 100,
          ) / 100
        : null;
    const bestTimeUs = results.reduce<number | null>((best, r) => {
      if (r.totalTimeUs === null) return best;
      const value = Number(r.totalTimeUs);
      return best === null ? value : Math.min(best, value);
    }, null);

    return {
      participantId,
      name,
      temporary: false,
      history: {
        playerId: participant.playerId,
        rounds: results.length,
        totalValidHits: results.reduce((acc, r) => acc + r.validHits, 0),
        averageAccuracyValid: averageAccuracy,
        roundsWithoutAccuracy: results.length - computable.length,
        bestTimeUs,
        recent: results.map((r) => ({
          roundId: r.roundId,
          validHits: r.validHits,
          invalidHits: r.invalidHits,
          totalTimeUs: r.totalTimeUs === null ? null : Number(r.totalTimeUs),
          accuracyValid: r.accuracyStatus === 'computed' ? r.accuracyValid : null,
          computedAt: r.computedAt,
        })),
      },
      note: null,
    };
  }
}
