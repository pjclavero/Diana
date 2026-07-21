import { PrismaClient } from '@prisma/client';
import { ContractValidator } from '../../src/contracts/contract-validator';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { PrismaHitRepository } from '../../src/modules/hits/prisma-hit.repository';
import { IngestService } from '../../src/modules/mqtt/ingest.service';
import { IncidentInput, IncidentSinkPort } from '../../src/modules/hits/ports';
import { loadExamples } from '../helpers/examples';
import { seedHitParents, cleanHitParents } from '../helpers/fk-seed';

/**
 * Idempotencia demostrada contra PostgreSQL REAL.
 *
 * La prueba unitaria usa un repositorio en memoria y por tanto sólo demuestra
 * la lógica; la garantía de verdad la dan las restricciones de la base de
 * datos (ADR-0003), y eso sólo puede comprobarse aquí.
 *
 * Se SALTA si no hay `DATABASE_URL`. Un salto no es un aprobado.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  // eslint-disable-next-line no-console
  console.warn(
    '[integración] DATABASE_URL no definida: se saltan las pruebas contra PostgreSQL. ' +
      'Ver test/integration/README.md.',
  );
}

class NullSink implements IncidentSinkPort {
  async record(_incident: IncidentInput): Promise<void> {
    /* no-op */
  }
}

const TOPIC = 'targets/v1/module/module-03/hit';

suite('Idempotencia contra PostgreSQL (ADR-0003)', () => {
  let prisma: PrismaClient;
  let ingest: IngestService;

  const payload = () => {
    const example = loadExamples('valid').find((e) => e.name.includes('valid-hit'))!;
    return JSON.parse(JSON.stringify(example.payload)) as Record<string, unknown>;
  };

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    const repository = new PrismaHitRepository(prisma as unknown as PrismaService);
    ingest = new IngestService(new ContractValidator(), repository, new NullSink());
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

  it('la restricción de la BD impide un segundo evento con el mismo event_id', async () => {
    const raw = Buffer.from(JSON.stringify(payload()));
    const first = await ingest.handleMessage(TOPIC, raw);
    const second = await ingest.handleMessage(TOPIC, raw);

    expect(first.status).toBe('accepted');
    expect(second.status).toBe('duplicate');
    expect(await prisma.hitEvent.count({ where: { moduleSlug: 'module-03' } })).toBe(1);
  });

  it('la idempotencia aguanta ingestas CONCURRENTES del mismo evento', async () => {
    const raw = Buffer.from(JSON.stringify(payload()));
    const results = await Promise.all(
      Array.from({ length: 8 }, () => ingest.handleMessage(TOPIC, raw)),
    );

    const accepted = results.filter((r) => r.status === 'accepted');
    expect(accepted).toHaveLength(1);
    expect(await prisma.hitEvent.count({ where: { moduleSlug: 'module-03' } })).toBe(1);
  });

  it('la restricción (module, boot_id, local_sequence) también se aplica en la BD', async () => {
    const base = payload();
    await ingest.handleMessage(TOPIC, Buffer.from(JSON.stringify(base)));
    const relabelled = { ...base, event_id: '11111111-2222-4333-8444-555555555555' };
    const second = await ingest.handleMessage(TOPIC, Buffer.from(JSON.stringify(relabelled)));

    expect(second.status).toBe('duplicate');
    expect(second.duplicateBy).toBe('module_boot_sequence');
  });
});
