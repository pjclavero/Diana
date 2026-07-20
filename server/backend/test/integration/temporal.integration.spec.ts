import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { toHitRecord, HitEventPayload } from '../../src/domain/hits/hit-record';
import { PrismaHitRepository } from '../../src/modules/hits/prisma-hit.repository';
import { loadExamples } from '../helpers/examples';

/**
 * ADR-0002 contra PostgreSQL real: las cuatro marcas sobreviven al viaje de
 * ida y vuelta sin perder precisión de microsegundos (BigInt) ni ser
 * reescritas por el backend.
 *
 * Se SALTA sin `DATABASE_URL`.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

suite('Modelo temporal contra PostgreSQL (ADR-0002)', () => {
  let prisma: PrismaClient;
  let repository: PrismaHitRepository;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    repository = new PrismaHitRepository(prisma as unknown as PrismaService);
  });

  beforeEach(async () => {
    await prisma.hitEvent.deleteMany({ where: { moduleSlug: 'module-03' } });
  });

  afterAll(async () => {
    await prisma.hitEvent.deleteMany({ where: { moduleSlug: 'module-03' } });
    await prisma.$disconnect();
  });

  it('T1, T2, T3 y T4 se persisten en columnas distintas y sin pérdida', async () => {
    const example = loadExamples('valid').find((e) => e.name.includes('valid-hit'))!;
    const payload = example.payload as unknown as HitEventPayload;
    const receivedAt = new Date('2026-07-20T12:00:00.000Z');

    const record = toHitRecord(payload, receivedAt);
    const inserted = await repository.insertIfAbsent(record);
    expect(inserted.inserted).toBe(true);

    const row = await prisma.hitEvent.findUniqueOrThrow({ where: { eventId: payload.event_id } });

    expect(row.deviceEventUs).toBe(BigInt(payload.device.event_us));
    expect(row.deviceUptimeUs).toBe(BigInt(payload.device.uptime_us));
    expect(row.deviceBootId).toBe(payload.device.boot_id);
    expect(row.coordinatorElapsedUs).toBe(BigInt(payload.coordinator!.elapsed_us));
    expect(row.clockOffsetUs).toBe(BigInt(payload.coordinator!.clock_offset_us));
    expect(row.receivedAt.toISOString()).toBe(receivedAt.toISOString());
    // T4 lo pone la base de datos y es posterior o igual a T3.
    expect(row.persistedAt.getTime()).toBeGreaterThanOrEqual(receivedAt.getTime());
  });

  it('un valor de microsegundos grande no se trunca a double', async () => {
    const example = loadExamples('valid').find((e) => e.name.includes('valid-hit'))!;
    const payload = JSON.parse(JSON.stringify(example.payload)) as HitEventPayload;
    payload.event_id = '22222222-3333-4444-8555-666666666666';
    payload.local_sequence = 9007199254740993 as unknown as number;
    payload.device.event_us = 9007199254740993 as unknown as number;

    await repository.insertIfAbsent(toHitRecord(payload, new Date()));
    const row = await prisma.hitEvent.findUniqueOrThrow({ where: { eventId: payload.event_id } });
    expect(row.deviceEventUs.toString()).toBe('9007199254740993');
  });
});
