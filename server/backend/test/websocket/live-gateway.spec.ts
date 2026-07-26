import { LiveGateway, LIVE_MESSAGE } from '../../src/modules/websocket/live.gateway';

const AT = new Date('2026-07-26T10:00:00Z');

function buildGateway() {
  const rooms = new Map<string, { emit: jest.Mock }>();
  const to = jest.fn((room: string) => {
    if (!rooms.has(room)) rooms.set(room, { emit: jest.fn() });
    return rooms.get(room)!;
  });
  const server = { emit: jest.fn(), to } as never;
  const gateway = new LiveGateway();
  gateway.server = server;
  return { gateway, rooms, to, server: server as unknown as { emit: jest.Mock } };
}

const client = () => ({ id: 'c1', join: jest.fn(), leave: jest.fn() }) as never;

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

  it('un mensaje sin `game_id` no se emite a ninguna sala', () => {
    const { gateway, to } = buildGateway();
    gateway.publish({ type: 'game-state', topic: 't', payload: { system_id: 's1' }, at: AT });
    expect(to).not.toHaveBeenCalled();
  });

  it('los demás tópicos se siguen reemitiendo por su nombre (diagnóstico)', () => {
    const { gateway, server, to } = buildGateway();
    gateway.publish({ type: 'module-telemetry', topic: 't', payload: { module_id: 'm1' }, at: AT });
    expect(server.emit).toHaveBeenCalledWith('module-telemetry', expect.any(Object));
    expect(to).not.toHaveBeenCalled();
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

  it('el búfer de diagnóstico no pasa de 200', () => {
    const { gateway } = buildGateway();
    for (let i = 0; i < 300; i += 1) gateway.publish(stateEvent('g1'));
    expect(gateway.recent(1000)).toHaveLength(200);
  });
});

describe('LiveGateway · sin servidor no revienta', () => {
  it('publicar antes de que el servidor exista no lanza', () => {
    const gateway = new LiveGateway();
    expect(() => gateway.publish(stateEvent('g1'))).not.toThrow();
    // Y el estado se recuerda igual, para quien se suscriba después.
    expect(gateway.onSubscribeGame(client(), { game_id: 'g1' }).state).not.toBeNull();
  });
});
