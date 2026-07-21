import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ModuleOwnershipService } from '../../src/modules/modules/module-ownership.service';
import { ROLE } from '../../src/domain/rbac/permissions';

/**
 * Regla de negocio F2: un usuario con ≥1 módulo vinculado ejerce de gestor.
 * Se promociona al vincular el primer módulo a un jugador y se degrada al
 * desvincular el último. El administrador nunca se degrada por perder módulos.
 */
function buildPrisma(overrides: {
  module?: Partial<Record<string, jest.Mock>>;
  user?: Partial<Record<string, jest.Mock>>;
  roleId?: Record<string, string>;
}) {
  const roleId = overrides.roleId ?? { [ROLE.GESTOR]: 'role-gestor', [ROLE.JUGADOR]: 'role-jugador' };
  const prisma: any = {
    module: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'm1' }),
      update: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
      ...overrides.module,
    },
    user: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      ...overrides.user,
    },
    role: {
      findUniqueOrThrow: jest.fn(({ where: { name } }: any) => Promise.resolve({ id: roleId[name] ?? `role-${name}` })),
    },
    // El servicio usa this.prisma tanto fuera como dentro de la transacción:
    // ejecutamos el callback con el mismo mock.
    $transaction: jest.fn((cb: any) => cb(prisma)),
  };
  return prisma;
}

describe('ModuleOwnershipService', () => {
  const admin = { userId: 'admin-1', role: ROLE.ADMINISTRADOR };
  const gestor = { userId: 'g1', role: ROLE.GESTOR };

  describe('link', () => {
    it('promociona a gestor cuando un jugador recibe su primer módulo', async () => {
      const prisma = buildPrisma({
        module: { findUnique: jest.fn().mockResolvedValue({ id: 'm1', ownerId: null }) },
        user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', role: { name: ROLE.JUGADOR } }) },
      });
      const svc = new ModuleOwnershipService(prisma);

      await svc.link('m1', 'u1', admin);

      expect(prisma.module.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'm1' }, data: { ownerId: 'u1' } }));
      expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'u1' }, data: { roleId: 'role-gestor' } }));
    });

    it('NO cambia el rol si el destinatario ya era gestor', async () => {
      const prisma = buildPrisma({
        module: { findUnique: jest.fn().mockResolvedValue({ id: 'm1', ownerId: null }) },
        user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', role: { name: ROLE.GESTOR } }) },
      });
      const svc = new ModuleOwnershipService(prisma);

      await svc.link('m1', 'u1', admin);

      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('un no-admin no puede vincular a otro usuario', async () => {
      const prisma = buildPrisma({});
      const svc = new ModuleOwnershipService(prisma);

      await expect(svc.link('m1', 'otro-usuario', gestor)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rechaza vincular un módulo que ya tiene otro dueño', async () => {
      const prisma = buildPrisma({
        module: { findUnique: jest.fn().mockResolvedValue({ id: 'm1', ownerId: 'otro' }) },
      });
      const svc = new ModuleOwnershipService(prisma);

      await expect(svc.link('m1', 'u1', admin)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('unlink', () => {
    it('degrada a jugador al gestor que se queda sin módulos', async () => {
      const prisma = buildPrisma({
        module: {
          findUnique: jest.fn().mockResolvedValue({ id: 'm1', ownerId: 'g1' }),
          count: jest.fn().mockResolvedValue(0),
        },
        user: { findUnique: jest.fn().mockResolvedValue({ id: 'g1', role: { name: ROLE.GESTOR } }) },
      });
      const svc = new ModuleOwnershipService(prisma);

      await svc.unlink('m1', admin);

      expect(prisma.module.update).toHaveBeenCalledWith(expect.objectContaining({ data: { ownerId: null } }));
      expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'g1' }, data: { roleId: 'role-jugador' } }));
    });

    it('NO degrada si al gestor le quedan otros módulos', async () => {
      const prisma = buildPrisma({
        module: {
          findUnique: jest.fn().mockResolvedValue({ id: 'm1', ownerId: 'g1' }),
          count: jest.fn().mockResolvedValue(2),
        },
      });
      const svc = new ModuleOwnershipService(prisma);

      await svc.unlink('m1', admin);

      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('un gestor no puede desvincular un módulo que no es suyo', async () => {
      const prisma = buildPrisma({
        module: { findUnique: jest.fn().mockResolvedValue({ id: 'm1', ownerId: 'otro-gestor' }) },
      });
      const svc = new ModuleOwnershipService(prisma);

      await expect(svc.unlink('m1', gestor)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
