import {
  BLACKOUT_GRACE_MS,
  findStaleModules,
  isBlackout,
  STALE_AFTER_MS,
} from '../../src/domain/resilience/resilience';
import {
  RECONNECT_GRACE_MS,
  ResilienceService,
  sweepIntervalFrom,
} from '../../src/modules/resilience/resilience.service';

const T0 = new Date('2026-07-26T10:00:00.000Z');
const at = (msAfter: number) => new Date(T0.getTime() + msAfter);
/** Instante en que el barrido ya puede declarar caídas (broker oído de sobra). */
const LATE = at(STALE_AFTER_MS + 1_000);

describe('Módulos callados (D9) · regla pura', () => {
  it('un módulo en línea que sigue hablando NO está caído', () => {
    const stale = findStaleModules(
      [{ slug: 'mod-a', online: true, lastSeenAt: at(0) }],
      at(STALE_AFTER_MS - 1),
    );
    expect(stale).toEqual([]);
  });

  it('justo en el límite todavía no se le da por caído', () => {
    const stale = findStaleModules(
      [{ slug: 'mod-a', online: true, lastSeenAt: at(0) }],
      at(STALE_AFTER_MS),
    );
    expect(stale).toEqual([]);
  });

  it('pasado el límite se le da por caído y se dice cuánto lleva callado', () => {
    const stale = findStaleModules(
      [{ slug: 'mod-a', online: true, lastSeenAt: at(0) }],
      at(STALE_AFTER_MS + 5_000),
    );
    expect(stale).toHaveLength(1);
    expect(stale[0].silentForMs).toBe(STALE_AFTER_MS + 5_000);
    expect(stale[0].reason).toMatch(/sin dar señal de vida/);
    // La afirmación es más débil que un LWT y el texto lo dice.
    expect(stale[0].reason).toMatch(/sin haber recibido su Last Will/);
  });

  it('un módulo que ya consta caído no se vuelve a declarar', () => {
    const stale = findStaleModules(
      [{ slug: 'mod-a', online: false, lastSeenAt: at(0) }],
      at(10 * STALE_AFTER_MS),
    );
    expect(stale).toEqual([]);
  });

  it('en línea sin ninguna señal de vida registrada: la bandera no la respalda nada', () => {
    const stale = findStaleModules([{ slug: 'mod-a', online: true, lastSeenAt: null }], at(0));
    expect(stale).toHaveLength(1);
    expect(stale[0].silentForMs).toBeNull();
    expect(stale[0].reason).toMatch(/ninguna señal de vida/);
  });

  it('el plazo tolerado deja margen de sobra frente al ritmo de telemetría', () => {
    // La telemetría que publica el backend va a 1 s (module-config.service.ts):
    // el umbral debe cubrir varias pérdidas seguidas, no una.
    expect(STALE_AFTER_MS).toBeGreaterThanOrEqual(10 * 1_000);
  });
});

const PLAN = { activations: [{ targets: [{ module_id: 'mod-a', target_index: 1 }] }] };
const GAME = {
  id: 'g1',
  status: 'running',
  targetSystemId: 's1',
  viewId: null,
  targetSystem: { id: 's1', slug: 'panel-a', name: 'Panel A', coordinatorModuleId: 'm-z' },
  rounds: [{ id: 'r1', roundIndex: 1, phase: 'running', plan: PLAN }],
};

type Row = {
  id?: string;
  slug: string;
  online: boolean;
  lastSeenAt: Date | null;
  targetSystemId?: string | null;
};

function buildService(modules: Row[], over: any = {}) {
  const rows = modules.map((m) => ({
    id: m.id ?? `id-${m.slug}`,
    targetSystemId: m.targetSystemId ?? 's1',
    offlineSince: null,
    ...m,
  }));
  const prisma = {
    module: {
      findMany: jest.fn().mockResolvedValue(rows),
      findUnique: jest.fn(async ({ where }: any) => rows.find((r) => r.slug === where.slug) ?? null),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      ...over.module,
    },
    game: {
      findFirst: jest.fn().mockResolvedValue(GAME),
      findUnique: jest.fn().mockResolvedValue(GAME),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      ...over.game,
    },
    viewPanel: { findMany: jest.fn().mockResolvedValue([]) },
    targetSystem: { findUnique: jest.fn().mockResolvedValue({ coordinatorModuleId: 'm-z' }) },
    incident: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
  } as any;
  const sendSystemCommand = jest.fn(() => ({ command_id: 'c1', delivered: true }));
  // El broker lleva oído desde mucho antes: la sordera propia no interfiere.
  const mqtt: { sendSystemCommand: jest.Mock; connected: boolean; connectedSince: Date | null } = {
    sendSystemCommand,
    connected: true,
    connectedSince: at(-3_600_000),
  };
  const service = new ResilienceService(prisma, { get: () => mqtt } as any);
  return { service, prisma, mqtt, sendSystemCommand };
}

