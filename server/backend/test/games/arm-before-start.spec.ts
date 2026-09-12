/**
 * ARM_BEFORE_START · el backend no puede encender una partida que no ha
 * declarado.
 *
 * POR QUÉ EXISTE. El gate físico 3.5 publicó `start_game` contra un
 * coordinador real y recibió `delivered: true`… y el módulo lo rechazó con
 * INVALID: el firmware (`coordinator.c`) exige `have_game`, que sólo pone
 * `arm_game`, y el simulador hace lo mismo (`start_game` -> `startArmedGame`).
 * El backend nunca emitía `arm_game` — la cadena no existía en ninguna parte
 * del producto — y aun así daba la ronda por iniciada. La suite estaba verde
 * porque comprobaba el PUBACK, que es del BROKER, no del coordinador.
 */
import { ServiceUnavailableException } from '@nestjs/common';
import { GamesService } from '../../src/modules/games/games.service';

const RONDA = 'r1';

function buildPrisma() {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    game: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn().mockResolvedValue({}) },
    round: { update: jest.fn().mockResolvedValue({}) },
    viewPanel: { findMany: jest.fn().mockResolvedValue([]) },
    module: { findMany: jest.fn().mockResolvedValue([]) },
    incident: { create: jest.fn().mockResolvedValue({}) },
  };
  // La marca de «ronda iniciada» se escribe DENTRO de la transacción: lo que
  // impide declararla no es omitir el UPDATE, es que la transacción no
  // confirme. Se modela aquí para poder afirmarlo de verdad, en vez de
  // comprobar que un doble no recibió una llamada que el código sí hace.
  const estado = { confirmada: false };
  return {
    tx,
    estado,
    prisma: {
      $transaction: jest.fn(async (cb: any) => {
        const r = await cb(tx);
        estado.confirmada = true;
        return r;
      }),
      game: { findFirst: jest.fn().mockResolvedValue(null) },
      viewPanel: { findMany: jest.fn().mockResolvedValue([]) },
    } as any,
  };
}

/** Un `get` mínimo: la partida y su ronda ya planificadas. */
function conPartida(service: GamesService) {
  jest.spyOn(service, 'get').mockResolvedValue({
    id: 'g1',
    status: 'draft',
    targetSystemId: 's1',
    viewId: null,
    targetSystem: { slug: 'banco-01' },
    rounds: [
      {
        id: RONDA,
        mode: 'sequence',
        countdownMs: 0,
        timeLimitMs: null,
        penaltyMs: 0,
        strictOrder: false,
        reactionDelayMinMs: null,
        reactionDelayMaxMs: null,
        seed: 0,
        plan: { activations: [{ step: 0, targets: [{ module_id: 'module-01', target_index: 1 }] }] },
      },
    ],
  } as any);
}

/** MQTT de mentira: registra el orden de las acciones y qué se confirma. */
function buildMqtt(opts: {
  entrega?: Record<string, { delivered?: boolean; denied?: boolean }>;
  aceptaArmado?: boolean;
  aceptaArranque?: boolean;
}) {
  const acciones: string[] = [];
  return {
    acciones,
    mqtt: {
      sendSystemCommand: jest.fn(async (_s: string, action: string) => {
        acciones.push(action);
        const r = opts.entrega?.[action] ?? { delivered: true, denied: false };
        return { command_id: `cmd-${action}`, action, ...r };
      }),
      esperarGameState: jest.fn(async (_s: string, cumple: (e: any) => boolean) => {
        // Se responde con el estado que el coordinador publicaría, y se deja
        // que sea el PREDICADO real del servicio quien decida si vale.
        const armado = { round_id: RONDA, phase: 'armed' };
        const corriendo = { round_id: RONDA, phase: 'running' };
        if (cumple(armado)) return opts.aceptaArmado === false ? null : armado;
        if (cumple(corriendo)) return opts.aceptaArranque === false ? null : corriendo;
        return null;
      }),
    } as any,
  };
}

