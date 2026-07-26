import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ResilienceService } from '../../src/modules/resilience/resilience.service';

const PLAN = {
  activations: [
    { targets: [{ module_id: 'mod-a', target_index: 1 }] },
    { targets: [{ module_id: 'mod-b', target_index: 2 }] },
  ],
};

const GAME = {
  id: 'g1',
  status: 'running',
  targetSystemId: 's1',
  viewId: null,
  targetSystem: { id: 's1', slug: 'panel-a', name: 'Panel A', coordinatorModuleId: 'm-a' },
  rounds: [{ id: 'r1', roundIndex: 1, phase: 'running', plan: PLAN }],
};

const FELL_AT = new Date('2026-07-26T10:00:00Z');

function buildPrisma(over: any = {}) {
  return {
    module: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'm-b', slug: 'mod-b', online: true, targetSystemId: 's1' }),
      findMany: jest.fn().mockResolvedValue([
        { id: 'm-a', slug: 'mod-a', online: true, lastSeenAt: FELL_AT, offlineSince: null },
        { id: 'm-b', slug: 'mod-b', online: false, lastSeenAt: FELL_AT, offlineSince: FELL_AT },
      ]),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      ...over.module,
    },
    game: {
      findFirst: jest.fn().mockResolvedValue(GAME),
      findUnique: jest.fn().mockResolvedValue({ ...GAME, status: 'paused' }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      ...over.game,
    },
    viewPanel: { findMany: jest.fn().mockResolvedValue([]), ...over.viewPanel },
    targetSystem: {
      findUnique: jest.fn().mockResolvedValue({ coordinatorModuleId: 'm-a' }),
      ...over.targetSystem,
    },
    incident: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      ...over.incident,
    },
    $transaction: jest.fn().mockResolvedValue([]),
  } as any;
}

/** El `MqttService` se resuelve con ModuleRef; aquí se sustituye por un doble. */
function mqttRef(delivered = true, throws = false) {
  const sendSystemCommand = jest.fn(() => {
    if (throws) throw new Error('sin cliente MQTT');
    return { command_id: 'c1', delivered };
  });
  // `connectedSince` muy anterior: el barrido no está inhibido por sordera.
  const connectedSince = new Date('2026-07-26T09:00:00Z');
  return {
    ref: { get: () => ({ sendSystemCommand, connected: delivered, connectedSince }) } as any,
    sendSystemCommand,
  };
}

const presence = (over: any = {}) => ({
  moduleSlug: 'mod-b',
  online: false,
  reason: 'lwt',
  at: new Date('2026-07-26T10:01:00Z'),
  ...over,
});

describe('ResilienceService · persistencia de presencia (G-I)', () => {
  it('al caer NO se toca `lastSeenAt` y se fija el instante de la caída', async () => {
    const prisma = buildPrisma();
    const { ref } = mqttRef();
    await new ResilienceService(prisma, ref).record(presence());
    const data = prisma.module.update.mock.calls[0][0].data;
    expect(data.online).toBe(false);
    // `lastSeenAt` es «la última vez que se le vio VIVO», no cuando nos enteramos.
    expect(data.lastSeenAt).toBeUndefined();
    expect(data.offlineSince).toEqual(new Date('2026-07-26T10:01:00Z'));
  });

  it('al volver se limpia el instante de caída y avanza `lastSeenAt`', async () => {
    const prisma = buildPrisma({
      module: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'm-b', slug: 'mod-b', online: false, targetSystemId: 's1' }),
      },
    });
    const { ref } = mqttRef();
    await new ResilienceService(prisma, ref).record(presence({ online: true, reason: 'connect' }));
    const data = prisma.module.update.mock.calls[0][0].data;
    expect(data.offlineSince).toBeNull();
    expect(data.lastSeenAt).toEqual(new Date('2026-07-26T10:01:00Z'));
  });

  it('`touch` no resucita a un módulo caído (retenidos reentregados)', async () => {
    const prisma = buildPrisma();
    const { ref } = mqttRef();
    await new ResilienceService(prisma, ref).touch('mod-b', new Date());
    expect(prisma.module.updateMany.mock.calls[0][0].where).toEqual({
      slug: 'mod-b',
      online: true,
    });
  });

  it('un módulo desconocido deja incidencia, no se pierde en silencio', async () => {
    const prisma = buildPrisma({ module: { findUnique: jest.fn().mockResolvedValue(null) } });
    const { ref } = mqttRef();
    await expect(new ResilienceService(prisma, ref).record(presence())).resolves.toBeNull();
    expect(prisma.incident.create.mock.calls[0][0].data.kind).toBe('presence_unknown_module');
  });

  it('presencia repetida (retenida) no vuelve a decidir', async () => {
    const prisma = buildPrisma({
      module: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'm-b', slug: 'mod-b', online: false, targetSystemId: 's1' }),
      },
    });
    const { ref, sendSystemCommand } = mqttRef();
    expect(await new ResilienceService(prisma, ref).record(presence())).toBeNull();
    expect(sendSystemCommand).not.toHaveBeenCalled();
  });
});