describe('Barrido · no confundir sordera propia con caída ajena (D1)', () => {
  it('sin conexión con el broker NO se declara ninguna caída', async () => {
    const { service, mqtt, prisma } = buildService([
      { slug: 'mod-a', online: true, lastSeenAt: at(0) },
    ]);
    mqtt.connectedSince = null;
    expect(await service.sweepStale(LATE)).toEqual([]);
    // Ni siquiera se consulta: no hay nada que interpretar sin escucha.
    expect(prisma.module.findMany).not.toHaveBeenCalled();
  });

  it('recién reconectado al broker se espera: no hemos oído lo suficiente', async () => {
    const { service, mqtt, prisma } = buildService([
      { slug: 'mod-a', online: true, lastSeenAt: at(0) },
    ]);
    mqtt.connectedSince = at(STALE_AFTER_MS - 10_000);
    expect(await service.sweepStale(LATE)).toEqual([]);
    expect(prisma.module.findMany).not.toHaveBeenCalled();
  });

  it('si callan TODOS a la vez es el camino común, no una caída de cada uno', async () => {
    const { service, prisma } = buildService([
      { slug: 'mod-a', online: true, lastSeenAt: at(0) },
      { slug: 'mod-b', online: true, lastSeenAt: at(0) },
      { slug: 'mod-c', online: true, lastSeenAt: at(0) },
    ]);
    expect(await service.sweepStale(LATE)).toEqual([]);
    // Nadie se marca caído; queda una incidencia crítica apuntando al broker.
    expect(prisma.module.update).not.toHaveBeenCalled();
    const incident = prisma.incident.create.mock.calls[0][0].data;
    expect(incident.kind).toBe('presence_blackout');
    expect(incident.severity).toBe('critical');
    expect(incident.message).toMatch(/camino común/);
  });

  it('el plazo de tolerancia del apagón es de 4 minutos, ni más ni menos', () => {
    // Fijado con un literal A PROPÓSITO: derivarlo de la constante haría que la
    // prueba se moviese con ella y el plazo se podría cambiar —o anular— sin
    // que nada fallara. Es el número que acota el punto ciego.
    expect(BLACKOUT_GRACE_MS).toBe(240_000);
  });

  it('dentro del plazo se tolera; justo pasado, se declara', async () => {
    const build = () =>
      buildService([
        { slug: 'mod-a', online: true, lastSeenAt: at(0) },
        { slug: 'mod-b', online: true, lastSeenAt: at(0) },
      ]);
    const a = build();
    await a.service.sweepStale(LATE);
    expect(await a.service.sweepStale(new Date(LATE.getTime() + 239_000))).toEqual([]);
    const b = build();
    await b.service.sweepStale(LATE);
    expect(await b.service.sweepStale(new Date(LATE.getTime() + 241_000))).toEqual([
      'mod-a',
      'mod-b',
    ]);
  });

  it('el apagón no ciega para siempre: pasado el plazo se declaran igualmente', async () => {
    const { service, prisma } = buildService([
      { slug: 'mod-a', online: true, lastSeenAt: at(0) },
      { slug: 'mod-b', online: true, lastSeenAt: at(0) },
    ]);
    // Se va la luz de la sala: los dos módulos mueren de verdad y a la vez.
    expect(await service.sweepStale(LATE)).toEqual([]);
    const late = new Date(LATE.getTime() + BLACKOUT_GRACE_MS + 1_000);
    expect(await service.sweepStale(late)).toEqual(['mod-a', 'mod-b']);
    expect(prisma.game.updateMany).toHaveBeenCalled();
  });

  it('la incidencia de apagón se emite UNA vez, no en cada barrido', async () => {
    const { service, prisma } = buildService([
      { slug: 'mod-a', online: true, lastSeenAt: at(0) },
      { slug: 'mod-b', online: true, lastSeenAt: at(0) },
    ]);
    for (let i = 0; i < 4; i += 1) await service.sweepStale(new Date(LATE.getTime() + i * 15_000));
    const blackouts = prisma.incident.create.mock.calls.filter(
      (c: any) => c[0].data.kind === 'presence_blackout',
    );
    expect(blackouts).toHaveLength(1);
  });

  it('resuelto un apagón, el siguiente vuelve a tolerarse y a dejar incidencia', async () => {
    const { service, prisma } = buildService([
      { slug: 'mod-a', online: true, lastSeenAt: at(0) },
      { slug: 'mod-b', online: true, lastSeenAt: at(0) },
    ]);
    await service.sweepStale(LATE); // apagón 1
    // Vuelven a hablar: el apagón se acaba.
    prisma.module.findMany.mockResolvedValue([
      { id: 'id-mod-a', slug: 'mod-a', online: true, lastSeenAt: LATE, offlineSince: null, targetSystemId: 's1' },
      { id: 'id-mod-b', slug: 'mod-b', online: true, lastSeenAt: LATE, offlineSince: null, targetSystemId: 's1' },
    ]);
    await service.sweepStale(new Date(LATE.getTime() + 1_000));
    // Y vuelven a callar: apagón 2, con su propio plazo y su propia incidencia.
    prisma.module.findMany.mockResolvedValue([
      { id: 'id-mod-a', slug: 'mod-a', online: true, lastSeenAt: LATE, offlineSince: null, targetSystemId: 's1' },
      { id: 'id-mod-b', slug: 'mod-b', online: true, lastSeenAt: LATE, offlineSince: null, targetSystemId: 's1' },
    ]);
    const t2 = new Date(LATE.getTime() + STALE_AFTER_MS + 2_000);
    expect(await service.sweepStale(t2)).toEqual([]);
    const blackouts = prisma.incident.create.mock.calls.filter(
      (c: any) => c[0].data.kind === 'presence_blackout',
    );
    expect(blackouts).toHaveLength(2);
  });

  it('quedarse sordo REINICIA el plazo del apagón: no se acumula sordera (B1)', async () => {
    const { service, mqtt, prisma } = buildService([
      { slug: 'mod-a', online: true, lastSeenAt: at(0) },
      { slug: 'mod-b', online: true, lastSeenAt: at(0) },
    ]);
    await service.sweepStale(LATE); // apagón tolerado
    // Se cae el broker 10 minutos: no oímos nada, así que ese silencio no es
    // de los módulos y no puede consumir la tolerancia.
    mqtt.connectedSince = null;
    await service.sweepStale(new Date(LATE.getTime() + 600_000));
    // Vuelve el broker; se le lleva oyendo justo el plazo de silencio.
    const back = new Date(LATE.getTime() + 700_000);
    mqtt.connectedSince = back;
    const after = new Date(back.getTime() + STALE_AFTER_MS + 1_000);
    // Con el plazo reiniciado, todavía NO se declara nada.
    expect(await service.sweepStale(after)).toEqual([]);
    expect(prisma.game.updateMany).not.toHaveBeenCalled();
  });

  it('un corte BREVE del broker entre barridos también reinicia el plazo (B1)', async () => {
    // Caso distinto del anterior: mqtt.js reconecta en ~1 s y el barrido va cada
    // 15 s, así que lo NORMAL es que ningún barrido llegue a ver la desconexión.
    // Lo único que queda es que `connectedSince` sea reciente, y eso también
    // tiene que reiniciar la tolerancia: si no, el rato sin escucha se cuela
    // como silencio de los módulos. Sin esta prueba, borrar ese segundo reinicio
    // reintroducía B1 con toda la suite en verde.
    const { service, mqtt, prisma } = buildService([
      { slug: 'mod-a', online: true, lastSeenAt: at(0) },
      { slug: 'mod-b', online: true, lastSeenAt: at(0) },
    ]);
    await service.sweepStale(LATE); // apagón tolerado; empieza a contar
    // El broker cayó y volvió ENTRE dos barridos: nunca vimos `null`.
    const reconnect = new Date(LATE.getTime() + 60_000);
    mqtt.connectedSince = reconnect;
    // Barrido mientras aún no se ha oído bastante: no declara y OLVIDA el plazo.
    await service.sweepStale(new Date(reconnect.getTime() + 10_000));
    // Ya se oye de sobra, y ha pasado más del plazo desde el PRIMER apagón…
    const after = new Date(reconnect.getTime() + BLACKOUT_GRACE_MS + 5_000);
    // …pero el plazo cuenta desde que volvimos a oír, así que aún no toca.
    expect(await service.sweepStale(after)).toEqual([]);
    expect(prisma.game.updateMany).not.toHaveBeenCalled();
  });

  it('un módulo que nunca dio señal no convierte una caída aislada en apagón', async () => {
    const { service } = buildService([
      { slug: 'mod-a', online: true, lastSeenAt: at(0) },
      { slug: 'mod-b', online: true, lastSeenAt: null },
    ]);
    // `mod-b` no ha hablado nunca: su silencio no prueba nada sobre el camino
    // común, así que no puede tapar la caída real de `mod-a`.
    expect(await service.sweepStale(LATE)).toEqual(['mod-a', 'mod-b']);
  });

  it('con un solo módulo en línea sí se le declara (no hay apagón que valga)', async () => {
    const { service } = buildService([{ slug: 'mod-a', online: true, lastSeenAt: at(0) }]);
    expect(await service.sweepStale(LATE)).toEqual(['mod-a']);
  });

  it('callados algunos pero no todos, se declaran sólo esos', async () => {
    const { service } = buildService([
      { slug: 'mod-a', online: true, lastSeenAt: at(0) },
      { slug: 'mod-b', online: true, lastSeenAt: LATE },
    ]);
    expect(await service.sweepStale(LATE)).toEqual(['mod-a']);
  });
});

