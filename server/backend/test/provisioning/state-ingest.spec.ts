import { getContractValidator } from '../../src/contracts/contract-validator';
import { ProvisioningStateService } from '../../src/modules/provisioning/provisioning-state.service';
import {
  EmittedOrderRecord,
  ObservedProvisionState,
  ProvisioningOrderRepositoryPort,
  ProvisioningStateRepositoryPort,
} from '../../src/modules/provisioning/provisioning.ports';

/** Repositorio observacional en memoria. */
class MemoryStates implements ProvisioningStateRepositoryPort {
  readonly rows = new Map<string, ObservedProvisionState>();
  async upsertObserved(state: ObservedProvisionState): Promise<void> {
    this.rows.set(state.deviceId, state);
  }
  async findLatest(deviceId: string): Promise<ObservedProvisionState | null> {
    return this.rows.get(deviceId) ?? null;
  }
}

/**
 * Repositorio de órdenes en memoria. `allocateSequence` lleva la cuenta de
 * cuántas veces se ha llamado: es la sonda que demuestra que la ingesta de
 * estado no toca jamás el lado de mando.
 */
class MemoryOrders implements ProvisioningOrderRepositoryPort {
  readonly emitted = new Map<string, EmittedOrderRecord>();
  allocations = 0;
  next = 1n;
  async allocateSequence(_deviceId?: string): Promise<bigint> {
    this.allocations += 1;
    return this.next++;
  }
  async recordEmitted(record: EmittedOrderRecord): Promise<void> {
    this.emitted.set(record.requestId, record);
  }
  async findByRequestId(requestId: string): Promise<EmittedOrderRecord | null> {
    return this.emitted.get(requestId) ?? null;
  }
}

const DEVICE = 'module-07';
const REQUEST = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

function validState(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    command_plane: 'DEVICE_MANAGEMENT',
    request_id: REQUEST,
    device_id: DEVICE,
    system_id: 'system-a',
    result: 'PROVISIONED',
    state: 'READY',
    active_epoch: '11111111-1111-4111-8111-111111111111',
    pending_epoch: null,
    provision_id: 'cccccccc-3333-4333-8333-cccccccccccc',
    last_provisioning_sequence: 10,
    last_delegation_sequence: 1,
    provisioning_key_fingerprint: '1f'.repeat(64 / 2),
    ...over,
  };
}

function build(): { service: ProvisioningStateService; states: MemoryStates; orders: MemoryOrders } {
  const states = new MemoryStates();
  const orders = new MemoryOrders();
  const service = new ProvisioningStateService(getContractValidator(), states, orders);
  return { service, states, orders };
}

describe('ingesta de provision/state · validar ANTES de aceptar nada', () => {
  it('acepta y persiste un estado conforme', async () => {
    const { service, states } = build();
    const result = await service.ingest(DEVICE, validState());
    expect(result.status).toBe('accepted');
    const row = states.rows.get(DEVICE)!;
    expect(row.result).toBe('PROVISIONED');
    expect(row.state).toBe('READY');
    expect(row.activeEpoch).toBe('11111111-1111-4111-8111-111111111111');
    expect(row.pendingEpoch).toBeNull();
    expect(row.lastProvisioningSequence).toBe(10n);
    expect(row.reason).toBeNull();
  });

  it('RECHAZA —y NO persiste— un estado que incumple el esquema', async () => {
    const { service, states } = build();
    // `REJECTED` sin `reason` es exactamente lo que el contrato prohíbe: un
    // rechazo sin motivo exacto es un diagnóstico deshonesto.
    const result = await service.ingest(
      DEVICE,
      validState({ result: 'REJECTED', provision_id: undefined }),
    );
    expect(result.status).toBe('rejected');
    expect(states.rows.size).toBe(0);
  });

  it('RECHAZA un estado con un `reason` fuera de la lista cerrada', async () => {
    const { service } = build();
    const result = await service.ingest(
      DEVICE,
      validState({ result: 'REJECTED', reason: 'porque_si', provision_id: undefined }),
    );
    expect(result.status).toBe('rejected');
  });

  it('RECHAZA un estado cuyo device_id no es el del tópico', async () => {
    const { service, states } = build();
    // Un módulo no reporta la autoridad de otro. La ingesta general NO cubre
    // esto para este mensaje: su comprobación mira `module_id` y aquí el campo
    // se llama `device_id`.
    const result = await service.ingest('module-99', validState());
    expect(result.status).toBe('rejected');
    expect(result.code).toBe('device_mismatch');
    expect(states.rows.size).toBe(0);
  });

  it('un JSON inválido se rechaza sin tocar el repositorio', async () => {
    const { service, states } = build();
    const result = await service.ingest(DEVICE, Buffer.from('{ esto no es json'));
    expect(result.status).toBe('rejected');
    expect(states.rows.size).toBe(0);
  });
});

