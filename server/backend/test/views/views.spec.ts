import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ViewsService } from '../../src/modules/views/views.service';
import { ROLE } from '../../src/domain/rbac/permissions';

const admin = { userId: 'a1', username: 'admin', role: ROLE.ADMINISTRADOR };
const gestor = { userId: 'g1', username: 'gestor', role: ROLE.GESTOR };

function view(panels: number[], ownerId: string | null = 'g1') {
  return {
    id: 'v1', name: 'Sala', description: null, ownerId, owner: null,
    panels: panels.map((moduleCount, i) => ({ targetSystemId: `s${i}`, position: i, targetSystem: { id: `s${i}`, slug: `s${i}`, name: `Panel ${i}`, _count: { modules: moduleCount } } })),
  };
}

function buildPrisma(over: any = {}) {
  return {
    view: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      create: jest.fn(({ data }: any) => Promise.resolve({ ...view([], data.ownerId), name: data.name, ownerId: data.ownerId })),
      delete: jest.fn().mockResolvedValue({}),
      ...over.view,
    },
    viewPanel: { create: jest.fn().mockResolvedValue({}), deleteMany: jest.fn().mockResolvedValue({}), ...over.viewPanel },
    targetSystem: { findUnique: jest.fn().mockResolvedValue({ id: 's1' }), ...over.targetSystem },
  } as any;
}

describe('ViewsService (G-H · Opción B)', () => {
  it('el gestor lista sus vistas y las públicas (no las ajenas)', async () => {
    const prisma = buildPrisma();
    await new ViewsService(prisma).list(gestor);
    expect(prisma.view.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { OR: [{ ownerId: 'g1' }, { ownerId: null }] } }));
  });

  it('el admin lista todas (where vacío)', async () => {
    const prisma = buildPrisma();
    await new ViewsService(prisma).list(admin);
    expect(prisma.view.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it('crea una vista propia para el gestor', async () => {
    const prisma = buildPrisma();
    const v: any = await new ViewsService(prisma).create({ name: 'Sala' }, gestor);
    expect(v.ownerId).toBe('g1');
  });

  it('nombre duplicado → 400', async () => {
    const { Prisma } = await import('@prisma/client');
    const prisma = buildPrisma({ view: { create: jest.fn().mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' })) } });
    await expect(new ViewsService(prisma).create({ name: 'Sala' }, gestor)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('un gestor no gestiona una vista ajena', async () => {
    const prisma = buildPrisma({ view: { findUnique: jest.fn().mockResolvedValue(view([9], 'otro')) } });
    await expect(new ViewsService(prisma).addPanel('v1', 's1', gestor)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('añade un panel inexistente → 404', async () => {
    const prisma = buildPrisma({ view: { findUnique: jest.fn().mockResolvedValue(view([9], 'g1')) }, targetSystem: { findUnique: jest.fn().mockResolvedValue(null) } });
    await expect(new ViewsService(prisma).addPanel('v1', 'nope', gestor)).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('dueloReadiness (cablea assertEqualSetup)', () => {
    it('lista para duelo si todos los paneles tienen los mismos módulos', async () => {
      const prisma = buildPrisma({ view: { findUnique: jest.fn().mockResolvedValue(view([9, 9])) } });
      const r = await new ViewsService(prisma).dueloReadiness('v1');
      expect(r.ready).toBe(true);
    });

    it('NO lista si los paneles tienen distinto número de módulos', async () => {
      const prisma = buildPrisma({ view: { findUnique: jest.fn().mockResolvedValue(view([9, 18])) } });
      const r = await new ViewsService(prisma).dueloReadiness('v1');
      expect(r.ready).toBe(false);
      expect(r.reason).toMatch(/mismo número/);
    });

    it('NO lista con un solo panel', async () => {
      const prisma = buildPrisma({ view: { findUnique: jest.fn().mockResolvedValue(view([9])) } });
      expect((await new ViewsService(prisma).dueloReadiness('v1')).ready).toBe(false);
    });
  });
});