describe('Barrido · declaración de la caída', () => {
  it('sólo consulta módulos que constan EN LÍNEA', async () => {
    const { service, prisma } = buildService([]);
    await service.sweepStale(LATE);
    expect(prisma.module.findMany.mock.calls[0][0].where).toEqual({ online: true });
  });

  it('la ventana de reconexión NO nace agotada: se cuenta desde la declaración (D3)', async () => {
    const { service, prisma } = buildService([{ slug: 'mod-a', online: true, lastSeenAt: at(0) }]);
    await service.sweepStale(LATE);
    const data = prisma.module.update.mock.calls[0][0].data;
    expect(data.online).toBe(false);
    // `offlineSince` = ahora ⇒ el operador dispone del plazo completo.
    expect(data.offlineSince).toEqual(LATE);
    // Y no se pierde cuánto llevaba callado: `lastSeenAt` no se toca.
    expect(data.lastSeenAt).toBeUndefined();
    expect(LATE.getTime() - (data.offlineSince as Date).getTime()).toBeLessThan(RECONNECT_GRACE_MS);
  });

  it('la incidencia dice que se dedujo del silencio y apunta a módulo y panel', async () => {
    const { service, prisma } = buildService([{ slug: 'mod-a', online: true, lastSeenAt: at(0) }]);
    await service.sweepStale(LATE);
    const data = prisma.incident.create.mock.calls[0][0].data;
    expect(data.kind).toBe('module_stale');
    // Sin estas dos claves la incidencia no sale en las vistas por módulo/panel.
    expect(data.moduleId).toBe('id-mod-a');
    expect(data.targetSystemId).toBe('s1');
    expect(data.detail).toMatchObject({
      module_slug: 'mod-a',
      silent_for_ms: STALE_AFTER_MS + 1_000,
      stale_after_ms: STALE_AFTER_MS,
    });
  });

  it('un módulo que sigue vivo no se toca', async () => {
    const { service, prisma } = buildService([{ slug: 'mod-a', online: true, lastSeenAt: at(0) }]);
    expect(await service.sweepStale(at(1_000))).toEqual([]);
    expect(prisma.module.update).not.toHaveBeenCalled();
    expect(prisma.incident.create).not.toHaveBeenCalled();
  });

  it('el camino COMPLETO: callar acaba pausando la ronda y ordenando la pausa', async () => {
    // Sin mockear `record`: es la prueba de que el barrido no es un camino
    // paralelo, sino el mismo que recorre un Last Will.
    const { service, prisma, sendSystemCommand } = buildService([
      { slug: 'mod-a', online: true, lastSeenAt: at(0) },
    ]);
    await service.sweepStale(LATE);
    expect(prisma.game.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'g1', status: 'running' }, data: { status: 'paused' } }),
    );
    expect(sendSystemCommand).toHaveBeenCalledWith('panel-a', 'pause_game', {}, 10000);
    const kinds = prisma.incident.create.mock.calls.map((c: any) => c[0].data.kind);
    expect(kinds).toContain('module_stale');
    expect(kinds).toContain('module_offline');
  });

  it('un fallo con un módulo no deja sin revisar a los demás (N2)', async () => {
    const { service, prisma } = buildService([
      { slug: 'mod-a', online: true, lastSeenAt: at(0) },
      { slug: 'mod-b', online: true, lastSeenAt: at(0) },
      { slug: 'mod-c', online: true, lastSeenAt: LATE },
    ]);
    prisma.module.update.mockImplementation(async ({ where }: any) => {
      if (where.id === 'id-mod-a') throw new Error('BD caída');
      return {};
    });
    // mod-a revienta, mod-b se declara igualmente.
    expect(await service.sweepStale(LATE)).toEqual(['mod-b']);
  });

  it('dos barridos solapados no declaran la caída dos veces', async () => {
    const { service, prisma } = buildService([{ slug: 'mod-a', online: true, lastSeenAt: at(0) }]);
    const [a, b] = await Promise.all([service.sweepStale(LATE), service.sweepStale(LATE)]);
    expect([a.length, b.length].sort()).toEqual([0, 1]);
    expect(prisma.module.update).toHaveBeenCalledTimes(1);
  });
});

