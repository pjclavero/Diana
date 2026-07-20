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

      await this.prisma.incident.create({
        data: {
          kind: incident.kind,
          severity: incident.severity,
          source: incident.source,
          moduleId: module?.id ?? null,
          eventId: incident.eventId ?? null,
          message: incident.message.slice(0, 1024),
          detail: (incident.detail ?? undefined) as never,
        },
      });
    } catch (error) {
      this.logger.error(`No se pudo registrar la incidencia: ${(error as Error).message}`);
    }
  }
}
