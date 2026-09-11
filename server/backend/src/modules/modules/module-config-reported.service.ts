import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { decideConfigVersion, deriveConfigState } from '../../domain/modules/config-version';
import { ConfigReportedResult, ConfigReportedSinkPort } from './module-config.ports';

/**
 * Ingesta de `config/reported` (T2). Es el ÚNICO camino por el que
 * `reported_config_version` cambia de valor.
 *
 * Hasta ahora este mensaje se validaba contra el esquema y se tiraba, así que
 * la base no distinguía «se publicó la versión 8» de «el módulo corre la 8».
 * `config/push` escribía el número en la misma columna sin haber recibido nada
 * de nadie: con un módulo físico que no aplicase la configuración, la base
 * afirmaba lo contrario de lo que pasaba y no había forma de notarlo.
 *
 * Reglas, todas apoyadas en `decideConfigVersion` (entero, nunca reloj):
 *  - reportada > la que consta  → se acepta y avanza.
 *  - reportada = la que consta  → noop, no se escribe nada.
 *  - reportada < la que consta  → se RECHAZA. La reportada es monotónica: si un
 *    módulo reinicia y reenvía una versión vieja, aceptarla haría creer que la
 *    configuración retrocedió, y el `push` siguiente calcularía mal.
 *
 * La versión reportada NO puede pasar de la deseada: el módulo no puede correr
 * una configuración que el servidor nunca emitió. Ese caso se rechaza y se
 * registra: o hay otro emisor en el broker, o el módulo se la inventó, y las
 * dos cosas hay que verlas.
 */
@Injectable()
export class ModuleConfigReportedService implements ConfigReportedSinkPort {
  private readonly logger = new Logger(ModuleConfigReportedService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(
    moduleSlug: string,
    configVersion: number,
    appliedAt: Date | null,
    receivedAt: Date,
  ): Promise<ConfigReportedResult> {
    const module = await this.prisma.module.findUnique({
      where: { slug: moduleSlug },
      select: {
        id: true,
        desiredConfigVersion: true,
        reportedConfigVersion: true,
        configState: true,
      },
    });

    if (!module) {
      return {
        outcome: 'unknown_module',
        reason: `No hay ningún módulo dado de alta con slug '${moduleSlug}'.`,
        reportedConfigVersion: null,
        desiredConfigVersion: null,
        configState: null,
      };
    }

    const local = module.reportedConfigVersion;
    const decision = decideConfigVersion(configVersion, local ?? 0);

    // Caso especial: nunca reportó nada. `local = 0` haría que un reporte
    // legítimo de la versión 0 saliese 'noop' y no se registrase, y entonces
    // el módulo seguiría constando como «no ha reportado nunca» pese a
    // haberlo hecho. Con `local === null` cualquier versión válida se acepta.
    const primeraVez = local === null;

    if (!primeraVez && decision.decision === 'reject') {
      this.logger.warn(
        `config/reported de ${moduleSlug} RECHAZADO: ${decision.reason} ` +
          '(la versión reportada es monotónica).',
      );
      return {
        outcome: 'rejected',
        reason: decision.reason,
        reportedConfigVersion: local,
        desiredConfigVersion: module.desiredConfigVersion,
        configState: module.configState as ConfigReportedResult['configState'],
      };
    }

    if (configVersion > module.desiredConfigVersion) {
      const reason =
        `El módulo ${moduleSlug} reporta la versión ${configVersion}, mayor que la deseada ` +
        `${module.desiredConfigVersion}, que es la última que este servidor emitió. Se rechaza: ` +
        'o hay otro emisor publicando config/desired, o el módulo la ha fabricado.';
      this.logger.error(reason);
      return {
        outcome: 'rejected',
        reason,
        reportedConfigVersion: local,
        desiredConfigVersion: module.desiredConfigVersion,
        configState: module.configState as ConfigReportedResult['configState'],
      };
    }

    if (!primeraVez && decision.decision === 'noop') {
      return {
        outcome: 'noop',
        reason: decision.reason,
        reportedConfigVersion: local,
        desiredConfigVersion: module.desiredConfigVersion,
        configState: module.configState as ConfigReportedResult['configState'],
      };
    }

    const nextState = deriveConfigState({
      desired: module.desiredConfigVersion,
      reported: configVersion,
    });

    // La escritura es CONDICIONAL sobre la versión reportada que se leyó. Si
    // otro mensaje del mismo módulo llegó entremedias y ya la avanzó, este
    // `updateMany` afecta a 0 filas y no la hace retroceder. La monotonía no
    // depende de que no haya concurrencia.
    const written = await this.prisma.module.updateMany({
      where: {
        id: module.id,
        reportedConfigVersion: local === null ? null : { lt: configVersion },
      },
      data: {
        reportedConfigVersion: configVersion,
        configState: nextState,
        // `applied_at` es OBSERVACIONAL y sólo se anota cuando la reportada
        // alcanza a la deseada. Se prefiere el instante de recepción (T3, del
        // servidor) al `applied_at` que declare el módulo: ese reloj puede ir
        // como quiera y aquí no ordena nada, sólo informa.
        configAppliedAt: nextState === 'applied' ? (appliedAt ?? receivedAt) : null,
      },
    });

    if (written.count === 0) {
      const reason =
        `Otro config/reported de ${moduleSlug} adelantó la versión mientras se procesaba ` +
        `la ${configVersion}. No se escribe: la reportada no retrocede.`;
      this.logger.warn(reason);
      return {
        outcome: 'rejected',
        reason,
        reportedConfigVersion: local,
        desiredConfigVersion: module.desiredConfigVersion,
        configState: module.configState as ConfigReportedResult['configState'],
      };
    }

    return {
      outcome: 'applied',
      reason:
        nextState === 'applied'
          ? `El módulo ${moduleSlug} confirma la versión deseada ${configVersion}.`
          : `El módulo ${moduleSlug} va por la versión ${configVersion}; la deseada es la ` +
            `${module.desiredConfigVersion}. Sigue pendiente.`,
      reportedConfigVersion: configVersion,
      desiredConfigVersion: module.desiredConfigVersion,
      configState: nextState,
    };
  }
}