describe('Barrido · un módulo dado por caído puede volver (D2)', () => {
  it('la telemetría de un módulo que consta caído lo devuelve a la vida', async () => {
    const { service, prisma } = buildService([{ slug: 'mod-a', online: false, lastSeenAt: at(0) }]);
    await service.touch('mod-a', LATE, true);
    const data = prisma.module.update.mock.calls[0][0].data;
    expect(data.online).toBe(true);
    expect(data.lastSeenAt).toEqual(LATE);
  });

  it('un mensaje RETENIDO (status) no resucita a nadie', async () => {
    // Se reentrega al reconectar el backend: reviviría a un módulo muerto.
    const { service, prisma } = buildService([{ slug: 'mod-a', online: false, lastSeenAt: at(0) }]);
    await service.touch('mod-a', LATE);
    expect(prisma.module.update).not.toHaveBeenCalled();
  });

  it('con el módulo ya en línea sólo se refresca la última vez que se le vio', async () => {
    const { service, prisma } = buildService([{ slug: 'mod-a', online: true, lastSeenAt: at(0) }]);
    prisma.module.updateMany.mockResolvedValue({ count: 1 });
    await service.touch('mod-a', LATE, true);
    expect(prisma.module.updateMany).toHaveBeenCalledWith({
      where: { slug: 'mod-a', online: true },
      data: { lastSeenAt: LATE },
    });
    expect(prisma.module.update).not.toHaveBeenCalled();
  });

  it('un módulo desconocido no se da de alta por la puerta de atrás', async () => {
    const { service, prisma } = buildService([]);
    await service.touch('mod-x', LATE, true);
    expect(prisma.module.update).not.toHaveBeenCalled();
  });
});

