import { BadRequestException, NotFoundException } from '@nestjs/common';
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
  targetSystem: { id: 's1', slug: 'panel-a', name: 'Panel A', coordinatorModuleId: 'm-a' },
  rounds: [{ id: 'r1', roundIndex: 1, phase: 'running', plan: PLAN }],
};

function buildPrisma(over: any = {}) {
  return {
    module: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'm-b', slug: 'mod-b', online: true, targetSystemId: 's1' }),
      findMany: jest.fn().mockResolvedValue([
        { id: 'm-a', slug: 'mod-a', online: true, lastSeenAt: new Date('2026-07-26T10:00:00Z') },
        { id: 'm-b', slug: 'mod-b', online: false, lastSeenAt: new Date('2026-07-26T10:00:00Z') },
      ]),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      ...over.module,
    },
    game: {
      findFirst: jest.fn().mockResolvedValue(GAME),
      findUnique: jest.fn().mockResolvedValue(GAME),
      update: jest.fn().mockResolvedValue({}),
      ...over.game,
    },
    targetSystem: {
      findUnique: jest.fn().mockResolvedValue({ coordinatorModuleId: 'm-a' }),
      ...over.targetSystem,
    },
    incident: { create: jest.fn().mockResolvedValue({}), ...over.incident },
    $transaction: jest.fn().mockResolvedValue([]),
  } as any;
}

function mqttRef(sendSystemCommand = jest.fn().mockReturnValue({ command_id: 'c1' })) {
  return { ref: { get: () => ({ sendSystemCommand }) } as any, sendSystemCommand };
}

const presence = (over: any = {}) => ({
  moduleSlug: 'mod-b',
  online: false,
  reason: 'lwt',
  at: new Date('2026-07-26T10:01:00Z'),
  ...over,
});

describe('ResilienceService · persistencia de presencia (G-I)', () => {
  it('el Last Will marca el módulo como caído y guarda cuándo se le vio', async () => {
    const prisma = buildPrisma();
    const { ref } = mqttRef();
    await new ResilienceService(prisma, ref).record(presence());
    expect(prisma.module.update.mock.calls[0][0].data).toMatchObject({
      online: false,
      lastSeenAt: new Date('2026-07-26T10:01:00Z'),
    });
  });

  it('no borra identidad que el módulo no envía (no machaca con null)', async () => {
    const prisma = buildPrisma();
    const { ref } = mqttRef();
    await new ResilienceService(prisma, ref).record(presence({ online: true, reason: 'connect' }));
    const data = prisma.module.update.mock.calls[0][0].data;
    expect(data.mac).toBeUndefined();
    expect(data.firmwareVersion).toBeUndefined();
  });

  it('un módulo desconocido no revienta la ingesta', async () => {
    const prisma = buildPrisma({ module: { findUnique: jest.fn().mockResolvedValue(null) } });
    const { ref } = mqttRef();
    await expect(new ResilienceService(prisma, ref).record(presence())).resolves.toBeNull();
    expect(prisma.module.update).not.toHaveBeenCalled();
  });

  it('presencia repetida (mensaje retenido) no vuelve a decidir', async () => {
    const prisma = buildPrisma({
      module: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'm-b', slug: 'mod-b', online: false, targetSystemId: 's1' }),
      },
    });
    const { ref, sendSystemCommand } = mqttRef();
    const decision = await new ResilienceService(prisma, ref).record(presence());
    expect(decision).toBeNull();
    expect(sendSystemCommand).not.toHaveBeenCalled();
    // Pero sí refresca `lastSeenAt`.
    expect(prisma.module.update).toHaveBeenCalled();
  });

  it('`touch` refresca la última vez que se vio, sin tocar la presencia', async () => {
    const prisma = buildPrisma();
    const { ref } = mqttRef();
    await new ResilienceService(prisma, ref).touch('mod-a', new Date('2026-07-26T10:02:00Z'));
    expect(prisma.module.updateMany.mock.calls[0][0].data).toEqual({
      lastSeenAt: new Date('2026-07-26T10:02:00Z'),
    });
  });
});

