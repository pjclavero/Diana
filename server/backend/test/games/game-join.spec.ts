import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GameJoinService } from '../../src/modules/games/game-join.service';

function build(over: { game?: any; participants?: any } = {}) {
  const prisma = {
    game: {
      findUnique: jest.fn(),
      update: jest.fn(({ data }: any) => Promise.resolve({ id: 'g1', joinCode: data.joinCode })),
      ...over.game,
    },
  } as any;
  const participants = { add: jest.fn().mockResolvedValue({ id: 'part1', guestName: 'Paco' }), ...over.participants } as any;
  return { svc: new GameJoinService(prisma, participants), prisma, participants };
}

describe('GameJoinService (G-D · unirse por QR)', () => {
  describe('ensureCode', () => {
    it('genera un código si la partida no tiene', async () => {
      const { svc, prisma } = build({ game: { findUnique: jest.fn().mockResolvedValue({ id: 'g1', joinCode: null }) } });
      const r = await svc.ensureCode('g1');
      expect(r.joinCode).toMatch(/^[A-Z2-9]{6}$/);
      expect(prisma.game.update).toHaveBeenCalled();
    });

    it('devuelve el código existente sin regenerar', async () => {
      const { svc, prisma } = build({ game: { findUnique: jest.fn().mockResolvedValue({ id: 'g1', joinCode: 'ABC234' }) } });
      const r = await svc.ensureCode('g1');
      expect(r.joinCode).toBe('ABC234');
      expect(prisma.game.update).not.toHaveBeenCalled();
    });

    it('regenera si se pide', async () => {
      const { svc, prisma } = build({ game: { findUnique: jest.fn().mockResolvedValue({ id: 'g1', joinCode: 'ABC234' }) } });
      await svc.ensureCode('g1', true);
      expect(prisma.game.update).toHaveBeenCalled();
    });

    it('404 si la partida no existe', async () => {
      const { svc } = build({ game: { findUnique: jest.fn().mockResolvedValue(null) } });
      await expect(svc.ensureCode('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('byCode', () => {
    it('devuelve la partida y joinable=true si está abierta', async () => {
      const { svc } = build({ game: { findUnique: jest.fn().mockResolvedValue({ id: 'g1', name: 'X', status: 'draft', gameMode: null }) } });
      const r = await svc.byCode('abc234');
      expect(r.joinable).toBe(true);
    });

    it('joinable=false si la partida ya terminó', async () => {
      const { svc } = build({ game: { findUnique: jest.fn().mockResolvedValue({ id: 'g1', name: 'X', status: 'finished', gameMode: null }) } });
      expect((await svc.byCode('abc234')).joinable).toBe(false);
    });

    it('404 con un código inexistente', async () => {
      const { svc } = build({ game: { findUnique: jest.fn().mockResolvedValue(null) } });
      await expect(svc.byCode('nope00')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('joinAsGuest', () => {
    it('añade un temporal si la partida admite incorporaciones', async () => {
      const { svc, participants } = build({ game: { findUnique: jest.fn().mockResolvedValue({ id: 'g1', status: 'draft' }) } });
      const r = await svc.joinAsGuest('abc234', 'Paco');
      expect(participants.add).toHaveBeenCalledWith({ gameId: 'g1', guestName: 'Paco' });
      expect(r.participantId).toBe('part1');
    });

    it('rechaza unirse a una partida terminada', async () => {
      const { svc } = build({ game: { findUnique: jest.fn().mockResolvedValue({ id: 'g1', status: 'finished' }) } });
      await expect(svc.joinAsGuest('abc234', 'Paco')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('404 con código inexistente', async () => {
      const { svc } = build({ game: { findUnique: jest.fn().mockResolvedValue(null) } });
      await expect(svc.joinAsGuest('nope00', 'Paco')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
