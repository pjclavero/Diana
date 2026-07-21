import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { toHitRecord, HitEventPayload } from '../../src/domain/hits/hit-record';
import { PrismaHitRepository } from '../../src/modules/hits/prisma-hit.repository';
import { loadExamples } from '../helpers/examples';
import { seedHitParents, cleanHitParents } from '../helpers/fk-seed';

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
    // Las FK gameId/roundId de hit_events apuntan a games/rounds reales: hay
    // que sembrar los padres o el INSERT viola hit_events_game_id_fkey.
    await cleanHitParents(prisma);
    await seedHitParents(prisma);
  });

  beforeEach(async () => {
    await prisma.hitEvent.deleteMany({ where: { moduleSlug: 'module-03' } });
  });

  afterAll(async () => {
    await cleanHitParents(prisma);
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

    // 2^53 + 1 NO es representable como `double`: escrito como literal `number`
    // de JS ya se redondea a 2^53 (9007199254740992) antes de tocar la base.
    // La precisión sólo sobrevive como BigInt, que es precisamente el tipo de
    // la columna. Inyectamos el BigInt en el registro para demostrar que el
    // ALMACENAMIENTO (Prisma + columna BigInt de PostgreSQL) lo conserva sin
    // truncarlo a double. `rawPayload` se mantiene serializable a JSON (Prisma
    // no serializa BigInt), así que no se altera lo que guarda la auditoría.
    const bigUs = 9007199254740993n;
    const record = toHitRecord(payload, new Date());
    record.deviceEventUs = bigUs;
    record.localSequence = bigUs;

    await repository.insertIfAbsent(record);
    const row = await prisma.hitEvent.findUniqueOrThrow({ where: { eventId: payload.event_id } });
    expect(row.deviceEventUs.toString()).toBe('9007199254740993');
  });
});
