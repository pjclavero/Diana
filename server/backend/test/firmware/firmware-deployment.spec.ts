import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { FirmwareDeploymentService } from '../../src/modules/firmware/firmware-deployment.service';
import { ROLE } from '../../src/domain/rbac/permissions';

/**
 * Reglas de negocio F3 (docs/product/alcance-panel-roles-firmware.md §3.3):
 *  - un no-admin sólo opera el firmware de los módulos de los que es dueño;
 *  - una versión sin firma NO se despliega (dosier 23.3);
 *  - no se admite un segundo despliegue si ya hay uno en curso;
 *  - aceptar una versión crea el `Deployment` y dispara la OTA real por MQTT.
 */
const SIGNED = {
  id: 'fw1',
  version: '1.2.0',
  targetBoard: 'esp32-s3',
  url: 'http://192.168.1.209:8080/fw/1.2.0.bin',
  sizeBytes: 1024,
  sha256: 'a'.repeat(64),
  signature: 'base64sig',
  signed: true,
};

function buildPrisma(overrides: {
  module?: Partial<Record<string, jest.Mock>>;
  firmwareVersion?: Partial<Record<string, jest.Mock>>;
  deployment?: Partial<Record<string, jest.Mock>>;
} = {}) {
  return {
    module: {
      findUnique: jest.fn().mockResolvedValue({ id: 'm1', slug: 'diana-01', ownerId: 'g1', firmwareVersion: '1.1.0' }),
      ...overrides.module,
    },
    firmwareVersion: {
      findUnique: jest.fn().mockResolvedValue(SIGNED),
      findMany: jest.fn().mockResolvedValue([SIGNED]),
      ...overrides.firmwareVersion,
    },
    deployment: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'dep1' }),
      update: jest.fn().mockResolvedValue({ id: 'dep1', status: 'sent' }),
      ...overrides.deployment,
    },
  } as any;
}

function buildMqtt(send: jest.Mock = jest.fn().mockReturnValue({ command_id: 'cmd-1' })) {
  return { sendOtaCommand: send } as any;
}

describe('FirmwareDeploymentService', () => {
  const admin = { userId: 'admin-1', username: 'admin', role: ROLE.ADMINISTRADOR };
  const gestor = { userId: 'g1', username: 'gestor1', role: ROLE.GESTOR };
  const otro = { userId: 'g2', username: 'gestor2', role: ROLE.GESTOR };

  describe('authorization', () => {
    it('un gestor no puede operar el firmware de un módulo ajeno', async () => {
      const prisma = buildPrisma();
      const svc = new FirmwareDeploymentService(prisma, buildMqtt());
      await expect(svc.deploy('m1', 'fw1', otro)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('falla si el módulo no existe', async () => {
      const prisma = buildPrisma({ module: { findUnique: jest.fn().mockResolvedValue(null) } });
      const svc = new FirmwareDeploymentService(prisma, buildMqtt());
      await expect(svc.availableForModule('nope', admin)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('deploy', () => {
    it('crea el despliegue y dispara la OTA firmada por MQTT', async () => {
      const send = jest.fn().mockReturnValue({ command_id: 'cmd-1' });
      const prisma = buildPrisma();
      const svc = new FirmwareDeploymentService(prisma, buildMqtt(send));

      await svc.deploy('m1', 'fw1', gestor);

      expect(prisma.deployment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ moduleId: 'm1', firmwareVersionId: 'fw1', status: 'pending', previousVersion: '1.1.0', requestedBy: 'gestor1' }),
        }),
      );
      // Se publica con el slug (identificador MQTT), no el UUID, y con firma.
      expect(send).toHaveBeenCalledWith('diana-01', 'update', expect.objectContaining({ version: '1.2.0', signature: 'base64sig', target_board: 'esp32-s3' }));
      expect(prisma.deployment.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'sent', commandId: 'cmd-1' }) }),
      );
    });

    it('el admin puede desplegar sobre cualquier módulo', async () => {
      const send = jest.fn().mockReturnValue({ command_id: 'cmd-2' });
      const prisma = buildPrisma({ module: { findUnique: jest.fn().mockResolvedValue({ id: 'm1', slug: 'ajeno', ownerId: 'g2', firmwareVersion: '1.0.0' }) } });
      const svc = new FirmwareDeploymentService(prisma, buildMqtt(send));

      await svc.deploy('m1', 'fw1', admin);
      expect(send).toHaveBeenCalled();
    });

    it('rechaza una versión sin firma (OTA sin firma prohibida)', async () => {
      const prisma = buildPrisma({ firmwareVersion: { findUnique: jest.fn().mockResolvedValue({ ...SIGNED, signed: false, signature: null }) } });
      const send = jest.fn();
      const svc = new FirmwareDeploymentService(prisma, buildMqtt(send));

      await expect(svc.deploy('m1', 'fw1', gestor)).rejects.toBeInstanceOf(BadRequestException);
      expect(send).not.toHaveBeenCalled();
      expect(prisma.deployment.create).not.toHaveBeenCalled();
    });

    it('rechaza si el módulo ya corre esa versión', async () => {
      const prisma = buildPrisma({ module: { findUnique: jest.fn().mockResolvedValue({ id: 'm1', slug: 'diana-01', ownerId: 'g1', firmwareVersion: '1.2.0' }) } });
      const svc = new FirmwareDeploymentService(prisma, buildMqtt());
      await expect(svc.deploy('m1', 'fw1', gestor)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza si ya hay un despliegue en curso', async () => {
      const prisma = buildPrisma({ deployment: { findFirst: jest.fn().mockResolvedValue({ id: 'dep0', status: 'installing', firmwareVersionId: 'fwX' }) } });
      const svc = new FirmwareDeploymentService(prisma, buildMqtt());
      await expect(svc.deploy('m1', 'fw1', gestor)).rejects.toBeInstanceOf(ConflictException);
    });

    it('marca el despliegue como fallido si la publicación OTA lanza', async () => {
      const send = jest.fn(() => {
        throw new Error('esquema inválido');
      });
      const prisma = buildPrisma();
      const svc = new FirmwareDeploymentService(prisma, buildMqtt(send));

      await expect(svc.deploy('m1', 'fw1', gestor)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.deployment.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }),
      );
    });
  });

  describe('availableForModule', () => {
    it('marca la versión vigente y sólo ofrece firmadas', async () => {
      const prisma = buildPrisma();
      const svc = new FirmwareDeploymentService(prisma, buildMqtt());

      const result = await svc.availableForModule('m1', gestor);

      expect(prisma.firmwareVersion.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { signed: true } }));
      expect(result.current_version).toBe('1.1.0');
      expect(result.available[0]).toEqual(expect.objectContaining({ version: '1.2.0', is_current: false }));
    });
  });
});