describe('Estado de la partida · el operador ve el silencio antes del barrido', () => {
  it('publica los módulos callados que aún no se han declarado caídos', async () => {
    const { service } = buildService([{ slug: 'mod-a', online: true, lastSeenAt: at(0) }]);
    const status = await service.statusOf('g1', LATE);
    // Todavía consta en línea, así que no está en `missingModules`…
    expect(status.missingModules).toEqual([]);
    // …pero el operador tiene que poder verlo venir.
    expect(status.staleModules).toEqual([
      expect.objectContaining({ slug: 'mod-a', silentForMs: STALE_AFTER_MS + 1_000 }),
    ]);
  });

  it('un módulo que habla no figura como callado', async () => {
    const { service } = buildService([{ slug: 'mod-a', online: true, lastSeenAt: LATE }]);
    expect((await service.statusOf('g1', LATE)).staleModules).toEqual([]);
  });

  it('con la partida terminada no se promete una pausa que no va a ocurrir (N5)', async () => {
    const { service, prisma } = buildService([{ slug: 'mod-a', online: true, lastSeenAt: at(0) }]);
    prisma.game.findUnique.mockResolvedValue({ ...GAME, status: 'finished' });
    expect((await service.statusOf('g1', LATE)).staleModules).toEqual([]);
  });

  it('de un módulo caído se dice cuánto lleva callado, no sólo que falta', async () => {
    const { service, prisma } = buildService([]);
    prisma.module.findMany.mockResolvedValue([
      {
        id: 'id-mod-a',
        slug: 'mod-a',
        online: false,
        lastSeenAt: at(0),
        offlineSince: at(1_000),
        targetSystemId: 's1',
      },
    ]);
    const status = await service.statusOf('g1', LATE);
    expect(status.missingModules[0]).toMatchObject({
      slug: 'mod-a',
      silentForMs: STALE_AFTER_MS + 1_000,
    });
  });
});

