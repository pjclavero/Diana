import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { detectSystemConflicts, type SystemConflict } from '../../domain/systems/conflicts';
import { ACTIVE_GAME_STATUSES } from '../games/games.service';

export interface SystemStatus {
  id: string;
  slug: string;
  name: string;
  state: string;
  coordinator_module_id: string | null;
  modules_expected: number;
  modules_online: number;
  conflicts: SystemConflict[];
  active_game_id: string | null;
}

/**
 * Estado compuesto de un sistema (panel), con conflictos de verdad (dosier
 * 11/12). Reúne lo que hoy vive repartido entre `TargetSystem`, `Module` y
 * `Game` en UNA respuesta REST — no es el tópico MQTT retenido, así que
 * `contracts/mqtt/system-status.schema.json` (contrato v1 congelado) no se le
 * aplica y esta respuesta NO es equivalente a él: comparte los nombres
 * `state`, `modules_expected`, `modules_online` y `conflicts`, pero usa `id`
 * donde el contrato usa `system_id`, y no incluye `schema_version` (obligatorio
 * allí) ni `backend_time_ms`. Reutilizar el vocabulario evita que el panel
 * tenga que aprenderse dos nombres para lo mismo; no promete ser el mismo
 * documento.
 *
 * Sin base de datos NO hay lógica de conflictos: la decisión de qué es un
 * conflicto vive en `detectSystemConflicts` (dominio puro); aquí sólo se leen
 * los datos y se llama a esa función.
 */
@Injectable()
export class SystemStatusService {
  constructor(private readonly prisma: PrismaService) {}

  async status(systemId: string): Promise<SystemStatus> {
    const system = await this.prisma.targetSystem.findUnique({ where: { id: systemId } });
    if (!system) throw new NotFoundException(`Sistema ${systemId} no encontrado`);

    const modules = await this.prisma.module.findMany({
      where: { targetSystemId: systemId },
      include: { position: true },
    });

    const { conflicts } = detectSystemConflicts(
      modules.map((m) => ({
        slug: m.slug,
        role: m.role,
        online: m.online,
        position: m.position ? { x: m.position.x, y: m.position.y } : null,
      })),
    );

    const activeGame = await this.prisma.game.findFirst({
      where: {
        status: { in: ACTIVE_GAME_STATUSES },
        OR: [{ targetSystemId: systemId }, { view: { panels: { some: { targetSystemId: systemId } } } }],
      },
      select: { id: true },
    });

    return {
      id: system.id,
      slug: system.slug,
      name: system.name,
      state: system.state,
      coordinator_module_id: system.coordinatorModuleId,
      modules_expected: system.modulesExpected,
      modules_online: modules.filter((m) => m.online).length,
      conflicts,
      active_game_id: activeGame?.id ?? null,
    };
  }
}
