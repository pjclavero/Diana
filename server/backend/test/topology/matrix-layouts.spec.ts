import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { MatrixLayoutsService } from '../../src/modules/matrix-layouts/matrix-layouts.service';
import { ROLE } from '../../src/domain/rbac/permissions';

const admin = { userId: 'a1', username: 'admin', role: ROLE.ADMINISTRADOR };
const gestor = { userId: 'g1', username: 'gestor', role: ROLE.GESTOR };
const otro = { userId: 'g2', username: 'otro', role: ROLE.GESTOR };

const cells = [
  { slug: 'mod-a', x: 0, y: 0, rotation: 0 },
  { slug: 'mod-b', x: 1, y: 0, rotation: 90 },
];

function layoutRow(over: any = {}) {
  return {
    id: 'l1',
    name: 'Fila baja',
    description: null,
    ownerId: 'g1',
    originSystemId: 's1',
    cells,
    favorite: false,
    createdAt: new Date('2026-07-26T10:00:00Z'),
    ...over,
  };
}

function buildPrisma(over: any = {}) {
  return {
    matrixLayout: {
      findMany: jest.fn().mockResolvedValue([layoutRow()]),
      findUnique: jest.fn().mockResolvedValue(layoutRow()),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(({ data }: any) => Promise.resolve(layoutRow({ ...data }))),
      update: jest.fn(({ data }: any) => Promise.resolve(layoutRow(data))),
      delete: jest.fn().mockResolvedValue({}),
      ...over.matrixLayout,
    },
    targetSystem: { findUnique: jest.fn().mockResolvedValue({ id: 's1' }), ...over.targetSystem },
    module: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { id: 'm-a', slug: 'mod-a' },
          { id: 'm-b', slug: 'mod-b' },
        ]),
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

