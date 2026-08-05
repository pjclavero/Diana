import { BadRequestException, ConflictException } from '@nestjs/common';
import { GamesService } from '../../src/modules/games/games.service';

function buildPrisma(over: any = {}) {
  return {
    game: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      ...over.game,
    },
    viewPanel: {
      findMany: jest.fn().mockResolvedValue([]),
      ...over.viewPanel,
    },
  } as any;
}

const mqtt = {} as any;

describe('GamesService · guardarraíl un juego por panel (G-H)', () => {
  it('panel libre: no lanza y consulta sólo ese panel', async () => {
    const prisma = buildPrisma();
    const service = new GamesService(prisma, mqtt);
    await service.assertPanelsFree({ id: 'g1', targetSystemId: 's1', viewId: null });
    const where = prisma.game.findFirst.mock.calls[0][0].where;
    expect(where.id).toEqual({ not: 'g1' });
    expect(where.status).toEqual({ in: ['armed', 'running', 'paused'] });
    expect(where.OR[0]).toEqual({ targetSystemId: { in: ['s1'] } });
  });

  it('panel ocupado por otra partida activa → 409 con el nombre de la partida', async () => {
    const prisma = buildPrisma({
      game: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'g2',
          name: 'Torneo',
          status: 'running',
          targetSystem: { slug: 'panel-a' },
        }),
      },
    });
    const service = new GamesService(prisma, mqtt);
    await expect(
      service.assertPanelsFree({ id: 'g1', targetSystemId: 's1', viewId: null }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.assertPanelsFree({ id: 'g1', targetSystemId: 's1', viewId: null }),
    ).rejects.toThrow(/Torneo/);
  });

  it('partida sobre una vista: comprueba TODOS los paneles de la vista', async () => {
    const prisma = buildPrisma({
      viewPanel: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ targetSystemId: 's1' }, { targetSystemId: 's2' }]),
      },
    });
    const service = new GamesService(prisma, mqtt);
    await service.assertPanelsFree({ id: 'g1', targetSystemId: 's1', viewId: 'v1' });
    const where = prisma.game.findFirst.mock.calls[0][0].where;
    expect(where.OR[0].targetSystemId.in.sort()).toEqual(['s1', 's2']);
    // También detecta partidas de OTRAS vistas que compartan panel.
    expect(where.OR[1]).toEqual({
      view: { panels: { some: { targetSystemId: { in: where.OR[0].targetSystemId.in } } } },
    });
  });

  it('los estados draft/finished/aborted no ocupan panel', async () => {
    const prisma = buildPrisma();
    const service = new GamesService(prisma, mqtt);
    await service.assertPanelsFree({ id: 'g1', targetSystemId: 's1', viewId: null });
    const statuses = prisma.game.findFirst.mock.calls[0][0].where.status.in;
    expect(statuses).not.toContain('draft');
    expect(statuses).not.toContain('finished');
    expect(statuses).not.toContain('aborted');
  });

  it('ocupación: una partida de vista marca cada panel implicado', async () => {
    const prisma = buildPrisma({
      game: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'g1',
            name: 'Duelo',
            status: 'running',
            targetSystemId: 's1',
            viewId: 'v1',
            view: { panels: [{ targetSystemId: 's1' }, { targetSystemId: 's2' }] },
          },
          {
            id: 'g2',
            name: null,
            status: 'armed',
            targetSystemId: 's3',
            viewId: null,
            view: null,
          },
        ]),
      },
    });
    const service = new GamesService(prisma, mqtt);
    const result = await service.panelOccupancy();
    expect(result.total).toBe(3);
    expect(result.items.map((i) => i.targetSystemId).sort()).toEqual(['s1', 's2', 's3']);
    expect(result.items.filter((i) => i.gameId === 'g1')).toHaveLength(2);
  });
});

/**
 * Cableado real del guardarraíl (defecto D10 del supervisor: antes se probaba
 * `assertPanelsFree` en aislamiento y nadie ejercitaba `start()`/`control()`).
 */
