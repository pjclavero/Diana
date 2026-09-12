import {
  MODULE_CREATABLE_FIELDS,
  MODULE_UPDATABLE_FIELDS,
} from '../../src/modules/modules/modules.service';
import { IngestService } from '../../src/modules/mqtt/ingest.service';
import { ContractValidator } from '../../src/contracts/contract-validator';

/**
 * El selector físico es OBSERVADO, no declarable.
 *
 * Estaba entre los campos escribibles por REST. Con la elección automática de
 * coordinador eso es un agujero de autoridad: un PATCH podría poner
 * `selector = PRINCIPAL` sin que nadie tocara el interruptor, y el backend
 * elegiría coordinador sobre un dato que el hardware nunca ha declarado.
 *
 * Al retirarlos NINGUNA prueba se puso roja, que es justo por lo que hace falta
 * ésta.
 */
describe('selector y role son observacionales, no escribibles por API', () => {
  it('no se pueden crear por REST', () => {
    expect(MODULE_CREATABLE_FIELDS).not.toContain('selector');
    expect(MODULE_CREATABLE_FIELDS).not.toContain('role');
  });

  it('ni actualizar', () => {
    expect(MODULE_UPDATABLE_FIELDS).not.toContain('selector');
    expect(MODULE_UPDATABLE_FIELDS).not.toContain('role');
    expect(MODULE_UPDATABLE_FIELDS).not.toContain('selectorObservedAt');
  });

  it('CONTROL · los campos de referencia SÍ siguen siendo escribibles', () => {
    // Sin esto, la prueba de arriba pasaría aunque alguien vaciara la lista.
    expect(MODULE_UPDATABLE_FIELDS).toContain('friendlyName');
    expect(MODULE_UPDATABLE_FIELDS).toContain('targetSystemId');
  });
});

/** Estado válido mínimo, tal y como lo publica el módulo. */
const status = (over: Record<string, unknown> = {}) => ({
  schema_version: 1,
  module_id: 'module-01',
  firmware_version: '0.1.0',
  state: 'ready',
  selector: 'PRINCIPAL',
  role: 'principal',
  queue_depth: 0,
  uptime_s: 120,
  targets: Array.from({ length: 9 }, (_, i) => ({
    target_index: i + 1,
    state: 'off',
    enabled: true,
  })),
  ...over,
});

function build() {
  const observation = { observeSelector: jest.fn().mockResolvedValue(undefined) };
  const presence = { record: jest.fn(), touch: jest.fn().mockResolvedValue(undefined) };
  const hits = { insert: jest.fn(), exists: jest.fn().mockResolvedValue(false) } as never;
  const incidents = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new IngestService(
    new ContractValidator(),
    hits,
    incidents as never,
    presence as never,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    observation as never,
  );
  return { service, observation };
}

const TOPIC = 'targets/v1/module/module-01/status';
const AT = new Date('2026-09-12T18:06:53.000Z');

describe('ingesta de module-status · el selector deja de descartarse', () => {
  it('un status con PRINCIPAL llega al puerto de observación', async () => {
    const { service, observation } = build();
    const r = await service.handleMessage(TOPIC, JSON.stringify(status()), AT);
    expect(r.status).toBe('accepted');
    expect(observation.observeSelector).toHaveBeenCalledWith({
      moduleSlug: 'module-01',
      selector: 'PRINCIPAL',
      role: 'principal',
      observedAt: AT,
    });
  });

  it('y un cambio a SATELITE también', async () => {
    const { service, observation } = build();
    await service.handleMessage(
      TOPIC,
      JSON.stringify(status({ selector: 'SATELITE', role: 'satellite' })),
      AT,
    );
    expect(observation.observeSelector).toHaveBeenCalledWith(
      expect.objectContaining({ selector: 'SATELITE', role: 'satellite' }),
    );
  });

  it('un fallo al persistir NO tumba la ingesta', async () => {
    // Perder una observación es recuperable: llegará otra. Perder el mensaje
    // entero, no.
    const { service, observation } = build();
    observation.observeSelector.mockRejectedValueOnce(new Error('base caída'));
    const r = await service.handleMessage(TOPIC, JSON.stringify(status()), AT);
    expect(r.status).toBe('accepted');
  });

  it('la telemetría no toca el selector: no lo declara', async () => {
    const { service, observation } = build();
    await service.handleMessage(
      'targets/v1/module/module-01/telemetry',
      JSON.stringify({
        schema_version: 1,
        module_id: 'module-01',
        uptime_s: 10,
        queue_depth: 0,
        rssi_dbm: null,
        free_heap: 100000,
        temperature_c: null,
        voltage_5v: null,
        voltage_12v: null,
      }),
      AT,
    );
    expect(observation.observeSelector).not.toHaveBeenCalled();
  });
});
