import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { getContractValidator } from '../../src/contracts/contract-validator';
import { parseTopic } from '../../src/contracts/topics';
import { MqttService, PublishResult } from '../../src/modules/mqtt/mqtt.service';
import {
  DelegationCredential,
  ProvisioningCommandService,
} from '../../src/modules/provisioning/provisioning-command.service';
import { ProvisioningSigner } from '../../src/modules/provisioning/provisioning-signer';
import {
  EmittedOrderRecord,
  ProvisioningOrderRepositoryPort,
} from '../../src/modules/provisioning/provisioning.ports';
import { AuditService } from '../../src/modules/audit/audit.service';

/** Espía del publicador: apunta TODO, incluido el `retain` con el que se llamó. */
class SpyMqtt {
  readonly calls: Array<{ topic: string; payload: Record<string, unknown>; retain: unknown }> = [];
  result: PublishResult = { delivered: true, denied: false, reasonCode: 0, timedOut: false };
  private readonly validator = getContractValidator();

  async publish(
    topic: string,
    payload: Record<string, unknown>,
    retain?: boolean,
  ): Promise<PublishResult> {
    // Se replica la validación de contrato del MqttService real: si el
    // servicio construyera un payload no conforme, aquí se vería, no en
    // producción.
    const parsed = parseTopic(topic)!;
    const outcome = this.validator.validate(parsed.schema, payload);
    if (!outcome.ok) {
      throw new Error(`payload no conforme: ${outcome.message} ${outcome.errors.join('; ')}`);
    }
    this.calls.push({ topic, payload, retain });
    return this.result;
  }
}

class MemoryOrders implements ProvisioningOrderRepositoryPort {
  readonly emitted: EmittedOrderRecord[] = [];
  next = 0n;
  async allocateSequence(): Promise<bigint> {
    this.next += 1n;
    return this.next;
  }
  async recordEmitted(record: EmittedOrderRecord): Promise<void> {
    this.emitted.push(record);
  }
  async findByRequestId(requestId: string): Promise<EmittedOrderRecord | null> {
    return this.emitted.find((r) => r.requestId === requestId) ?? null;
  }
}

class SpyAudit {
  readonly entries: Array<Record<string, unknown>> = [];
  async record(input: Record<string, unknown>): Promise<void> {
    this.entries.push(input);
  }
}

function ephemeralSigner(): ProvisioningSigner {
  const dir = mkdtempSync(path.join(tmpdir(), 'diana-prov-cmd-'));
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const file = path.join(dir, 'op.pem');
  writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, {
    mode: 0o600,
  });
  return new ProvisioningSigner({ keyFile: file, keyId: 'op-key-test' });
}

const DELEGATION: DelegationCredential = {
  delegationVersion: 1n,
  delegationId: 'dede1111-0000-4000-8000-000000000000',
  rootKeyId: 'root-key-2026',
  operationalKeyId: 'op-key-test',
  operationalPublicKey: 'QUJDREVG',
  scope: 'DIANA_PROVISIONING',
  delegationSequence: 1n,
  systemId: 'system-a',
  rootSignature: 'ZmlybWEtZGUtbGEtcmFpeg',
};

const ACTOR = {
  userId: '99999999-9999-4999-8999-999999999999',
  username: 'admin',
  role: 'administrador',
  permissions: ['*'],
};

function build(): {
  service: ProvisioningCommandService;
  mqtt: SpyMqtt;
  orders: MemoryOrders;
  audit: SpyAudit;
} {
  const mqtt = new SpyMqtt();
  const orders = new MemoryOrders();
  const audit = new SpyAudit();
  const service = new ProvisioningCommandService(
    mqtt as unknown as MqttService,
    orders,
    ephemeralSigner(),
    DELEGATION,
    audit as unknown as AuditService,
  );
  return { service, mqtt, orders, audit };
}

const PROVISION = {
  deviceId: 'module-07',
  systemId: 'system-a',
  action: 'PROVISION' as const,
  provisioningKeyFingerprint: '1f'.repeat(32),
  epoch: '11111111-1111-4111-8111-111111111111',
  provisionId: 'cccccccc-3333-4333-8333-cccccccccccc',
};