describe('ResilienceService · reacción a la caída', () => {
  it('módulo implicado caído → ordena pausa (transición condicional)', async () => {
    const prisma = buildPrisma();
    const { ref, sendSystemCommand } = mqttRef();
    const decision = await new ResilienceService(prisma, ref).record(presence());
    expect(decision!.action).toBe('auto_pause');
    expect(prisma.game.updateMany.mock.calls[0][0].where).toEqual({ id: 'g1', status: 'running' });
    expect(sendSystemCommand).toHaveBeenCalledWith('panel-a', 'pause_game', {}, 10000);
  });

  it('dos caídas a la vez: sólo UNA orden de pausa (la 2ª no transiciona)', async () => {
    const prisma = buildPrisma({ game: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) } });
    const { ref, sendSystemCommand } = mqttRef();
    await new ResilienceService(prisma, ref).record(presence());
    expect(sendSystemCommand).not.toHaveBeenCalled();
  });

  it('coordinador de la PARTIDA caído → pausa dura', async () => {
    const prisma = buildPrisma({
      module: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'm-a', slug: 'mod-a', online: true, targetSystemId: 's1' }),
      },
    });
    const { ref } = mqttRef();
    const decision = await new ResilienceService(prisma, ref).record(
      presence({ moduleSlug: 'mod-a' }),
    );
    expect(decision!.action).toBe('hard_pause');
  });

  it('si la orden NO llega al broker se registra como crítica (aunque no lance)', async () => {
    const prisma = buildPrisma();
    const { ref } = mqttRef(false); // publicada pero no entregada
    await new ResilienceService(prisma, ref).record(presence());
    const kinds = prisma.incident.create.mock.calls.map((c: any) => c[0].data.kind);
    expect(kinds).toContain('pause_command_failed');
  });

  it('si la publicación lanza, también se registra', async () => {
    const prisma = buildPrisma();
    const { ref } = mqttRef(true, true);
    await new ResilienceService(prisma, ref).record(presence());
    const kinds = prisma.incident.create.mock.calls.map((c: any) => c[0].data.kind);
    expect(kinds).toContain('pause_command_failed');
  });
});

