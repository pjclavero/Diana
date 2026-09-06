/**
 * ============================================================================
 * E2E-3 · DEVICE MANAGEMENT — el escenario completo, extremo a extremo
 * ============================================================================
 *
 *   backend/coordinator → orden FIRMADA (P-256, canónica con prefijo de
 *   longitud) → Mosquitto REAL con TLS y la ACL del repositorio → suscripción
 *   REAL del módulo → diana_prov_message() (firmware D1b compilado en host) →
 *   efecto PERSISTIDO en NVS → provision/state publicado por el módulo →
 *   ingesta del backend → PostgreSQL.
 *
 * Ningún tramo está simulado por un doble:
 *  · el emisor es `ProvisioningCommandService`, el del backend, con su firmante
 *    y su `publishNeverRetained()`; no se ha escrito otro emisor;
 *  · el broker es un contenedor efímero de `eclipse-mosquitto:2` con TLS y con
 *    `infrastructure/mosquitto/acl` copiada verbatim;
 *  · el dispositivo es `diana_core` compilado con gcc y ejercido por su camino
 *    de runtime real (`diana_prov_message`), con NVS que sobrevive entre
 *    mensajes y entre reinicios;
 *  · la BD es PostgreSQL con las migraciones del repo y los repositorios
 *    Prisma reales.
 *
 * LO QUE ESTE CARRIL NO PUEDE AFIRMAR: no hay silicio. El firmware se ejerce
 * COMPILADO EN HOST. Todo lo relativo a la ESP32 física —cliente MQTT del
 * firmware sobre TLS, NVS de verdad, arranque, temporización— es
 * PENDING_PHYSICAL_VALIDATION. Ver README.md del carril.
 */
import { execFileSync } from 'node:child_process';
import { connect, IClientOptions, MqttClient } from 'mqtt';
import { readFileSync } from 'node:fs';

import { AppConfig } from '../../../server/backend/src/config/configuration';
import { getContractValidator } from '../../../server/backend/src/contracts/contract-validator';
import { topics } from '../../../server/backend/src/contracts/topics';
import { IngestService } from '../../../server/backend/src/modules/mqtt/ingest.service';
import { MqttService } from '../../../server/backend/src/modules/mqtt/mqtt.service';
import { ProvisioningCommandService } from '../../../server/backend/src/modules/provisioning/provisioning-command.service';
import { ProvisioningSigner } from '../../../server/backend/src/modules/provisioning/provisioning-signer';
import { ProvisioningStateService } from '../../../server/backend/src/modules/provisioning/provisioning-state.service';
import {
  EmittedOrderRecord,
  ProvisioningOrderRepositoryPort,
} from '../../../server/backend/src/modules/provisioning/provisioning.ports';

import { dockerAvailable, EphemeralBroker, startBroker } from './harness/broker';
import { backendDir, EphemeralDatabase, startDatabase } from './harness/database';
import { buildRunner, DeviceOutcome, HostDevice } from './harness/device';
import { Authority, generateAuthority } from './harness/pki';

/* ------------------------------------------------------------- constantes -- */

const DEVICE = 'module-01';
const OTHER_DEVICE = 'module-02';
const SYSTEM = 'system-a';
const FOREIGN_SYSTEM = 'system-intruso';
/** Huella PÚBLICA de la clave de fábrica. Identificador, no secreto. */
const FPRINT = 'ab'.repeat(32);
const PASSWORDS: Record<string, string> = {
  backend: 'e2e-backend-pw',
  [DEVICE]: 'e2e-module-01-pw',
  [OTHER_DEVICE]: 'e2e-module-02-pw',
};
const ACTOR = {
  userId: '11111111-2222-4333-8444-555555555555',
  username: 'operador-e2e',
  role: 'administrador',
  permissions: ['*'],
};

const available = dockerAvailable();

/* --------------------------------------------------------------- utillaje -- */

interface Arrival {
  topic: string;
  payload: Buffer;
  retain: boolean;
}