describe('emisión de órdenes · retain=false SIEMPRE', () => {
  it('publica con retain FALSE explícito', async () => {
    const { service, mqtt } = build();
    await service.issue(PROVISION, ACTOR);
    expect(mqtt.calls).toHaveLength(1);
    expect(mqtt.calls[0].retain).toBe(false);
    expect(mqtt.calls[0].topic).toBe('targets/v1/module/module-07/provision');
  });

  it('CONTROL POSITIVO: el espía distingue de verdad un retenido', async () => {
    // Sin este control, «retain === false» podría estar pasando porque el
    // espía nunca ve otro valor. Aquí se demuestra que sabría verlo.
    const mqtt = new SpyMqtt();
    await mqtt.publish(
      'targets/v1/module/module-07/provision/state',
      {
        schema_version: 1,
        command_plane: 'DEVICE_MANAGEMENT',
        device_id: 'module-07',
        system_id: 'system-a',
        result: 'AUTHORITY_UNPROVISIONED',
        state: 'UNPROVISIONED',
        active_epoch: null,
        pending_epoch: null,
        last_provisioning_sequence: 0,
        last_delegation_sequence: 0,
        provisioning_key_fingerprint: '',
      },
      true,
    );
    expect(mqtt.calls[0].retain).toBe(true);
  });

  it('el API del servicio no ofrece NINGUNA vía para pedir un retenido', () => {
    // Se comprueba la ARIDAD, no el texto: un parámetro extra en `issue()`
    // —el único método público que publica— cambiaría este número.
    expect(ProvisioningCommandService.prototype.issue.length).toBe(2);
    // Y la única salida a MQTT toma (topic, payload) y nada más: no hay
    // tercer parámetro por el que colar un `retain`.
    const proto = ProvisioningCommandService.prototype as unknown as Record<
      string,
      (...args: unknown[]) => unknown
    >;
    expect(proto.publishNeverRetained.length).toBe(2);
    // Ningún otro método del servicio llama a `mqtt.publish`; si apareciera uno
    // nuevo, esta lista cerrada lo saca a la luz.
    expect(Object.getOwnPropertyNames(ProvisioningCommandService.prototype).sort()).toEqual(
      [
        'constructor',
        'configured',
        'delegationPayload',
        'issue',
        'publishNeverRetained',
        'validateShape',
      ].sort(),
    );
  });

  it('aborta la publicación si el contrato reclasificara el tópico como retenido', async () => {
    const { service, mqtt } = build();
    const topics = require('../../src/contracts/topics');
    const original = topics.parseTopic;
    // Se simula el cambio de contrato interceptando `parseTopic`, que es
    // exactamente de donde el servicio saca la clasificación.
    jest
      .spyOn(topics, 'parseTopic')
      .mockImplementation((topic: unknown) => ({ ...original(topic as string), retain: true }));
    try {
      await expect(service.issue(PROVISION, ACTOR)).rejects.toThrow(/replay servido por el broker/);
      expect(mqtt.calls).toHaveLength(0);
    } finally {
      jest.restoreAllMocks();
    }
  });
});

