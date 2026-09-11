import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { HitClassification, HitRecord } from '../../domain/hits/hit-record';
import { HitRepositoryPort, InsertResult } from './ports';

/**
 * Persistencia de impactos sobre PostgreSQL.
 *
 * La idempotencia se delega a las restricciones de la base de datos
 * (ADR-0003): se intenta insertar y se interpreta la violación de unicidad
 * (`P2002`) como duplicado. Es lo único correcto con varios procesos de
 * ingesta: un `SELECT` previo tendría carrera.
 */
@Injectable()
export class PrismaHitRepository implements HitRepositoryPort {
  private readonly logger = new Logger(PrismaHitRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resuelve los identificadores EXTERNOS del evento contra las entidades que
   * ya existen en la base.
   *
   * El impacto llega del dispositivo con `module_id` y `system_id`, que son
   * SLUGS del contrato, no claves de la base. Hasta ahora se guardaban tal
   * cual y las tres claves ajenas quedaban en NULL: el impacto existía, se
   * contaba y era idempotente, pero no estaba enlazado con su módulo, su
   * sistema ni su diana. Cualquier consulta por entidad —estadísticas,
   * resultados, la puntuación de una partida— se quedaba sin nada que unir.
   *
   * NO se inventa ninguna entidad: sólo se buscan las que ya están. Lo que no
   * se pueda resolver se devuelve en `unresolved` para que la ingesta lo
   * registre como incidencia; un slug desconocido no puede pasar en silencio.
   *
   * El sistema se toma del MÓDULO y no del `system_slug` del mensaje: la
   * pertenencia de un módulo a un panel la decide el servidor, no el
   * dispositivo. Si el mensaje nombra otro sistema, se dice.
   */
  private async resolver(record: HitRecord): Promise<{
    moduleId: string | null;
    targetSystemId: string | null;
    targetId: string | null;
    unresolved: string[];
  }> {
    const unresolved: string[] = [];

    const module = await this.prisma.module.findUnique({
      where: { slug: record.moduleSlug },
      select: { id: true, targetSystemId: true, targetSystem: { select: { slug: true } } },
    });
    if (!module) {
      // Ni módulo, ni sistema, ni diana: sin módulo no hay a qué colgarlas.
      unresolved.push(`module_slug=${record.moduleSlug}`);
      return { moduleId: null, targetSystemId: null, targetId: null, unresolved };
    }

    if (!module.targetSystemId) unresolved.push(`module ${record.moduleSlug} sin sistema asignado`);
    else if (module.targetSystem && module.targetSystem.slug !== record.systemSlug) {
      // No es motivo para descartar el impacto, pero sí para que quede escrito.
      unresolved.push(
        `system_slug del mensaje '${record.systemSlug}' != sistema del módulo ` +
          `'${module.targetSystem.slug}' (manda el servidor)`,
      );
    }

    const target = await this.prisma.target.findUnique({
      where: { moduleId_targetIndex: { moduleId: module.id, targetIndex: record.targetIndex } },
      select: { id: true },
    });
    if (!target) unresolved.push(`diana ${record.targetIndex} de ${record.moduleSlug}`);

    return {
      moduleId: module.id,
      targetSystemId: module.targetSystemId,
      targetId: target?.id ?? null,
      unresolved,
    };
  }

  async insertIfAbsent(record: HitRecord): Promise<InsertResult> {
    const ref = await this.resolver(record);
    try {
      const created = await this.prisma.hitEvent.create({
        data: {
          eventId: record.eventId,
          systemSlug: record.systemSlug,
          moduleSlug: record.moduleSlug,
          targetIndex: record.targetIndex,
          // Claves ajenas resueltas contra entidades REALES. Nullables a
          // propósito (onDelete: SetNull): un impacto sobrevive al borrado de
          // su módulo, y esa es la única razón legítima para que estén vacías.
          moduleId: ref.moduleId,
          targetSystemId: ref.targetSystemId,
          targetId: ref.targetId,
          gameId: record.gameId,
          roundId: record.roundId,
          participantId: record.participantId,
          modulePositionX: record.modulePositionX,
          modulePositionY: record.modulePositionY,
          moduleRotation: record.moduleRotation,
          localSequence: record.localSequence,

          deviceBootId: record.deviceBootId,
          deviceUptimeUs: record.deviceUptimeUs,
          deviceEventUs: record.deviceEventUs,
          deviceEpochMs: record.deviceEpochMs,

          coordinatorRecvUs: record.coordinatorRecvUs,
          coordinatorElapsedUs: record.coordinatorElapsedUs,
          clockOffsetUs: record.clockOffsetUs,
          offsetUncertaintyUs: record.offsetUncertaintyUs,

          receivedAt: record.receivedAt,

          detectionMethod: record.detectionMethod as never,
          amplitude: record.amplitude,
          threshold: record.threshold,
          noiseFloor: record.noiseFloor,
          neighbours: (record.neighbours ?? undefined) as never,
          targetStateBefore: record.targetStateBefore as never,
          classification: record.classification as never,
          classificationReason: record.classificationReason,
          firmwareVersion: record.firmwareVersion,
          replay: record.replay,

          outOfWindow: record.outOfWindow,
          outOfWindowReason: record.outOfWindowReason,
          countsForScore: record.countsForScore,

          rawPayload: record.rawPayload as never,
        },
        select: { id: true },
      });
      return {
        inserted: true,
        id: created.id,
        unresolved: ref.unresolved.length > 0 ? ref.unresolved : undefined,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = String(error.meta?.target ?? '');
        const byEventId = target.includes('event_id');
        const existing = byEventId
          ? await this.prisma.hitEvent.findUnique({
              where: { eventId: record.eventId },
              select: { id: true },
            })
          : await this.prisma.hitEvent.findUnique({
              where: {
                hit_module_boot_sequence: {
                  moduleSlug: record.moduleSlug,
                  deviceBootId: record.deviceBootId,
                  localSequence: record.localSequence,
                },
              },
              select: { id: true },
            });
        return {
          inserted: false,
          id: existing?.id ?? '',
          duplicateBy: byEventId ? 'event_id' : 'module_boot_sequence',
        };
      }
      throw error;
    }
  }

  async findByEventId(eventId: string): Promise<HitRecord | null> {
    const row = await this.prisma.hitEvent.findUnique({ where: { eventId } });
    if (!row) return null;
    return {
      eventId: row.eventId,
      systemSlug: row.systemSlug,
      moduleSlug: row.moduleSlug,
      targetIndex: row.targetIndex,
      gameId: row.gameId,
      roundId: row.roundId,
      participantId: row.participantId,
      modulePositionX: row.modulePositionX,
      modulePositionY: row.modulePositionY,
      moduleRotation: row.moduleRotation,
      localSequence: row.localSequence,
      deviceBootId: row.deviceBootId,
      deviceUptimeUs: row.deviceUptimeUs,
      deviceEventUs: row.deviceEventUs,
      deviceEpochMs: row.deviceEpochMs,
      coordinatorRecvUs: row.coordinatorRecvUs,
      coordinatorElapsedUs: row.coordinatorElapsedUs,
      clockOffsetUs: row.clockOffsetUs,
      offsetUncertaintyUs: row.offsetUncertaintyUs,
      receivedAt: row.receivedAt,
      detectionMethod: row.detectionMethod as HitRecord['detectionMethod'],
      amplitude: row.amplitude,
      threshold: row.threshold,
      noiseFloor: row.noiseFloor,
      neighbours: row.neighbours,
      targetStateBefore: row.targetStateBefore,
      classification: row.classification as HitClassification,
      classificationReason: row.classificationReason,
      firmwareVersion: row.firmwareVersion,
      replay: row.replay,
      outOfWindow: row.outOfWindow,
      outOfWindowReason: row.outOfWindowReason,
      countsForScore: row.countsForScore,
      rawPayload: row.rawPayload,
    };
  }

  async countByRound(roundId: string): Promise<number> {
    return this.prisma.hitEvent.count({ where: { roundId } });
  }
}
