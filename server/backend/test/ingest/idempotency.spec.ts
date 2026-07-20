import { ContractValidator } from '../../src/contracts/contract-validator';
import { InMemoryHitRepository } from '../../src/modules/hits/in-memory-hit.repository';
import { IngestService } from '../../src/modules/mqtt/ingest.service';
import { IncidentInput, IncidentSinkPort } from '../../src/modules/hits/ports';
import { GameEngine } from '../../src/domain/game/engine';
import { createDefaultRegistry } from '../../src/domain/game/registry';
import { loadExamples } from '../helpers/examples';

class NullSink implements IncidentSinkPort {
  readonly incidents: IncidentInput[] = [];
  async record(i: IncidentInput): Promise<void> {
    this.incidents.push(i);
  }
}

function validHitPayload(): Record<string, unknown> {
  const example = loadExamples('valid').find((e) => e.name.includes('valid-hit'))!;
  return JSON.parse(JSON.stringify(example.payload)) as Record<string, unknown>;
}

const TOPIC = 'targets/v1/module/module-03/hit';

/** ADR-0003 · La idempotencia es requisito, no optimización. */
describe('Idempotencia de la ingesta (ADR-0003)', () => {
  const validator = new ContractValidator();
  let repo: InMemoryHitRepository;
  let ingest: IngestService;

  beforeEach(() => {
    repo = new InMemoryHitRepository();
    ingest = new IngestService(validator, repo, new NullSink());
  });

  it('el mismo event_id dos veces produce UN solo impacto', async () => {
    const payload = validHitPayload();
    const raw = Buffer.from(JSON.stringify(payload));

    const first = await ingest.handleMessage(TOPIC, raw);
    const second = await ingest.handleMessage(TOPIC, raw);

    expect(first.status).toBe('accepted');
    expect(second.status).toBe('duplicate');
    expect(second.duplicateBy).toBe('event_id');
    expect(second.id).toBe(first.id);
    expect(repo.size()).toBe(1);
  });

  it('el duplicado se cuenta como métrica, NO como error', async () => {
    const raw = Buffer.from(JSON.stringify(validHitPayload()));
    await ingest.handleMessage(TOPIC, raw);
    await ingest.handleMessage(TOPIC, raw);
    await ingest.handleMessage(TOPIC, raw);

    const metrics = ingest.getMetrics();
    expect(metrics.accepted).toBe(1);
    expect(metrics.duplicates).toBe(2);
    expect(metrics.rejected).toBe(0);
  });

  it('un duplicado no altera la puntuación de la ronda', async () => {
    const engine = new GameEngine(createDefaultRegistry());
    const plan = engine.planRound({
      mode: 'all_against_clock',
      seed: 42,
      targets: [
        { module_id: 'module-03', target_index: 7 },
        { module_id: 'module-03', target_index: 4 },
      ],
      penaltyMs: 2000,
    });
    const state = engine.createState(plan);
    const raw = Buffer.from(JSON.stringify(validHitPayload()));

    // Se puntúa SÓLO cuando la ingesta confirma inserción nueva.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await ingest.handleMessage(TOPIC, raw);
      if (result.status === 'accepted') {
        engine.applyHit(state, {
          target: { module_id: 'module-03', target_index: 7 },
          elapsedUs: 4210556,
          firmwareClassification: 'valid_hit',
        });
      }
    }

    expect(state.validHits).toBe(1);
    expect(state.detectedHits).toBe(1);
    expect(engine.summarise(state).totalTimeUs).toBe(4210556);
    expect(repo.size()).toBe(1);
  });

  it('detecta el duplicado también por (module, boot_id, local_sequence)', async () => {
    const payload = validHitPayload();
    await ingest.handleMessage(TOPIC, Buffer.from(JSON.stringify(payload)));

    // Mismo módulo, mismo arranque y misma secuencia, pero otro event_id:
    // sólo puede ser el mismo evento reetiquetado. Se rechaza como duplicado.
    const clone = { ...payload, event_id: '11111111-2222-4333-8444-555555555555' };
    const second = await ingest.handleMessage(TOPIC, Buffer.from(JSON.stringify(clone)));

    expect(second.status).toBe('duplicate');
    expect(second.duplicateBy).toBe('module_boot_sequence');
    expect(repo.size()).toBe(1);
  });

  it('un boot_id distinto con la misma local_sequence SÍ es un evento nuevo', async () => {
    const payload = validHitPayload();
    await ingest.handleMessage(TOPIC, Buffer.from(JSON.stringify(payload)));

    const afterReflash = {
      ...payload,
      event_id: '11111111-2222-4333-8444-555555555555',
      device: { ...(payload.device as object), boot_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' },
    };
    const second = await ingest.handleMessage(TOPIC, Buffer.from(JSON.stringify(afterReflash)));

    expect(second.status).toBe('accepted');
    expect(repo.size()).toBe(2);
  });

  it('`replay: true` NO implica duplicado: se acepta y se contabiliza aparte', async () => {
    const replayed = loadExamples('valid').find((e) => e.name.includes('replayed-from-queue'))!;
    const result = await ingest.handleMessage(
      'targets/v1/module/module-05/hit',
      Buffer.from(JSON.stringify(replayed.payload)),
    );
    expect(result.status).toBe('accepted');
    expect(ingest.getMetrics().replayed).toBe(1);
    expect(ingest.getMetrics().duplicates).toBe(0);
  });
});
