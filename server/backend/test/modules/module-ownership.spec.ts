import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ModuleOwnershipService } from '../../src/modules/modules/module-ownership.service';
import { ROLE } from '../../src/domain/rbac/permissions';

/**
 * Regla de negocio F2 + F5: poseer un módulo es condición para ejercer de
 * gestor, pero **vender no es ascender**. Vincular abre un código de activación
 * (§3.1); el acceso de gestor queda activo cuando el comprador lo introduce.
 * Se degrada al desvincular el último módulo, y entonces sus códigos pendientes
 * dejan de valer. El administrador nunca se degrada por perder módulos.
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

/** Doble del servicio de ascensos: aquí sólo interesa que se le llame. */
function buildActivations() {
  return {
    open: jest.fn().mockResolvedValue({
      id: 'act-1',
      expiresAt: new Date('2026-07-27T10:00:00Z'),
      dispatchNote: 'SMTP sin configurar',
    }),
    revokePendingFor: jest.fn().mockResolvedValue(1),
  } as any;
}

describe('ModuleOwnershipService', () => {
  const admin = { userId: 'admin-1', role: ROLE.ADMINISTRADOR };
  const gestor = { userId: 'g1', role: ROLE.GESTOR };

  describe('link', () => {
    it('vender NO asciende: abre un código de activación y el rol NO cambia', async () => {
      const prisma = buildPrisma({
        module: { findUnique: jest.fn().mockResolvedValue({ id: 'm1', ownerId: null }) },
        user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', role: { name: ROLE.JUGADOR } }) },
      });
      const activations = buildActivations();
      const svc = new ModuleOwnershipService(prisma, activations);

      const result = await svc.link('m1', 'u1', admin);

      expect(prisma.module.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'm1' }, data: { ownerId: 'u1' } }));
      // Antes esto ascendía a gestor en el acto, sin que el comprador aceptara
      // nada y sin que quedara constancia de habérselo comunicado.
      expect(prisma.user.update).not.toHaveBeenCalled();
      // El cuarto argumento es el cliente de la transacción (ver la prueba de
      // atomicidad más abajo): la venta y el código se escriben juntos.
      expect(activations.open).toHaveBeenCalledWith('u1', 'm1', 'admin-1', expect.anything());
      expect((result as any).activation.note).toMatch(/NO es gestor todavía/);
    });

    it('a quien ya es gestor no se le abre ningún ascenso nuevo', async () => {
      const prisma = buildPrisma({
        module: { findUnique: jest.fn().mockResolvedValue({ id: 'm1', ownerId: null }) },
        user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', role: { name: ROLE.GESTOR } }) },
      });
      const activations = buildActivations();
      const svc = new ModuleOwnershipService(prisma, activations);

      await svc.link('m1', 'u1', admin);

      expect(prisma.user.update).not.toHaveBeenCalled();
      // `open` decide por sí mismo que no procede; aquí se comprueba que se le
      // consulta siempre, para que esa decisión viva en un solo sitio.
      expect(activations.open).toHaveBeenCalled();
    });

    it('un no-admin no puede vincular a otro usuario', async () => {
      const prisma = buildPrisma({});
      const activations = buildActivations();
      const svc = new ModuleOwnershipService(prisma, activations);

      await expect(svc.link('m1', 'otro-usuario', gestor)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rechaza vincular un módulo que ya tiene otro dueño', async () => {
      const prisma = buildPrisma({
        module: { findUnique: jest.fn().mockResolvedValue({ id: 'm1', ownerId: 'otro' }) },
      });
      const activations = buildActivations();
      const svc = new ModuleOwnershipService(prisma, activations);

      await expect(svc.link('m1', 'u1', admin)).rejects.toBeInstanceOf(BadRequestException);
    });

    /**
     * La rama de REPARACIÓN no la tocaba ninguna prueba: se podía anular entera
     * (`const repaired = null`) con la suite completa en verde. Es la red que
     * recoge una venta a medias —módulo asignado, código nunca creado—, que
     * dejaba al comprador poseyendo un módulo que no podía activar.
     */
    it('revincular al MISMO dueño repara el código que faltaba', async () => {
      const prisma = buildPrisma({
        module: { findUnique: jest.fn().mockResolvedValue({ id: 'm1', ownerId: 'u1' }) },
      });
      const activations = buildActivations();
      const svc = new ModuleOwnershipService(prisma, activations);

      const res: any = await svc.link('m1', 'u1', admin);

      expect(activations.open).toHaveBeenCalledWith('u1', 'm1', 'admin-1');
      expect(res.activation).not.toBeNull();
      expect(res.activation.id).toBe('act-1');
      // No se reasigna nada: ya era suyo.
      expect(prisma.module.update).not.toHaveBeenCalled();
    });

    it('si al revincular ya tenía código vigente, no se inventa otro', async () => {
      // `open` es idempotente: devuelve el pendiente. Aquí se comprueba que
      // `link` respeta esa respuesta en vez de forzar uno nuevo.
      const prisma = buildPrisma({
        module: { findUnique: jest.fn().mockResolvedValue({ id: 'm1', ownerId: 'u1' }) },
      });
      const activations = buildActivations();
      const svc = new ModuleOwnershipService(prisma, activations);

      await svc.link('m1', 'u1', admin);
      expect(activations.open).toHaveBeenCalledTimes(1);
    });

    it('a un rol que no se asciende se le vende el módulo SIN código', async () => {
      // `open` devuelve null (no es jugador). La venta debe completarse igual y
      // decirlo, en vez de reventar o de afirmar que hay un código.
      const prisma = buildPrisma({
        module: { findUnique: jest.fn().mockResolvedValue({ id: 'm1', ownerId: null }) },
        user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', role: { name: ROLE.OPERADOR } }) },
      });
      const activations = buildActivations();
      activations.open.mockResolvedValue(null);
      const svc = new ModuleOwnershipService(prisma, activations);

      const res: any = await svc.link('m1', 'u1', admin);
      expect(res.activation).toBeNull();
      expect(prisma.module.update).toHaveBeenCalled();
    });

    /**
     * ATOMICIDAD: vender y abrir el código son un solo acto. Si se hacen por
     * separado, un fallo entre medias deja el módulo vendido y sin código.
     */
    it('la venta y la apertura del código ocurren DENTRO de la misma transacción', async () => {
      const prisma = buildPrisma({
        module: { findUnique: jest.fn().mockResolvedValue({ id: 'm1', ownerId: null }) },
        user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', role: { name: ROLE.JUGADOR } }) },
      });
      const activations = buildActivations();
      const svc = new ModuleOwnershipService(prisma, activations);

      await svc.link('m1', 'u1', admin);

      expect(prisma.$transaction).toHaveBeenCalled();
      // `open` recibe el cliente de la transacción como cuarto argumento: sin
      // él escribiría fuera y la atomicidad sería decorativa.
      expect(activations.open.mock.calls[0][3]).toBeDefined();
    });

    it('si abrir el código falla, la venta NO queda escrita', async () => {
      const prisma = buildPrisma({
        module: { findUnique: jest.fn().mockResolvedValue({ id: 'm1', ownerId: null }) },
        user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', role: { name: ROLE.JUGADOR } }) },
      });
      // Una transacción real revierte lo escrito cuando el callback lanza.
      const escrituras: string[] = [];
      prisma.$transaction = jest.fn(async (cb: any) => {
        try {
          return await cb({
            ...prisma,
            module: {
              ...prisma.module,
              update: jest.fn(async () => {
                escrituras.push('venta');
                return {};
              }),
            },
          });
        } catch (e) {
          escrituras.length = 0; // revertido
          throw e;
        }
      });
      const activations = buildActivations();
      activations.open.mockRejectedValue(new Error('BD caída'));
      const svc = new ModuleOwnershipService(prisma, activations);

      await expect(svc.link('m1', 'u1', admin)).rejects.toThrow('BD caída');
      expect(escrituras).toEqual([]);
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
      const activations = buildActivations();
      const svc = new ModuleOwnershipService(prisma, activations);

      await svc.unlink('m1', admin);

      expect(prisma.module.update).toHaveBeenCalledWith(expect.objectContaining({ data: { ownerId: null } }));
      expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'g1' }, data: { roleId: 'role-jugador' } }));
      // Un código vivo de quien ya no posee nada ascendería a alguien sin motivo.
      expect(activations.revokePendingFor).toHaveBeenCalledWith('g1');
    });

    it('NO degrada si al gestor le quedan otros módulos', async () => {
      const prisma = buildPrisma({
        module: {
          findUnique: jest.fn().mockResolvedValue({ id: 'm1', ownerId: 'g1' }),
          count: jest.fn().mockResolvedValue(2),
        },
      });
      const activations = buildActivations();
      const svc = new ModuleOwnershipService(prisma, activations);

      await svc.unlink('m1', admin);

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(activations.revokePendingFor).not.toHaveBeenCalled();
    });

    it('un gestor no puede desvincular un módulo que no es suyo', async () => {
      const prisma = buildPrisma({
        module: { findUnique: jest.fn().mockResolvedValue({ id: 'm1', ownerId: 'otro-gestor' }) },
      });
      const activations = buildActivations();
      const svc = new ModuleOwnershipService(prisma, activations);

      await expect(svc.unlink('m1', gestor)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