describe('GamesService · el guardarraíl está cableado de verdad', () => {
  const round = {
    id: 'r1',
    plan: { activations: [{ targets: [{ module_id: 'mod-a', target_index: 1 }] }] },
    mode: 'sequence',
    countdownMs: 3000,
    timeLimitMs: null,
    penaltyMs: 0,
    strictOrder: false,
    reactionDelayMinMs: null,
    reactionDelayMaxMs: null,
    seed: BigInt(1),
  };

  function gamePrisma(over: any = {}) {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      game: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn().mockResolvedValue({}) },
      round: { update: jest.fn().mockResolvedValue({}) },
      viewPanel: { findMany: jest.fn().mockResolvedValue([]) },
      // La recomprobación de conflictos (dosier 11/12) vive DENTRO de la
      // transacción, con el mismo patrón que `assertPanelsFree`: por eso
      // `module`/`incident` cuelgan de `tx`, no del cliente de fuera.
      module: { findMany: jest.fn().mockResolvedValue([]) },
      incident: { create: jest.fn().mockResolvedValue({}) },
      ...over.tx,
    };
    const prisma = {
      game: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'g1',
          status: 'armed',
          targetSystemId: 's1',
          viewId: null,
          rounds: [round],
          gameMode: { key: 'sequence' },
          targetSystem: { slug: 'panel-a' },
          ...over.game,
        }),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
      viewPanel: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((fn: any) => fn(tx)),
      __tx: tx,
    } as any;
    return prisma;
  }

  const mqttStub = { sendSystemCommand: jest.fn().mockReturnValue({ command_id: 'c1' }) } as any;

  it('start() bloquea dos módulos EN LÍNEA forzados como PRINCIPAL (dosier 11/12), DENTRO de la transacción', async () => {
    const prisma = gamePrisma({
      tx: {
        module: {
          findMany: jest.fn().mockResolvedValue([
            { slug: 'mod-a', role: 'principal', online: true, position: null },
            { slug: 'mod-b', role: 'principal', online: true, position: null },
          ]),
        },
      },
    });
    const mqtt = { sendSystemCommand: jest.fn() } as any;
    await expect(new GamesService(prisma, mqtt).start('g1', 'r1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(new GamesService(prisma, mqtt).start('g1', 'r1')).rejects.toThrow(
      /mod-a, mod-b/,
    );
    // Se detecta DENTRO de la transacción (bajo el mismo cerrojo de panel que
    // `assertPanelsFree`): no se marca la partida ni sale nada al coordinador.
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.__tx.game.update).not.toHaveBeenCalled();
    expect(prisma.__tx.round.update).not.toHaveBeenCalled();
    expect(mqtt.sendSystemCommand).not.toHaveBeenCalled();
  });

  it('start() deja la incidencia consultable del bloqueo (no sólo un log)', async () => {
    const prisma = gamePrisma({
      tx: {
        module: {
          findMany: jest.fn().mockResolvedValue([
            { slug: 'mod-a', role: 'principal', online: true, position: null },
            { slug: 'mod-b', role: 'principal', online: true, position: null },
          ]),
        },
      },
    });
    const mqtt = { sendSystemCommand: jest.fn() } as any;
    await expect(new GamesService(prisma, mqtt).start('g1', 'r1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.__tx.incident.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'dual_principal',
          severity: 'critical',
          targetSystemId: 's1',
        }),
      }),
    );
  });

  it('start() NO bloquea si sólo hay UN módulo principal en línea (control negativo)', async () => {
    const prisma = gamePrisma({
      tx: {
        module: {
          findMany: jest.fn().mockResolvedValue([
            { slug: 'mod-a', role: 'principal', online: true, position: null },
            { slug: 'mod-b', role: 'satellite', online: true, position: null },
          ]),
        },
      },
    });
    await new GamesService(prisma, mqttStub).start('g1', 'r1');
    expect(prisma.__tx.incident.create).not.toHaveBeenCalled();
    expect(mqttStub.sendSystemCommand).toHaveBeenCalled();
  });

  it('start() lee los módulos DESPUÉS de tomar el cerrojo de panel, no antes de entrar en la transacción', async () => {
    // Fija el ORDEN, no sólo que se llame: si alguien vuelve a sacar la
    // comprobación fuera de la transacción (o la pone antes del cerrojo), el
    // orden de llamadas deja de coincidir y esta prueba muere.
    const calls: string[] = [];
    const prisma = gamePrisma({
      tx: {
        $executeRaw: jest.fn().mockImplementation(() => {
          calls.push('lock');
          return Promise.resolve(1);
        }),
        module: {
          findMany: jest.fn().mockImplementation(() => {
            calls.push('conflicts');
            return Promise.resolve([]);
          }),
        },
        game: {
          findFirst: jest.fn().mockImplementation(() => {
            calls.push('panel-free');
            return Promise.resolve(null);
          }),
          update: jest.fn().mockImplementation(() => {
            calls.push('game-update');
            return Promise.resolve({});
          }),
        },
      },
    });
    await new GamesService(prisma, mqttStub).start('g1', 'r1');
    expect(calls).toEqual(['lock', 'conflicts', 'panel-free', 'game-update']);
  });

  it('start() rechaza empezar sobre un panel ocupado y NO manda nada al coordinador', async () => {
    const prisma = gamePrisma({
      tx: {
        game: {
          findFirst: jest.fn().mockResolvedValue({ id: 'g2', name: 'Otra', status: 'running', targetSystem: { slug: 'panel-a' } }),
          update: jest.fn(),
        },
      },
    });
    const mqtt = { sendSystemCommand: jest.fn() } as any;
    await expect(new GamesService(prisma, mqtt).start('g1', 'r1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(mqtt.sendSystemCommand).not.toHaveBeenCalled();
    expect(prisma.__tx.game.update).not.toHaveBeenCalled();
  });

  it('start() toma cerrojo por panel y marca la partida dentro de la MISMA transacción', async () => {
    const prisma = gamePrisma();
    mqttStub.sendSystemCommand.mockClear();
    await new GamesService(prisma, mqttStub).start('g1', 'r1');
    expect(prisma.__tx.$executeRaw).toHaveBeenCalled();
    expect(prisma.__tx.game.update.mock.calls[0][0].data).toMatchObject({ status: 'running' });
    expect(prisma.__tx.round.update.mock.calls[0][0].data).toMatchObject({ phase: 'countdown' });
    expect(mqttStub.sendSystemCommand).toHaveBeenCalled();
  });

  it('control() no ejecuta una orden imposible para el estado actual', async () => {
    const prisma = gamePrisma({ game: { status: 'finished' } });
    const mqtt = { sendSystemCommand: jest.fn() } as any;
    const service = new GamesService(prisma, mqtt);
    await expect(service.control('g1', 'pause_game')).rejects.toBeInstanceOf(ConflictException);
    await expect(service.control('g1', 'resume_game')).rejects.toBeInstanceOf(ConflictException);
    expect(mqtt.sendSystemCommand).not.toHaveBeenCalled();
  });

  it('resume_game no puede devolver una partida a un panel ya ocupado por otra', async () => {
    const prisma = gamePrisma({ game: { status: 'paused' } });
    prisma.game.findFirst.mockResolvedValue({
      id: 'g2',
      name: 'Otra',
      status: 'running',
      targetSystem: { slug: 'panel-a' },
    });
    const mqtt = { sendSystemCommand: jest.fn() } as any;
    await expect(new GamesService(prisma, mqtt).control('g1', 'resume_game')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(mqtt.sendSystemCommand).not.toHaveBeenCalled();
  });

  it('start() no reabre una partida terminada ni abortada', async () => {
    for (const status of ['finished', 'aborted']) {
      const prisma = gamePrisma({ game: { status } });
      const mqtt = { sendSystemCommand: jest.fn() } as any;
      await expect(new GamesService(prisma, mqtt).start('g1', 'r1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(mqtt.sendSystemCommand).not.toHaveBeenCalled();
      expect(prisma.__tx.game.update).not.toHaveBeenCalled();
    }
  });

  it('si falla la orden MQTT, la partida NO queda marcada como en curso', async () => {
    const prisma = gamePrisma();
    // La transacción real revierte al propagarse el error: aquí se comprueba que
    // la publicación ocurre DENTRO del callback, que es lo que lo hace posible.
    prisma.$transaction = jest.fn(async (fn: any) => fn(prisma.__tx));
    const mqtt = {
      sendSystemCommand: jest.fn(() => {
        throw new Error('Tópico fuera del contrato v1');
      }),
    } as any;
    await expect(new GamesService(prisma, mqtt).start('g1', 'r1')).rejects.toThrow(/contrato v1/);
    // El update se ejecutó dentro de la misma transacción que ha fallado.
    const txCallback = (prisma.$transaction as jest.Mock).mock.calls[0][0];
    expect(typeof txCallback).toBe('function');
    expect(mqtt.sendSystemCommand).toHaveBeenCalled();
  });

  it('una orden de control desconocida es un 400, no un 500', async () => {
    const prisma = gamePrisma({ game: { status: 'running' } });
    const mqtt = { sendSystemCommand: jest.fn() } as any;
    await expect(
      new GamesService(prisma, mqtt).control('g1', 'nope' as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mqtt.sendSystemCommand).not.toHaveBeenCalled();
  });

  it('pause_game sobre una partida en curso sí se ejecuta', async () => {
    const prisma = gamePrisma({ game: { status: 'running' } });
    const mqtt = { sendSystemCommand: jest.fn().mockReturnValue({ command_id: 'c1' }) } as any;
    const result = await new GamesService(prisma, mqtt).control('g1', 'pause_game');
    expect(result.status).toBe('paused');
    expect(mqtt.sendSystemCommand).toHaveBeenCalledWith('panel-a', 'pause_game', {}, 10000);
  });
});
