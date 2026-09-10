import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ROLE } from '../../domain/rbac/permissions';
import {
  classifyConnectivityAll,
  summarizeConnectivity,
} from '../../domain/modules/connectivity';

export interface OverviewActor {
  userId: string;
  role: string;
}

/**
 * Resumen de módulos para el dashboard (G-C). Devuelve, por módulo, lo justo para
 * el panel: estado, versión de firmware, dueño y si hay **actualización pendiente**
 * (existe una versión firmada más reciente que la que corre). El admin ve todos;
 * un no-admin (gestor) sólo los suyos.
 *
 * Compatibilidad de placa (F3/D3, ya cerrada): la versión candidata es la más
 * reciente firmada **para la placa del módulo**. Si la placa del módulo no
 * consta, no se afirma que haya actualización: se dice que no se puede saber.
 */
@Injectable()
export class ModulesOverviewService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(actor: OverviewActor) {
    const isAdmin = actor.role === ROLE.ADMINISTRADOR;
    const where = isAdmin ? {} : { ownerId: actor.userId };

    const modules = await this.prisma.module.findMany({
      where,
      include: {
        owner: { select: { id: true, username: true, displayName: true, role: { select: { name: true } } } },
        position: true,
      },
      orderBy: { slug: 'asc' },
    });

    // Una candidata por placa: ofrecer firmware de otra placa sería mentir.
    const boards = [...new Set(modules.map((m) => m.targetBoard).filter(Boolean))] as string[];
    const signedByBoard = new Map<string, { version: string; targetBoard: string }>();
    for (const board of boards) {
      const latest = await this.prisma.firmwareVersion.findFirst({
        where: { signed: true, targetBoard: board },
        orderBy: { releasedAt: 'desc' },
        select: { version: true, targetBoard: true },
      });
      if (latest) signedByBoard.set(board, latest);
    }

    // T3 · conectividad DERIVADA de `online` + `lastSeenAt`, con el umbral de
    // silencio del dominio de resiliencia (90 s). `now` se toma una vez para
    // que todas las filas se clasifiquen contra el mismo instante: con una
    // llamada por fila, dos módulos idénticos podrían salir uno ONLINE y otro
    // STALE por unos milisegundos de diferencia.
    //
    // Los veredictos se casan con las filas POR POSICIÓN, no por `slug`. Un
    // Map indexado por slug parece más limpio y es una trampa: colapsa dos
    // filas que compartan slug en una sola entrada, y entonces el resumen
    // cuenta menos módulos de los que hay. `slug` es único en la base, sí,
    // pero el recuento del panel no debería depender de que un índice de
    // PostgreSQL siga existiendo, y una prueba con datos repetidos habría
    // pasado por buena una cuenta equivocada.
    const now = new Date();
    const verdicts = classifyConnectivityAll(
      modules.map((m) => ({ slug: m.slug, online: m.online, lastSeenAt: m.lastSeenAt })),
      now,
    );

    const items = modules.map((m, i) => {
      const verdict = verdicts[i];
      const latestSigned = m.targetBoard ? (signedByBoard.get(m.targetBoard) ?? null) : null;
      const updateAvailable = latestSigned !== null && latestSigned.version !== m.firmwareVersion;
      return {
        id: m.id,
        slug: m.slug,
        friendlyName: m.friendlyName,
        online: m.online,
        // La bandera cruda se conserva (`online`) y se añade el veredicto. No
        // se sustituye: `online` es lo que dijo el broker y `connectivity` lo
        // que se puede afirmar, y verlas juntas es lo que delata una bandera
        // pegada a `true` sin señal que la respalde.
        connectivity: verdict.connectivity,
        connectivityReason: verdict.reason,
        silentForMs: verdict.silentForMs,
        state: m.state,
        role: m.role,
        firmwareVersion: m.firmwareVersion,
        maintenance: m.maintenance,
        lastSeenAt: m.lastSeenAt,
        ownerId: m.ownerId,
        owner: m.owner,
        position: m.position ? { x: m.position.x, y: m.position.y } : null,
        updateAvailable,
        latestSignedVersion: latestSigned?.version ?? null,
        targetBoard: m.targetBoard,
        // Sin placa declarada no se puede afirmar ni negar que haya actualización.
        updateUnknownReason: m.targetBoard
          ? null
          : 'No consta la placa del módulo: no se puede saber qué firmware le corresponde.',
        // T2 · la deseada y la reportada, por separado y las dos a la vista. Un
        // panel que sólo enseñara una de ellas volvería a confundir «se envió»
        // con «se aplicó».
        desiredConfigVersion: m.desiredConfigVersion,
        reportedConfigVersion: m.reportedConfigVersion,
        configState: m.configState,
        configAppliedAt: m.configAppliedAt,
      };
    });

    // El recuento sale de los VEREDICTOS, no de la bandera `online`. Con cero
    // dispositivos publicando, `lastSeenAt` es NULL en todas las filas, todas
    // salen PENDING y `online` vale 0: no hay ningún camino por el que este
    // número suba sin que un módulo haya publicado de verdad.
    const conn = summarizeConnectivity(verdicts);
    return {
      summary: {
        total: items.length,
        online: conn.online,
        stale: conn.stale,
        offline: conn.offline,
        pending: conn.pending,
        // Se conserva el nombre anterior para no romper al panel, pero ahora
        // significa «no está en línea», que incluye a los que nunca lo
        // estuvieron y a los vencidos.
        notOnline: conn.total - conn.online,
        updatesPending: items.filter((i) => i.updateAvailable).length,
        configPending: items.filter((i) => i.configState === 'pending').length,
      },
      items,
    };
  }
}
