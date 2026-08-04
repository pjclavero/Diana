import { LiveGateway, LIVE_MESSAGE } from '../../src/modules/websocket/live.gateway';

const AT = new Date('2026-07-26T10:00:00Z');

function buildGateway(
  over: { verify?: jest.Mock; corsOrigins?: string[]; cuenta?: unknown } = {},
) {
  const rooms = new Map<string, { emit: jest.Mock }>();
  const to = jest.fn((room: string) => {
    if (!rooms.has(room)) rooms.set(room, { emit: jest.fn() });
    return rooms.get(room)!;
  });
  const server = { emit: jest.fn(), to } as never;
  const verify = over.verify ?? jest.fn(() => ({ sub: 'u1', username: 'ana' }));
  const config = {
    corsOrigins: over.corsOrigins ?? ['http://localhost:8080'],
    jwt: { secret: 's' },
  } as never;
  // La cuenta se comprueba contra la BASE en el saludo: un token válido de una
  // cuenta desactivada no debe abrir el canal.
  const cuenta = 'cuenta' in over ? over.cuenta : { id: 'u1', active: true };
  const findUnique = jest.fn().mockResolvedValue(cuenta);
  const prisma = { user: { findUnique } } as never;
  const gateway = new LiveGateway({ verify } as never, config, prisma);
  gateway.server = server;
  return {
    gateway,
    rooms,
    to,
    verify,
    findUnique,
    server: server as unknown as { emit: jest.Mock },
  };
}

const client = (token?: string) =>
  ({
    id: 'c1',
    data: {} as Record<string, unknown>,
    join: jest.fn(),
    leave: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
    handshake: { auth: token ? { token } : {}, headers: {} },
  }) as never;

const state = (gameId: string, over: Record<string, unknown> = {}) => ({
  game_id: gameId,
  system_id: 's1',
  phase: 'running',
  elapsed_us: 1_000,
  ...over,
});

const stateEvent = (gameId: string, over: Record<string, unknown> = {}) => ({
  type: 'game-state',
  topic: `targets/v1/system/s1/game/state`,
  payload: state(gameId, over),
  at: AT,
});

const gameEvent = (gameId: string, kind = 'target_hit') => ({
  type: 'game-event',
  topic: `targets/v1/system/s1/game/event`,
  payload: { game_id: gameId, system_id: 's1', kind, elapsed_us: 2_000 },
  at: AT,
});

describe('LiveGateway · suscripción por partida (X-06)', () => {
  it('suscribirse mete al cliente en la sala de SU partida', () => {
    const { gateway } = buildGateway();
    const c = client();
    const res = gateway.onSubscribeGame(c, { game_id: 'g1' });
    expect(res.room).toBe('game:g1');
    expect((c as unknown as { join: jest.Mock }).join).toHaveBeenCalledWith('game:g1');
  });

  it('al suscribirse se devuelve el último estado conocido, no una pantalla en blanco', () => {
    const { gateway } = buildGateway();
    gateway.publish(stateEvent('g1', { targets_hit: 3 }));
    const res = gateway.onSubscribeGame(client(), { game_id: 'g1' });
    expect(res.state).toMatchObject({ game_id: 'g1', targets_hit: 3 });
  });

  it('sin estado previo se dice `null`, no se inventa uno', () => {
    const { gateway } = buildGateway();
    expect(gateway.onSubscribeGame(client(), { game_id: 'g9' }).state).toBeNull();
  });

  it('una suscripción sin partida no mete al cliente en ninguna sala', () => {
    const { gateway } = buildGateway();
    const c = client();
    expect(gateway.onSubscribeGame(c, {}).room).toBe('');
    expect((c as unknown as { join: jest.Mock }).join).not.toHaveBeenCalled();
  });

  it('darse de baja saca al cliente de la sala', () => {
    const { gateway } = buildGateway();
    const c = client();
    gateway.onUnsubscribeGame(c, { game_id: 'g1' });
    expect((c as unknown as { leave: jest.Mock }).leave).toHaveBeenCalledWith('game:g1');
  });
});