describe('ResilienceService · estado', () => {
  it('enumera módulos ausentes y cuenta desde la caída MÁS RECIENTE', async () => {
    const prisma = buildPrisma({
      module: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'm-a',
            slug: 'mod-a',
            online: false,
            lastSeenAt: FELL_AT,
            offlineSince: new Date('2026-07-26T10:00:00Z'),
          },
          {
            id: 'm-b',
            slug: 'mod-b',
            online: false,
            lastSeenAt: FELL_AT,
            offlineSince: new Date('2026-07-26T10:00:30Z'),
          },
        ]),
      },
    });
    const { ref } = mqttRef();
    const status = await new ResilienceService(prisma, ref).statusOf(
      'g1',
      new Date('2026-07-26T10:00:40Z'),
      60_000,
    );
    expect(status.missingModules.map((m: any) => m.slug).sort()).toEqual(['mod-a', 'mod-b']);
    // Desde la más reciente (10:00:30) quedan 50 s, no 30.
    expect(status.countdown).toMatchObject({ remainingMs: 50_000, expired: false });
  });

  it('partida sobre VISTA: mira los módulos de TODOS sus paneles (D4)', async () => {
    const prisma = buildPrisma({
      game: {
        findUnique: jest.fn().mockResolvedValue({ ...GAME, status: 'paused', viewId: 'v1' }),
      },
      viewPanel: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ targetSystemId: 's1' }, { targetSystemId: 's2' }]),
      },
    });
    const { ref } = mqttRef();
    const status = await new ResilienceService(prisma, ref).statusOf('g1');
    expect(status.panels.sort()).toEqual(['s1', 's2']);
    expect(prisma.module.findMany.mock.calls[0][0].where.targetSystemId.in.sort()).toEqual([
      's1',
      's2',
    ]);
  });

  it('módulo de vuelta con la ronda aún pausada: SE PUEDE reanudar (D1)', async () => {
    const prisma = buildPrisma({
      module: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'm-a', slug: 'mod-a', online: true, lastSeenAt: FELL_AT, offlineSince: null },
          { id: 'm-b', slug: 'mod-b', online: true, lastSeenAt: FELL_AT, offlineSince: null },
        ]),
      },
      incident: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { kind: 'round_auto_paused', detail: { game_id: 'g1', command_delivered: true }, occurredAt: FELL_AT },
          ]),
      },
    });
    const { ref } = mqttRef();
    const status = await new ResilienceService(prisma, ref).statusOf('g1');
    expect(status.missingModules).toEqual([]);
    expect(status.canResume).toBe(true);
    // Y el aviso NO desaparece de la pantalla: sigue habiendo que decidir.
    expect(status.operatorMustDecide).toBe(true);
  });

  it('declara que la orden de pausa no llegó al coordinador', async () => {
    const prisma = buildPrisma({
      incident: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { kind: 'round_auto_paused', detail: { game_id: 'g1', command_delivered: false }, occurredAt: FELL_AT },
          ]),
      },
    });
    const { ref } = mqttRef();
    const status = await new ResilienceService(prisma, ref).statusOf('g1');
    expect(status.pauseCommandDelivered).toBe(false);
    expect(status.note).toMatch(/no llegó al coordinador/);
  });

  it('partida inexistente → 404', async () => {
    const prisma = buildPrisma({ game: { findUnique: jest.fn().mockResolvedValue(null) } });
    const { ref } = mqttRef();
    await expect(new ResilienceService(prisma, ref).statusOf('gX')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('ResilienceService · decisión del operador', () => {
  it('NO resucita una partida cerrada (D2)', async () => {
    for (const status of ['finished', 'aborted']) {
      const prisma = buildPrisma({
        game: { findUnique: jest.fn().mockResolvedValue({ ...GAME, status }) },
      });
      const { ref, sendSystemCommand } = mqttRef();
      await expect(
        new ResilienceService(prisma, ref).decide('g1', 'resume_without'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(sendSystemCommand).not.toHaveBeenCalled();
    }
  });

  it('no reanuda sobre un panel ocupado por otra partida (guardarraíl G-H)', async () => {
    const prisma = buildPrisma({
      game: {
        findUnique: jest.fn().mockResolvedValue({ ...GAME, status: 'paused' }),
        findFirst: jest.fn().mockResolvedValue({ id: 'g2', name: 'Otra', status: 'running' }),
      },
    });
    const { ref, sendSystemCommand } = mqttRef();
    await expect(
      new ResilienceService(prisma, ref).decide('g1', 'resume_without'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(sendSystemCommand).not.toHaveBeenCalled();
  });

  it('reanudar con todos de vuelta ordena resume_game', async () => {
    const prisma = buildPrisma({
      module: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'm-a', slug: 'mod-a', online: true, lastSeenAt: FELL_AT, offlineSince: null },
            { id: 'm-b', slug: 'mod-b', online: true, lastSeenAt: FELL_AT, offlineSince: null },
          ]),
      },
      game: {
        findUnique: jest.fn().mockResolvedValue({ ...GAME, status: 'paused' }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    });
    const { ref, sendSystemCommand } = mqttRef();
    const result = await new ResilienceService(prisma, ref).decide('g1', 'resume', 'operador');
    expect(sendSystemCommand).toHaveBeenCalledWith('panel-a', 'resume_game', {}, 10000);
    expect(result.action).toBe('resume');
  });

  it('«reanudar» con módulos aún ausentes se rechaza y explica la alternativa', async () => {
    const prisma = buildPrisma({ game: { findFirst: jest.fn().mockResolvedValue(null) } });
    const { ref } = mqttRef();
    await expect(new ResilienceService(prisma, ref).decide('g1', 'resume')).rejects.toThrow(
      /Siguen ausentes/,
    );
  });

  it('con el coordinador caído no se puede reanudar de ninguna forma', async () => {
    const prisma = buildPrisma({
      module: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'm-a', slug: 'mod-a', online: false, lastSeenAt: FELL_AT, offlineSince: FELL_AT },
          { id: 'm-b', slug: 'mod-b', online: true, lastSeenAt: FELL_AT, offlineSince: null },
        ]),
      },
      game: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    const { ref } = mqttRef();
    const service = new ResilienceService(prisma, ref);
    await expect(service.decide('g1', 'resume_without')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('abortar cierra la partida y dice si la orden llegó', async () => {
    const prisma = buildPrisma({ game: { findFirst: jest.fn().mockResolvedValue(null) } });
    const { ref, sendSystemCommand } = mqttRef(false);
    const result = await new ResilienceService(prisma, ref).decide('g1', 'abort');
    expect(sendSystemCommand).toHaveBeenCalledWith('panel-a', 'abort_game', {}, 10000);
    expect(result.delivered).toBe(false);
    expect(result.note).toMatch(/no llegó al broker/);
  });

  it('la pausa de ESTA partida se busca en SQL, no entre las 25 últimas de todas (N1)', async () => {
    const prisma = buildPrisma();
    const { ref } = mqttRef();
    await new ResilienceService(prisma, ref).statusOf('g1');
    const where = prisma.incident.findMany.mock.calls[0][0].where;
    expect(where.detail).toEqual({ path: ['game_id'], equals: 'g1' });
    // Y el orden desempata para que dos incidencias del mismo instante no salgan al azar.
    expect(prisma.incident.findMany.mock.calls[0][0].orderBy).toEqual([
      { occurredAt: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('una caída durante una pausa MANUAL deja constancia igualmente (N2)', async () => {
    const prisma = buildPrisma({ game: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) } });
    const { ref, sendSystemCommand } = mqttRef();
    await new ResilienceService(prisma, ref).record(presence());
    // No se repite la orden…
    expect(sendSystemCommand).not.toHaveBeenCalled();
    // …pero sí queda la incidencia, o al volver el módulo no habría salida.
    const kinds = prisma.incident.create.mock.calls.map((c: any) => c[0].data.kind);
    expect(kinds).toContain('round_auto_paused');
    const detail = prisma.incident.create.mock.calls.find(
      (c: any) => c[0].data.kind === 'round_auto_paused',
    )[0].data.detail;
    expect(detail.already_paused).toBe(true);
    expect(detail.command_delivered).toBeNull();
  });

  it('sin pausa por resiliencia no se afirma nada sobre la entrega de la orden', async () => {
    const prisma = buildPrisma({
      incident: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { kind: 'round_resumed', detail: { game_id: 'g1' }, occurredAt: FELL_AT },
          ]),
      },
    });
    const { ref } = mqttRef();
    const status = await new ResilienceService(prisma, ref).statusOf('g1');
    expect(status.pausedByResilience).toBe(false);
    expect(status.pauseCommandDelivered).toBeNull();
  });
});
