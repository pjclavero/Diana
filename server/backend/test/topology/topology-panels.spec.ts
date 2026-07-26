import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TopologyPanelsService } from '../../src/modules/topology/topology-panels.service';

const SYSTEM = { id: '11111111-1111-4111-8111-111111111111', slug: 'panel-a', name: 'Panel A' };

function buildPrisma(over: any = {}) {
  return {
    targetSystem: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(SYSTEM),
      ...over.targetSystem,
    },
    module: {
      findMany: jest.fn().mockResolvedValue([{ id: 'm-a', slug: 'mod-a', targetSystemId: SYSTEM.id }]),
      ...over.module,
    },
    modulePosition: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
      ...over.modulePosition,
    },
    $transaction: jest.fn().mockResolvedValue([]),
  } as any;
}

describe('TopologyPanelsService · matriz real por panel (X-21)', () => {
  it('busca por UUID cuando el parámetro es un UUID, y por slug si no', async () => {
    const prisma = buildPrisma();
    await new TopologyPanelsService(prisma).getPanel(SYSTEM.id);
    expect(prisma.targetSystem.findUnique.mock.calls[0][0].where).toEqual({ id: SYSTEM.id });

    const prisma2 = buildPrisma();
    await new TopologyPanelsService(prisma2).getPanel('panel-a');
    expect(prisma2.targetSystem.findUnique.mock.calls[0][0].where).toEqual({ slug: 'panel-a' });
  });

  it('panel inexistente → 404', async () => {
    const prisma = buildPrisma({ targetSystem: { findUnique: jest.fn().mockResolvedValue(null) } });
    await expect(new TopologyPanelsService(prisma).getPanel('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('devuelve slots colocados y módulos sin colocar', async () => {
    const prisma = buildPrisma({
      modulePosition: {
        findMany: jest.fn().mockResolvedValue([
          {
            moduleId: 'm-a',
            x: 0,
            y: 0,
            rotation: 90,
            module: { id: 'm-a', slug: 'mod-a', friendlyName: 'A', online: true },
          },
        ]),
      },
      module: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'm-a', slug: 'mod-a', friendlyName: 'A', online: true },
          { id: 'm-b', slug: 'mod-b', friendlyName: 'B', online: false },
        ]),
      },
    });
    const panel = await new TopologyPanelsService(prisma).getPanel(SYSTEM.id);
    expect(panel.slots).toEqual([
      { module_id: 'm-a', slug: 'mod-a', name: 'A', online: true, x: 0, y: 0, rotation: 90 },
    ]);
    expect(panel.unassigned.map((m: any) => m.id)).toEqual(['m-b']);
  });

  it('guardar reemplaza la matriz completa dentro de una transacción', async () => {
    const prisma = buildPrisma();
    await new TopologyPanelsService(prisma).savePanel(
      SYSTEM.id,
      [
        { module_id: 'm-a', x: -1, y: 1, rotation: 180 },
        { module_id: null, x: 0, y: 0 },
      ],
      'gestor',
    );
    const ops = prisma.$transaction.mock.calls[0][0];
    expect(ops).toHaveLength(2); // deleteMany + 1 create (la casilla vacía no crea nada)
    expect(prisma.modulePosition.create.mock.calls[0][0].data).toMatchObject({
      moduleId: 'm-a',
      x: -1,
      y: 1,
      rotation: 180,
      assignedBy: 'gestor',
    });
  });

  it('rechaza coordenadas fuera de la rejilla 3×3', async () => {
    const prisma = buildPrisma();
    await expect(
      new TopologyPanelsService(prisma).savePanel(SYSTEM.id, [{ module_id: 'm-a', x: 2, y: 0 }]),
    ).rejects.toThrow(/fuera de la rejilla/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rechaza dos módulos en la misma casilla y el mismo módulo dos veces', async () => {
    const service = new TopologyPanelsService(buildPrisma());
    await expect(
      service.savePanel(SYSTEM.id, [
        { module_id: 'm-a', x: 0, y: 0 },
        { module_id: 'm-b', x: 0, y: 0 },
      ]),
    ).rejects.toThrow(/misma casilla/);
    await expect(
      service.savePanel(SYSTEM.id, [
        { module_id: 'm-a', x: 0, y: 0 },
        { module_id: 'm-a', x: 1, y: 0 },
      ]),
    ).rejects.toThrow(/dos veces/);
  });

  it('rechaza colocar un módulo de otro panel', async () => {
    const prisma = buildPrisma({
      module: {
        findMany: jest.fn().mockResolvedValue([{ id: 'm-a', targetSystemId: 'otro-panel' }]),
      },
    });
    await expect(
      new TopologyPanelsService(prisma).savePanel(SYSTEM.id, [{ module_id: 'm-a', x: 0, y: 0 }]),
    ).rejects.toThrow(/no pertenece a este panel/);
  });

  it('rechaza un módulo inexistente', async () => {
    const prisma = buildPrisma({ module: { findMany: jest.fn().mockResolvedValue([]) } });
    await expect(
      new TopologyPanelsService(prisma).savePanel(SYSTEM.id, [{ module_id: 'm-x', x: 0, y: 0 }]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lista paneles con recuento de módulos y colocados', async () => {
    const prisma = buildPrisma({
      targetSystem: {
        findMany: jest.fn().mockResolvedValue([
          {
            ...SYSTEM,
            modulesExpected: 9,
            _count: { modules: 4, positions: 3 },
          },
        ]),
      },
    });
    const result = await new TopologyPanelsService(prisma).listPanels();
    expect(result.items[0]).toMatchObject({ slug: 'panel-a', moduleCount: 4, placedCount: 3 });
  });
});