describe('LiveGateway · el directo va SÓLO a su partida', () => {
  it('el estado se emite a la sala de la partida, no a todo el mundo', () => {
    const { gateway, rooms, to } = buildGateway();
    gateway.publish(stateEvent('g1'));
    expect(to).toHaveBeenCalledWith('game:g1');
    const emit = rooms.get('game:g1')!.emit;
    expect(emit).toHaveBeenCalledWith(LIVE_MESSAGE, { state: expect.objectContaining({ game_id: 'g1' }) });
  });

  it('un evento de otra partida NO llega a la sala de ésta', () => {
    const { gateway, rooms } = buildGateway();
    gateway.publish(stateEvent('g1'));
    gateway.publish(gameEvent('g2'));
    // La sala de g1 sólo ha recibido su estado.
    expect(rooms.get('game:g1')!.emit).toHaveBeenCalledTimes(1);
    expect(rooms.get('game:g2')!.emit).toHaveBeenCalledTimes(1);
  });

  it('el evento viaja con el último estado conocido de SU partida', () => {
    const { gateway, rooms } = buildGateway();
    gateway.publish(stateEvent('g1', { targets_hit: 2 }));
    gateway.publish(gameEvent('g1', 'target_hit'));
    const last = rooms.get('game:g1')!.emit.mock.calls.at(-1)!;
    expect(last[0]).toBe(LIVE_MESSAGE);
    expect(last[1].state).toMatchObject({ game_id: 'g1', targets_hit: 2 });
    expect(last[1].event).toMatchObject({ kind: 'target_hit' });
  });

  it('un evento sin estado previo se entrega con `state: null` en vez de callarse', () => {
    const { gateway, rooms } = buildGateway();
    gateway.publish(gameEvent('g7'));
    const last = rooms.get('game:g7')!.emit.mock.calls.at(-1)!;
    expect(last[1].state).toBeNull();
    expect(last[1].event).toBeDefined();
  });

  it('el estado se actualiza: el segundo evento lleva el estado más reciente', () => {
    const { gateway, rooms } = buildGateway();
    gateway.publish(stateEvent('g1', { targets_hit: 1 }));
    gateway.publish(stateEvent('g1', { targets_hit: 5 }));
    gateway.publish(gameEvent('g1'));
    const last = rooms.get('game:g1')!.emit.mock.calls.at(-1)!;
    expect(last[1].state).toMatchObject({ targets_hit: 5 });
  });

  it('un mensaje sin `game_id` no se emite a ninguna sala de partida', () => {
    const { gateway, to } = buildGateway();
    gateway.publish({ type: 'game-state', topic: 't', payload: { system_id: 's1' }, at: AT });
    const salas = to.mock.calls.map((c) => c[0]);
    expect(salas.filter((r) => String(r).startsWith('game:'))).toEqual([]);
  });

  it('el diagnóstico NO se difunde a todo el mundo: va a su sala', () => {
    const { gateway, server, rooms } = buildGateway();
    gateway.publish({ type: 'module-telemetry', topic: 't', payload: { module_id: 'm1' }, at: AT });
    // `server.emit` mandaba la manguera MQTT completa a cualquier conectado.
    expect(server.emit).not.toHaveBeenCalled();
    expect(rooms.get('diagnostics')!.emit).toHaveBeenCalledWith(
      'module-telemetry',
      expect.any(Object),
    );
  });

  it('un cliente que no pide diagnóstico no recibe tópicos ajenos', () => {
    const { gateway, rooms } = buildGateway();
    gateway.publish(stateEvent('g1'));
    gateway.publish({ type: 'module-telemetry', topic: 't', payload: { module_id: 'm1' }, at: AT });
    // La sala de la partida sólo ha recibido su mensaje `live`.
    expect(rooms.get('game:g1')!.emit).toHaveBeenCalledTimes(1);
  });

  it('al diagnóstico hay que pedir entrar expresamente', () => {
    const { gateway } = buildGateway();
    const c = client('t');
    expect(gateway.onSubscribeDiagnostics(c).subscribed).toBe('diagnostics');
    expect((c as unknown as { join: jest.Mock }).join).toHaveBeenCalledWith('diagnostics');
  });
});

