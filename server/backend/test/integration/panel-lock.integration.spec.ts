import { PrismaClient } from '@prisma/client';
import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { GamesService } from '../../src/modules/games/games.service';

/**
 * Guardarraíl «un juego activo por panel» contra PostgreSQL REAL (G-H).
 *
 * Las pruebas unitarias demuestran la lógica con mocks, pero la garantía de
 * atomicidad la da el cerrojo consultivo dentro de la transacción, y eso sólo
 * se puede comprobar aquí: dos `start` CONCURRENTES sobre el mismo panel.
 *
 * Se SALTA si no hay `DATABASE_URL`. Un salto no es un aprobado.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  // eslint-disable-next-line no-console
  console.warn(
    '[integración] DATABASE_URL no definida: se salta la prueba de concurrencia del panel. ' +
      'Ver test/integration/README.md.',
  );
}

const SYSTEM_ID = '00000000-0000-4000-8000-0000000000b1';
const MODE_ID = '00000000-0000-4000-8000-0000000000b2';
const GAME_A = '00000000-0000-4000-8000-0000000000b3';
const GAME_B = '00000000-0000-4000-8000-0000000000b4';
const ROUND_A = '00000000-0000-4000-8000-0000000000b5';
const ROUND_B = '00000000-0000-4000-8000-0000000000b6';

const PLAN = { activations: [{ targets: [{ module_id: 'itest-mod', target_index: 1 }] }] };

/** MQTT simulado: sólo cuenta las órdenes; no se publica nada de verdad. */
function fakeMqtt() {
  const sent: string[] = [];
  return {
    sent,
    sendSystemCommand: (slug: string, action: string) => {
      sent.push(`${slug}:${action}`);
      return { command_id: `cmd-${sent.length}` };
    },
  } as never;
}

suite('Concurrencia de panel contra PostgreSQL (G-H)', () => {
  let prisma: PrismaClient;
  let service: GamesService;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    service = new GamesService(prisma as unknown as PrismaService, fakeMqtt());
  });

  afterAll(async () => {
    await prisma.round.deleteMany({ where: { id: { in: [ROUND_A, ROUND_B] } } });
    await prisma.game.deleteMany({ where: { id: { in: [GAME_A, GAME_B] } } });
    await prisma.gameMode.deleteMany({ where: { id: MODE_ID } });
    await prisma.targetSystem.deleteMany({ where: { id: SYSTEM_ID } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.targetSystem.upsert({
      where: { id: SYSTEM_ID },
      update: {},
      create: { id: SYSTEM_ID, slug: 'itest-panel-lock', name: 'Panel de integración' },
    });
    await prisma.gameMode.upsert({
      where: { id: MODE_ID },
      update: {},
      create: { id: MODE_ID, key: 'itest-mode', name: 'Modo de integración' },
    });
    for (const [gameId, roundId] of [
      [GAME_A, ROUND_A],
      [GAME_B, ROUND_B],
    ]) {
      // `draft`: NO ocupa panel (sólo armed|running|paused lo hacen), así que
      // ambas parten libres y lo único que puede impedir el doble arranque es
      // el cerrojo. Con las dos en `armed` se rechazaban mutuamente y la prueba
      // no demostraba nada del cerrojo.
      await prisma.game.upsert({
        where: { id: gameId },
        update: { status: 'draft', startedAt: null },
        create: {
          id: gameId,
          targetSystemId: SYSTEM_ID,
          gameModeId: MODE_ID,
          status: 'draft',
          config: {},
        },
      });
      await prisma.round.upsert({
        where: { id: roundId },
        update: { phase: 'armed', startedAt: null },
        create: {
          id: roundId,
          gameId,
          roundIndex: 1,
          mode: 'itest-mode',
          plan: PLAN as never,
        },
      });
    }
  });

  it('dos `start` CONCURRENTES sobre el mismo panel: sólo uno gana', async () => {
    const results = await Promise.allSettled([
      service.start(GAME_A, ROUND_A),
      service.start(GAME_B, ROUND_B),
    ]);

    const ok = results.filter((r) => r.status === 'fulfilled');
    const ko = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(ko).toHaveLength(1);
    expect((ko[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);

    const running = await prisma.game.count({
      where: { targetSystemId: SYSTEM_ID, status: { in: ['running', 'paused'] } },
    });
    expect(running).toBe(1);
  });

  it('la partida perdedora no queda marcada ni con la ronda arrancada', async () => {
    await Promise.allSettled([service.start(GAME_A, ROUND_A), service.start(GAME_B, ROUND_B)]);

    const games = await prisma.game.findMany({
      where: { id: { in: [GAME_A, GAME_B] } },
      select: { id: true, status: true },
    });
    const perdedora = games.find((g) => g.status !== 'running')!;
    expect(perdedora.status).toBe('draft');

    const rounds = await prisma.round.findMany({
      where: { gameId: perdedora.id },
      select: { phase: true, startedAt: true },
    });
    expect(rounds[0].phase).toBe('armed');
    expect(rounds[0].startedAt).toBeNull();
  });
});