describe('NO_SECRET_IN_STATE · lo ingerido no contiene secretos', () => {
  const SECRETS = [
    ['root_key', 'MIGH...clave-raiz-privada'],
    ['private_key', '-----BEGIN EC PRIVATE KEY-----'],
    ['mqtt_password', 'la-contrasena-del-broker'],
    ['operational_private_key', 'AAAA'],
    ['signature', 'no-va-en-el-estado'],
  ] as const;

  it.each(SECRETS)('rechaza entero un estado que traiga `%s`', async (field, value) => {
    const { service, states } = build();
    const result = await service.ingest(DEVICE, validState({ [field]: value }));
    // `additionalProperties: false` no «limpia» el campo: tira el mensaje. La
    // diferencia importa, porque limpiar dejaría entrar el resto del mensaje
    // que lo acompañaba.
    expect(result.status).toBe('rejected');
    expect(states.rows.size).toBe(0);
  });

  it('lo persistido sólo tiene campos de la lista cerrada', async () => {
    const { service, states } = build();
    await service.ingest(DEVICE, validState());
    const row = states.rows.get(DEVICE)!;
    expect(Object.keys(row).sort()).toEqual(
      [
        'activeEpoch',
        'correlated',
        'deviceId',
        'lastDelegationSequence',
        'lastProvisioningSequence',
        'pendingEpoch',
        'provisionId',
        'provisioningKeyFingerprint',
        'reason',
        'receivedAt',
        'requestId',
        'result',
        'rotationId',
        'state',
        'systemId',
      ].sort(),
    );
    // Barrido del contenido, no sólo de los nombres: ni PEM, ni base64 de 64
    // bytes, ni nada que huela a material criptográfico privado.
    const dump = JSON.stringify(row, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    expect(dump).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY/);
    expect(dump).not.toMatch(/password|secret|private/i);
    // CONTROL POSITIVO: la huella PÚBLICA sí está, y es un identificador.
    expect(dump).toContain('1f'.repeat(32));
  });
});

describe('correlación por request_id', () => {
  it('marca `correlated` cuando el request_id es de una orden emitida', async () => {
    const { service, states, orders } = build();
    orders.emitted.set(REQUEST, { requestId: REQUEST } as EmittedOrderRecord);
    await service.ingest(DEVICE, validState());
    expect(states.rows.get(DEVICE)!.correlated).toBe(true);
  });

  it('acepta pero NO correlaciona una declaración espontánea al conectar', async () => {
    const { service, states } = build();
    const result = await service.ingest(
      DEVICE,
      validState({
        request_id: undefined,
        result: 'AUTHORITY_UNPROVISIONED',
        state: 'UNPROVISIONED',
        active_epoch: null,
        provision_id: undefined,
        provisioning_key_fingerprint: '',
      }),
    );
    expect(result.status).toBe('accepted');
    expect(states.rows.get(DEVICE)!.correlated).toBe(false);
    expect(states.rows.get(DEVICE)!.requestId).toBeNull();
  });

  it('un request_id desconocido no invalida el mensaje, sólo queda sin correlacionar', async () => {
    const { service, states } = build();
    await service.ingest(DEVICE, validState({ request_id: 'ffffffff-1111-4111-8111-ffffffffffff' }));
    expect(states.rows.get(DEVICE)!.correlated).toBe(false);
  });
});

describe('el estado reportado NO alimenta la secuencia de mando', () => {
  it('ingerir estados jamás reserva ni mueve la secuencia', async () => {
    const { service, orders } = build();
    // Un módulo (o quien pueda publicar en su tópico) declara una secuencia
    // altísima. Si el backend la tomara como referencia, ese publicador
    // elegiría con qué secuencia firma el backend.
    await service.ingest(DEVICE, validState({ last_provisioning_sequence: 9007199254740991 }));
    expect(orders.allocations).toBe(0);
    // Y la siguiente reserva sigue saliendo del lado de mando, desde 1.
    expect(await orders.allocateSequence(DEVICE)).toBe(1n);
  });
});
