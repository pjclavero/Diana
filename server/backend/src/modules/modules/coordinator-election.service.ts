import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { INCIDENT_SINK, type IncidentSinkPort } from '../hits/ports';
import {
  elegirCoordinador,
  type CandidatoModulo,
} from '../../domain/modules/coordinatorElection';
import type { SelectorPosition } from '../../domain/modules/selectorObservation';

/**
 * Antigüedad máxima admisible de una observación del selector.
 *
 * Decisión de PRODUCTO, no un número técnico: cuánto tiempo puede uno fiarse de
 * que el interruptor sigue donde se vio. Un minuto, porque esto elige AUTORIDAD
 * de juego y no es telemetría: el módulo publica `module-status` en el mismo
 * instante del cambio —medido en el banco—, así que un minuto sobra para la
 * propagación real y no deja a un módulo apagado siendo candidato durante
 * varios minutos.
 *
 * Se declara aquí, visible, en vez de esconderse dentro de la función de
 * elección: cambiarlo es una decisión, no un ajuste.
 */
export const FRESCURA_SELECTOR_MS = 60_000;

/**
 * Aplica la elección de coordinador (3.2 / 3.3).
 *
 * Se dispara cuando se OBSERVA un cambio de selector, no periódicamente: la
 * entrada de esta decisión es el interruptor físico, y sólo cambia cuando
 * alguien lo mueve.
 *
 * LO QUE HACE: elegir y persistir `TargetSystem.coordinatorModuleId`, que es lo
 * que `config/desired` ya publica como `coordinator_module_id`.
 *
 * LO QUE NO HACE, y es deliberado: no toca la ACL del broker ni concede permiso
 * de publicar en `module/+/command`. Decir quién coordina y PODER coordinar son
 * cosas distintas; lo segundo es 3.4 y es una ampliación de privilegios que va
 * aparte.
 */
@Injectable()
export class CoordinatorElectionService {
  private readonly logger = new Logger(CoordinatorElectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(INCIDENT_SINK) private readonly incidents?: IncidentSinkPort,
  ) {}

  /** Reevalúa el coordinador del sistema al que pertenece `moduleSlug`. */
  async reevaluar(moduleSlug: string, ahora: Date): Promise<void> {
    const modulo = await this.prisma.module.findUnique({
      where: { slug: moduleSlug },
      select: { targetSystemId: true },
    });
    if (!modulo?.targetSystemId) return; // sin sistema no hay a quién coordinar

    const sistema = await this.prisma.targetSystem.findUnique({
      where: { id: modulo.targetSystemId },
      select: { id: true, slug: true, coordinatorModuleId: true },
    });
    if (!sistema) return;

    const modulos = await this.prisma.module.findMany({
      where: { targetSystemId: sistema.id },
      select: {
        id: true,
        slug: true,
        selector: true,
        selectorObservedAt: true,
        online: true,
      },
    });

    const candidatos: CandidatoModulo[] = modulos.map((m) => ({
      slug: m.slug,
      selector: (m.selector as SelectorPosition | null) ?? null,
      selectorObservedAt: m.selectorObservedAt,
      online: m.online,
    }));

    const vigente = sistema.coordinatorModuleId
      ? (modulos.find((m) => m.id === sistema.coordinatorModuleId)?.slug ?? null)
      : null;

    const r = elegirCoordinador(candidatos, vigente, ahora, FRESCURA_SELECTOR_MS);

    if (r.conflicto) {
      // AVISO, no bloqueo: el sistema sigue funcionando con un único
      // coordinador efectivo y los demás PRINCIPAL actúan como miembros hasta
      // que alguien corrija los interruptores.
      const msg =
        `Más de un módulo en PRINCIPAL (${r.principales.join(', ')}). ` +
        `Coordina ${r.coordinador}; el resto actúa como miembro hasta corregir el selector.`;
      this.logger.warn(msg);
      await this.incidents
        ?.record({
          kind: 'coordinator_conflict',
          severity: 'warning',
          source: 'backend',
          moduleSlug,
          message: msg,
          detail: { principales: r.principales, coordinador: r.coordinador },
          receivedAt: ahora,
        } as never)
        .catch(() => undefined);
    }

    if (r.ignoradosPorOffline.length > 0) {
      this.logger.warn(
        `Selector ignorado por estar desconectado: ${r.ignoradosPorOffline.join(', ')}`,
      );
    }

    if (r.ignoradosPorAntiguedad.length > 0) {
      // No desaparecen en silencio: un módulo que dice ser PRINCIPAL con una
      // observación caducada no coordina, y conviene poder verlo.
      this.logger.warn(
        `Selector ignorado por antigüedad en: ${r.ignoradosPorAntiguedad.join(', ')}`,
      );
    }

    if (r.coordinador === vigente) return; // nada que cambiar

    const nuevo = r.coordinador
      ? (modulos.find((m) => m.slug === r.coordinador)?.id ?? null)
      : null;

    await this.prisma.targetSystem.update({
      where: { id: sistema.id },
      data: { coordinatorModuleId: nuevo },
    });
    this.logger.log(
      `Coordinador de ${sistema.slug}: ${vigente ?? '(ninguno)'} -> ` +
        `${r.coordinador ?? '(ninguno)'} (${r.motivo})`,
    );
  }
}