describe('MatrixLayoutsService · matrices favoritas (G-H)', () => {
  it('el gestor sólo ve las suyas y las públicas; el admin todas', async () => {
    const prisma = buildPrisma();
    await new MatrixLayoutsService(prisma).list(gestor);
    expect(prisma.matrixLayout.findMany.mock.calls[0][0].where).toEqual({
      OR: [{ ownerId: 'g1' }, { ownerId: null }],
    });

    const prisma2 = buildPrisma();
    await new MatrixLayoutsService(prisma2).list(admin);
    expect(prisma2.matrixLayout.findMany.mock.calls[0][0].where).toEqual({});
  });

  it('las favoritas se listan primero', async () => {
    const prisma = buildPrisma();
    await new MatrixLayoutsService(prisma).list(gestor);
    expect(prisma.matrixLayout.findMany.mock.calls[0][0].orderBy).toEqual([
      { favorite: 'desc' },
      { name: 'asc' },
    ]);
  });

  it('guarda una matriz con dueño y nombre normalizado', async () => {
    const prisma = buildPrisma();
    const saved: any = await new MatrixLayoutsService(prisma).create(
      { name: '  Fila baja  ', cells },
      gestor,
    );
    expect(prisma.matrixLayout.create.mock.calls[0][0].data.name).toBe('Fila baja');
    expect(prisma.matrixLayout.create.mock.calls[0][0].data.ownerId).toBe('g1');
    expect(saved.moduleCount).toBe(2);
  });

  it('rechaza dos módulos en la misma casilla', async () => {
    const prisma = buildPrisma();
    await expect(
      new MatrixLayoutsService(prisma).create(
        { name: 'Mala', cells: [{ slug: 'a', x: 0, y: 0, rotation: 0 }, { slug: 'b', x: 0, y: 0, rotation: 0 }] },
        gestor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.matrixLayout.create).not.toHaveBeenCalled();
  });

  it('rechaza matriz vacía y coordenadas no enteras', async () => {
    const service = new MatrixLayoutsService(buildPrisma());
    await expect(service.create({ name: 'X', cells: [] }, gestor)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.create({ name: 'X', cells: [{ slug: 'a', x: 0.5, y: 0, rotation: 0 }] }, gestor),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('respeta el máximo de 20 matrices por dueño', async () => {
    const prisma = buildPrisma({ matrixLayout: { count: jest.fn().mockResolvedValue(20) } });
    await expect(
      new MatrixLayoutsService(prisma).create({ name: 'Otra', cells }, gestor),
    ).rejects.toThrow(/máximo de 20/);
  });

  it('nombre duplicado → 400 legible', async () => {
    const { Prisma } = await import('@prisma/client');
    const prisma = buildPrisma({
      matrixLayout: {
        create: jest
          .fn()
          .mockRejectedValue(
            new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
          ),
      },
    });
    await expect(
      new MatrixLayoutsService(prisma).create({ name: 'Fila baja', cells }, gestor),
    ).rejects.toThrow(/ya tienes una matriz/i);
  });

  it('captura la colocación real de un panel por slug', async () => {
    const prisma = buildPrisma({
      modulePosition: {
        findMany: jest.fn().mockResolvedValue([
          { x: 0, y: 0, rotation: 0, module: { slug: 'mod-a' } },
          { x: 1, y: 0, rotation: 90, module: { slug: 'mod-b' } },
        ]),
      },
    });
    await new MatrixLayoutsService(prisma).captureFromSystem(
      { name: 'Captura', target_system_id: 's1' },
      gestor,
    );
    expect(prisma.matrixLayout.create.mock.calls[0][0].data.cells).toEqual([
      { slug: 'mod-a', x: 0, y: 0, rotation: 0 },
      { slug: 'mod-b', x: 1, y: 0, rotation: 90 },
    ]);
  });

  it('capturar un panel sin módulos colocados → 400', async () => {
    const prisma = buildPrisma();
    await expect(
      new MatrixLayoutsService(prisma).captureFromSystem(
        { name: 'Vacía', target_system_id: 's1' },
        gestor,
      ),
    ).rejects.toThrow(/ningún módulo colocado/);
  });

  it('una matriz ajena no existe para otro gestor (no filtra su existencia)', async () => {
    const prisma = buildPrisma();
    await expect(new MatrixLayoutsService(prisma).get('l1', otro)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('sólo el dueño (o el admin) puede renombrar o borrar', async () => {
    const prisma = buildPrisma();
    const service = new MatrixLayoutsService(prisma);
    await expect(service.update('l1', { name: 'Nueva' }, otro)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.remove('l1', otro)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.update('l1', { favorite: true }, admin)).resolves.toBeDefined();
  });

  it('aplicar recoloca sólo los módulos presentes y avisa de los que faltan', async () => {
    const prisma = buildPrisma({
      module: { findMany: jest.fn().mockResolvedValue([{ id: 'm-a', slug: 'mod-a' }]) },
    });
    const result = await new MatrixLayoutsService(prisma).apply('l1', 's1', gestor);
    expect(result.applied.map((c) => c.slug)).toEqual(['mod-a']);
    expect(result.missing).toEqual(['mod-b']);
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('aplicar libera la casilla destino antes de crear la posición (unique system,x,y)', async () => {
    const prisma = buildPrisma();
    await new MatrixLayoutsService(prisma).apply('l1', 's1', gestor);
    const ops = prisma.$transaction.mock.calls[0][0];
    expect(prisma.modulePosition.deleteMany).toHaveBeenCalledTimes(2);
    expect(prisma.modulePosition.deleteMany.mock.calls[1][0].where.OR).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    expect(ops).toHaveLength(4); // 2 deleteMany + 2 create
  });

  it('aplicar una matriz sin ningún módulo de ese panel → 400 (no toca nada)', async () => {
    const prisma = buildPrisma({ module: { findMany: jest.fn().mockResolvedValue([]) } });
    await expect(
      new MatrixLayoutsService(prisma).apply('l1', 's1', gestor),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('aplicar sobre un panel inexistente → 400', async () => {
    const prisma = buildPrisma({ targetSystem: { findUnique: jest.fn().mockResolvedValue(null) } });
    await expect(new MatrixLayoutsService(prisma).apply('l1', 'sX', gestor)).rejects.toThrow(
      /panel indicado no existe/,
    );
  });
});
