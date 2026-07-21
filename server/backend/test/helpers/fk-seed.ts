import { PrismaClient } from '@prisma/client';
import { loadExamples } from './examples';

/**
 * Siembra y limpieza de los PADRES de clave foránea que necesita `hit_events`
 * para las pruebas de integración contra PostgreSQL real.
 *
 * El ejemplo `valid-hit` trae `game_id` y `round_id` no nulos. `toHitRecord`
 * los mapea a las FK `gameId`/`roundId` de `hit_events`. En el repositorio en
 * memoria no hay restricciones, pero en PostgreSQL el INSERT viola
 * `hit_events_game_id_fkey` si las filas padre no existen. Aquí las creamos.
 *
 * Cadena real de FKs (ver `prisma/schema.prisma`):
 *   - Game.targetSystemId  → TargetSystem  (onDelete: Restrict, obligatoria)
 *   - Game.gameModeId      → GameMode      (onDelete: Restrict, obligatoria)
 *   - Round.gameId         → Game          (onDelete: Cascade, obligatoria)
 * De modo que hay que sembrar TargetSystem y GameMode antes que Game, y Game
 * antes que Round. Del payload sólo `gameId` y `roundId` llegan no nulos
 * (`systemSlug`/`moduleSlug` son slugs, no las FK uuid), así que ésas son las
 * únicas FK obligatorias a satisfacer.
 *
 * NOTA: no alteramos NADA de lo que la prueba demuestra (idempotencia por la
 * base y precisión de microsegundos). Sólo damos existencia a los padres.
 */

// Identificadores fijos y propios de la siembra de integración, ajenos a
// cualquier UUID de producción. Permiten upsert y limpieza deterministas.
const TARGET_SYSTEM_ID = '00000000-0000-4000-8000-0000000000a1';
const GAME_MODE_ID = '00000000-0000-4000-8000-0000000000a2';

/** Extrae `game_id`/`round_id` del propio ejemplo `valid-hit` para no duplicar UUID. */
function parentIds(): { gameId: string; roundId: string } {
  const example = loadExamples('valid').find((e) => e.name.includes('valid-hit'));
  if (!example) {
    throw new Error('No se encontró el ejemplo valid-hit para sembrar los padres FK.');
  }
  const payload = example.payload as Record<string, unknown>;
  const gameId = payload.game_id;
  const roundId = payload.round_id;
  if (typeof gameId !== 'string' || typeof roundId !== 'string') {
    throw new Error('El ejemplo valid-hit debe traer game_id y round_id (uuid) para la siembra.');
  }
  return { gameId, roundId };
}

/**
 * Crea (idempotente) TargetSystem → GameMode → Game → Round de modo que el
 * INSERT de un `hit_events` con esos `gameId`/`roundId` respete las FK.
 */
export async function seedHitParents(prisma: PrismaClient): Promise<void> {
  const { gameId, roundId } = parentIds();

  await prisma.targetSystem.upsert({
    where: { id: TARGET_SYSTEM_ID },
    update: {},
    create: {
      id: TARGET_SYSTEM_ID,
      slug: 'itest-system',
      name: 'Sistema de pruebas de integración',
    },
  });

  await prisma.gameMode.upsert({
    where: { id: GAME_MODE_ID },
    update: {},
    create: {
      id: GAME_MODE_ID,
      key: 'itest-mode',
      name: 'Modo de pruebas de integración',
    },
  });

  await prisma.game.upsert({
    where: { id: gameId },
    update: {},
    create: {
      id: gameId,
      targetSystemId: TARGET_SYSTEM_ID,
      gameModeId: GAME_MODE_ID,
      config: {},
    },
  });

  await prisma.round.upsert({
    where: { id: roundId },
    update: {},
    create: {
      id: roundId,
      gameId,
      roundIndex: 0,
      mode: 'itest-mode',
    },
  });
}

/**
 * Deshace la siembra dejando la base de test limpia para reruns.
 *
 * Orden: primero los `hit_events` del módulo de prueba (su FK a game/round es
 * SetNull, pero conviene no dejar residuos), luego Game (que arrastra Round por
 * onDelete: Cascade) y por último GameMode y TargetSystem.
 */
export async function cleanHitParents(prisma: PrismaClient): Promise<void> {
  const { gameId } = parentIds();

  await prisma.hitEvent.deleteMany({ where: { moduleSlug: 'module-03' } });
  await prisma.game.deleteMany({ where: { id: gameId } });
  await prisma.gameMode.deleteMany({ where: { id: GAME_MODE_ID } });
  await prisma.targetSystem.deleteMany({ where: { id: TARGET_SYSTEM_ID } });
}
