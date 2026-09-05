import { execFileSync, spawnSync } from 'node:child_process';
import { createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { connect, MqttClient } from 'mqtt';

import { AppConfig } from '../../src/config/configuration';
import { getContractValidator } from '../../src/contracts/contract-validator';
import { canonicalizeOrder } from '../../src/modules/provisioning/provisioning-canonical';
import { IngestService } from '../../src/modules/mqtt/ingest.service';
import { MqttService } from '../../src/modules/mqtt/mqtt.service';
import {
  DelegationCredential,
  ProvisioningCommandService,
} from '../../src/modules/provisioning/provisioning-command.service';
import { ProvisioningSigner } from '../../src/modules/provisioning/provisioning-signer';
import { ProvisioningStateService } from '../../src/modules/provisioning/provisioning-state.service';
import {
  EmittedOrderRecord,
  ObservedProvisionState,
  ProvisioningOrderRepositoryPort,
  ProvisioningStateRepositoryPort,
} from '../../src/modules/provisioning/provisioning.ports';

/**
 * PLANO DE APROVISIONAMIENTO CONTRA UN MOSQUITTO DE VERDAD.
 *
 * Contenedor EFÍMERO, nunca el broker de producción. Si no hay docker, el
 * bloque entero se declara NO MEDIDO en voz alta en vez de saltarse en
 * silencio: un `describe.skip` mudo hace creer que algo está probado.
 *
 * Lo que sólo se puede afirmar con un broker real y no con un doble:
 *
 *  1. Que la orden sale con `retain=false` DE VERDAD. Un espía comprueba el
 *     argumento; sólo el broker comprueba el EFECTO, que es lo que importa:
 *     que un cliente que se suscribe DESPUÉS no recibe nada.
 *  2. Que una denegación de ACL se distingue de un envío correcto. Medido en
 *     P0-2: el código de retorno del cliente es 0 en ambos casos; lo único que
 *     las separa es el `reasonCode` del PUBACK (135 = Not authorized).
 *  3. Que un `provision/state` publicado por un módulo atraviesa la ingesta
 *     entera y acaba persistido y correlacionado.
 */

const IMAGE = 'eclipse-mosquitto:2';
const DEVICE = 'module-07';
const SYSTEM = 'system-a';
const FPRINT = '1f'.repeat(32);

function dockerAvailable(): boolean {
  const probe = spawnSync('docker', ['info'], { stdio: 'ignore' });
  return probe.status === 0;
}

interface Broker {
  container: string;
  port: number;
  stop(): void;
}

function startBroker(): Broker {
  const dir = mkdtempSync(path.join(tmpdir(), 'diana-mosq-'));
  // `mkdtemp` crea el directorio con 0700 y el proceso del contenedor corre
  // como el usuario `mosquitto` (uid 1883), que entonces no puede ni
  // atravesarlo: el broker arranca, no encuentra su configuración y muere.
  // Desde fuera eso se ve como un ECONNREFUSED, que es un síntoma que no
  // apunta a su causa.
  chmodSync(dir, 0o755);
  const port = 21000 + Math.floor(Math.random() * 900);
  const container = `diana-prov-test-${port}`;

  // Dos usuarios: uno con escritura y otro SIN ella sobre el canal de órdenes.
  // El segundo es lo que convierte «no vi el mensaje» en «el broker lo denegó».
  writeFileSync(
    path.join(dir, 'mosquitto.conf'),
    [
      'listener 1883 0.0.0.0',
      'allow_anonymous false',
      'password_file /mosquitto/config/passwd',
      'acl_file /mosquitto/config/acl',
      'persistence false',
      'log_type warning',
      '',
    ].join('\n'),
  );
  writeFileSync(
    path.join(dir, 'acl'),
    [
      'user backend',
      'topic readwrite targets/v1/#',
      '',
      'user sinpermiso',
      'topic read targets/v1/#',
      '',
    ].join('\n'),
  );
  // Las contraseñas son de un contenedor efímero que muere con el test. Aun
  // así NO viajan por `argv`: se escriben en un fichero y `mosquitto_passwd -U`
  // lo convierte en su lugar. `mosquitto_passwd -b <usuario> <clave>` habría
  // dejado la clave en la línea de órdenes, legible en `/proc`.
  const passwdFile = path.join(dir, 'passwd');
  writeFileSync(passwdFile, 'backend:backendpw\nsinpermiso:otropw\n', { mode: 0o644 });

  // El hash se produce ANTES de arrancar el broker: mosquitto 2 aborta el
  // arranque si `password_file` no existe o está en claro, y un contenedor
  // muerto se manifiesta como un `docker exec` que falla, no como un fallo del
  // plano que se está probando.
  execFileSync('docker', [
    'run', '--rm',
    '-v', `${dir}:/mosquitto/config`,
    '--entrypoint', 'mosquitto_passwd',
    IMAGE, '-U', '/mosquitto/config/passwd',
  ]);

  execFileSync('docker', [
    'run', '-d', '--rm',
    '--name', container,
    '-p', `${port}:1883`,
    '-v', `${dir}:/mosquitto/config`,
    IMAGE,
  ]);

  return {
    container,
    port,
    stop: () => {
      spawnSync('docker', ['rm', '-f', container], { stdio: 'ignore' });
    },
  };
}

function config(port: number, username: string, password: string): AppConfig {
  return {
    mqtt: {
      url: `mqtt://127.0.0.1:${port}`,
      caFile: null,
      username,
      password,
      clientId: `diana-test-${username}-${Math.random().toString(36).slice(2)}`,
      enabled: true,
      publishAckTimeoutMs: 4000,
    },
    ingest: { maxPersistLatencyMs: 5000 },
  } as unknown as AppConfig;
}

/** Prisma mínimo: sólo se usa para dejar la incidencia de publicación denegada. */
const prismaStub = {
  incident: { create: async () => undefined },
} as never;

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

class MemoryStates implements ProvisioningStateRepositoryPort {
  readonly rows = new Map<string, ObservedProvisionState>();
  async upsertObserved(state: ObservedProvisionState): Promise<void> {
    this.rows.set(state.deviceId, state);
  }
  async findLatest(deviceId: string): Promise<ObservedProvisionState | null> {
    return this.rows.get(deviceId) ?? null;
  }
}

function ephemeralSigner(): ProvisioningSigner {
  const dir = mkdtempSync(path.join(tmpdir(), 'diana-prov-int-'));
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const file = path.join(dir, 'op.pem');
  writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, {
    mode: 0o600,
  });
  return new ProvisioningSigner({ keyFile: file, keyId: 'op-key-int' });
}