describe('LiveGateway · el canal exige credenciales (B1)', () => {
  it('sin token se rechaza la conexión y se cierra', async () => {
    const { gateway } = buildGateway();
    const c = client();
    await gateway.handleConnection(c);
    const spy = c as unknown as { disconnect: jest.Mock; emit: jest.Mock };
    expect(spy.disconnect).toHaveBeenCalledWith(true);
    expect(spy.emit).toHaveBeenCalledWith('unauthorized', { reason: 'sin credenciales' });
  });

  it('con un token inválido tampoco se entra', async () => {
    const verify = jest.fn(() => {
      throw new Error('firma incorrecta');
    });
    const { gateway } = buildGateway({ verify });
    const c = client('basura');
    await gateway.handleConnection(c);
    expect((c as unknown as { disconnect: jest.Mock }).disconnect).toHaveBeenCalledWith(true);
  });

  it('con un token válido se entra y queda registrado quién es', async () => {
    const { gateway, verify } = buildGateway();
    const c = client('bueno');
    await gateway.handleConnection(c);
    expect(verify).toHaveBeenCalledWith('bueno');
    expect((c as unknown as { disconnect: jest.Mock }).disconnect).not.toHaveBeenCalled();
    expect((c as unknown as { data: { user?: unknown } }).data.user).toMatchObject({
      username: 'ana',
    });
  });

  it('una cuenta DESACTIVADA no abre el canal aunque su token sea válido', async () => {
    // Un WebSocket dura horas: sin comprobar la cuenta, desactivar a alguien lo
    // echaba del REST y le dejaba el directo abierto hasta que caducara el token.
    const { gateway } = buildGateway({ cuenta: { id: 'u1', active: false } });
    const c = client('bueno');
    await gateway.handleConnection(c);
    const spy = c as unknown as { disconnect: jest.Mock; emit: jest.Mock };
    expect(spy.disconnect).toHaveBeenCalledWith(true);
    expect(spy.emit).toHaveBeenCalledWith('unauthorized', { reason: 'cuenta no activa' });
  });

  it('una cuenta BORRADA tampoco entra', async () => {
    const { gateway } = buildGateway({ cuenta: null });
    const c = client('bueno');
    await gateway.handleConnection(c);
    expect((c as unknown as { disconnect: jest.Mock }).disconnect).toHaveBeenCalledWith(true);
  });

  it('se consulta al usuario del token, no a otro', async () => {
    const { gateway, findUnique } = buildGateway();
    await gateway.handleConnection(client('bueno'));
    expect(findUnique.mock.calls[0][0].where).toEqual({ id: 'u1' });
  });

  it('el token también se acepta en la cabecera Authorization', async () => {
    const { gateway, verify } = buildGateway();
    const c = client() as unknown as { handshake: { headers: Record<string, string> } };
    c.handshake.headers.authorization = 'Bearer desde-cabecera';
    await gateway.handleConnection(c as never);
    expect(verify).toHaveBeenCalledWith('desde-cabecera');
  });
});

describe('LiveGateway · no crece sin techo', () => {
  it('la memoria de estados tiene cota: no acumula una entrada por partida vista', () => {
    const { gateway } = buildGateway();
    for (let i = 0; i < 250; i += 1) gateway.publish(stateEvent(`g${i}`));
    // La primera se ha olvidado; la última se conserva.
    expect(gateway.onSubscribeGame(client(), { game_id: 'g0' }).state).toBeNull();
    expect(gateway.onSubscribeGame(client(), { game_id: 'g249' }).state).not.toBeNull();
  });

  it('el desalojo NO se lleva por delante la partida en curso (O2)', () => {
    const { gateway } = buildGateway();
    gateway.publish(stateEvent('viva'));
    // Se llena la memoria con partidas nuevas mientras la viva sigue latiendo.
    for (let i = 0; i < 250; i += 1) {
      gateway.publish(stateEvent(`relleno${i}`));
      gateway.publish(stateEvent('viva', { v: i }));
    }
    // Antes caía la primera INSERTADA, que era justo la que se estaba mirando.
    expect(gateway.onSubscribeGame(client(), { game_id: 'viva' }).state).not.toBeNull();
  });

  it('el búfer de diagnóstico no pasa de 200', () => {
    const { gateway } = buildGateway();
    for (let i = 0; i < 300; i += 1) gateway.publish(stateEvent('g1'));
    expect(gateway.recent(1000)).toHaveLength(200);
  });
});

describe('LiveGateway · sin servidor no revienta', () => {
  it('publicar antes de que el servidor exista no lanza', () => {
    const { gateway } = buildGateway();
    gateway.server = undefined;
    expect(() => gateway.publish(stateEvent('g1'))).not.toThrow();
    // Y el estado se recuerda igual, para quien se suscriba después.
    expect(gateway.onSubscribeGame(client(), { game_id: 'g1' }).state).not.toBeNull();
  });
});