describe('emisión de órdenes · secuencia, correlación y forma', () => {
  it('cada orden lleva request_id nuevo y secuencia estrictamente creciente', async () => {
    const { service, orders } = build();
    const a = await service.issue(PROVISION, ACTOR);
    const b = await service.issue(
      { ...PROVISION, epoch: '22222222-2222-4222-8222-222222222222' },
      ACTOR,
    );
    expect(a.requestId).not.toBe(b.requestId);
    expect(BigInt(b.provisioningSequence)).toBeGreaterThan(BigInt(a.provisioningSequence));
    expect(orders.emitted.map((r) => r.requestId)).toEqual([a.requestId, b.requestId]);
  });

  it('la orden PROVISION viaja con delegación; PREPARE y COMMIT no', async () => {
    const { service, mqtt } = build();
    await service.issue(PROVISION, ACTOR);
    expect(mqtt.calls[0].payload.delegation).toBeDefined();

    await service.issue(
      {
        deviceId: 'module-07',
        systemId: 'system-a',
        action: 'COMMIT',
        mode: 'NORMAL',
        provisioningKeyFingerprint: '1f'.repeat(32),
        rotationId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
      },
      ACTOR,
    );
    expect(mqtt.calls[1].payload.delegation).toBeUndefined();
    expect(mqtt.calls[1].payload.mode).toBe('NORMAL');
  });

  it('rechaza en el backend lo que el contrato prohíbe por acción', async () => {
    const { service, mqtt } = build();
    await expect(
      service.issue({ ...PROVISION, mode: 'NORMAL' } as never, ACTOR),
    ).rejects.toThrow(/prohíbe mode/);
    await expect(
      service.issue({ ...PROVISION, epoch: undefined } as never, ACTOR),
    ).rejects.toThrow(/exige epoch/);
    await expect(
      service.issue({ ...PROVISION, provisioningKeyFingerprint: 'NO-ES-HEX' }, ACTOR),
    ).rejects.toThrow(/SHA-256/);
    expect(mqtt.calls).toHaveLength(0);
  });

  it('el payload firmado y el publicado son el MISMO mensaje', async () => {
    const { service, mqtt } = build();
    const issued = await service.issue(PROVISION, ACTOR);
    const payload = mqtt.calls[0].payload;
    expect(payload.request_id).toBe(issued.requestId);
    expect(String(payload.provisioning_sequence)).toBe(issued.provisioningSequence);
    expect(payload.signature_alg).toBe('ECDSA-P256-SHA256-P1363-B64URL');
    expect(Buffer.from(String(payload.signature), 'base64url')).toHaveLength(64);
    // Los campos que el contrato prohíbe en PROVISION no viajan ni vacíos: una
    // cadena vacía canonicaliza como ausente, así que emitirla sería firmar una
    // cosa y mandar otra.
    expect(payload).not.toHaveProperty('mode');
    expect(payload).not.toHaveProperty('rotation_id');
  });
});

describe('auditoría · quién ordenó qué', () => {
  it('deja rastro del actor, la acción y el resultado de la publicación', async () => {
    const { service, audit } = build();
    const issued = await service.issue(PROVISION, ACTOR);
    expect(audit.entries).toHaveLength(1);
    const entry = audit.entries[0] as {
      user: typeof ACTOR;
      action: string;
      entityId: string;
      after: Record<string, unknown>;
    };
    expect(entry.user.username).toBe('admin');
    expect(entry.action).toBe('provisioning.provision');
    expect(entry.entityId).toBe(issued.requestId);
    expect(entry.after.publish_outcome).toBe('delivered');
  });

  it('la FIRMA no entra en la auditoría', async () => {
    const { service, audit } = build();
    await service.issue(PROVISION, ACTOR);
    const dump = JSON.stringify(audit.entries);
    expect(dump).not.toMatch(/"signature"/);
    expect(dump).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY/);
  });
});

describe('denegación del broker · no se disfraza de éxito', () => {
  it('una denegación de ACL se propaga y se persiste como tal', async () => {
    const { service, mqtt, orders } = build();
    // Recordatorio medido en P0-2: el código de retorno del cliente NO
    // distingue esto de un envío correcto. Lo único que lo delata es el
    // reasonCode del PUBACK.
    mqtt.result = { delivered: false, denied: true, reasonCode: 135, timedOut: false };
    const issued = await service.issue(PROVISION, ACTOR);
    expect(issued.publish.denied).toBe(true);
    expect(issued.publish.reasonCode).toBe(135);
    expect(orders.emitted[0].publishOutcome).toBe('denied');
    expect(orders.emitted[0].publishReasonCode).toBe(135);
  });

  it('un plazo vencido se informa como NO entregado, nunca como éxito', async () => {
    const { service, mqtt, orders } = build();
    mqtt.result = { delivered: false, denied: false, reasonCode: null, timedOut: true };
    const issued = await service.issue(PROVISION, ACTOR);
    expect(issued.publish.delivered).toBe(false);
    expect(orders.emitted[0].publishOutcome).toBe('timed_out');
  });
});

describe('fallo cerrado sin clave', () => {
  it('sin firmante ni delegación devuelve 503 y no publica nada', async () => {
    const mqtt = new SpyMqtt();
    const service = new ProvisioningCommandService(
      mqtt as unknown as MqttService,
      new MemoryOrders(),
      null,
      null,
    );
    expect(service.configured).toBe(false);
    await expect(service.issue(PROVISION, ACTOR)).rejects.toThrow(/no está configurado/);
    expect(mqtt.calls).toHaveLength(0);
  });
});