const DELEGATION: DelegationCredential = {
  delegationVersion: 1n,
  delegationId: 'dede1111-0000-4000-8000-000000000000',
  rootKeyId: 'root-key-2026',
  operationalKeyId: 'op-key-int',
  operationalPublicKey: 'QUJDREVG',
  scope: 'DIANA_PROVISIONING',
  delegationSequence: 1n,
  systemId: SYSTEM,
  rootSignature: 'ZmlybWEtZGUtbGEtcmFpeg',
};

const ACTOR = {
  userId: '99999999-9999-4999-8999-999999999999',
  username: 'admin',
  role: 'administrador',
  permissions: ['*'],
};

/** Cliente MQTT5 desnudo, para observar el broker sin pasar por el backend. */
function rawClient(port: number, user: string, pass: string): Promise<MqttClient> {
  return new Promise((resolve, reject) => {
    const client = connect(`mqtt://127.0.0.1:${port}`, {
      username: user,
      password: pass,
      protocolVersion: 5,
      clean: true,
      reconnectPeriod: 0,
    });
    client.once('connect', () => resolve(client));
    client.once('error', reject);
  });
}

function waitForMessage(
  client: MqttClient,
  ms: number,
): Promise<{ topic: string; payload: Buffer; retain: boolean } | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      client.removeListener('message', handler);
      resolve(null);
    }, ms);
    const handler = (topic: string, payload: Buffer, packet: { retain?: boolean }): void => {
      clearTimeout(timer);
      client.removeListener('message', handler);
      resolve({ topic, payload, retain: packet.retain === true });
    };
    client.on('message', handler);
  });
}

