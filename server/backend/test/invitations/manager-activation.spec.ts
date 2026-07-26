import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  ACTIVATION_STATUS,
  ManagerActivationService,
} from '../../src/modules/invitations/manager-activation.service';
import { ROLE } from '../../src/domain/rbac/permissions';

const AHORA = new Date('2026-07-26T10:00:00Z');
const MANANA = new Date('2026-07-27T10:00:00Z');
const AYER = new Date('2026-07-25T10:00:00Z');

const jugador = { id: 'u1', username: 'ana', email: 'ana@example.com', role: { name: ROLE.JUGADOR } };

function build(over: any = {}) {
  const prisma: any = {
    user: {
      findUnique: jest.fn().mockResolvedValue(jugador),
      update: jest.fn().mockResolvedValue({}),
      ...over.user,
    },
    module: { count: jest.fn().mockResolvedValue(1), ...over.module },
    role: { findUnique: jest.fn().mockResolvedValue({ id: 'role-gestor' }), ...over.role },
    managerActivation: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(async ({ data }: any) => ({ id: 'act-1', ...data })),
      update: jest.fn(async ({ data }: any) => ({ id: 'act-1', ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      ...over.managerActivation,
    },
  };
  prisma.$transaction = jest.fn((cb: any) => cb(prisma));
  const smtp = { isConfigured: jest.fn().mockResolvedValue(false), ...over.smtp } as any;
  return { service: new ManagerActivationService(prisma, smtp), prisma, smtp };
}

describe('Ascenso a gestor (F5) · abrir el ascenso', () => {
  it('a un jugador se le genera un código con caducidad', async () => {
    const { service, prisma } = build();
    const act = await service.open('u1', 'm1', 'admin');
    expect(act).not.toBeNull();
    const data = prisma.managerActivation.create.mock.calls[0][0].data;
    expect(data.code).toHaveLength(8);
    expect(data.status).toBeUndefined(); // el valor por defecto es 'pending'
    expect(data.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('el código no usa caracteres que se confunden al dictarlo', async () => {
    const { service, prisma } = build();
    await service.open('u1', 'm1');
    const code: string = prisma.managerActivation.create.mock.calls[0][0].data.code;
    expect(code).not.toMatch(/[IO01]/);
  });

  it('sin SMTP configurado NO se afirma que se haya enviado nada', async () => {
    const { service, prisma } = build();
    await service.open('u1', 'm1');
    const nota: string = prisma.managerActivation.create.mock.calls[0][0].data.dispatchNote;
    expect(nota).toMatch(/NO se ha enviado/);
  });

  it('con SMTP configurado se dice que lo enviará el relay, no que ya llegó', async () => {
    const { service, prisma } = build({ smtp: { isConfigured: jest.fn().mockResolvedValue(true) } });
    await service.open('u1', 'm1');
    const nota: string = prisma.managerActivation.create.mock.calls[0][0].data.dispatchNote;
    expect(nota).toMatch(/el envío real lo hace el relay/);
  });

  it('a un usuario sin correo se le dice que hay que entregarlo en mano', async () => {
    const { service, prisma } = build({
      user: { findUnique: jest.fn().mockResolvedValue({ ...jugador, email: null }) },
    });
    await service.open('u1', 'm1');
    expect(prisma.managerActivation.create.mock.calls[0][0].data.dispatchNote).toMatch(/en mano/);
  });

  it('a quien ya es gestor no se le abre nada', async () => {
    const { service, prisma } = build({
      user: { findUnique: jest.fn().mockResolvedValue({ ...jugador, role: { name: ROLE.GESTOR } }) },
    });
    expect(await service.open('u1', 'm1')).toBeNull();
    expect(prisma.managerActivation.create).not.toHaveBeenCalled();
  });

  it('al administrador tampoco: ya puede todo', async () => {
    const { service, prisma } = build({
      user: {
        findUnique: jest.fn().mockResolvedValue({ ...jugador, role: { name: ROLE.ADMINISTRADOR } }),
      },
    });
    expect(await service.open('u1', 'm1')).toBeNull();
    expect(prisma.managerActivation.create).not.toHaveBeenCalled();
  });

  it('vender un segundo módulo NO deja dos códigos vivos', async () => {
    const vigente = { id: 'act-0', code: 'AAAA1111', expiresAt: MANANA };
    const { service, prisma } = build({
      managerActivation: { findFirst: jest.fn().mockResolvedValue(vigente) },
    });
    expect(await service.open('u1', 'm2')).toBe(vigente);
    expect(prisma.managerActivation.create).not.toHaveBeenCalled();
  });

  it('un usuario inexistente da 404', async () => {
    const { service } = build({ user: { findUnique: jest.fn().mockResolvedValue(null) } });
    await expect(service.open('u9', null)).rejects.toBeInstanceOf(NotFoundException);
  });
});

const pendiente = (over: any = {}) => ({
  id: 'act-1',
  userId: 'u1',
  code: 'ABCD2345',
  status: ACTIVATION_STATUS.pending,
  expiresAt: MANANA,
  createdBy: 'admin',
  user: { id: 'u1', role: { name: ROLE.JUGADOR }, email: 'ana@example.com' },
  ...over,
});

describe('Ascenso a gestor (F5) · activar', () => {
  it('el comprador introduce su código y pasa a gestor', async () => {
    const { service, prisma } = build({
      managerActivation: { findUnique: jest.fn().mockResolvedValue(pendiente()) },
    });
    const res = await service.activate('abcd2345', { userId: 'u1' });
    expect(res.activated).toBe(true);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { roleId: 'role-gestor' },
    });
  });

  it('el código se acepta en minúsculas y con espacios', async () => {
    const { service, prisma } = build({
      managerActivation: { findUnique: jest.fn().mockResolvedValue(pendiente()) },
    });
    await service.activate('  abcd2345 ', { userId: 'u1' });
    expect(prisma.managerActivation.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { code: 'ABCD2345' } }),
    );
  });

  it('el código de OTRO no asciende a nadie', async () => {
    const { service, prisma } = build({
      managerActivation: { findUnique: jest.fn().mockResolvedValue(pendiente()) },
    });
    await expect(service.activate('ABCD2345', { userId: 'intruso' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('un código ajeno da el MISMO error que uno inexistente', async () => {
    // Si no, probar códigos diría cuáles existen.
    const ajeno = build({
      managerActivation: { findUnique: jest.fn().mockResolvedValue(pendiente()) },
    });
    const inexistente = build();
    const a = await ajeno.service.activate('ABCD2345', { userId: 'x' }).catch((e) => e.message);
    const b = await inexistente.service.activate('ZZZZ9999', { userId: 'x' }).catch((e) => e.message);
    expect(a).toBe(b);
  });

  it('un código caducado no vale y se dice por qué', async () => {
    const { service } = build({
      managerActivation: { findUnique: jest.fn().mockResolvedValue(pendiente({ expiresAt: AYER })) },
    });
    await expect(service.activate('ABCD2345', { userId: 'u1' })).rejects.toThrow(/caducado/);
  });

  it('un código ya usado no sirve dos veces', async () => {
    const { service } = build({
      managerActivation: {
        findUnique: jest.fn().mockResolvedValue(pendiente({ status: ACTIVATION_STATUS.activated })),
      },
    });
    await expect(service.activate('ABCD2345', { userId: 'u1' })).rejects.toThrow(/ya se usó/);
  });

  it('un código revocado no sirve', async () => {
    const { service } = build({
      managerActivation: {
        findUnique: jest.fn().mockResolvedValue(pendiente({ status: ACTIVATION_STATUS.revoked })),
      },
    });
    await expect(service.activate('ABCD2345', { userId: 'u1' })).rejects.toThrow(/revocado/);
  });

  it('sin módulos NO se asciende, aunque el código sea válido', async () => {
    // La condición del encargo es POSEER un módulo, no haber recibido un código.
    const { service, prisma } = build({
      managerActivation: { findUnique: jest.fn().mockResolvedValue(pendiente()) },
      module: { count: jest.fn().mockResolvedValue(0) },
    });
    await expect(service.activate('ABCD2345', { userId: 'u1' })).rejects.toThrow(/ningún módulo/);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('activar invalida los demás códigos pendientes del usuario', async () => {
    const { service, prisma } = build({
      managerActivation: { findUnique: jest.fn().mockResolvedValue(pendiente()) },
    });
    await service.activate('ABCD2345', { userId: 'u1' });
    expect(prisma.managerActivation.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', status: ACTIVATION_STATUS.pending },
      data: { status: ACTIVATION_STATUS.revoked },
    });
  });

  it('a un administrador no se le cambia el rol al activar', async () => {
    const { service, prisma } = build({
      managerActivation: {
        findUnique: jest
          .fn()
          .mockResolvedValue(pendiente({ user: { role: { name: ROLE.ADMINISTRADOR } } })),
      },
    });
    await service.activate('ABCD2345', { userId: 'u1' });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('un código vacío se rechaza sin ir a la base', async () => {
    const { service, prisma } = build();
    await expect(service.activate('   ', { userId: 'u1' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.managerActivation.findUnique).not.toHaveBeenCalled();
  });
});

describe('Ascenso a gestor (F5) · administración', () => {
  it('regenerar cambia el código y renueva la caducidad', async () => {
    const { service, prisma } = build({
      managerActivation: {
        findUnique: jest.fn().mockResolvedValue({ ...pendiente(), user: { email: 'a@b.c' } }),
      },
    });
    await service.regenerate('act-1', 'admin');
    const data = prisma.managerActivation.update.mock.calls[0][0].data;
    expect(data.code).toHaveLength(8);
    expect(data.code).not.toBe('ABCD2345');
    expect(data.status).toBe(ACTIVATION_STATUS.pending);
    expect(data.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('una activación ya usada no se regenera', async () => {
    const { service } = build({
      managerActivation: {
        findUnique: jest.fn().mockResolvedValue({
          ...pendiente({ status: ACTIVATION_STATUS.activated }),
          user: { email: 'a@b.c' },
        }),
      },
    });
    await expect(service.regenerate('act-1')).rejects.toThrow(/ya se usó/);
  });

  it('quedarse sin módulos revoca los ascensos pendientes', async () => {
    const { service, prisma } = build({
      managerActivation: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    });
    expect(await service.revokePendingFor('u1')).toBe(2);
    expect(prisma.managerActivation.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', status: ACTIVATION_STATUS.pending },
      data: { status: ACTIVATION_STATUS.revoked },
    });
  });

  it('el listado marca como caducado lo que el reloj ya invalidó', async () => {
    const { service } = build({
      managerActivation: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'a', status: ACTIVATION_STATUS.pending, expiresAt: AYER },
          { id: 'b', status: ACTIVATION_STATUS.pending, expiresAt: MANANA },
          { id: 'c', status: ACTIVATION_STATUS.activated, expiresAt: AYER },
        ]),
      },
    });
    const { items, smtpConfigured } = await service.list();
    expect(items.map((i: any) => i.expired)).toEqual([true, false, false]);
    // Que no haya SMTP es información que el admin necesita para saber si
    // tiene que dictar el código él.
    expect(smtpConfigured).toBe(false);
  });

  it('el propio usuario ve que tiene un ascenso pendiente, pero NO su código', async () => {
    const { service } = build({
      managerActivation: {
        findFirst: jest.fn().mockResolvedValue({ id: 'a', expiresAt: MANANA, createdAt: AHORA }),
      },
    });
    const mine = await service.mine('u1');
    expect(mine.pending).toBe(true);
    expect(JSON.stringify(mine)).not.toMatch(/code/i);
  });

  it('si su código caducó, se le dice que pida uno nuevo', async () => {
    const { service } = build({
      managerActivation: {
        findFirst: jest.fn().mockResolvedValue({ id: 'a', expiresAt: AYER, createdAt: AYER }),
      },
    });
    const mine = await service.mine('u1');
    expect(mine.pending).toBe(false);
    expect(mine.note).toMatch(/caducado/);
  });
});
