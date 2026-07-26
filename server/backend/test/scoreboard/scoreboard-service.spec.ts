import { NotFoundException } from '@nestjs/common';
import { ScoreboardService } from '../../src/modules/scoreboard/scoreboard.service';

const GAME = {
  id: 'g1',
  name: 'Torneo',
  status: 'running',
  targetSystemId: 's1',
  gameMode: { key: 'sequence', name: 'Secuencia' },
  targetSystem: { id: 's1', slug: 'panel-a', name: 'Panel A' },
};

function buildPrisma(over: any = {}) {
  return {
    game: { findUnique: jest.fn().mockResolvedValue(GAME), ...over.game },
    round: {
      findFirst: jest.fn().mockResolvedValue({ id: 'r2', roundIndex: 2, phase: 'finished', mode: 'sequence' }),
      ...over.round,
    },
    participant: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'p1', slot: 1, playerId: 'pl1', guestName: null, player: { id: 'pl1', displayName: 'Ana' }, team: { name: 'Rojo' } },
      ]),
      findUnique: jest.fn().mockResolvedValue({
        id: 'p1',
        slot: 1,
        playerId: 'pl1',
        guestName: null,
        player: { id: 'pl1', displayName: 'Ana' },
      }),
      ...over.participant,
    },
    hitEvent: { findMany: jest.fn().mockResolvedValue([]), ...over.hitEvent },
    viewPanel: { findMany: jest.fn().mockResolvedValue([]), ...over.viewPanel },
    result: { findMany: jest.fn().mockResolvedValue([]), ...over.result },
    module: {
      findMany: jest.fn().mockResolvedValue([
        {
          slug: 'mod-a',
          targetSystemId: 's1',
          targetSystem: { id: 's1', name: 'Panel A' },
          position: { x: 0, y: 0 },
          targets: [{ targetIndex: 1 }, { targetIndex: 2 }],
        },
      ]),
      ...over.module,
    },
  } as any;
}

