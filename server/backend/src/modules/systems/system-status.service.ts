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
const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class SystemStatusService {
  constructor(private readonly prisma: PrismaService) {}

  async status(systemId: string): Promise<SystemStatus> {
    // Se admite UUID o slug. Antes esto hacia `findUnique({ where: { id } })`
    // siempre, asi que un slug -- que es lo que usa el panel: `system-a` --
    // llegaba a Prisma como UUID invalido y salia un 500 «Internal server
    // error» en la pantalla de Inicio. Lo cazo el E2E de navegador contra el
    // backend real. Un identificador que no existe debe dar 404, no 500: lo
    // primero es un dato del cliente, lo segundo dice que el servidor se rompio.
    const system = ES_UUID.test(systemId)
      ? await this.prisma.targetSystem.findUnique({ where: { id: systemId } })
      : await this.prisma.targetSystem.findUnique({ where: { slug: systemId } });
    if (!system) throw new NotFoundException(`Sistema ${systemId} no encontrado`);

    // A partir de aqui SIEMPRE el id real: si se filtrase por `systemId` y
    // hubiera llegado un slug, la consulta devolveria cero modulos en silencio
    // y el sistema se veria vacio en vez de dar error.
    const modules = await this.prisma.module.findMany({
      where: { targetSystemId: system.id },
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
        // El id REAL, no el parametro: con un slug esto no habria encontrado
        // ninguna partida activa y el sistema se veria libre estandolo.
        OR: [{ targetSystemId: system.id }, { view: { panels: { some: { targetSystemId: system.id } } } }],
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
