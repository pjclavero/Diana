import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ModuleObservationPort } from '../hits/ports';
import { esObservacionNueva } from '../../domain/modules/selectorObservation';

/**
 * Persiste la posición OBSERVADA del selector físico (3.1).
 *
 * `module-status` es RETENIDO: el broker lo reentrega en cada reconexión del
 * backend, así que la misma observación llega muchas veces. Sólo se escribe
 * cuando cambia algo — si no, `selectorObservedAt` avanzaría sin que nadie
 * hubiera tocado el interruptor, y la elección de coordinador (3.2) creería que
 * la posición se acaba de confirmar.
 *
 * No decide nada: no elige coordinador, no otorga autoridad y no toca la ACL.
 */
@Injectable()
export class ModuleObservationRepository implements ModuleObservationPort {
  private readonly logger = new Logger(ModuleObservationRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async observeSelector(input: {
    moduleSlug: string;
    selector: 'SATELITE' | 'AUTO' | 'PRINCIPAL';
    role: 'principal' | 'satellite' | 'auto';
    observedAt: Date;
  }): Promise<void> {
    const actual = await this.prisma.module.findUnique({
      where: { slug: input.moduleSlug },
      select: { id: true, selector: true, role: true },
    });
    // Un módulo que publica antes de estar dado de alta no se crea aquí: el
    // alta es del flujo de provisioning, y crearlo desde una observación
    // fabricaría un módulo a partir de un mensaje MQTT.
    if (!actual) return;

    if (!esObservacionNueva({ selector: actual.selector, role: actual.role }, input)) return;

    await this.prisma.module.update({
      where: { id: actual.id },
      data: {
        selector: input.selector,
        role: input.role,
        selectorObservedAt: input.observedAt,
      },
    });
    this.logger.log(
      `Selector observado en ${input.moduleSlug}: ${input.selector} (${input.role})`,
    );
  }
}