describe('Apagón · regla pura', () => {
  const heard = (slug: string, lastSeenAt: Date | null) => ({ slug, online: true, lastSeenAt });

  it('callan todos los que alguna vez hablaron: apagón', () => {
    const c = [heard('a', at(0)), heard('b', at(0))];
    expect(isBlackout(c, findStaleModules(c, LATE))).toBe(true);
  });

  it('si uno sigue hablando no hay apagón: el camino común funciona', () => {
    const c = [heard('a', at(0)), heard('b', LATE)];
    expect(isBlackout(c, findStaleModules(c, LATE))).toBe(false);
  });

  it('con un solo módulo no se puede hablar de camino común', () => {
    const c = [heard('a', at(0))];
    expect(isBlackout(c, findStaleModules(c, LATE))).toBe(false);
  });

  it('los que nunca hablaron no cuentan como prueba de apagón', () => {
    const c = [heard('a', at(0)), heard('b', null), heard('c', null)];
    expect(isBlackout(c, findStaleModules(c, LATE))).toBe(false);
  });

  it('un mudo NO puede tapar la caída real de otro haciéndola pasar por apagón', () => {
    // a cayó de verdad, b sigue hablando, c nunca habló. Si el mudo contase
    // como prueba, «todos los callados» sería {a, c} = todos los vistos y la
    // caída real de `a` se quedaría sin declarar.
    const c = [heard('a', at(0)), heard('b', LATE), heard('c', null)];
    expect(isBlackout(c, findStaleModules(c, LATE))).toBe(false);
  });
});

describe('Lo que la pantalla puede prometer (N-D1)', () => {
  it('sin escucha suficiente NO se promete pausa automática', async () => {
    const { service, mqtt } = buildService([{ slug: 'mod-a', online: true, lastSeenAt: at(0) }]);
    mqtt.connectedSince = null;
    expect((await service.statusOf('g1', LATE)).sweep).toEqual({
      enabled: true,
      listening: false,
      blackout: false,
    });
  });

  it('recién reconectado tampoco se promete pausa: aún no hemos oído bastante', async () => {
    const { service, mqtt } = buildService([{ slug: 'mod-a', online: true, lastSeenAt: at(0) }]);
    mqtt.connectedSince = at(STALE_AFTER_MS - 10_000);
    const sweep = (await service.statusOf('g1', LATE)).sweep;
    expect(sweep).toEqual({ enabled: true, listening: false, blackout: false });
  });

  it('con el barrido desactivado se dice que NADIE va a pausar la ronda (B2)', async () => {
    const previous = process.env.RESILIENCE_SWEEP_MS;
    process.env.RESILIENCE_SWEEP_MS = '0';
    try {
      const { service } = buildService([{ slug: 'mod-a', online: true, lastSeenAt: at(0) }]);
      expect((await service.statusOf('g1', LATE)).sweep).toEqual({
        enabled: false,
        listening: true,
        blackout: false,
      });
    } finally {
      if (previous === undefined) delete process.env.RESILIENCE_SWEEP_MS;
      else process.env.RESILIENCE_SWEEP_MS = previous;
    }
  });

  it('con apagón se dice que no se declarará ninguna caída de momento', async () => {
    const { service } = buildService([
      { slug: 'mod-a', online: true, lastSeenAt: at(0) },
      { slug: 'mod-b', online: true, lastSeenAt: at(0) },
    ]);
    expect((await service.statusOf('g1', LATE)).sweep).toEqual({
      enabled: true,
      listening: true,
      blackout: true,
    });
  });

  it('en condiciones normales sí se promete la pausa', async () => {
    const { service } = buildService([
      { slug: 'mod-a', online: true, lastSeenAt: at(0) },
      { slug: 'mod-b', online: true, lastSeenAt: LATE },
    ]);
    expect((await service.statusOf('g1', LATE)).sweep).toEqual({
      enabled: true,
      listening: true,
      blackout: false,
    });
  });

  it('el COORDINADOR callado también avisa, aunque no aporte dianas al plan', async () => {
    const { service, prisma } = buildService([]);
    prisma.module.findMany.mockResolvedValue([
      { id: 'm-z', slug: 'mod-z', online: true, lastSeenAt: at(0), offlineSince: null, targetSystemId: 's1' },
      { id: 'id-mod-a', slug: 'mod-a', online: true, lastSeenAt: LATE, offlineSince: null, targetSystemId: 's1' },
    ]);
    // `mod-z` es el coordinador (GAME.targetSystem.coordinatorModuleId = 'm-z')
    // y su caída provoca PAUSA DURA: es el caso más grave y el que menos aviso
    // previo tenía.
    const status = await service.statusOf('g1', LATE);
    expect(status.staleModules.map((m) => m.slug)).toEqual(['mod-z']);
  });
});

