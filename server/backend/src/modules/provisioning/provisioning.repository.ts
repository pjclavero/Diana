import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';
import {
  EmittedOrderRecord,
  ObservedProvisionState,
  ProvisioningAction,
  ProvisioningMode,
  ProvisioningOrderRepositoryPort,
  ProvisioningStateRepositoryPort,
} from './provisioning.ports';

/** Lado de MANDO. Ver `provisioning.ports.ts` para la frontera con el observacional. */
@Injectable()
export class PrismaProvisioningOrderRepository implements ProvisioningOrderRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reserva la siguiente secuencia de forma ATÓMICA.
   *
   * Se hace con un `INSERT … ON CONFLICT DO UPDATE … RETURNING` y no con un
   * `findUnique` + `update` porque leer y luego escribir es una carrera: dos
   * peticiones simultáneas leerían el mismo valor y firmarían dos órdenes
   * distintas con la MISMA secuencia. El módulo aceptaría la primera y
   * rechazaría la segunda, y desde fuera parecería un fallo del dispositivo.
   * La atomicidad la da PostgreSQL en una sola sentencia.
   */
  async allocateSequence(deviceId: string): Promise<bigint> {
    const rows = await this.prisma.$queryRaw<Array<{ last_sequence: bigint }>>`
      INSERT INTO "provisioning_sequences" ("device_id", "last_sequence", "updated_at")
      VALUES (${deviceId}, 1, NOW())
      ON CONFLICT ("device_id") DO UPDATE
        SET "last_sequence" = "provisioning_sequences"."last_sequence" + 1,
            "updated_at" = NOW()
      RETURNING "last_sequence"
    `;
    if (rows.length !== 1) {
      throw new Error(`No se pudo reservar secuencia de aprovisionamiento para ${deviceId}.`);
    }
    return BigInt(rows[0].last_sequence);
  }

  async recordEmitted(record: EmittedOrderRecord): Promise<void> {
    await this.prisma.provisioningOrder.create({
      data: {
        requestId: record.requestId,
        deviceId: record.deviceId,
        systemId: record.systemId,
        action: record.action,
        mode: record.mode,
        provisioningSequence: record.provisioningSequence,
        rotationId: record.rotationId,
        epoch: record.epoch,
        currentEpoch: record.currentEpoch,
        nextEpoch: record.nextEpoch,
        provisionId: record.provisionId,
        issuedAtMs: record.issuedAtMs,
        actorUserId: record.actorUserId,
        actorUsername: record.actorUsername,
        publishOutcome: record.publishOutcome,
        publishReasonCode: record.publishReasonCode,
      },
    });
  }

  async findByRequestId(requestId: string): Promise<EmittedOrderRecord | null> {
    const row = await this.prisma.provisioningOrder.findUnique({ where: { requestId } });
    if (!row) return null;
    return {
      requestId: row.requestId,
      deviceId: row.deviceId,
      systemId: row.systemId,
      action: row.action as ProvisioningAction,
      mode: (row.mode as ProvisioningMode | null) ?? null,
      provisioningSequence: row.provisioningSequence,
      rotationId: row.rotationId,
      epoch: row.epoch,
      currentEpoch: row.currentEpoch,
      nextEpoch: row.nextEpoch,
      provisionId: row.provisionId,
      issuedAtMs: row.issuedAtMs,
      actorUserId: row.actorUserId,
      actorUsername: row.actorUsername,
      publishOutcome: row.publishOutcome,
      publishReasonCode: row.publishReasonCode,
    };
  }
}

/**
 * Lado OBSERVACIONAL.
 *
 * Sólo dos métodos, y ninguno devuelve nada ejecutable: se guarda «lo que el
 * módulo dijo» y se puede volver a leer. No hay —ni debe haber— un método que
 * traduzca esto a una orden, ni que aporte la secuencia siguiente.
 */
@Injectable()
export class PrismaProvisioningStateRepository implements ProvisioningStateRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async upsertObserved(state: ObservedProvisionState): Promise<void> {
    const data = {
      systemId: state.systemId,
      requestId: state.requestId,
      correlated: state.correlated,
      result: state.result,
      state: state.state,
      activeEpoch: state.activeEpoch,
      pendingEpoch: state.pendingEpoch,
      rotationId: state.rotationId,
      provisionId: state.provisionId,
      lastProvisioningSequence: state.lastProvisioningSequence,
      lastDelegationSequence: state.lastDelegationSequence,
      provisioningKeyFingerprint: state.provisioningKeyFingerprint,
      reason: state.reason,
      receivedAt: state.receivedAt,
    };
    await this.prisma.provisioningStateObservation.upsert({
      where: { deviceId: state.deviceId },
      create: { deviceId: state.deviceId, ...data },
      update: data,
    });
  }

  async findLatest(deviceId: string): Promise<ObservedProvisionState | null> {
    const row = await this.prisma.provisioningStateObservation.findUnique({
      where: { deviceId },
    });
    if (!row) return null;
    return {
      deviceId: row.deviceId,
      systemId: row.systemId,
      requestId: row.requestId,
      correlated: row.correlated,
      result: row.result,
      state: row.state,
      activeEpoch: row.activeEpoch,
      pendingEpoch: row.pendingEpoch,
      rotationId: row.rotationId,
      provisionId: row.provisionId,
      lastProvisioningSequence: row.lastProvisioningSequence,
      lastDelegationSequence: row.lastDelegationSequence,
      provisioningKeyFingerprint: row.provisioningKeyFingerprint,
      reason: row.reason,
      receivedAt: row.receivedAt,
    };
  }
}
