import { NotFoundException } from '@nestjs/common';
import { SystemStatusService } from '../../src/modules/systems/system-status.service';

function buildPrisma(over: any = {}) {
  return {
    targetSystem: {
      findUnique: jest.fn().mockResolvedValue({
        id: 's1',
        slug: 'panel-a',
        name: 'Panel A',
        state: 'ready',
        coordinatorModuleId: 'mod-a',
        modulesExpected: 3,
      }),
      ...over.targetSystem,
    },
    module: {
      findMany: jest.fn().mockResolvedValue([]),
      ...over.module,
    },
    game: {
      findFirst: jest.fn().mockResolvedValue(null),
      ...over.game,
    },
  } as any;
}

describe('SystemStatusService (estado compuesto + conflictos de verdad)', () => {
  it('404 si el sistema no existe', async () => {
    const prisma = buildPrisma({ targetSystem: { findUnique: jest.fn().mockResolvedValue(null) } });
    await expect(new SystemStatusService(prisma).status('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('sin módulos conflictivos: conflicts vacío, con los campos del contrato v1', async () => {
    const prisma = buildPrisma({
      module: {
        findMany: jest.fn().mockResolvedValue([
          { slug: 'a', role: 'principal', online: true, position: null },
          { slug: 'b', role: 'satellite', online: true, position: null },
          { slug: 'c', role: 'satellite', online: false, position: null },
        ]),
      },
    });
    const status = await new SystemStatusService(prisma).status('s1');
    expect(status).toEqual({
      id: 's1',
      slug: 'panel-a',
      name: 'Panel A',
      state: 'ready',
      coordinator_module_id: 'mod-a',
      modules_expected: 3,
      modules_online: 2,
      conflicts: [],
      active_game_id: null,
    });
  });

  it('dos principales en línea: conflicts incluye dual_principal', async () => {
    const prisma = buildPrisma({
      module: {
        findMany: jest.fn().mockResolvedValue([
          { slug: 'a', role: 'principal', online: true, position: null },
          { slug: 'b', role: 'principal', online: true, position: null },
        ]),
      },
    });
    const status = await new SystemStatusService(prisma).status('s1');
    expect(status.conflicts).toEqual(['dual_principal']);
  });

  it('devuelve la partida activa del sistema si hay una', async () => {
    const prisma = buildPrisma({
      game: { findFirst: jest.fn().mockResolvedValue({ id: 'g1' }) },
    });
    const status = await new SystemStatusService(prisma).status('s1');
    expect(status.active_game_id).toBe('g1');
  });
});