describe('GamesService.start · dos pasos arm_game -> start_game', () => {
  it('camino feliz: publica arm_game ANTES que start_game, y sólo esos dos', async () => {
    const { prisma, tx, estado } = buildPrisma();
    const { mqtt, acciones } = buildMqtt({});
    const service = new GamesService(prisma, mqtt);
    conPartida(service);

    const res = await service.start('g1', RONDA);

    expect(acciones).toEqual(['arm_game', 'start_game']);
    expect(res.accepted_by_coordinator).toBe(true);
    // La ronda sólo se declara iniciada cuando todo lo anterior ha pasado.
    expect(tx.round.update).toHaveBeenCalled();
    expect(estado.confirmada).toBe(true);
  });

  it('el sobre de la partida viaja en arm_game, no en start_game', async () => {
    const { prisma } = buildPrisma();
    const { mqtt } = buildMqtt({});
    const service = new GamesService(prisma, mqtt);
    conPartida(service);

    await service.start('g1', RONDA);

    const [, accionArm, sobreArm] = mqtt.sendSystemCommand.mock.calls[0];
    const [, accionStart, sobreStart] = mqtt.sendSystemCommand.mock.calls[1];
    expect(accionArm).toBe('arm_game');
    expect((sobreArm as any).game.round_id).toBe(RONDA);
    expect((sobreArm as any).game.targets).toEqual([{ module_id: 'module-01', target_index: 1 }]);
    expect(accionStart).toBe('start_game');
    expect(sobreStart).toEqual({});
  });

  it('arm_game DENEGADO por ACL: no se publica start_game y la ronda no se inicia', async () => {
    const { prisma, estado } = buildPrisma();
    const { mqtt, acciones } = buildMqtt({
      entrega: { arm_game: { delivered: false, denied: true } },
    });
    const service = new GamesService(prisma, mqtt);
    conPartida(service);

    await expect(service.start('g1', RONDA)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(acciones).toEqual(['arm_game']);
    expect(estado.confirmada).toBe(false);
  });

  it('arm_game sin PUBACK: tampoco encadena start_game', async () => {
    const { prisma } = buildPrisma();
    const { mqtt, acciones } = buildMqtt({
      entrega: { arm_game: { delivered: false, denied: false } },
    });
    const service = new GamesService(prisma, mqtt);
    conPartida(service);

    await expect(service.start('g1', RONDA)).rejects.toThrow(/no llegó al broker/);
    expect(acciones).toEqual(['arm_game']);
  });

  it('el coordinador NO confirma el armado: no se publica start_game', async () => {
    const { prisma, estado } = buildPrisma();
    const { mqtt, acciones } = buildMqtt({ aceptaArmado: false });
    const service = new GamesService(prisma, mqtt);
    conPartida(service);

    await expect(service.start('g1', RONDA)).rejects.toThrow(/no confirmó el armado/);
    expect(acciones).toEqual(['arm_game']);
    expect(estado.confirmada).toBe(false);
  });

  it('start_game publicado pero SIN aceptación del coordinador: la ronda no se da por iniciada', async () => {
    const { prisma } = buildPrisma();
    const { mqtt, acciones } = buildMqtt({ aceptaArranque: false });
    const service = new GamesService(prisma, mqtt);
    conPartida(service);

    // Éste es exactamente el caso que el banco encontró: PUBACK sí, partida no.
    await expect(service.start('g1', RONDA)).rejects.toThrow(/no confirmó el arranque/);
    expect(acciones).toEqual(['arm_game', 'start_game']);
  });

  it('start_game DENEGADO por ACL: la ronda no se da por iniciada', async () => {
    const { prisma } = buildPrisma();
    const { mqtt } = buildMqtt({ entrega: { start_game: { delivered: false, denied: true } } });
    const service = new GamesService(prisma, mqtt);
    conPartida(service);

    await expect(service.start('g1', RONDA)).rejects.toThrow(/DENEGÓ 'start_game'/);
  });
});
