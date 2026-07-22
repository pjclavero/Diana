import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ParticipantsService } from '../../src/modules/participants/participants.service';

const p2002 = () => new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' });

function buildPrisma(over: {
  game?: any; player?: any; participant?: Partial<Record<string, jest.Mock>>;
} = {}) {
  return {
    game: { findUnique: jest.fn().mockResolvedValue({ id: 'g1' }), ...over.game },
    player: { findUnique: jest.fn().mockResolvedValue({ id: 'pl1' }), ...over.player },
    participant: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({ id: 'part1' }),
      create: jest.fn(({ data }: any) => Promise.resolve({ id: 'new', ...data })),
      delete: jest.fn().mockResolvedValue({}),
      ...over.participant,
    },
  } as any;
}

describe('ParticipantsService (G-D.2 temporales)', () => {
  it('añade un jugador TEMPORAL (guestName, sin playerId)', async () => {
    const prisma = buildPrisma();
    const p: any = await new ParticipantsService(prisma).add({ gameId: 'g1', guestName: 'Paco' });
    expect(p.guestName).toBe('Paco');
    expect(p.playerId).toBeNull();
    expect(p.slot).toBe(1);
  });

  it('añade un jugador registrado/plantilla (playerId, sin guestName)', async () => {
    const prisma = buildPrisma();
    const p: any = await new ParticipantsService(prisma).add({ gameId: 'g1', playerId: 'pl1' });
    expect(p.playerId).toBe('pl1');
    expect(p.guestName).toBeNull();
  });

  it('rechaza si se indican AMBOS (playerId y guestName)', async () => {
    const prisma = buildPrisma();
    await expect(new ParticipantsService(prisma).add({ gameId: 'g1', playerId: 'pl1', guestName: 'Paco' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza si no se indica NINGUNO', async () => {
    const prisma = buildPrisma();
    await expect(new ParticipantsService(prisma).add({ gameId: 'g1' })).rejects.toBeInstanceOf(BadRequestException);
    // Un guestName en blanco también cuenta como "ninguno".
    await expect(new ParticipantsService(prisma).add({ gameId: 'g1', guestName: '   ' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza si la partida no existe', async () => {
    const prisma = buildPrisma({ game: { findUnique: jest.fn().mockResolvedValue(null) } });
    await expect(new ParticipantsService(prisma).add({ gameId: 'nope', guestName: 'Paco' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rechaza si el jugador no existe', async () => {
    const prisma = buildPrisma({ player: { findUnique: jest.fn().mockResolvedValue(null) } });
    await expect(new ParticipantsService(prisma).add({ gameId: 'g1', playerId: 'nope' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('asigna el slot siguiente (último 3 → 4)', async () => {
    const prisma = buildPrisma({ participant: { findFirst: jest.fn().mockResolvedValue({ slot: 3 }) } });
    const p: any = await new ParticipantsService(prisma).add({ gameId: 'g1', guestName: 'Paco' });
    expect(p.slot).toBe(4);
  });

  it('reintenta al colisionar el slot (P2002) y acaba creando (OBS supervisor)', async () => {
    const create = jest
      .fn()
      .mockRejectedValueOnce(p2002())
      .mockImplementationOnce(({ data }: any) => Promise.resolve({ id: 'ok', ...data }));
    const prisma = buildPrisma({ participant: { create } });
    const p: any = await new ParticipantsService(prisma).add({ gameId: 'g1', guestName: 'Paco' });
    expect(p.id).toBe('ok');
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('si la colisión de slot persiste, responde Conflict (no 500)', async () => {
    const create = jest.fn().mockRejectedValue(p2002());
    const prisma = buildPrisma({ participant: { create } });
    await expect(new ParticipantsService(prisma).add({ gameId: 'g1', guestName: 'Paco' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('setTeam reasigna el equipo de un participante', async () => {
    const update = jest.fn(({ data }: any) => Promise.resolve({ id: 'part1', ...data }));
    const prisma = buildPrisma({
      participant: { findUnique: jest.fn().mockResolvedValue({ id: 'part1' }), update },
      team: { findUnique: jest.fn().mockResolvedValue({ id: 't1' }) },
    } as any);
    prisma.team = { findUnique: jest.fn().mockResolvedValue({ id: 't1' }) };
    const p: any = await new ParticipantsService(prisma).setTeam('part1', 't1');
    expect(p.teamId).toBe('t1');
  });

  it('setTeam con equipo inexistente → NotFound', async () => {
    const prisma = buildPrisma({ participant: { findUnique: jest.fn().mockResolvedValue({ id: 'part1' }) } });
    prisma.team = { findUnique: jest.fn().mockResolvedValue(null) };
    await expect(new ParticipantsService(prisma).setTeam('part1', 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('listForGame marca temporary=true a los que tienen guestName', async () => {
    const prisma = buildPrisma({
      participant: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'a', guestName: 'Paco', playerId: null },
          { id: 'b', guestName: null, playerId: 'pl1' },
        ]),
      },
    });
    const list = await new ParticipantsService(prisma).listForGame('g1');
    expect(list.find((x: any) => x.id === 'a')!.temporary).toBe(true);
    expect(list.find((x: any) => x.id === 'b')!.temporary).toBe(false);
    expect(prisma.participant.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { gameId: 'g1', roundId: null } }));
  });
});