function tlsClient(
  broker: EphemeralBroker,
  user: string,
  extra: Partial<IClientOptions> = {},
): Promise<MqttClient> {
  return new Promise((resolve, reject) => {
    const client = connect(broker.url, {
      username: user,
      password: PASSWORDS[user],
      protocolVersion: 5,
      clean: true,
      reconnectPeriod: 0,
      ca: readFileSync(broker.tls.caFile),
      rejectUnauthorized: true,
      ...extra,
    });
    const timer = setTimeout(() => reject(new Error(`${user} no conectó por TLS`)), 20000);
    client.once('connect', () => {
      clearTimeout(timer);
      resolve(client);
    });
    client.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

function subscribe(client: MqttClient, filter: string): Promise<number[]> {
  return new Promise((resolve, reject) => {
    client.subscribe(filter, { qos: 1 }, (err, granted) => {
      if (err) reject(err);
      else resolve((granted ?? []).map((g) => g.qos as number));
    });
  });
}

/** Publica y devuelve el `reasonCode` del PUBACK (135 = Not authorized). */
function publishWithReason(
  client: MqttClient,
  topic: string,
  payload: string,
  retain: boolean,
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    client.publish(topic, payload, { qos: 1, retain }, (err, packet) => {
      if (err) {
        // MEDIDO: mqtt.js entrega la denegación de ACL como un
        // `ErrorWithReasonCode` en el callback, no como un `packet` con
        // reasonCode. El `rc` del proceso es 0 en ambos casos, así que lo
        // único que distingue «publicado» de «denegado» es este código.
        const code = (err as { code?: number }).code;
        if (typeof code === 'number') resolve(code);
        else reject(err);
        return;
      }
      const code = (packet as { reasonCode?: number } | undefined)?.reasonCode;
      resolve(typeof code === 'number' ? code : null);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/* ------------------------------------------------------------- el carril --- */

if (!available) {
  describe('E2E-3 · DEVICE MANAGEMENT', () => {
    it('NO MEDIDO: no hay docker en esta máquina; el escenario NO se ha ejercido', () => {
      // Un `describe.skip` mudo haría creer que algo se probó. Esto lo dice.
      expect(available).toBe(false);
    });
  });
} else {
  describe('E2E-3 · DEVICE MANAGEMENT (broker TLS real + firmware en host + BD real)', () => {
    let broker: EphemeralBroker;
    let database: EphemeralDatabase;
    let authority: Authority;
    let signer: ProvisioningSigner;
    let mqtt: MqttService;
    let commands: ProvisioningCommandService;
    let stateService: ProvisioningStateService;
    let orders: ProvisioningOrderRepositoryPort;
    let prisma: { $queryRaw: unknown; $disconnect: () => Promise<void> } & Record<string, any>;
    let device: HostDevice;
    let runnerBinary: string;
    let moduleClient: MqttClient;
    /**
     * Cliente del SEGUNDO módulo. No es un espía genérico y no puede serlo:
     * con `use_username_as_clientid true` el broker reescribe el client_id con
     * el usuario autenticado, así que dos conexiones del MISMO usuario se
     * expulsan la una a la otra —medido: el backend perdía la conexión y sus
     * publicaciones se encolaban—. Cada identidad tiene exactamente un cliente,
     * que es además como se comportan los módulos de verdad.
     */
    let otherClient: MqttClient;
    const openClients: MqttClient[] = [];

    /** Cola de órdenes que el módulo ha recibido POR EL BROKER. */
    const inbox: Arrival[] = [];
    const otherInbox: Arrival[] = [];

    async function waitFor(box: Arrival[], predicate: (a: Arrival) => boolean, ms: number) {
      const deadline = Date.now() + ms;
      for (;;) {
        const hit = box.find(predicate);
        if (hit) return hit;
        if (Date.now() > deadline) return null;
        await sleep(50);
      }
    }

    /** Filas realmente escritas en PostgreSQL. */
    async function observedRows(deviceId: string): Promise<any[]> {
      return prisma.provisioningStateObservation.findMany({ where: { deviceId } });
    }
    async function orderRows(deviceId: string): Promise<any[]> {
      return prisma.provisioningOrder.findMany({ where: { deviceId } });
    }

    beforeAll(async () => {
      runnerBinary = buildRunner();
      database = startDatabase();
      process.env.DATABASE_URL = database.url;

      broker = startBroker(PASSWORDS);
      // Espera ACTIVA a que el broker acepte credenciales por TLS.
      let up = false;
      for (let i = 0; i < 60 && !up; i += 1) {
        try {
          const probe = await tlsClient(broker, 'backend');
          probe.end(true);
          up = true;
        } catch {
          await sleep(500);
        }
      }
      if (!up) throw new Error(`el broker efímero no aceptó TLS. Logs:\n${broker.logs()}`);

      authority = generateAuthority(SYSTEM);
      signer = new ProvisioningSigner({
        keyFile: authority.operationalKeyFile,
        keyId: authority.operationalKeyId,
      });

      // Repositorios PRISMA REALES contra la BD efímera.
      const {
        PrismaProvisioningOrderRepository,
        PrismaProvisioningStateRepository,
        // eslint-disable-next-line @typescript-eslint/no-var-requires
      } = require('../../../server/backend/src/modules/provisioning/provisioning.repository');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { PrismaService } = require('../../../server/backend/src/common/prisma/prisma.service');
      prisma = new PrismaService();
      await prisma.$connect();
      orders = new PrismaProvisioningOrderRepository(prisma);
      const states = new PrismaProvisioningStateRepository(prisma);

      const validator = getContractValidator();
      stateService = new ProvisioningStateService(validator, states, orders);
      const ingest = new IngestService(
        validator,
        { insertIfAbsent: async () => ({ inserted: true, id: 'x' }) } as never,
        { record: async () => undefined } as never,
        undefined,
        undefined,
        undefined,
        undefined,
        stateService,
      );

      const config = {
        mqtt: {
          url: broker.url,
          caFile: broker.tls.caFile,
          username: 'backend',
          password: PASSWORDS.backend,
          clientId: 'backend',
          enabled: true,
          publishAckTimeoutMs: 6000,
        },
        ingest: { maxPersistLatencyMs: 5000 },
      } as unknown as AppConfig;

      mqtt = new MqttService(config, validator, ingest, prisma as never);
      await mqtt.onModuleInit();
      for (let i = 0; i < 60 && !mqtt.connected; i += 1) await sleep(250);
      if (!mqtt.connected) throw new Error('el backend no se conectó al broker por TLS');

      commands = new ProvisioningCommandService(mqtt, orders, signer, authority.delegation);

      // EL MÓDULO: suscripción REAL a su canal de órdenes, con su identidad.
      moduleClient = await tlsClient(broker, DEVICE);
      openClients.push(moduleClient);
      moduleClient.on('message', (topic, payload, packet) => {
        inbox.push({ topic, payload, retain: packet.retain === true });
      });
      const granted = await subscribe(moduleClient, topics.moduleProvisionCommand(DEVICE));
      if (granted[0] === 128) throw new Error('el módulo no pudo suscribirse a su propio canal');

      // El SEGUNDO módulo, con su propia identidad, suscrito a SU canal.
      otherClient = await tlsClient(broker, OTHER_DEVICE);
      openClients.push(otherClient);
      otherClient.on('message', (topic, payload, packet) => {
        otherInbox.push({ topic, payload, retain: packet.retain === true });
      });
      const grantedOther = await subscribe(
        otherClient,
        topics.moduleProvisionCommand(OTHER_DEVICE),
      );
      if (grantedOther[0] === 128) {
        throw new Error('module-02 no pudo suscribirse a su propio canal');
      }

      device = await HostDevice.start({
        binary: runnerBinary,
        deviceId: DEVICE,
        systemId: SYSTEM,
        fingerprint: FPRINT,
        rootPublicKeySec1: authority.rootPublicKeySec1,
        rootKeyId: authority.rootKeyId,
      });
    }, 600000);

    afterAll(async () => {
      device?.stop();
      for (const c of openClients) c.end(true);
      await mqtt?.onModuleDestroy();
      await prisma?.$disconnect();
      broker?.stop();
      database?.stop();
    }, 120000);

    /* ------------------------------------------------------- preámbulo ----- */

    it('el transporte se ha ejercido DE VERDAD: TLS, sin listener en claro', async () => {
      expect(mqtt.connected).toBe(true);
      expect(broker.url.startsWith('mqtts://')).toBe(true);
      // El broker no escucha en claro: la conexión sin TLS al mismo puerto no
      // llega a establecerse. Es el EFECTO, no la lectura del fichero de
      // configuración.
      const plain = await new Promise<string>((resolve) => {
        const c = connect(`mqtt://127.0.0.1:${broker.port}`, {
          username: 'backend',
          password: PASSWORDS.backend,
          reconnectPeriod: 0,
          connectTimeout: 4000,
        });
        c.once('connect', () => {
          c.end(true);
          resolve('conectó');
        });
        c.once('error', () => {
          c.end(true);
          resolve('rechazado');
        });
        setTimeout(() => {
          c.end(true);
          resolve('rechazado');
        }, 5000);
      });
      expect(plain).toBe('rechazado');
    }, 60000);

    /* --------------------------------------------- CONTROL POSITIVO -------- */

    const EPOCH_OK = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    const PROVISION_ID = 'cccccccc-3333-4333-8333-cccccccccccc';
    let positivePayload: Buffer;      // el que salió del backend, TAL CUAL
    let applicablePayload: string;    // el mismo + delegation.signature_alg
    let positiveRequestId: string;

    /**
     * DEFECTO DE INTEROPERACIÓN MEDIDO EN ESTE CARRIL (ver README §Hallazgos).
     *
     * `conforms()` del firmware exige `delegation.signature_alg`
     * (components/diana_core/src/provisioning.c, línea del bloque
     * `if (c->has_delegation)`), pero el objeto `delegation` de
     * `contracts/mqtt/module-provision-command.schema.json` NO declara ese
     * campo y lleva `additionalProperties: false`. El backend, que valida cada
     * publicación contra el esquema, NO PUEDE emitirlo. Resultado: TODA orden
     * PROVISION conforme al contrato muere en el módulo como
     * `malformed_provisioning_message`.
     *
     * Esta función construye el payload que el firmware SÍ acepta añadiendo
     * ESE ÚNICO campo. No es un arreglo ni un atajo: es el diferencial que
     * demuestra la causa, y todo lo que se mida con él va etiquetado como
     * «fuera de contrato» en el informe.
     */
    /**
     * El backend YA emite `delegation.signature_alg` (GAP-D1B-DELEG-ALG
     * cerrado). Este ayudante existe ahora para lo contrario: QUITARLO, y poder
     * demostrar que sin ese campo la orden muere como malformed. Antes anadia
     * el campo a mano porque el emisor no lo ponia, y el arnes codificaba el
     * defecto como comportamiento esperado.
     */
    function withoutDelegationAlg(raw: Buffer | string): string {
      const payload = JSON.parse(raw.toString()) as Record<string, any>;
      if (!payload.delegation) throw new Error('esta orden no lleva delegación');
      delete payload.delegation.signature_alg;
      return JSON.stringify(payload);
    }

    /** Identidad: lo que emite el backend ya es aplicable tal cual. */
    function withDelegationAlg(raw: Buffer | string): string {
      return raw.toString();
    }

    it('CONTROL POSITIVO · una orden válida produce EXACTAMENTE UN efecto en el módulo y UNA fila en la BD', async () => {
      const before = await device.snapshot();
      expect(before.state).toBe('UNPROVISIONED');
      expect(before.kvWrites).toBe(0);

      const issued = await commands.issue(
        {
          deviceId: DEVICE,
          systemId: SYSTEM,
          action: 'PROVISION',
          provisioningKeyFingerprint: FPRINT,
          epoch: EPOCH_OK,
          provisionId: PROVISION_ID,
        },
        ACTOR,
      );
      positiveRequestId = issued.requestId;
      expect(issued.publish.delivered).toBe(true);
      expect(issued.publish.denied).toBe(false);

      // El módulo lo recibe POR EL BROKER, en su propio canal, sin retener.
      const arrival = await waitFor(
        inbox,
        (a) => a.topic === topics.moduleProvisionCommand(DEVICE),
        15000,
      );
      expect(arrival).not.toBeNull();
      expect(arrival!.retain).toBe(false);
      positivePayload = arrival!.payload;

      // ── D1b: el camino de runtime del firmware ──────────────────────────
      // El payload TAL COMO SALIÓ DEL BACKEND se aplica, sin parchear nada.
      //
      // Este bloque tenía antes un diferencial que exigía lo contrario
      // (`asWired.applied === false`, muerto por `malformed`): documentaba
      // GAP-D1B-DELEG-ALG, con el emisor sin poner `delegation.signature_alg`.
      // Cerrado el gap en el emisor, mantener aquella expectativa habría
      // convertido el arnés en guardián del defecto. La mitad negativa no se
      // pierde: vive en el caso de regresión, que quita el campo a propósito y
      // exige que muera.
      applicablePayload = positivePayload.toString();
      const outcome = await device.feed(applicablePayload, false);
      expect(outcome.applied).toBe(true);
      expect(outcome.authorityChanged).toBe(true);
      expect(outcome.result).toBe('PROVISIONED');
      expect(outcome.state).toBe('READY');
      expect(outcome.reason).toBe('');
      // La traza demuestra el ORDEN de verificación ejecutado, no sólo el veredicto.
      expect(outcome.trace.length).toBeGreaterThan(0);

      // EFECTO PERSISTIDO, medido con el estado y los contadores.
      const after = outcome.snapshot;
      expect(after.state).toBe('READY');
      expect(after.activeEpoch).toBe(EPOCH_OK);
      expect(after.lastProvSeq).toBe(Number(issued.provisioningSequence));
      expect(after.hasOpKey).toBe(true);
      expect(after.hasDelegFingerprint).toBe(true);
      expect(after.kvWrites).toBeGreaterThan(0);
      expect(outcome.bootstraps).toBe(1);

      // El estado SOBREVIVE a un reinicio: la autoridad vive en NVS.
      const rebooted = await device.reboot();
      expect(rebooted.state).toBe('READY');
      expect(rebooted.activeEpoch).toBe(EPOCH_OK);
      expect(rebooted.lastProvSeq).toBe(Number(issued.provisioningSequence));

      // ── provision/state → backend → BD ──────────────────────────────────
      const stateJson = JSON.stringify(outcome.stateJson);
      const reason = await publishWithReason(
        moduleClient,
        topics.moduleProvisionState(DEVICE),
        stateJson,
        true, // el ESTADO sí se retiene; el comando nunca
      );
      expect(reason === null || reason < 0x80).toBe(true);

      let rows: any[] = [];
      for (let i = 0; i < 60 && rows.length === 0; i += 1) {
        rows = await observedRows(DEVICE);
        if (rows.length === 0) await sleep(250);
      }
      expect(rows).toHaveLength(1);
      expect(rows[0].result).toBe('PROVISIONED');
      expect(rows[0].state).toBe('READY');
      expect(rows[0].activeEpoch).toBe(EPOCH_OK);
      expect(rows[0].requestId).toBe(issued.requestId);
      expect(rows[0].correlated).toBe(true);

      const emitted = await orderRows(DEVICE);
      expect(emitted).toHaveLength(1);
      expect(emitted[0].publishOutcome).toBe('delivered');
    }, 180000);

    it('GAP-D1B-DELEG-ALG (CERRADO) · lo que emite el backend se aplica tal cual, y sin signature_alg muere', async () => {
      // Se repite el diferencial sobre un módulo VIRGEN, para que no dependa
      // del estado que dejó el control positivo:
      //   · payload EXACTAMENTE como lo emitió el backend  → malformado
      //   · el MISMO payload + `delegation.signature_alg`  → aplicado
      // Un único campo separa las dos ramas, y el contrato PROHÍBE ese campo
      // (`additionalProperties: false` en el objeto `delegation` de
      // module-provision-command.schema.json), mientras que `conforms()` del
      // firmware lo EXIGE. Conclusión: hoy ninguna orden PROVISION conforme al
      // contrato puede aprovisionar un módulo.
      const fresh = await HostDevice.start({
        binary: runnerBinary,
        deviceId: DEVICE,
        systemId: SYSTEM,
        fingerprint: FPRINT,
        rootPublicKeySec1: authority.rootPublicKeySec1,
        rootKeyId: authority.rootKeyId,
      });
      try {
        // 1. Sin el campo: muere como malformed, CERO escrituras. Es la mitad
        //    negativa, y es la que impide que el gap se reabra en silencio.
        const sinAlg = await fresh.feed(withoutDelegationAlg(positivePayload), false);
        expect(sinAlg.applied).toBe(false);
        expect(sinAlg.reason).toBe('malformed_provisioning_message');
        expect(sinAlg.snapshot.state).toBe('UNPROVISIONED');
        expect(sinAlg.snapshot.kvWrites).toBe(0);

        // 2. Tal cual lo emitio el backend, SIN parchear nada: se aplica.
        //    Antes esta rama exigia un parche a mano porque el emisor no ponia
        //    el campo; ahora lo pone, y por eso el camino conforme funciona.
        const wired = await fresh.feed(positivePayload, false);
        expect(wired.applied).toBe(true);
        expect(wired.snapshot.state).toBe('READY');
      } finally {
        fresh.stop();
      }
    }, 60000);

    it('CONTROL POSITIVO (segunda mitad) · repetir la MISMA orden produce CERO efectos adicionales', async () => {
      const before = await device.snapshot();
      const outcome = await device.feed(applicablePayload, false);

      expect(outcome.applied).toBe(false);
      expect(outcome.authorityChanged).toBe(false);
      // Contadores y estado persistido, no códigos de retorno.
      // `applied_bootstraps` es diagnóstico EN RAM y el control positivo
      // reinició el módulo por medio, así que vale 0: lo que importa es que la
      // repetición NO lo incrementa, es decir, que no se aplicó ningún
      // bootstrap más. La autoridad persistida no se ha movido ni un campo.
      expect(outcome.bootstraps).toBe(0);
      expect(outcome.snapshot.activeEpoch).toBe(before.activeEpoch);
      expect(outcome.snapshot.pendingEpoch).toBe(before.pendingEpoch);
      expect(outcome.snapshot.lastProvSeq).toBe(before.lastProvSeq);
      expect(outcome.snapshot.lastDelegSeq).toBe(before.lastDelegSeq);
      expect(outcome.snapshot.state).toBe(before.state);
      // La única escritura admisible es la re-persistencia de la MISMA
      // delegación, que el firmware declara explícitamente; nunca más de una,
      // y nunca acompañada de un cambio de autoridad.
      expect(outcome.snapshot.kvWrites - before.kvWrites).toBeLessThanOrEqual(1);
    }, 60000);

    /* ------------------------------------------------ LOS NUEVE NEGATIVOS -- */

    /**
     * Cada negativo se mide igual: se parte del estado persistido ANTES, se
     * ejerce el camino real, y se exige que el estado y el contador de
     * escrituras a NVS queden IDÉNTICOS. «No lanzó» no es evidencia de nada.
     */
    async function expectNoEffect(
      run: () => Promise<DeviceOutcome>,
      /**
       * MEDIDO en este carril, y es comportamiento DECLARADO del firmware
       * (`provisioning.c`: «la delegación, si llegó y verificó, es una
       * credencial válida en sí misma: sus efectos SÍ se persisten aunque la
       * orden que la acompaña termine rechazada»). Esa escritura reescribe la
       * MISMA delegación, así que no mueve autoridad ninguna; lo que se
       * permite es una única escritura de NVS, nunca un cambio de estado, de
       * epoch ni de secuencia.
       */
      delegationMayPersist = false,
    ): Promise<DeviceOutcome> {
      const before = await device.snapshot();
      const outcome = await run();
      const after = outcome.snapshot;
      if (delegationMayPersist) {
        expect(after.kvWrites - before.kvWrites).toBeLessThanOrEqual(1);
      } else {
        expect(after.kvWrites).toBe(before.kvWrites);
      }
      expect(after.state).toBe(before.state);
      expect(after.activeEpoch).toBe(before.activeEpoch);
      expect(after.pendingEpoch).toBe(before.pendingEpoch);
      expect(after.lastProvSeq).toBe(before.lastProvSeq);
      expect(after.lastDelegSeq).toBe(before.lastDelegSeq);
      expect(outcome.applied).toBe(false);
      expect(outcome.authorityChanged).toBe(false);
      return outcome;
    }

    it('N1 · FIRMA INVÁLIDA → cero efecto', async () => {
      const payload = JSON.parse(applicablePayload) as Record<string, unknown>;
      const sig = Buffer.from(String(payload.signature), 'base64url');
      sig[0] ^= 0x01;
      payload.signature = sig.toString('base64url');
      const outcome = await expectNoEffect(
        () => device.feed(JSON.stringify(payload), false),
        true,
      );
      expect(outcome.reason).toBe('invalid_signature');
    }, 60000);

    it('N2 · DEVICE_ID AJENO → cero efecto (y el módulo ni siquiera puede oír ese canal)', async () => {
      // La orden es LEGÍTIMA y va dirigida a module-02: la firma verifica. Lo
      // que la mata es el direccionamiento, no la criptografía.
      const issued = await commands.issue(
        {
          deviceId: OTHER_DEVICE,
          systemId: SYSTEM,
          action: 'PROVISION',
          provisioningKeyFingerprint: FPRINT,
          epoch: 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb',
          provisionId: 'dddddddd-3333-4333-8333-dddddddddddd',
        },
        ACTOR,
      );
      expect(issued.publish.delivered).toBe(true);

      const arrival = await waitFor(
        otherInbox,
        (a) => a.topic === topics.moduleProvisionCommand(OTHER_DEVICE),
        15000,
      );
      expect(arrival).not.toBeNull();

      const outcome = await expectNoEffect(() =>
        device.feed(withDelegationAlg(arrival!.payload), false),
      );
      expect(outcome.reason).toBe('device_mismatch');

      // Y en el broker: module-01 no recibe NADA del canal de module-02.
      // MEDIDO: mosquitto CONCEDE el SUBACK (qos 1) aunque la ACL prohíba el
      // tópico —igual que una denegación de publicación devuelve rc=0—, así
      // que el código del SUBACK no sirve para distinguirlo. Lo que se mide es
      // el EFECTO: se emite otra orden para module-02 y se comprueba que llega
      // a module-02 y NO a module-01.
      await subscribe(moduleClient, topics.moduleProvisionCommand(OTHER_DEVICE));
      const inboxBefore = inbox.length;
      const second = await commands.issue(
        {
          deviceId: OTHER_DEVICE,
          systemId: SYSTEM,
          action: 'PROVISION',
          provisioningKeyFingerprint: FPRINT,
          epoch: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
          provisionId: 'dddddddd-4444-4444-8444-dddddddddddd',
        },
        ACTOR,
      );
      expect(second.publish.delivered).toBe(true);
      const forOther = await waitFor(
        otherInbox,
        (a) =>
          (JSON.parse(a.payload.toString('utf8')) as { request_id: string }).request_id ===
          second.requestId,
        15000,
      );
      expect(forOther).not.toBeNull();
      await sleep(1500);
      expect(inbox.length).toBe(inboxBefore);
    }, 120000);

    it('N3 · SYSTEM_ID AJENO → cero efecto', async () => {
      const issued = await commands.issue(
        {
          deviceId: DEVICE,
          systemId: FOREIGN_SYSTEM,
          action: 'PROVISION',
          provisioningKeyFingerprint: FPRINT,
          epoch: 'eeeeeeee-1111-4111-8111-eeeeeeeeeeee',
          provisionId: 'ffffffff-3333-4333-8333-ffffffffffff',
        },
        ACTOR,
      );
      expect(issued.publish.delivered).toBe(true);
      const arrival = await waitFor(
        inbox,
        (a) =>
          a.topic === topics.moduleProvisionCommand(DEVICE) &&
          (JSON.parse(a.payload.toString('utf8')) as { request_id: string }).request_id ===
            issued.requestId,
        15000,
      );
      expect(arrival).not.toBeNull();
      const outcome = await expectNoEffect(() =>
        device.feed(withDelegationAlg(arrival!.payload), false),
      );
      expect(['system_mismatch', 'delegation_invalid_signature']).toContain(outcome.reason);
    }, 120000);

    it('N4 · REPLAY DE SECUENCIA → cero efecto', async () => {
      // Se reenvía una orden ya consumida, bien firmada y bien dirigida. La
      // única defensa que queda en pie es la antirrepetición de secuencia.
      const outcome = await expectNoEffect(
        () => device.feed(applicablePayload, false),
        true,
      );
      expect(outcome.reason).not.toBe('');
      expect([
        'provisioning_sequence_rejected',
        'already_provisioned',
        'epoch_reuse_rejected',
      ]).toContain(outcome.reason);
    }, 60000);

    it('N5 · COMANDO RETENIDO → cero efecto, y el canal no retiene NADA', async () => {
      // (a) el firmware rechaza el retenido ANTES de mirar la firma
      const outcome = await expectNoEffect(() => device.feed(applicablePayload, true));
      expect(outcome.reason).toBe('retained_provisioning_rejected');

      // (b) en el broker: quien se suscribe DESPUÉS no recibe ninguna orden.
      // Se reconecta el PROPIO módulo con sesión limpia —que es lo que hace un
      // módulo real al reiniciar— y se comprueba que el broker no le sirve
      // ninguna orden. Tiene que ser el mismo usuario: con
      // `use_username_as_clientid` no puede haber dos conexiones de la misma
      // identidad, y usar otra identidad probaría el canal de otro.
      moduleClient.end(true);
      await sleep(500);
      const late = await tlsClient(broker, DEVICE);
      const lateBox: Arrival[] = [];
      late.on('message', (t, p, k) => lateBox.push({ topic: t, payload: p, retain: k.retain === true }));
      await subscribe(late, topics.moduleProvisionCommand(DEVICE));
      await sleep(3000);
      expect(lateBox).toHaveLength(0);

      // Se deja el módulo conectado y suscrito para el resto del escenario.
      moduleClient = late;
      openClients.push(late);
      moduleClient.on('message', (topic, payload, packet) => {
        inbox.push({ topic, payload, retain: packet.retain === true });
      });
    }, 120000);

    it('N6 · ACL CROSS-MODULE → cero efecto (denegación observada por reasonCode, no por rc)', async () => {
      const rowsBefore = await observedRows(OTHER_DEVICE);
      // module-01 intenta reportar la autoridad de module-02.
      const forged = {
        schema_version: 1,
        command_plane: 'DEVICE_MANAGEMENT',
        device_id: OTHER_DEVICE,
        system_id: SYSTEM,
        result: 'PROVISIONED',
        state: 'READY',
        active_epoch: '99999999-1111-4111-8111-999999999999',
        pending_epoch: null,
        last_provisioning_sequence: 1,
        last_delegation_sequence: 1,
        provisioning_key_fingerprint: FPRINT,
      };
      const reason = await publishWithReason(
        moduleClient,
        topics.moduleProvisionState(OTHER_DEVICE),
        JSON.stringify(forged),
        true,
      );
      // 135 = Not authorized. El rc del cliente es 0 en ambos casos: sólo el
      // reasonCode los distingue.
      expect(reason).toBe(135);
      await sleep(2000);
      expect(await observedRows(OTHER_DEVICE)).toHaveLength(rowsBefore.length);
    }, 60000);

    it('N7 · SIN IDENTIDAD DE RAÍZ → cero efecto (fallo cerrado, nunca "acepta porque no puede comprobar")', async () => {
      const naked = await HostDevice.start({
        binary: runnerBinary,
        deviceId: DEVICE,
        systemId: SYSTEM,
        fingerprint: FPRINT,
        rootPublicKeySec1: null,
        rootKeyId: '',
      });
      try {
        const before = await naked.snapshot();
        expect(before.state).toBe('UNPROVISIONED');
        const outcome = await naked.feed(applicablePayload, false);
        expect(outcome.applied).toBe(false);
        expect(outcome.snapshot.kvWrites).toBe(before.kvWrites);
        expect(outcome.snapshot.state).toBe('UNPROVISIONED');
        expect(outcome.snapshot.activeEpoch).toBe('');
        expect([
          'delegation_invalid_signature',
          'delegation_root_key_mismatch',
        ]).toContain(outcome.reason);
      } finally {
        naked.stop();
      }
    }, 60000);

    it('N8 · PAYLOAD VÁLIDO ALTERADO DESPUÉS DE FIRMAR → cero efecto', async () => {
      const payload = JSON.parse(applicablePayload) as Record<string, unknown>;
      // Se cambia un campo que SÍ entra en la canónica; la firma sigue siendo
      // la del payload original. Es el ataque de «firma una cosa, manda otra».
      payload.epoch = '77777777-1111-4111-8111-777777777777';
      const outcome = await expectNoEffect(
        () => device.feed(JSON.stringify(payload), false),
        true,
      );
      expect(outcome.reason).toBe('invalid_signature');
    }, 60000);

    it('N9 · ENTERO > 2^53 → la orden NO SE EMITE (regresión H-2), cero efecto en cable, módulo y BD', async () => {
      // `Number(bigint)` por encima de 2^53 redondeaba en silencio y rompía
      // «firma lo que envías»: 9007199254740993 viajaba como …992. `exactUint64`
      // debe fallar RUIDOSAMENTE. Se fuerza desde el puerto de secuencias, que
      // es de donde sale el valor en producción.
      const huge = 2n ** 53n + 1n;
      const hijacked: ProvisioningOrderRepositoryPort = {
        allocateSequence: async () => huge,
        recordEmitted: (r: EmittedOrderRecord) => orders.recordEmitted(r),
        findByRequestId: (id: string) => orders.findByRequestId(id),
      };
      const service = new ProvisioningCommandService(
        mqtt,
        hijacked,
        signer,
        authority.delegation,
      );

      const inboxBefore = inbox.length;
      const ordersBefore = (await orderRows(DEVICE)).length;
      const deviceBefore = await device.snapshot();

      await expect(
        service.issue(
          {
            deviceId: DEVICE,
            systemId: SYSTEM,
            action: 'PROVISION',
            provisioningKeyFingerprint: FPRINT,
            epoch: '88888888-1111-4111-8111-888888888888',
            provisionId: '66666666-3333-4333-8333-666666666666',
          },
          ACTOR,
        ),
      ).rejects.toThrow(/2\^53/);

      // Y no dejó rastro por ninguna de las tres vías.
      await sleep(2000);
      expect(inbox.length).toBe(inboxBefore);
      expect((await orderRows(DEVICE)).length).toBe(ordersBefore);
      const deviceAfter = await device.snapshot();
      expect(deviceAfter.kvWrites).toBe(deviceBefore.kvWrites);
      expect(deviceAfter.activeEpoch).toBe(deviceBefore.activeEpoch);

      // El valor exacto: si alguien reintrodujera `Number(bigint)`, este número
      // viajaría como 9007199254740992 y la firma dejaría de casar.
      expect(Number(huge).toString()).toBe('9007199254740992');
      expect(huge.toString()).toBe('9007199254740993');
    }, 120000);

    /* ------------------------------------------------------ trazabilidad --- */

    it('la BD conserva la correlación orden↔estado y NADA más se coló', async () => {
      const emitted = await orderRows(DEVICE);
      // Positivo + N3 (system ajeno) llegaron a publicarse; N9 no.
      expect(emitted.length).toBeGreaterThanOrEqual(2);
      expect(emitted.some((r) => r.requestId === positiveRequestId)).toBe(true);
      // Un solo estado observado para module-01 y ninguno para module-02.
      expect(await observedRows(DEVICE)).toHaveLength(1);
      expect(await observedRows(OTHER_DEVICE)).toHaveLength(0);
    }, 60000);

    it('el escenario NO atraviesa infrastructure/mosquitto/set-coordinator.sh', () => {
      // Propiedad ESTRUCTURAL, comprobada por ejecución: ningún fichero del
      // carril invoca ese script, y el broker efímero arrancó con la ACL del
      // repo tal cual (sin bloque de coordinador activo). Si alguien lo
      // introdujera, esto se pondría rojo y el carril pasaría a ser bloqueante
      // operativo (deja la ACL en 0600 → broker Exited(13), decisión D6).
      const hits = execFileSync(
        'sh',
        [
          '-c',
          `grep -rl "set-coordinator" "${__dirname}" || true`,
        ],
        { encoding: 'utf8' },
      )
        .split('\n')
        .filter((l) => l && !l.endsWith('device-management.e2e.spec.ts') && !l.endsWith('README.md') && !l.endsWith('broker.ts'));
      expect(hits).toEqual([]);
      expect(backendDir().endsWith('server/backend')).toBe(true);
    }, 30000);
  });
}
