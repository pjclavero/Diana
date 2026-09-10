import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { IngestService } from '../../src/modules/mqtt/ingest.service';
import { ContractValidator } from '../../src/contracts/contract-validator';
import {
  ConfigReportedResult,
  ConfigReportedSinkPort,
} from '../../src/modules/modules/module-config.ports';

/**
 * T2 · el camino de `config/reported` desde el tópico hasta el sumidero.
 *
 * Antes de esto el mensaje se validaba contra el esquema y se DESCARTABA: la
 * suite entera pasaba con el manejador borrado, porque no había ninguna prueba
 * que mirase si alguien lo recogía. Este fichero es esa prueba.
 */
class SinkEspia implements ConfigReportedSinkPort {
  readonly llamadas: Array<{
    slug: string;
    version: number;
    appliedAt: Date | null;
    receivedAt: Date;
  }> = [];
  async record(
    moduleSlug: string,
    configVersion: number,
    appliedAt: Date | null,
    receivedAt: Date,
  ): Promise<ConfigReportedResult> {
    this.llamadas.push({ slug: moduleSlug, version: configVersion, appliedAt, receivedAt });
    return {
      outcome: 'applied',
      reason: 'ok',
      reportedConfigVersion: configVersion,
      desiredConfigVersion: configVersion,
      configState: 'applied',
    };
  }
}

const RECEIVED_AT = new Date('2026-09-10T10:00:00Z');
const TOPIC = 'targets/v1/module/module-03/config/reported';

// Se parte del ejemplo CANÓNICO del contrato, no de un payload inventado: si
// el esquema cambia, esta prueba se entera.
const EJEMPLO = path.resolve(
  __dirname,
  '../../../../contracts/examples/valid/module-config/desired.json',
);

function payload(over: Record<string, unknown> = {}) {
  const base = JSON.parse(readFileSync(EJEMPLO, 'utf8')) as Record<string, unknown>;
  delete base._schema;
  return Buffer.from(JSON.stringify({ ...base, ...over }));
}

function build() {
  const sink = new SinkEspia();
  const hits = { insert: jest.fn(), exists: jest.fn().mockResolvedValue(false) } as never;
  const incidents = { record: jest.fn() } as never;
  const service = new IngestService(
    new ContractValidator(),
    hits,
    incidents,
    undefined, // presence
    undefined, // attributor
    undefined, // publisher
    undefined, // options
    undefined, // provisionState
    sink,
  );
  return { service, sink };
}

describe('T2 · ingesta de config/reported', () => {
  it('el mensaje LLEGA al sumidero con la versión del payload', async () => {
    const { service, sink } = build();
    const r = await service.handleMessage(TOPIC, payload({ config_version: 7 }), RECEIVED_AT);
    expect(r.status).toBe('accepted');
    expect(sink.llamadas).toHaveLength(1);
    expect(sink.llamadas[0]).toMatchObject({ slug: 'module-03', version: 7 });
  });

  it('el slug viene del TÓPICO, no del payload', async () => {
    // El payload ya declara `module_id: module-03`; la ingesta comprueba antes
    // que coincidan, así que lo que llega al sumidero es el del tópico.
    const { service, sink } = build();
    await service.handleMessage(TOPIC, payload(), RECEIVED_AT);
    expect(sink.llamadas[0].slug).toBe('module-03');
  });

  it('un payload cuyo module_id no casa con el tópico se RECHAZA', async () => {
    const { service, sink } = build();
    const r = await service.handleMessage(
      TOPIC,
      payload({ module_id: 'module-09' }),
      RECEIVED_AT,
    );
    expect(r.status).toBe('rejected');
    expect(sink.llamadas).toHaveLength(0);
  });

  it('`received_at` lo pone el backend (T3), no el módulo', async () => {
    const { service, sink } = build();
    await service.handleMessage(TOPIC, payload(), RECEIVED_AT);
    expect(sink.llamadas[0].receivedAt).toEqual(RECEIVED_AT);
  });

  it('`applied_at` del módulo se transmite tal cual cuando es válido', async () => {
    const { service, sink } = build();
    await service.handleMessage(
      TOPIC,
      payload({ applied_at: '2026-09-10T09:59:00Z' }),
      RECEIVED_AT,
    );
    expect(sink.llamadas[0].appliedAt).toEqual(new Date('2026-09-10T09:59:00Z'));
  });

  it('un `applied_at` nulo no rompe nada', async () => {
    const { service, sink } = build();
    await service.handleMessage(TOPIC, payload({ applied_at: null }), RECEIVED_AT);
    expect(sink.llamadas[0].appliedAt).toBeNull();
  });

  it('config/reported NO cuenta como señal de vida (es retenido)', async () => {
    // Al reconectar, el broker reentrega el último retenido. Si esto tocase la
    // presencia, un módulo apagado resucitaría solo. La presencia se pasa como
    // espía y se comprueba que NADIE la llama.
    const presence = { record: jest.fn(), touch: jest.fn() };
    const hits = { insert: jest.fn(), exists: jest.fn().mockResolvedValue(false) } as never;
    const incidents = { record: jest.fn() } as never;
    const service = new IngestService(
      new ContractValidator(),
      hits,
      incidents,
      presence as never,
      undefined,
      undefined,
      undefined,
      undefined,
      new SinkEspia(),
    );
    await service.handleMessage(TOPIC, payload(), RECEIVED_AT);
    expect(presence.touch).not.toHaveBeenCalled();
    expect(presence.record).not.toHaveBeenCalled();
  });

  it('sin sumidero cableado la ingesta sigue aceptando (puerto opcional)', async () => {
    const hits = { insert: jest.fn(), exists: jest.fn().mockResolvedValue(false) } as never;
    const incidents = { record: jest.fn() } as never;
    const service = new IngestService(new ContractValidator(), hits, incidents);
    const r = await service.handleMessage(TOPIC, payload(), RECEIVED_AT);
    expect(r.status).toBe('accepted');
  });

  it('un fallo del sumidero NO tumba la ingesta', async () => {
    const roto: ConfigReportedSinkPort = {
      record: async () => {
        throw new Error('PostgreSQL no disponible');
      },
    };
    const hits = { insert: jest.fn(), exists: jest.fn().mockResolvedValue(false) } as never;
    const incidents = { record: jest.fn() } as never;
    const service = new IngestService(
      new ContractValidator(),
      hits,
      incidents,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      roto,
    );
    const r = await service.handleMessage(TOPIC, payload(), RECEIVED_AT);
    expect(r.status).toBe('accepted');
  });
});
