import { createHash } from 'crypto';
import { mkdtempSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { FirmwareBinaryService } from '../../src/modules/firmware/firmware-binary.service';
import type { AppConfig } from '../../src/config/configuration';

function buildConfig(dir: string): AppConfig {
  return {
    firmware: { dir, publicBaseUrl: 'http://192.168.1.209:8080', maxBytes: 1024 },
  } as unknown as AppConfig;
}

function buildPrisma(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    firmwareVersion: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(({ data }: any) => Promise.resolve({ ...data })),
      ...overrides,
    },
  } as any;
}

describe('FirmwareBinaryService', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fw-'));

  it('sube: calcula sha256/tamaño reales del binario, lo guarda y crea la versión con url de descarga', async () => {
    const prisma = buildPrisma();
    const svc = new FirmwareBinaryService(prisma, buildConfig(dir));
    const buffer = Buffer.from('binario-de-prueba');
    const expectedSha = createHash('sha256').update(buffer).digest('hex');

    const created = await svc.upload(buffer, { version: '1.2.0', targetBoard: 'esp32-s3', signature: 'firma==' });

    expect(created.sha256).toBe(expectedSha);
    expect(created.sizeBytes).toBe(buffer.length);
    expect(created.signed).toBe(true);
    expect(created.url).toBe(`http://192.168.1.209:8080/api/firmware/${created.id}/binary`);
    // El binario quedó en disco y coincide byte a byte.
    expect(existsSync(join(dir, `${created.id}.bin`))).toBe(true);
    expect(readFileSync(join(dir, `${created.id}.bin`)).equals(buffer)).toBe(true);
  });

  it('sin firma → signed=false', async () => {
    const svc = new FirmwareBinaryService(buildPrisma(), buildConfig(dir));
    const created = await svc.upload(Buffer.from('x'), { version: '2.0.0', targetBoard: 'esp32-s3' });
    expect(created.signed).toBe(false);
    expect(created.signature).toBeNull();
  });

  it('rechaza binario vacío', async () => {
    const svc = new FirmwareBinaryService(buildPrisma(), buildConfig(dir));
    await expect(svc.upload(Buffer.alloc(0), { version: '1.0.0', targetBoard: 'b' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza versión no-semver', async () => {
    const svc = new FirmwareBinaryService(buildPrisma(), buildConfig(dir));
    await expect(svc.upload(Buffer.from('x'), { version: 'v1', targetBoard: 'b' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza binario mayor que el máximo', async () => {
    const svc = new FirmwareBinaryService(buildPrisma(), buildConfig(dir));
    await expect(svc.upload(Buffer.alloc(2048), { version: '1.0.0', targetBoard: 'b' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza versión duplicada (misma versión+placa)', async () => {
    const prisma = buildPrisma({ findUnique: jest.fn().mockResolvedValue({ id: 'ya' }) });
    const svc = new FirmwareBinaryService(prisma, buildConfig(dir));
    await expect(svc.upload(Buffer.from('x'), { version: '1.0.0', targetBoard: 'b' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('descarga: 404 si la versión no existe', async () => {
    const prisma = buildPrisma({ findUnique: jest.fn().mockResolvedValue(null) });
    const svc = new FirmwareBinaryService(prisma, buildConfig(dir));
    await expect(svc.openForDownload('00000000-0000-0000-0000-000000000000')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('descarga: 404 si el registro existe pero el binario no está en disco', async () => {
    const prisma = buildPrisma({ findUnique: jest.fn().mockResolvedValue({ id: 'huerfano', sizeBytes: 1, sha256: 'a', version: '1.0.0' }) });
    const svc = new FirmwareBinaryService(prisma, buildConfig(dir));
    await expect(svc.openForDownload('huerfano')).rejects.toBeInstanceOf(NotFoundException);
  });
});
