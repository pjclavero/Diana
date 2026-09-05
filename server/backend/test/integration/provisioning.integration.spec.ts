import { PrismaService } from '../../src/common/prisma/prisma.service';
import {
  PrismaProvisioningOrderRepository,
  PrismaProvisioningStateRepository,
} from '../../src/modules/provisioning/provisioning.repository';
import { EmittedOrderRecord } from '../../src/modules/provisioning/provisioning.ports';

/**
 * El plano DEVICE_MANAGEMENT contra PostgreSQL REAL.
 *
 * Las pruebas unitarias usan repositorios en memoria: demuestran la lógica,
 * no las garantías. Las garantías que importan aquí sólo las da la base:
 *
 *   · que `allocateSequence` sea ATÓMICA. En memoria no hay carrera; en una
 *     base sí, y dos peticiones simultáneas que leyeran-y-luego-escribieran
 *     firmarían dos órdenes distintas con la MISMA secuencia. El módulo
 *     aceptaría una y rechazaría la otra, y desde fuera parecería un fallo del
 *     dispositivo.
 *   · que la barrera antirreplay exista también fuera del ORM: una escritura
 *     directa no pasa por él.
 *   · que las restricciones NO_SECRET_IN_STATE del contrato estén en el
 *     esquema y no sólo en el validador de la aplicación.
 *
 * Se SALTA si no hay `DATABASE_URL`. Un salto no es un aprobado.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  // eslint-disable-next-line no-console
  console.warn(
    '[integración] DATABASE_URL no definida: NO MEDIDO el plano de aprovisionamiento ' +
      'contra PostgreSQL. Ver test/integration/README.md.',
  );
}

const DEVICE = 'module-int-07';

function order(over: Partial<EmittedOrderRecord>): EmittedOrderRecord {
  return {
    requestId: '11111111-1111-4111-8111-111111111111',
    deviceId: DEVICE,
    systemId: 'system-a',
    action: 'PROVISION',
    mode: null,
    provisioningSequence: 1n,
    rotationId: null,
    epoch: '22222222-2222-4222-8222-222222222222',
    currentEpoch: null,
    nextEpoch: null,
    provisionId: '33333333-3333-4333-8333-333333333333',
    issuedAtMs: 1750000000000n,
    actorUserId: null,
    actorUsername: 'admin',
    publishOutcome: 'delivered',
    publishReasonCode: 0,
    ...over,
  };
}

suite('plano de aprovisionamiento · PostgreSQL real', () => {
  let prisma: PrismaService;
  let orders: PrismaProvisioningOrderRepository;
  let states: PrismaProvisioningStateRepository;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    orders = new PrismaProvisioningOrderRepository(prisma);
    states = new PrismaProvisioningStateRepository(prisma);
  });

  beforeEach(async () => {
    await prisma.provisioningOrder.deleteMany({ where: { deviceId: DEVICE } });
    await prisma.provisioningSequence.deleteMany({ where: { deviceId: DEVICE } });
    await prisma.provisioningStateObservation.deleteMany({ where: { deviceId: DEVICE } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('la secuencia arranca en 1 y crece de una en una', async () => {
    expect(await orders.allocateSequence(DEVICE)).toBe(1n);
    expect(await orders.allocateSequence(DEVICE)).toBe(2n);
    expect(await orders.allocateSequence(DEVICE)).toBe(3n);
  });

  it('20 reservas SIMULTÁNEAS devuelven 20 secuencias distintas', async () => {
    // Aquí se ve la diferencia entre `INSERT … ON CONFLICT DO UPDATE …
    // RETURNING` y un `findUnique` + `update`: con el segundo, este test
    // devolvería secuencias repetidas.
    const results = await Promise.all(
      Array.from({ length: 20 }, () => orders.allocateSequence(DEVICE)),
    );
    const unique = new Set(results.map(String));
    expect(unique.size).toBe(20);
    expect(results.map(String).sort((a, b) => Number(a) - Number(b))).toEqual(
      Array.from({ length: 20 }, (_, i) => String(i + 1)),
    );
  });

  it('la secuencia SOBREVIVE a un «reinicio» del backend', async () => {
    await orders.allocateSequence(DEVICE);
    await orders.allocateSequence(DEVICE);
    // Repositorio nuevo = proceso nuevo. Si el contador viviera en memoria,
    // esto volvería a 1 y el módulo rechazaría todas las órdenes siguientes.
    const reiniciado = new PrismaProvisioningOrderRepository(prisma);
    expect(await reiniciado.allocateSequence(DEVICE)).toBe(3n);
  });

  it('la BASE impide dos órdenes con la misma secuencia para un dispositivo', async () => {
    await orders.recordEmitted(order({ provisioningSequence: 7n }));
    await expect(
      orders.recordEmitted(
        order({
          requestId: '44444444-4444-4444-8444-444444444444',
          provisioningSequence: 7n,
        }),
      ),
    ).rejects.toThrow();
  });

  it('la BASE rechaza una acción o un resultado fuera del contrato', async () => {
    // La lista cerrada no vive sólo en el validador de la aplicación: una
    // escritura directa tampoco puede colar un estado inventado.
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "provisioning_orders" ("id","request_id","device_id","system_id",` +
          `"action","provisioning_sequence","issued_at_ms","publish_outcome","created_at")` +
          ` VALUES (gen_random_uuid(),'55555555-5555-4555-8555-555555555555',$1,'system-a',` +
          `'BORRAR_TODO',1,1,'delivered',NOW())`,
        DEVICE,
      ),
    ).rejects.toThrow();

    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "provisioning_state_observations" ("device_id","system_id","result",` +
          `"state","last_provisioning_sequence","last_delegation_sequence",` +
          `"provisioning_key_fingerprint","received_at","updated_at")` +
          ` VALUES ($1,'system-a','PROVISIONED','ROOT',0,0,'',NOW(),NOW())`,
        DEVICE,
      ),
    ).rejects.toThrow();
  });

  it('la BASE exige un motivo cuando el resultado es REJECTED', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "provisioning_state_observations" ("device_id","system_id","result",` +
          `"state","last_provisioning_sequence","last_delegation_sequence",` +
          `"provisioning_key_fingerprint","received_at","updated_at")` +
          ` VALUES ($1,'system-a','REJECTED','READY',0,0,'',NOW(),NOW())`,
        DEVICE,
      ),
    ).rejects.toThrow();
  });

  it('la huella sólo admite hex de 64 o cadena vacía, nunca texto libre', async () => {
    // Es la mitad estructural de NO_SECRET_IN_STATE: este campo no puede
    // convertirse en un hueco donde quepa cualquier cosa.
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "provisioning_state_observations" ("device_id","system_id","result",` +
          `"state","last_provisioning_sequence","last_delegation_sequence",` +
          `"provisioning_key_fingerprint","received_at","updated_at")` +
          ` VALUES ($1,'system-a','PROVISIONED','READY',0,0,'-----BEGIN EC PRIVATE KEY-----',NOW(),NOW())`,
        DEVICE,
      ),
    ).rejects.toThrow();
  });

  it('la observación se sustituye, no se acumula, y se relee igual', async () => {
    const base = {
      deviceId: DEVICE,
      systemId: 'system-a',
      requestId: null,
      correlated: false,
      result: 'AUTHORITY_UNPROVISIONED',
      state: 'UNPROVISIONED',
      activeEpoch: null,
      pendingEpoch: null,
      rotationId: null,
      provisionId: null,
      lastProvisioningSequence: 0n,
      lastDelegationSequence: 0n,
      provisioningKeyFingerprint: '',
      reason: null,
      receivedAt: new Date(),
    };
    await states.upsertObserved(base);
    await states.upsertObserved({
      ...base,
      result: 'PROVISIONED',
      state: 'READY',
      activeEpoch: '22222222-2222-4222-8222-222222222222',
      lastProvisioningSequence: 42n,
      provisioningKeyFingerprint: '1f'.repeat(32),
    });

    const row = await states.findLatest(DEVICE);
    expect(row!.result).toBe('PROVISIONED');
    expect(row!.lastProvisioningSequence).toBe(42n);
    expect(
      await prisma.provisioningStateObservation.count({ where: { deviceId: DEVICE } }),
    ).toBe(1);
  });

  it('correlación por request_id de ida y vuelta', async () => {
    const emitted = order({ provisioningSequence: 9n });
    await orders.recordEmitted(emitted);
    const found = await orders.findByRequestId(emitted.requestId);
    expect(found).not.toBeNull();
    expect(found!.provisioningSequence).toBe(9n);
    expect(found!.actorUsername).toBe('admin');
    expect(await orders.findByRequestId('99999999-9999-4999-8999-999999999999')).toBeNull();
  });
});
