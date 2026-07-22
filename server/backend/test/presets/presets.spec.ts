import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { MAX_PRESETS_PER_OWNER, PresetsService } from '../../src/modules/presets/presets.service';
import { ROLE } from '../../src/domain/rbac/permissions';

function buildPrisma(over: {
  gamePreset?: Partial<Record<string, jest.Mock>>;
  gameMode?: Partial<Record<string, jest.Mock>>;
} = {}) {
  return {
    gamePreset: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn(),
      create: jest.fn(({ data }: any) => Promise.resolve({ id: 'p-new', ...data })),
      update: jest.fn(({ data }: any) => Promise.resolve({ id: 'p1', ...data })),
      delete: jest.fn().mockResolvedValue({}),
      ...over.gamePreset,
    },
    gameMode: {
      findUnique: jest.fn().mockResolvedValue({ id: 'mode-1', key: 'random' }),
      ...over.gameMode,
    },
  } as any;
}

const admin = { userId: 'a1', username: 'admin', role: ROLE.ADMINISTRADOR };
const gestor = { userId: 'g1', username: 'gestor1', role: ROLE.GESTOR };
const input = { name: 'Mi preset', mode: 'random', config: { seed: 1 } };

describe('PresetsService (G-F)', () => {
  describe('list', () => {
    it('el admin consulta todos (where vacío)', async () => {
      const prisma = buildPrisma();
      await new PresetsService(prisma).list(admin);
      expect(prisma.gamePreset.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    });

    it('el gestor ve los suyos + los de muestra', async () => {
      const prisma = buildPrisma();
      await new PresetsService(prisma).list(gestor);
      expect(prisma.gamePreset.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { OR: [{ ownerId: 'g1' }, { isSample: true }] } }),
      );
    });
  });

  describe('create', () => {
    it('el gestor crea un preset PROPIO (ownerId=él, no muestra)', async () => {
      const prisma = buildPrisma();
      const created: any = await new PresetsService(prisma).create(input, gestor);
      expect(created.ownerId).toBe('g1');
      expect(created.isSample).toBe(false);
      expect(created.createdBy).toBe('gestor1');
    });

    it('aplica el límite de 5 presets por gestor', async () => {
      const prisma = buildPrisma({ gamePreset: { count: jest.fn().mockResolvedValue(MAX_PRESETS_PER_OWNER) } });
      await expect(new PresetsService(prisma).create(input, gestor)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.gamePreset.create).not.toHaveBeenCalled();
    });

    it('el admin crea un preset de MUESTRA (isSample, sin dueño)', async () => {
      const prisma = buildPrisma();
      const created: any = await new PresetsService(prisma).create(input, admin);
      expect(created.isSample).toBe(true);
      expect(created.ownerId).toBeNull();
    });

    it('rechaza un preset de muestra con nombre ya existente (NULL owner)', async () => {
      const prisma = buildPrisma({ gamePreset: { findFirst: jest.fn().mockResolvedValue({ id: 'ya', name: 'Mi preset' }) } });
      await expect(new PresetsService(prisma).create(input, admin)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.gamePreset.create).not.toHaveBeenCalled();
    });

    it('rechaza si el modo de juego no existe', async () => {
      const prisma = buildPrisma({ gameMode: { findUnique: jest.fn().mockResolvedValue(null) } });
      await expect(new PresetsService(prisma).create(input, gestor)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('visibilidad y propiedad', () => {
    it('un gestor no puede ver un preset ajeno que no es de muestra (404)', async () => {
      const prisma = buildPrisma({ gamePreset: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', ownerId: 'otro', isSample: false }) } });
      await expect(new PresetsService(prisma).get('p1', gestor)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('un gestor sí puede ver un preset de muestra', async () => {
      const prisma = buildPrisma({ gamePreset: { findUnique: jest.fn().mockResolvedValue({ id: 's1', ownerId: null, isSample: true }) } });
      await expect(new PresetsService(prisma).get('s1', gestor)).resolves.toEqual(expect.objectContaining({ id: 's1' }));
    });

    it('un gestor no puede borrar un preset de muestra (no es suyo)', async () => {
      const prisma = buildPrisma({ gamePreset: { findUnique: jest.fn().mockResolvedValue({ id: 's1', ownerId: null, isSample: true }) } });
      await expect(new PresetsService(prisma).remove('s1', gestor)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('un gestor borra su propio preset', async () => {
      const prisma = buildPrisma({ gamePreset: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', ownerId: 'g1', isSample: false }) } });
      await expect(new PresetsService(prisma).remove('p1', gestor)).resolves.toEqual({ id: 'p1', deleted: true });
      expect(prisma.gamePreset.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
    });
  });

  describe('update', () => {
    it('un gestor no puede editar un preset ajeno', async () => {
      const prisma = buildPrisma({ gamePreset: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', ownerId: 'otro', isSample: false }) } });
      // loadVisible lo oculta antes (no es suyo ni muestra) → NotFound.
      await expect(new PresetsService(prisma).update('p1', { name: 'x' }, gestor)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('el gestor edita su propio preset', async () => {
      const prisma = buildPrisma({ gamePreset: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', ownerId: 'g1', isSample: false, name: 'viejo' }) } });
      await new PresetsService(prisma).update('p1', { name: 'nuevo' }, gestor);
      expect(prisma.gamePreset.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'p1' }, data: expect.objectContaining({ name: 'nuevo' }) }));
    });

    it('rechaza renombrar una muestra a un nombre de muestra ya existente', async () => {
      const prisma = buildPrisma({
        gamePreset: {
          findUnique: jest.fn().mockResolvedValue({ id: 's1', ownerId: null, isSample: true, name: 'viejo' }),
          findFirst: jest.fn().mockResolvedValue({ id: 's2', name: 'Otra muestra' }),
        },
      });
      await expect(new PresetsService(prisma).update('s1', { name: 'Otra muestra' }, admin)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.gamePreset.update).not.toHaveBeenCalled();
    });
  });
});
