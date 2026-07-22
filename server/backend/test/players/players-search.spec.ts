import { PlayersSearchService } from '../../src/modules/players/players-search.service';

function buildPrisma(findMany: jest.Mock) {
  return { player: { findMany } } as any;
}

const row = (over: any = {}) => ({
  id: 'p1', displayName: 'Paco', firstName: null, lastName: null, licence: null, active: true,
  teamId: null, team: null, userId: null, user: null, ...over,
});

describe('PlayersSearchService (G-D)', () => {
  it('sin término, lista todos (where vacío)', async () => {
    const findMany = jest.fn().mockResolvedValue([row()]);
    await new PlayersSearchService(buildPrisma(findMany)).search(undefined);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it('con término, busca por nombre/apellidos/licencia/usuario (insensible)', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await new PlayersSearchService(buildPrisma(findMany)).search('pac');
    const arg = findMany.mock.calls[0][0];
    expect(arg.where.OR).toEqual(
      expect.arrayContaining([
        { displayName: { contains: 'pac', mode: 'insensitive' } },
        { user: { username: { contains: 'pac', mode: 'insensitive' } } },
      ]),
    );
  });

  it('marca registered=true cuando el jugador tiene usuario vinculado', async () => {
    const findMany = jest.fn().mockResolvedValue([
      row({ id: 'reg', userId: 'u1', user: { id: 'u1', username: 'paco' } }),
      row({ id: 'plantilla', userId: null, user: null }),
    ]);
    const res = await new PlayersSearchService(buildPrisma(findMany)).search('');
    expect(res.find((p) => p.id === 'reg')!.registered).toBe(true);
    expect(res.find((p) => p.id === 'plantilla')!.registered).toBe(false);
  });

  it('limita el take a un máximo de 500', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await new PlayersSearchService(buildPrisma(findMany)).search('x', 99999);
    expect(findMany.mock.calls[0][0].take).toBe(500);
  });

  it('un take no numérico (NaN) cae a 100 (OBS-1)', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await new PlayersSearchService(buildPrisma(findMany)).search('x', Number.NaN);
    expect(findMany.mock.calls[0][0].take).toBe(100);
  });
});