describe('Barrido · el temporizador', () => {
  afterEach(() => jest.useRealTimers());

  it('barre de verdad cada intervalo (no basta con crear el temporizador)', async () => {
    jest.useFakeTimers();
    const { service } = buildService([]);
    const sweep = jest.spyOn(service, 'sweepStale').mockResolvedValue([]);
    service.onApplicationBootstrap();
    expect(sweep).not.toHaveBeenCalled();
    jest.advanceTimersByTime(15_000);
    expect(sweep).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(30_000);
    expect(sweep).toHaveBeenCalledTimes(3);
    service.onModuleDestroy();
    jest.advanceTimersByTime(60_000);
    expect(sweep).toHaveBeenCalledTimes(3);
  });

  it('no mantiene vivo el proceso al apagar (unref)', () => {
    jest.useFakeTimers();
    const { service } = buildService([]);
    service.onApplicationBootstrap();
    const timer = (service as any).sweepTimer as NodeJS.Timeout;
    expect(jest.getTimerCount()).toBeGreaterThan(0);
    // `unref` es lo único que evita que el intervalo bloquee el cierre.
    expect((timer as any).hasRef?.() ?? false).toBe(false);
    service.onModuleDestroy();
    expect((service as any).sweepTimer).toBeNull();
  });

  it('un fallo del barrido no tumba el temporizador', async () => {
    jest.useFakeTimers();
    const { service } = buildService([]);
    const sweep = jest.spyOn(service, 'sweepStale').mockRejectedValue(new Error('BD caída'));
    service.onApplicationBootstrap();
    jest.advanceTimersByTime(30_000);
    await Promise.resolve();
    expect(sweep).toHaveBeenCalledTimes(2);
    service.onModuleDestroy();
  });
});

describe('Barrido · configuración del intervalo (N4)', () => {
  it('sin variable, el valor por defecto', () => {
    expect(sweepIntervalFrom(undefined)).toBe(15_000);
    expect(sweepIntervalFrom('')).toBe(15_000);
  });

  it('un 0 explícito lo desactiva: es la única forma de apagarlo', () => {
    expect(sweepIntervalFrom('0')).toBe(0);
  });

  it('una errata NO apaga la detección en silencio: avisa y sigue barriendo', () => {
    const logger = { error: jest.fn() } as any;
    expect(sweepIntervalFrom('30s', logger)).toBe(15_000);
    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/no es un número válido/));
  });

  it('un valor negativo tampoco lo apaga', () => {
    expect(sweepIntervalFrom('-1')).toBe(15_000);
  });

  it('un valor válido se respeta', () => {
    expect(sweepIntervalFrom('5000')).toBe(5_000);
  });
});