const available = dockerAvailable();

if (!available) {
  describe('plano de aprovisionamiento contra Mosquitto real', () => {
    it('NO MEDIDO: no hay docker en esta máquina; el test queda listo pero sin ejecutar', () => {
      expect(available).toBe(false);
    });
  });
} else {
  describe('plano de aprovisionamiento contra Mosquitto real', () => {
    let broker: Broker;
    let mqtt: MqttService;
    let commands: ProvisioningCommandService;
    let orders: MemoryOrders;
    let states: MemoryStates;
    let stateService: ProvisioningStateService;
    let ingest: IngestService;
    let signer: ProvisioningSigner;
    const openClients: MqttClient[] = [];

    beforeAll(async () => {
      broker = startBroker();
      // Espera ACTIVA a que el broker acepte credenciales, no un sleep fijo:
      // un `sleep` corto da un fallo intermitente y uno largo alarga el test.
      for (let attempt = 0; attempt < 40; attempt += 1) {
        try {
          const probe = await rawClient(broker.port, 'backend', 'backendpw');
          probe.end(true);
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 250));
        }
      }

      orders = new MemoryOrders();
      states = new MemoryStates();
      const validator = getContractValidator();
      stateService = new ProvisioningStateService(validator, states, orders);
      ingest = new IngestService(
        validator,
        { insertIfAbsent: async () => ({ inserted: true, id: 'x' }) } as never,
        { record: async () => undefined } as never,
        undefined,
        undefined,
        undefined,
        undefined,
        stateService,
      );
      mqtt = new MqttService(
        config(broker.port, 'backend', 'backendpw'),
        validator,
        ingest,
        prismaStub,
      );
      await mqtt.onModuleInit();
      for (let attempt = 0; attempt < 40 && !mqtt.connected; attempt += 1) {
        await new Promise((r) => setTimeout(r, 250));
      }
      signer = ephemeralSigner();
      commands = new ProvisioningCommandService(mqtt, orders, signer, DELEGATION);
    }, 120000);

    afterAll(async () => {
      for (const client of openClients) client.end(true);
      await mqtt?.onModuleDestroy();
      broker?.stop();
    }, 60000);

    it('el backend está conectado al broker efímero', () => {
      expect(mqtt.connected).toBe(true);
    });

    it('CONTROL POSITIVO · una orden válida sale, llega y su FIRMA verifica', async () => {
      const listener = await rawClient(broker.port, 'backend', 'backendpw');
      openClients.push(listener);
      await new Promise<void>((resolve, reject) =>
        listener.subscribe(`targets/v1/module/${DEVICE}/provision`, { qos: 1 }, (e) =>
          e ? reject(e) : resolve(),
        ),
      );
      const arrival = waitForMessage(listener, 8000);

      const issued = await commands.issue(
        {
          deviceId: DEVICE,
          systemId: SYSTEM,
          action: 'PROVISION',
          provisioningKeyFingerprint: FPRINT,
          epoch: '11111111-1111-4111-8111-111111111111',
          provisionId: 'cccccccc-3333-4333-8333-cccccccccccc',
        },
        ACTOR,
      );

      expect(issued.publish.delivered).toBe(true);
      expect(issued.publish.denied).toBe(false);

      const message = await arrival;
      expect(message).not.toBeNull();
      expect(message!.retain).toBe(false);

      const payload = JSON.parse(message!.payload.toString('utf8')) as Record<string, unknown>;
      expect(payload.request_id).toBe(issued.requestId);
      expect(payload.command_plane).toBe('DEVICE_MANAGEMENT');
      expect(payload.delegation).toBeDefined();

      // La firma se verifica sobre la canónica RECONSTRUIDA desde el mensaje
      // que salió por el cable, no desde la estructura interna del emisor: es
      // lo que hará el módulo.
      const canonical = canonicalizeOrder({
        action: payload.action as 'PROVISION',
        mode: (payload.mode as 'NORMAL' | undefined) ?? null,
        systemId: payload.system_id as string,
        deviceId: payload.device_id as string,
        provisioningSequence: BigInt(payload.provisioning_sequence as number),
        rotationId: (payload.rotation_id as string) ?? null,
        currentEpoch: (payload.current_epoch as string) ?? null,
        nextEpoch: (payload.next_epoch as string) ?? null,
        epoch: (payload.epoch as string) ?? null,
        issuedAtMs: BigInt(payload.issued_at_ms as number),
        provisioningKeyFingerprint: payload.provisioning_key_fingerprint as string,
        provisionId: (payload.provision_id as string) ?? null,
      });
      const pub = createPublicKey({
        key: Buffer.from(signer.publicKeySpki, 'base64url'),
        format: 'der',
        type: 'spki',
      });
      const verifier = createVerify('sha256');
      verifier.update(canonical);
      verifier.end();
      const signature = Buffer.from(String(payload.signature), 'base64url');
      expect(
        verifier.verify({ key: pub, dsaEncoding: 'ieee-p1363' }, signature),
      ).toBe(true);

      // CONTROL NEGATIVO en el mismo sitio: un byte cambiado invalida.
      const tampered = Buffer.from(canonical);
      tampered[tampered.length - 1] ^= 0x01;
      const badVerifier = createVerify('sha256');
      badVerifier.update(tampered);
      badVerifier.end();
      expect(badVerifier.verify({ key: pub, dsaEncoding: 'ieee-p1363' }, signature)).toBe(false);
    }, 60000);

    it('la orden NO queda retenida: quien se suscribe DESPUÉS no recibe nada', async () => {
      // El mensaje anterior ya se publicó. Un cliente nuevo que se suscriba
      // ahora no debe recibir absolutamente nada del canal de órdenes.
      const late = await rawClient(broker.port, 'backend', 'backendpw');
      openClients.push(late);
      await new Promise<void>((resolve, reject) =>
        late.subscribe(`targets/v1/module/${DEVICE}/provision`, { qos: 1 }, (e) =>
          e ? reject(e) : resolve(),
        ),
      );
      expect(await waitForMessage(late, 3000)).toBeNull();
    }, 60000);

    it('CONTROL POSITIVO del test anterior · un retenido SÍ llega a quien se suscribe después', async () => {
      // Sin esto, «no llegó nada» podría deberse a una suscripción rota, no a
      // la ausencia de retención. Aquí se demuestra que el mismo montaje SÍ ve
      // un retenido cuando lo hay — y se usa `provision/state`, que el
      // contrato SÍ retiene.
      const publisher = await rawClient(broker.port, 'backend', 'backendpw');
      openClients.push(publisher);
      const retained = JSON.stringify({
        schema_version: 1,
        command_plane: 'DEVICE_MANAGEMENT',
        device_id: DEVICE,
        system_id: SYSTEM,
        result: 'AUTHORITY_UNPROVISIONED',
        state: 'UNPROVISIONED',
        active_epoch: null,
        pending_epoch: null,
        last_provisioning_sequence: 0,
        last_delegation_sequence: 0,
        provisioning_key_fingerprint: '',
      });
      await new Promise<void>((resolve, reject) =>
        publisher.publish(
          `targets/v1/module/${DEVICE}/provision/state`,
          retained,
          { qos: 1, retain: true },
          (e) => (e ? reject(e) : resolve()),
        ),
      );

      const late = await rawClient(broker.port, 'backend', 'backendpw');
      openClients.push(late);
      await new Promise<void>((resolve, reject) =>
        late.subscribe(`targets/v1/module/${DEVICE}/provision/state`, { qos: 1 }, (e) =>
          e ? reject(e) : resolve(),
        ),
      );
      const message = await waitForMessage(late, 5000);
      expect(message).not.toBeNull();
      expect(message!.retain).toBe(true);
    }, 60000);

    it('CONTROL POSITIVO · un provision/state real atraviesa la ingesta y se persiste', async () => {
      const emitted = orders.emitted[0];
      expect(emitted).toBeDefined();

      const module = await rawClient(broker.port, 'backend', 'backendpw');
      openClients.push(module);
      const state = JSON.stringify({
        schema_version: 1,
        command_plane: 'DEVICE_MANAGEMENT',
        request_id: emitted.requestId,
        device_id: DEVICE,
        system_id: SYSTEM,
        result: 'PROVISIONED',
        state: 'READY',
        active_epoch: '11111111-1111-4111-8111-111111111111',
        pending_epoch: null,
        provision_id: 'cccccccc-3333-4333-8333-cccccccccccc',
        last_provisioning_sequence: Number(emitted.provisioningSequence),
        last_delegation_sequence: 1,
        provisioning_key_fingerprint: FPRINT,
      });
      await new Promise<void>((resolve, reject) =>
        module.publish(
          `targets/v1/module/${DEVICE}/provision/state`,
          state,
          { qos: 1, retain: true },
          (e) => (e ? reject(e) : resolve()),
        ),
      );

      // Espera por la CONDICIÓN, no por un plazo fijo.
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const row = states.rows.get(DEVICE);
        if (row?.result === 'PROVISIONED') break;
        await new Promise((r) => setTimeout(r, 200));
      }

      const row = states.rows.get(DEVICE);
      expect(row).toBeDefined();
      expect(row!.result).toBe('PROVISIONED');
      expect(row!.state).toBe('READY');
      expect(row!.requestId).toBe(emitted.requestId);
      expect(row!.correlated).toBe(true);
      expect(row!.lastProvisioningSequence).toBe(emitted.provisioningSequence);

      // NO_SECRET_IN_STATE sobre lo REALMENTE ingerido del broker.
      const dump = JSON.stringify(row, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
      expect(dump).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY/);
      expect(dump).not.toMatch(/backendpw|otropw/);
      expect(dump).not.toMatch(/password|secret|private/i);
    }, 90000);

    it('una denegación de ACL se ve por el reasonCode, no por el código de retorno', async () => {
      // Recordatorio medido en P0-2: `mosquitto_pub` devuelve rc=0 con un
      // «Warning: … Not authorized». Aquí se comprueba en el camino real del
      // backend: el PUBACK trae 135 y `publish()` lo traduce a `denied`.
      const weak = new MqttService(
        config(broker.port, 'sinpermiso', 'otropw'),
        getContractValidator(),
        ingest,
        prismaStub,
      );
      await weak.onModuleInit();
      for (let attempt = 0; attempt < 40 && !weak.connected; attempt += 1) {
        await new Promise((r) => setTimeout(r, 250));
      }
      expect(weak.connected).toBe(true);

      const denied = new ProvisioningCommandService(
        weak,
        new MemoryOrders(),
        signer,
        DELEGATION,
      );
      const issued = await denied.issue(
        {
          deviceId: DEVICE,
          systemId: SYSTEM,
          action: 'PROVISION',
          provisioningKeyFingerprint: FPRINT,
          epoch: '22222222-2222-4222-8222-222222222222',
          provisionId: 'dddddddd-4444-4444-8444-dddddddddddd',
        },
        ACTOR,
      );

      expect(issued.publish.delivered).toBe(false);
      expect(issued.publish.denied).toBe(true);
      expect(issued.publish.reasonCode).toBe(135);
      await weak.onModuleDestroy();
    }, 90000);
  });
}