describe('ScoreboardService (G-G)', () => {
  it('partida inexistente → 404', async () => {
    const prisma = buildPrisma({ game: { findUnique: jest.fn().mockResolvedValue(null) } });
    await expect(new ScoreboardService(prisma).forGame('gX')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sin round_id usa la última ronda de la partida', async () => {
    const prisma = buildPrisma();
    await new ScoreboardService(prisma).forGame('g1');
    expect(prisma.round.findFirst).toHaveBeenCalledWith({
      where: { gameId: 'g1' },
      orderBy: { roundIndex: 'desc' },
    });
  });

  it('una ronda de otra partida → 404 (no se cuela el marcador ajeno)', async () => {
    const prisma = buildPrisma({ round: { findFirst: jest.fn().mockResolvedValue(null) } });
    await expect(new ScoreboardService(prisma).forGame('g1', 'r9')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    // El acotado tiene que ser POR PARTIDA, no sólo por id de ronda: sin `gameId`
    // se podría leer el marcador de una ronda ajena.
    expect(prisma.round.findFirst).toHaveBeenCalledWith({ where: { id: 'r9', gameId: 'g1' } });
  });

  it('partida sobre una VISTA: la rejilla incluye las dianas de todos sus paneles', async () => {
    const prisma = buildPrisma({
      game: {
        findUnique: jest.fn().mockResolvedValue({ ...GAME, viewId: 'v1' }),
      },
      viewPanel: {
        findMany: jest.fn().mockResolvedValue([{ targetSystemId: 's1' }, { targetSystemId: 's2' }]),
      },
    });
    const board = await new ScoreboardService(prisma).forGame('g1');
    expect(board.panels.sort()).toEqual(['s1', 's2']);
    expect(prisma.module.findMany.mock.calls[0][0].where.targetSystemId.in.sort()).toEqual([
      's1',
      's2',
    ]);
  });

  it('impactos sin atribuir con varios jugadores: se declaran, no se reparten', async () => {
    const prisma = buildPrisma({
      participant: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'p1', slot: 1, playerId: 'pl1', guestName: null, player: { id: 'pl1', displayName: 'Ana' }, team: null },
          { id: 'p2', slot: 2, playerId: null, guestName: 'Invitado', player: null, team: null },
        ]),
      },
      hitEvent: {
        findMany: jest.fn().mockResolvedValue([
          { participantId: null, moduleSlug: 'mod-a', targetIndex: 1, classification: 'valid_hit', countsForScore: true, coordinatorElapsedUs: BigInt(1000) },
        ]),
      },
    });
    const board = await new ScoreboardService(prisma).forGame('g1');
    expect(board.totals).toMatchObject({ detected: 1, valid: 1, unattributed: 1 });
    expect(board.ranking.every((r) => r.validHits === null)).toBe(true);
    expect(board.warnings.join(' ')).toMatch(/no están atribuidos/);
  });

  it('partida sin ninguna ronda: marcador vacío, sin impactos inventados', async () => {
    const prisma = buildPrisma({ round: { findFirst: jest.fn().mockResolvedValue(null) } });
    const board = await new ScoreboardService(prisma).forGame('g1');
    expect(board.round).toBeNull();
    expect(prisma.hitEvent.findMany).not.toHaveBeenCalled();
    expect(board.totals).toEqual({ detected: 0, valid: 0, invalid: 0, unattributed: 0, inferred: 0 });
    expect(board.ranking[0]).toMatchObject({ name: 'Ana', validHits: 0 });
  });

  it('convierte los BigInt de tiempo a número y reparte impactos válidos/inválidos', async () => {
    const prisma = buildPrisma({
      hitEvent: {
        findMany: jest.fn().mockResolvedValue([
          { participantId: 'p1', moduleSlug: 'mod-a', targetIndex: 1, classification: 'valid_hit', countsForScore: true, coordinatorElapsedUs: BigInt(1500) },
          { participantId: 'p1', moduleSlug: 'mod-a', targetIndex: 2, classification: 'crosstalk_rejected', countsForScore: false, coordinatorElapsedUs: null },
        ]),
      },
    });
    const board = await new ScoreboardService(prisma).forGame('g1');
    expect(board.totals).toEqual({ detected: 2, valid: 1, invalid: 1, unattributed: 0, inferred: 0 });
    expect(board.ranking[0]).toMatchObject({ validHits: 1, invalidHits: 1, totalTimeUs: 1500 });
    expect(board.board[0].targets[0].state).toBe('hit');
    expect(board.board[0].targets[1].state).toBe('invalid');
  });

  it('el histórico de un temporal se declara inexistente, no cero', async () => {
    const prisma = buildPrisma({
      participant: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'p2',
          slot: 2,
          playerId: null,
          guestName: 'Invitado',
          player: null,
        }),
      },
    });
    const stats = await new ScoreboardService(prisma).forParticipant('p2');
    expect(stats).toMatchObject({ name: 'Invitado', temporary: true, history: null });
    expect(stats.note).toMatch(/no acumula estadística/i);
    expect(prisma.result.findMany).not.toHaveBeenCalled();
  });

  it('el histórico promedia sólo lo calculable y saca el mejor tiempo', async () => {
    const prisma = buildPrisma({
      result: {
        findMany: jest.fn().mockResolvedValue([
          { roundId: 'r1', validHits: 4, invalidHits: 1, totalTimeUs: BigInt(8000), accuracyValid: 0.8, accuracyStatus: 'computed', computedAt: new Date() },
          { roundId: 'r2', validHits: 2, invalidHits: 0, totalTimeUs: BigInt(5000), accuracyValid: 0.6, accuracyStatus: 'not_computable', computedAt: new Date() },
        ]),
      },
    });
    const stats = await new ScoreboardService(prisma).forParticipant('p1');
    expect(stats.history).toMatchObject({
      rounds: 2,
      totalValidHits: 6,
      averageAccuracyValid: 0.8,
      roundsWithoutAccuracy: 1,
      bestTimeUs: 5000,
    });
    // La ronda sin precisión calculable no muestra un número inventado.
    expect(stats.history!.recent[1].accuracyValid).toBeNull();
  });

  it('participante inexistente → 404', async () => {
    const prisma = buildPrisma({ participant: { findUnique: jest.fn().mockResolvedValue(null) } });
    await expect(new ScoreboardService(prisma).forParticipant('pX')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
