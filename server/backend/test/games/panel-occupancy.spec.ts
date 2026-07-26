import { ConflictException } from '@nestjs/common';
import { GamesService } from '../../src/modules/games/games.service';

function buildPrisma(over: any = {}) {
  return {
    game: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      ...over.game,
    },
    viewPanel: {
      findMany: jest.fn().mockResolvedValue([]),
      ...over.viewPanel,
    },
  } as any;
}

const mqtt = {} as any;

describe('GamesService · guardarraíl un juego por panel (G-H)', () => {
  it('panel libre: no lanza y consulta sólo ese panel', async () => {
    const prisma = buildPrisma();
    const service = new GamesService(prisma, mqtt);
    await service.assertPanelsFree({ id: 'g1', targetSystemId: 's1', viewId: null });
    const where = prisma.game.findFirst.mock.calls[0][0].where;
    expect(where.id).toEqual({ not: 'g1' });
    expect(where.status).toEqual({ in: ['armed', 'running', 'paused'] });
    expect(where.OR[0]).toEqual({ targetSystemId: { in: ['s1'] } });
  });

  it('panel ocupado por otra partida activa → 409 con el nombre de la partida', async () => {
    const prisma = buildPrisma({
      game: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'g2',
          name: 'Torneo',
          status: 'running',
          targetSystem: { slug: 'panel-a' },
        }),
      },
    });
    const service = new GamesService(prisma, mqtt);
    await expect(
      service.assertPanelsFree({ id: 'g1', targetSystemId: 's1', viewId: null }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.assertPanelsFree({ id: 'g1', targetSystemId: 's1', viewId: null }),
    ).rejects.toThrow(/Torneo/);
  });

  it('partida sobre una vista: comprueba TODOS los paneles de la vista', async () => {
    const prisma = buildPrisma({
      viewPanel: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ targetSystemId: 's1' }, { targetSystemId: 's2' }]),
      },
    });
    const service = new GamesService(prisma, mqtt);
    await service.assertPanelsFree({ id: 'g1', targetSystemId: 's1', viewId: 'v1' });
    const where = prisma.game.findFirst.mock.calls[0][0].where;
    expect(where.OR[0].targetSystemId.in.sort()).toEqual(['s1', 's2']);
    // También detecta partidas de OTRAS vistas que compartan panel.
    expect(where.OR[1]).toEqual({
      view: { panels: { some: { targetSystemId: { in: where.OR[0].targetSystemId.in } } } },
    });
  });

  it('los estados draft/finished/aborted no ocupan panel', async () => {
    const prisma = buildPrisma();
    const service = new GamesService(prisma, mqtt);
    await service.assertPanelsFree({ id: 'g1', targetSystemId: 's1', viewId: null });
    const statuses = prisma.game.findFirst.mock.calls[0][0].where.status.in;
    expect(statuses).not.toContain('draft');
    expect(statuses).not.toContain('finished');
    expect(statuses).not.toContain('aborted');
  });

  it('ocupación: una partida de vista marca cada panel implicado', async () => {
    const prisma = buildPrisma({
      game: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'g1',
            name: 'Duelo',
            status: 'running',
            targetSystemId: 's1',
            viewId: 'v1',
            view: { panels: [{ targetSystemId: 's1' }, { targetSystemId: 's2' }] },
          },
          {
            id: 'g2',
            name: null,
            status: 'armed',
            targetSystemId: 's3',
            viewId: null,
            view: null,
          },
        ]),
      },
    });
    const service = new GamesService(prisma, mqtt);
    const result = await service.panelOccupancy();
    expect(result.total).toBe(3);
    expect(result.items.map((i) => i.targetSystemId).sort()).toEqual(['s1', 's2', 's3']);
    expect(result.items.filter((i) => i.gameId === 'g1')).toHaveLength(2);
  });
});
