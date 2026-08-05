import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IncidentInput, IncidentSinkPort } from '../hits/ports';

/** Registro de incidencias en `incidents` (dosier 21.1). */
@Injectable()
export class PrismaIncidentSink implements IncidentSinkPort {
  private readonly logger = new Logger(PrismaIncidentSink.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(incident: IncidentInput): Promise<void> {
    try {
      const module = incident.moduleSlug
        ? await this.prisma.module.findUnique({
            where: { slug: incident.moduleSlug },
            select: { id: true },
          })
        : null;

      if (incident.moduleSlug && !module && incident.source === 'diagnostic') {
        this.logger.warn(
          `Diagnóstico de módulo aún desconocido «${incident.moduleSlug}»: ` +
            'se conserva por slug y está disponible en el listado global de incidencias.',
        );
      }

      const deviceOccurredAt =
        incident.moduleTime?.epochMs == null
          ? null
          : this.dateFromEpochMs(incident.moduleTime.epochMs);

      await this.prisma.incident.create({
        data: {
          kind: incident.kind,
          severity: incident.severity,
          source: incident.source,
          moduleId: module?.id ?? null,
          // El slug se conserva aunque el módulo todavía no esté registrado.
          // Así la incidencia no queda huérfana y se enlaza al historial si el
          // módulo aparece después con el mismo identificador MQTT.
          moduleSlug: incident.moduleSlug ?? null,
          eventId: incident.eventId ?? null,
          requestId: incident.requestId ?? null,
          message: incident.message.slice(0, 1024),
          detail: (incident.detail ?? undefined) as never,
          occurredAt: incident.receivedAt,
          deviceOccurredAt,
          deviceEventUs:
            incident.moduleTime == null ? null : BigInt(incident.moduleTime.eventUs),
          deviceEpochMs:
            incident.moduleTime?.epochMs == null ? null : BigInt(incident.moduleTime.epochMs),
          deviceBootId: incident.moduleTime?.bootId ?? null,
        },
      });
    } catch (error) {
      this.logger.error(`No se pudo registrar la incidencia: ${(error as Error).message}`);
      // La ingesta de diagnóstico necesita saber que perdió el resultado para
      // incrementar su métrica. Sólo se propaga en esta fuente: las demás
      // incidencias históricas conservan el comportamiento tolerante previo.
      if (incident.source === 'diagnostic') throw error;
    }
  }

  /** Convierte sólo épocas representables; nunca fabrica una hora desde `event_us`. */
  private dateFromEpochMs(epochMs: number): Date | null {
    const date = new Date(epochMs);
    return Number.isNaN(date.getTime()) ? null : date;
  }
}
