import { IngestService } from '../../src/modules/mqtt/ingest.service';
import { ContractValidator } from '../../src/contracts/contract-validator';
import type { IncidentInput, IncidentSinkPort } from '../../src/modules/hits/ports';

/**
 * Una incidencia de rechazo tiene que decir QUÉ falló.
 *
 * Lo encontró el primer arranque del módulo físico: llegaron nueve
 * `ingest_schema_violation` sobre `provision/state` y todas guardaban
 * `{"errors": []}`. El veredicto era correcto —el mensaje no cumple el
 * contrato— pero el diagnóstico no servía para nada: no se podía saber qué
 * campo fallaba sin reproducir el fallo con la placa delante.
 *
 * Aquí se comprueba el CONTENIDO de la incidencia, no que exista.
 */
class SinkEspia implements IncidentSinkPort {
  readonly recorded: IncidentInput[] = [];
  async record(incident: IncidentInput): Promise<void> {
    this.recorded.push(incident);
  }
}

const TOPIC = 'targets/v1/module/module-03/provision/state';
const RECIBIDO = new Date('2026-09-11T20:00:00Z');

/** Estado de aprovisionamiento VÁLIDO, para partir de algo que sí cumple. */
const valido = (over: Record<string, unknown> = {}) => ({
  schema_version: 1,
  command_plane: 'DEVICE_MANAGEMENT',
  device_id: 'module-03',
  system_id: 'banco-01',
  result: 'AUTHORITY_UNPROVISIONED',
  state: 'UNPROVISIONED',
  active_epoch: null,
  pending_epoch: null,
  last_provisioning_sequence: 0,
  last_delegation_sequence: 0,
  provisioning_key_fingerprint: '',
  ...over,
});

function build() {
  const sink = new SinkEspia();
  const hits = { insert: jest.fn(), exists: jest.fn().mockResolvedValue(false) } as never;
  return { service: new IngestService(new ContractValidator(), hits, sink), sink };
}

describe('rechazo por contrato · la incidencia tiene que diagnosticar', () => {
  it('CONTROL POSITIVO · el estado válido se ACEPTA y no genera incidencia', async () => {
    // Sin esto, las pruebas de abajo podrían pasar con un payload que el
    // esquema rechaza siempre, y no demostrarían nada sobre el diagnóstico.
    const { service, sink } = build();
    const r = await service.handleMessage(TOPIC, JSON.stringify(valido()), RECIBIDO);
    expect(r.status).toBe('accepted');
    expect(sink.recorded).toHaveLength(0);
  });

  it('falta un campo obligatorio · errors NO vacío y el detalle nombra el campo', async () => {
    const { service, sink } = build();
    const sin = valido();
    delete (sin as Record<string, unknown>).provisioning_key_fingerprint;

    const r = await service.handleMessage(TOPIC, JSON.stringify(sin), RECIBIDO);
    expect(r.status).toBe('rejected');

    const inc = sink.recorded.find((i) => i.kind === 'ingest_schema_violation');
    expect(inc).toBeDefined();
    const detalle = inc!.detail as {
      errors: string[];
      error_details: Array<Record<string, unknown>>;
      rejection_code: string;
    };
    expect(detalle.errors.length).toBeGreaterThan(0);
    expect(detalle.error_details.length).toBeGreaterThan(0);
    expect(detalle.rejection_code).toBe('schema_violation');

    const e = detalle.error_details[0];
    // Los cinco campos que hacen falta para saber qué regla se rompió.
    for (const k of ['instancePath', 'schemaPath', 'keyword', 'message', 'params']) {
      expect(e).toHaveProperty(k);
    }
    expect(JSON.stringify(detalle)).toContain('provisioning_key_fingerprint');
  });

  it('campo desconocido · el detalle dice CUÁL sobra', async () => {
    const { service, sink } = build();
    const r = await service.handleMessage(TOPIC, JSON.stringify(valido({ inventado: 1 })), RECIBIDO);
    expect(r.status).toBe('rejected');
    const detalle = sink.recorded[0].detail as { error_details: Array<Record<string, unknown>> };
    expect(JSON.stringify(detalle)).toContain('inventado');
  });

  it('enum inválido · el detalle dice qué valores se admitían', async () => {
    const { service, sink } = build();
    const r = await service.handleMessage(TOPIC, JSON.stringify(valido({ state: 'INVENTADO' })), RECIBIDO);
    expect(r.status).toBe('rejected');
    const detalle = sink.recorded[0].detail as { errors: string[] };
    expect(detalle.errors.join(' ')).toMatch(/UNPROVISIONED/);
  });

  it('el payload rechazado se conserva, para poder verlo sin reproducir el fallo', async () => {
    const { service, sink } = build();
    await service.handleMessage(TOPIC, JSON.stringify(valido({ state: 'INVENTADO' })), RECIBIDO);
    const detalle = sink.recorded[0].detail as { payload: Record<string, unknown> };
    expect(detalle.payload.device_id).toBe('module-03');
    expect(detalle.payload.state).toBe('INVENTADO');
  });

  it('pero NUNCA con campos sensibles: se redactan aunque vengan fuera de contrato', async () => {
    // Un mensaje que no cumple el contrato puede traer cualquier cosa, y una
    // incidencia se guarda, se exporta y se lee. La redacción es por NOMBRE de
    // campo y se aplica aunque el campo no exista en ningún esquema.
    const { service, sink } = build();
    await service.handleMessage(
      TOPIC,
      JSON.stringify(valido({ mqtt_password: 'no-debe-salir-de-aqui', token: 'tampoco' })),
      RECIBIDO,
    );
    const texto = JSON.stringify(sink.recorded[0].detail);
    expect(texto).not.toContain('no-debe-salir-de-aqui');
    expect(texto).not.toContain('tampoco');
    expect(texto).toContain('[redactado]');
  });

  it('JSON no deserializable · también deja rastro utilizable', async () => {
    const { service, sink } = build();
    const r = await service.handleMessage(TOPIC, '{esto no es json', RECIBIDO);
    expect(r.status).toBe('rejected');
    const detalle = sink.recorded[0].detail as { rejection_code: string; payload: unknown };
    expect(detalle.rejection_code).toBe('invalid_json');
    // Aquí AJV no interviene, así que no hay detalle estructurado; lo que se
    // conserva es el texto, acotado, que es lo único que puede explicarlo.
    expect(String(detalle.payload)).toContain('esto no es json');
  });
});
