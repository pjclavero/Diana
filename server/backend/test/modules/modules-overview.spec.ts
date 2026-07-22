import { ModulesOverviewService } from '../../src/modules/modules/modules-overview.service';
import { ROLE } from '../../src/domain/rbac/permissions';

function buildPrisma(modules: any[], latestSigned: any) {
  return {
    module: { findMany: jest.fn().mockResolvedValue(modules) },
    firmwareVersion: { findFirst: jest.fn().mockResolvedValue(latestSigned) },
  } as any;
}

const mod = (over: Partial<any> = {}) => ({
  id: 'm1', slug: 'diana-01', friendlyName: null, online: true, state: 'ready', role: 'principal',
  firmwareVersion: '1.0.0', maintenance: false, lastSeenAt: null, ownerId: 'g1', owner: null, position: null, ...over,
});

describe('ModulesOverviewService', () => {
  const admin = { userId: 'a1', role: ROLE.ADMINISTRADOR };
  const gestor = { userId: 'g1', role: ROLE.GESTOR };

  it('el admin consulta todos los módulos (where vacío)', async () => {
    const prisma = buildPrisma([mod()], { version: '1.2.0', targetBoard: 'esp32-s3' });
    await new ModulesOverviewService(prisma).overview(admin);
    expect(prisma.module.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it('un gestor sólo consulta sus módulos (where ownerId)', async () => {
    const prisma = buildPrisma([mod()], null);
    await new ModulesOverviewService(prisma).overview(gestor);
    expect(prisma.module.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerId: 'g1' } }));
  });

  it('marca updateAvailable cuando hay una versión firmada más reciente distinta a la vigente', async () => {
    const prisma = buildPrisma([mod({ firmwareVersion: '1.0.0' })], { version: '1.2.0', targetBoard: 'esp32-s3' });
    const res = await new ModulesOverviewService(prisma).overview(admin);
    expect(res.items[0].updateAvailable).toBe(true);
    expect(res.items[0].latestSignedVersion).toBe('1.2.0');
    expect(res.summary.updatesPending).toBe(1);
  });

  it('NO marca updateAvailable si el módulo ya corre la última firmada', async () => {
    const prisma = buildPrisma([mod({ firmwareVersion: '1.2.0' })], { version: '1.2.0', targetBoard: 'esp32-s3' });
    const res = await new ModulesOverviewService(prisma).overview(admin);
    expect(res.items[0].updateAvailable).toBe(false);
    expect(res.summary.updatesPending).toBe(0);
  });

  it('sin versiones firmadas, no hay actualizaciones pendientes', async () => {
    const prisma = buildPrisma([mod(), mod({ id: 'm2', online: false })], null);
    const res = await new ModulesOverviewService(prisma).overview(admin);
    expect(res.summary).toEqual({ total: 2, online: 1, offline: 1, updatesPending: 0 });
  });
});