describe('ResilienceService · reacción a la caída', () => {
  it('módulo implicado caído → ordena pausa y marca la partida en pausa', async () => {
    const prisma = buildPrisma();
    const { ref, sendSystemCommand } = mqttRef();
    const decision = await new ResilienceService(prisma, ref).record(presence());
    expect(decision!.action).toBe('auto_pause');
    expect(sendSystemCommand).toHaveBeenCalledWith('panel-a', 'pause_game', {}, 10000);
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('coordinador caído → pausa dura registrada como crítica', async () => {
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
    expect(prisma.incident.create.mock.calls[0][0].data.severity).toBe('critical');
  });

  it('si no se puede publicar la pausa, se pausa igual y se registra el fallo', async () => {
    const prisma = buildPrisma();
    const sendSystemCommand = jest.fn(() => {
      throw new Error('sin cliente MQTT');
    });
    const { ref } = mqttRef(sendSystemCommand);
    await new ResilienceService(prisma, ref).record(presence());
    const kinds = prisma.incident.create.mock.calls.map((c: any) => c[0].data.kind);
    expect(kinds).toContain('pause_command_failed');
    // El panel no puede mostrar «en curso» algo que ya no lo está.
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('una partida ya pausada no recibe otra orden de pausa', async () => {
    const prisma = buildPrisma({
      game: { findFirst: jest.fn().mockResolvedValue({ ...GAME, status: 'paused' }) },
    });
    const { ref, sendSystemCommand } = mqttRef();
    await new ResilienceService(prisma, ref).record(presence());
    expect(sendSystemCommand).not.toHaveBeenCalled();
  });

  it('un módulo que no aporta dianas a la ronda no la pausa', async () => {
    const prisma = buildPrisma({
      module: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'm-z', slug: 'mod-z', online: true, targetSystemId: 's1' }),
      },
      targetSystem: { findUnique: jest.fn().mockResolvedValue({ coordinatorModuleId: 'm-a' }) },
    });
    const { ref, sendSystemCommand } = mqttRef();
    const decision = await new ResilienceService(prisma, ref).record(
      presence({ moduleSlug: 'mod-z' }),
    );
    expect(decision!.action).toBe('none');
    expect(sendSystemCommand).not.toHaveBeenCalled();
  });
});

describe('ResilienceService · estado y decisión del operador', () => {
  it('el estado enumera los módulos que faltan y la cuenta atrás', async () => {
    const prisma = buildPrisma();
    const { ref } = mqttRef();
    const status = await new ResilienceService(prisma, ref).statusOf(
      'g1',
      new Date('2026-07-26T10:00:30Z'),
      60_000,
    );
    expect(status.missingModules.map((m: any) => m.slug)).toEqual(['mod-b']);
    expect(status.countdown).toMatchObject({ remainingMs: 30_000, expired: false });
    expect(status.operatorMustDecide).toBe(true);
    expect(status.canResumeWithout).toBe(true);
  });

  it('con el coordinador caído no se puede reanudar sin él', async () => {
    const prisma = buildPrisma({
      module: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'm-a', slug: 'mod-a', online: false, lastSeenAt: new Date('2026-07-26T10:00:00Z') },
          { id: 'm-b', slug: 'mod-b', online: true, lastSeenAt: null },
        ]),
      },
    });
    const { ref } = mqttRef();
    const service = new ResilienceService(prisma, ref);
    const status = await service.statusOf('g1');
    expect(status.coordinatorDown).toBe(true);
    expect(status.canResumeWithout).toBe(false);
    await expect(service.decide('g1', 'resume_without')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('reanudar sin el módulo deja constancia de que cambian las condiciones', async () => {
    const prisma = buildPrisma();
    const { ref, sendSystemCommand } = mqttRef();
    const result = await new ResilienceService(prisma, ref).decide('g1', 'resume_without', 'operador');
    expect(sendSystemCommand).toHaveBeenCalledWith('panel-a', 'resume_game', {}, 10000);
    expect(result.missing).toEqual(['mod-b']);
    const incident = prisma.$transaction.mock.calls[0][0];
    expect(incident).toHaveLength(2);
  });

  it('no se «reanuda sin nadie» cuando no falta ningún módulo', async () => {
    const prisma = buildPrisma({
      module: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'm-b', slug: 'mod-b', online: true, lastSeenAt: null }]),
      },
    });
    const { ref } = mqttRef();
    await expect(
      new ResilienceService(prisma, ref).decide('g1', 'resume_without'),
    ).rejects.toThrow(/No falta ningún módulo/);
  });

  it('abortar cierra la partida', async () => {
    const prisma = buildPrisma();
    const { ref, sendSystemCommand } = mqttRef();
    const result = await new ResilienceService(prisma, ref).decide('g1', 'abort');
    expect(sendSystemCommand).toHaveBeenCalledWith('panel-a', 'abort_game', {}, 10000);
    expect(result.action).toBe('abort');
  });

  it('partida inexistente → 404', async () => {
    const prisma = buildPrisma({ game: { findUnique: jest.fn().mockResolvedValue(null) } });
    const { ref } = mqttRef();
    await expect(new ResilienceService(prisma, ref).statusOf('gX')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
