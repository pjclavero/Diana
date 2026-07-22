import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InvitationsService } from '../../src/modules/invitations/invitations.service';
import { SmtpService } from '../../src/modules/invitations/smtp.service';

function buildPrisma(over: any = {}) {
  return {
    invitation: {
      create: jest.fn(({ data }: any) => Promise.resolve({ id: 'i1', status: 'pending', ...data })),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      update: jest.fn(({ data }: any) => Promise.resolve({ id: 'i1', ...data })),
      ...over.invitation,
    },
    player: { create: jest.fn().mockResolvedValue({ id: 'pl1', displayName: 'Paco' }), ...over.player },
    smtpSetting: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}), ...over.smtpSetting },
    $transaction: jest.fn((cb: any) => cb({
      player: { create: jest.fn().mockResolvedValue({ id: 'pl1', displayName: 'Paco' }) },
      invitation: { update: jest.fn().mockResolvedValue({}) },
    })),
  } as any;
}

const smtpStub = (configured = false) => ({ isConfigured: jest.fn().mockResolvedValue(configured) }) as any;

const future = () => new Date(Date.now() + 3600_000);
const past = () => new Date(Date.now() - 3600_000);

describe('InvitationsService (G-D/F5)', () => {
  describe('create', () => {
    it('crea una invitación con código y nota de envío', async () => {
      const prisma = buildPrisma();
      const inv: any = await new InvitationsService(prisma, smtpStub(false)).create({ email: 'Paco@Mail.com' });
      expect(inv.email).toBe('paco@mail.com'); // normalizado
      expect(inv.code).toMatch(/^[A-Z2-9]{8}$/);
      expect(inv.dispatchNote).toMatch(/sin configurar/i);
    });

    it('con SMTP configurado, la nota cambia', async () => {
      const inv: any = await new InvitationsService(buildPrisma(), smtpStub(true)).create({ email: 'a@b.com' });
      expect(inv.dispatchNote).toMatch(/encolado/i);
    });

    it('rechaza un correo no válido', async () => {
      await expect(new InvitationsService(buildPrisma(), smtpStub()).create({ email: 'no-es-correo' })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('resend / revoke', () => {
    it('reenvía sólo si está pendiente', async () => {
      const prisma = buildPrisma({ invitation: { findUnique: jest.fn().mockResolvedValue({ id: 'i1', status: 'pending' }) } });
      await new InvitationsService(prisma, smtpStub()).resend('i1');
      expect(prisma.invitation.update).toHaveBeenCalled();
    });

    it('no reenvía una aceptada', async () => {
      const prisma = buildPrisma({ invitation: { findUnique: jest.fn().mockResolvedValue({ id: 'i1', status: 'accepted' }) } });
      await expect(new InvitationsService(prisma, smtpStub()).resend('i1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('revoca una pendiente y no una aceptada', async () => {
      const p1 = buildPrisma({ invitation: { findUnique: jest.fn().mockResolvedValue({ id: 'i1', status: 'pending' }) } });
      await expect(new InvitationsService(p1, smtpStub()).revoke('i1')).resolves.toBeDefined();
      const p2 = buildPrisma({ invitation: { findUnique: jest.fn().mockResolvedValue({ id: 'i1', status: 'accepted' }) } });
      await expect(new InvitationsService(p2, smtpStub()).revoke('i1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('byCode / accept', () => {
    it('byCode: acceptable si pendiente y no caducada', async () => {
      const prisma = buildPrisma({ invitation: { findUnique: jest.fn().mockResolvedValue({ status: 'pending', expiresAt: future(), email: 'a@b.com', displayName: null }) } });
      const r = await new InvitationsService(prisma, smtpStub()).byCode('ABCDEFGH');
      expect(r.acceptable).toBe(true);
    });

    it('byCode: caducada → acceptable false, expired true', async () => {
      const prisma = buildPrisma({ invitation: { findUnique: jest.fn().mockResolvedValue({ status: 'pending', expiresAt: past(), email: 'a@b.com', displayName: null }) } });
      const r = await new InvitationsService(prisma, smtpStub()).byCode('ABCDEFGH');
      expect(r.acceptable).toBe(false);
      expect(r.expired).toBe(true);
    });

    it('accept crea un jugador y marca aceptada', async () => {
      const prisma = buildPrisma({ invitation: { findUnique: jest.fn().mockResolvedValue({ id: 'i1', status: 'pending', expiresAt: future(), email: 'a@b.com' }) } });
      const r = await new InvitationsService(prisma, smtpStub()).accept('ABCDEFGH', 'Paco');
      expect(r.playerId).toBe('pl1');
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('accept rechaza una invitación no pendiente o caducada', async () => {
      const revoked = buildPrisma({ invitation: { findUnique: jest.fn().mockResolvedValue({ status: 'revoked', expiresAt: future() }) } });
      await expect(new InvitationsService(revoked, smtpStub()).accept('X', 'Paco')).rejects.toBeInstanceOf(BadRequestException);
      const exp = buildPrisma({ invitation: { findUnique: jest.fn().mockResolvedValue({ status: 'pending', expiresAt: past() }) } });
      await expect(new InvitationsService(exp, smtpStub()).accept('X', 'Paco')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('byCode/accept 404 si no existe', async () => {
      const prisma = buildPrisma({ invitation: { findUnique: jest.fn().mockResolvedValue(null) } });
      await expect(new InvitationsService(prisma, smtpStub()).byCode('X')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

describe('SmtpService', () => {
  it('isConfigured true sólo con host y remitente', async () => {
    const yes = { smtpSetting: { findUnique: jest.fn().mockResolvedValue({ host: 'h', fromAddress: 'f@x' }) } } as any;
    const no = { smtpSetting: { findUnique: jest.fn().mockResolvedValue({ host: 'h', fromAddress: null }) } } as any;
    expect(await new SmtpService(yes).isConfigured()).toBe(true);
    expect(await new SmtpService(no).isConfigured()).toBe(false);
  });

  it('get nunca devuelve la contraseña, sólo hasPassword', async () => {
    const prisma = { smtpSetting: { findUnique: jest.fn().mockResolvedValue({ host: 'h', fromAddress: 'f@x', password: 'secreto' }) } } as any;
    const r = await new SmtpService(prisma).get();
    expect((r as any).password).toBeUndefined();
    expect(r.hasPassword).toBe(true);
  });

  it('update no borra la contraseña si viene vacía', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const prisma = { smtpSetting: { upsert, findUnique: jest.fn().mockResolvedValue({}) } } as any;
    await new SmtpService(prisma).update({ host: 'h', password: null });
    const arg = upsert.mock.calls[0][0];
    expect(arg.update.password).toBeUndefined(); // no se toca
  });
});
