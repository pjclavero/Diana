import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  ACTING_COMMAND_TYPES,
  ModuleDiagnosticsService,
} from '../../src/modules/modules/module-diagnostics.service';
import { CommandBuilder } from '../../src/contracts/command-builder';
import { ContractValidator } from '../../src/contracts/contract-validator';
import { topics } from '../../src/contracts/topics';

const MODULE = { id: 'm1', slug: 'mod-a', ownerId: 'u-gestor', targetSystemId: 'panel-1' };
const ADMIN = { userId: 'u-admin', role: 'administrador' };
const OWNER = { userId: 'u-gestor', role: 'gestor' };
const OTHER = { userId: 'u-otro', role: 'gestor' };

function build(over: any = {}) {
  const prisma = {
    module: {
      findUnique: jest.fn().mockResolvedValue(MODULE),
      ...over.module,
    },
    target: {
      findFirst: jest.fn().mockResolvedValue({ id: 't1', targetIndex: 3, enabled: true }),
      ...over.target,
    },
    incident: { findMany: jest.fn().mockResolvedValue([]), ...over.incident },
  } as any;
  const sendModuleMaintenanceCommand = jest.fn(
    (moduleId: string, commandType: string, _requestedBy: unknown, _params: unknown, _expires: unknown, requestId?: string) => ({
      request_id: requestId ?? 'generated-request-id',
      command_type: commandType,
      module_id: moduleId,
      delivered: true,
      denied: false,
    }),
  );
  const mqtt = { sendModuleMaintenanceCommand, ...over.mqtt } as any;
  const games = { isPanelOccupied: jest.fn().mockResolvedValue(false), ...over.games } as any;
  return {
    service: new ModuleDiagnosticsService(prisma, mqtt, games),
    prisma,
    sendModuleMaintenanceCommand,
    isPanelOccupied: games.isPanelOccupied,
  };
}

describe('Diagnóstico de módulo (F6/v1.1) · quién puede', () => {
  it('el dueño puede diagnosticar lo suyo', async () => {
    const { service, sendModuleMaintenanceCommand } = build();
    await service.identify('mod-a', 4000, OWNER);
    expect(sendModuleMaintenanceCommand).toHaveBeenCalled();
  });

  it('el admin puede con cualquier módulo', async () => {
    const { service, sendModuleMaintenanceCommand } = build();
    await service.identify('mod-a', 4000, ADMIN);
    expect(sendModuleMaintenanceCommand).toHaveBeenCalled();
  });

  it('un gestor ajeno NO enciende los LED de un módulo que no es suyo', async () => {
    const { service, sendModuleMaintenanceCommand } = build();
    // 404 y no 403: a quien no le corresponde, el módulo ni siquiera existe.
    await expect(service.testLed('mod-a', 3, OTHER)).rejects.toBeInstanceOf(NotFoundException);
    expect(sendModuleMaintenanceCommand).not.toHaveBeenCalled();
  });

  it('un módulo sin dueño lo puede diagnosticar cualquier gestor', async () => {
    const { service, sendModuleMaintenanceCommand } = build({
      module: { findUnique: jest.fn().mockResolvedValue({ ...MODULE, ownerId: null }) },
    });
    await service.identify('mod-a', 4000, OTHER);
    expect(sendModuleMaintenanceCommand).toHaveBeenCalled();
  });

  it('un módulo inexistente da 404', async () => {
    const { service } = build({ module: { findUnique: jest.fn().mockResolvedValue(null) } });
    await expect(service.identify('mod-x', 4000, ADMIN)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('acepta tanto el identificador como el slug', async () => {
    const { service, prisma } = build();
    await service.identify('11111111-2222-3333-4444-555555555555', 4000, ADMIN);
    expect(prisma.module.findUnique.mock.calls[0][0].where).toHaveProperty('id');
    await service.identify('mod-a', 4000, ADMIN);
    expect(prisma.module.findUnique.mock.calls[1][0].where).toHaveProperty('slug');
  });
});

describe('Diagnóstico · publica en el canal de MANTENIMIENTO, jamás en el de juego', () => {
  it('identify se manda por sendModuleMaintenanceCommand, con command_type y requested_by', async () => {
    const { service, sendModuleMaintenanceCommand } = build();
    await service.identify('mod-a', 4000, ADMIN);
    expect(sendModuleMaintenanceCommand).toHaveBeenCalledWith(
      'mod-a',
      'identify',
      { actor_type: 'operator', actor_id: 'u-admin' },
      { duration_ms: 4000 },
      undefined,
      undefined,
    );
  });

  it('un gestor (no admin) queda registrado como actor_type "user"', async () => {
    const { service, sendModuleMaintenanceCommand } = build();
    await service.identify('mod-a', 4000, OWNER);
    expect(sendModuleMaintenanceCommand.mock.calls[0][2]).toEqual({
      actor_type: 'user',
      actor_id: 'u-gestor',
    });
  });

  it('la prueba de LED manda duration_ms y target_index (v1.1 no admite `state`)', async () => {
    const { service, sendModuleMaintenanceCommand } = build();
    await service.testLed('mod-a', 3, ADMIN, 5000);
    expect(sendModuleMaintenanceCommand).toHaveBeenCalledWith(
      'mod-a',
      'led_test',
      { actor_type: 'operator', actor_id: 'u-admin' },
      { duration_ms: 5000, target_index: 3 },
      undefined,
      undefined,
    );
  });

  it('una duración inválida se rechaza antes de publicar', async () => {
    const { service, sendModuleMaintenanceCommand } = build();
    await expect(service.testLed('mod-a', 3, ADMIN, -1)).rejects.toBeInstanceOf(BadRequestException);
    expect(sendModuleMaintenanceCommand).not.toHaveBeenCalled();
  });

  it('una diana fuera de rango se rechaza', async () => {
    const { service } = build();
    await expect(service.testLed('mod-a', 10, ADMIN)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('una diana que el módulo no tiene da 404', async () => {
    const { service } = build({ target: { findFirst: jest.fn().mockResolvedValue(null) } });
    await expect(service.testLed('mod-a', 5, ADMIN)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('la calibración se pide con target_index informativo, scope módulo', async () => {
    const { service, sendModuleMaintenanceCommand } = build();
    const res = await service.calibrate('mod-a', 3, ADMIN);
    expect(sendModuleMaintenanceCommand).toHaveBeenCalledWith(
      'mod-a',
      'start_calibration',
      { actor_type: 'operator', actor_id: 'u-admin' },
      { target_index: 3 },
      undefined,
      undefined,
    );
    expect(res.scope).toBe('module');
    expect(res.note).toMatch(/calibra el MÓDULO completo/);
  });

  it('una diana deshabilitada no se calibra', async () => {
    const { service } = build({
      target: { findFirst: jest.fn().mockResolvedValue({ id: 't', targetIndex: 3, enabled: false }) },
    });
    await expect(service.calibrate('mod-a', 3, ADMIN)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('la prueba de sensor pide self_test y DICE que es del módulo entero', async () => {
    const { service, sendModuleMaintenanceCommand } = build();
    const res = await service.testSensor('mod-a', 3, ADMIN);
    expect(sendModuleMaintenanceCommand).toHaveBeenCalledWith(
      'mod-a',
      'self_test',
      { actor_type: 'operator', actor_id: 'u-admin' },
      { target_index: 3 },
      undefined,
      undefined,
    );
    expect(res.scope).toBe('module');
    expect(res.note).toMatch(/no tiene una prueba de sensor por diana/);
  });

  it('abortCalibration YA publica: abort_calibration es command_type legal (categoría "seguridad")', async () => {
    const { service, sendModuleMaintenanceCommand } = build();
    const res = await service.abortCalibration('mod-a', ADMIN);
    expect(sendModuleMaintenanceCommand).toHaveBeenCalledWith(
      'mod-a',
      'abort_calibration',
      { actor_type: 'operator', actor_id: 'u-admin' },
      undefined,
      undefined,
      undefined,
    );
    expect(res.delivered).toBe(true);
  });

  /**
   * La prueba que fija la decisión del operador: NINGÚN método de este
   * servicio construye jamás el tópico de juego. Se recorren TODAS las
   * llamadas hechas al mock de `sendModuleMaintenanceCommand` (que es el
   * único canal MQTT que el servicio conoce: no tiene inyectado nada que
   * pueda escribir en `module/{id}/command`) y, adicionalmente, se
   * comprueba que el propio tópico de juego jamás aparece en ningún String
   * pasado al mock.
   */
  it('ninguna orden de F6 lleva jamás el tópico de juego module/{id}/command', async () => {
    const { service, sendModuleMaintenanceCommand } = build();
    await service.identify('mod-a', 4000, ADMIN);
    await service.testLed('mod-a', 3, ADMIN);
    await service.testSensor('mod-a', 3, ADMIN);
    await service.calibrate('mod-a', 3, ADMIN);
    const juegoTopic = topics.moduleCommand('mod-a');
    for (const call of sendModuleMaintenanceCommand.mock.calls) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain(juegoTopic);
    }
  });
});

describe('Diagnóstico · guardarraíl DOBLE de game_in_progress (backend, no sólo firmware)', () => {
  it('con partida activa sobre el panel, led_test se bloquea SIN publicar', async () => {
    const { service, sendModuleMaintenanceCommand, isPanelOccupied } = build({
      games: { isPanelOccupied: jest.fn().mockResolvedValue(true) },
    });
    await expect(service.testLed('mod-a', 3, ADMIN)).rejects.toBeInstanceOf(ConflictException);
    expect(sendModuleMaintenanceCommand).not.toHaveBeenCalled();
    expect(isPanelOccupied).toHaveBeenCalledWith('panel-1');
  });

  it('con partida activa, self_test (test-sensor) también se bloquea', async () => {
    const { service, sendModuleMaintenanceCommand } = build({
      games: { isPanelOccupied: jest.fn().mockResolvedValue(true) },
    });
    await expect(service.testSensor('mod-a', 3, ADMIN)).rejects.toBeInstanceOf(ConflictException);
    expect(sendModuleMaintenanceCommand).not.toHaveBeenCalled();
  });

  it('con partida activa, start_calibration también se bloquea', async () => {
    const { service, sendModuleMaintenanceCommand } = build({
      games: { isPanelOccupied: jest.fn().mockResolvedValue(true) },
    });
    await expect(service.calibrate('mod-a', 3, ADMIN)).rejects.toBeInstanceOf(ConflictException);
    expect(sendModuleMaintenanceCommand).not.toHaveBeenCalled();
  });

  it('con partida activa, identify SIGUE PERMITIDO (categoría "leer")', async () => {
    const { service, sendModuleMaintenanceCommand } = build({
      games: { isPanelOccupied: jest.fn().mockResolvedValue(true) },
    });
    await service.identify('mod-a', 4000, ADMIN);
    expect(sendModuleMaintenanceCommand).toHaveBeenCalled();
  });

  it('sin partida activa, no se bloquea nada', async () => {
    const { service, sendModuleMaintenanceCommand } = build({
      games: { isPanelOccupied: jest.fn().mockResolvedValue(false) },
    });
    await service.testLed('mod-a', 3, ADMIN);
    expect(sendModuleMaintenanceCommand).toHaveBeenCalled();
  });

  /**
   * `abort_calibration` es categoría "seguridad", NO "actuar": el contrato
   * exige que se acepte SIEMPRE, incluso con partida activa — es la orden que
   * para lo que otra arrancó.
   *
   * ALCANCE EXACTO de esta prueba, que antes se sobrevendía. Ésta sola NO
   * muere por añadir `abort_calibration` a `ACTING_COMMAND_TYPES`: hoy
   * `abortCalibration()` no llama a `assertPanelFreeToAct`, así que ampliar el
   * `Set` no cambia nada por sí solo — hacen falta las DOS cosas (ampliar el
   * `Set` Y cablear la comprobación) para romperla. Lo que mata al mutante
   * COMPLETO —el escenario que de verdad importa, porque es el que bloquearía
   * el abort— es esta prueba; y la pieza que falta, que el `Set` no crezca,
   * la fija por separado la prueba de composición de `ACTING_COMMAND_TYPES`
   * de más abajo. Juntas cubren el error; ninguna de las dos lo cubre sola, y
   * así se dice.
   */
  it('abortCalibration NO se bloquea con partida activa (categoría "seguridad", no "actuar")', async () => {
    const { service, sendModuleMaintenanceCommand, isPanelOccupied } = build({
      games: { isPanelOccupied: jest.fn().mockResolvedValue(true) },
    });
    const res = await service.abortCalibration('mod-a', ADMIN);
    expect(sendModuleMaintenanceCommand).toHaveBeenCalled();
    expect(res.delivered).toBe(true);
    // Y, más fuerte: ni siquiera CONSULTA la ocupación del panel. Abortar no
    // condiciona su aceptación a nada del backend, ni a costa de una consulta
    // extra que retrasara la orden de parada.
    expect(isPanelOccupied).not.toHaveBeenCalled();
  });

  /**
   * La pieza que le faltaba a la prueba de arriba para que su promesa fuera
   * cierta: se fija la COMPOSICIÓN EXACTA del conjunto de órdenes que
   * "actúan". Meter `abort_calibration` ahí —el error concreto que el operador
   * pidió evitar, por parecido con `start_calibration`— mata esta prueba de
   * inmediato, sin necesidad de cablear nada más. Es una lista cerrada a
   * propósito: quitar `led_test` o `self_test` también la mata, porque
   * dejaría de bloquearse una actuación física durante la partida.
   */
  it('ACTING_COMMAND_TYPES tiene exactamente las órdenes que ACTÚAN, y abort_calibration NO está', () => {
    expect([...ACTING_COMMAND_TYPES].sort()).toEqual([
      'led_test',
      'piezo_test',
      'self_test',
      'start_calibration',
    ]);
    expect(ACTING_COMMAND_TYPES.has('abort_calibration' as never)).toBe(false);
  });

  it('un módulo sin panel asignado no puede comprobarse y no bloquea (nada que ocupar)', async () => {
    const { service, sendModuleMaintenanceCommand, isPanelOccupied } = build({
      module: { findUnique: jest.fn().mockResolvedValue({ ...MODULE, targetSystemId: null }) },
    });
    await service.testLed('mod-a', 3, ADMIN);
    expect(isPanelOccupied).not.toHaveBeenCalled();
    expect(sendModuleMaintenanceCommand).toHaveBeenCalled();
  });
});

describe('Diagnóstico · idempotencia por request_id', () => {
  it('un request_id repetido NO vuelve a publicar: se sirve el resultado ya despachado', async () => {
    const { service, sendModuleMaintenanceCommand } = build();
    const requestId = '11111111-1111-1111-1111-111111111111';
    const first = await service.testLed('mod-a', 3, ADMIN, 4000, requestId);
    const second = await service.testLed('mod-a', 3, ADMIN, 4000, requestId);
    expect(sendModuleMaintenanceCommand).toHaveBeenCalledTimes(1);
    expect(first.duplicate).toBe(false);
    expect(second).toMatchObject({ duplicate: true, request_id: requestId });
  });

  it('sin request_id del llamador, cada llamada publica (no hay nada que deduplicar)', async () => {
    const { service, sendModuleMaintenanceCommand } = build();
    await service.testLed('mod-a', 3, ADMIN);
    await service.testLed('mod-a', 3, ADMIN);
    expect(sendModuleMaintenanceCommand).toHaveBeenCalledTimes(2);
  });

  it('dos request_id distintos SÍ publican dos veces', async () => {
    const { service, sendModuleMaintenanceCommand } = build();
    await service.testLed('mod-a', 3, ADMIN, 4000, '11111111-1111-1111-1111-111111111111');
    await service.testLed('mod-a', 3, ADMIN, 4000, '22222222-2222-2222-2222-222222222222');
    expect(sendModuleMaintenanceCommand).toHaveBeenCalledTimes(2);
  });
});

/**
 * CONCURRENCIA, que es el caso que la idempotencia decía cubrir y no cubría.
 *
 * Las pruebas de arriba son SECUENCIALES: la primera llamada termina del todo
 * antes de que empiece la segunda, así que pasaban con la implementación
 * defectuosa (consultar → `await` de la publicación → escribir) y no vieron
 * nada. Un doble clic real, en cambio, son dos peticiones casi simultáneas:
 * las dos consultaban la caché antes de que ninguna hubiera escrito y las dos
 * publicaban de verdad — doble actuación FÍSICA sobre el hardware en
 * `led_test`, `self_test` y `start_calibration`.
 *
 * Para reproducirlo hace falta que la publicación NO se resuelva sola: el
 * mock queda colgado de un `Deferred` que sólo resuelve la prueba, de modo
 * que la segunda llamada entra mientras la primera sigue en vuelo. Ése es el
 * solapamiento real; con el mock síncrono de `build()` no se produce.
 */
function deferredPublisher() {
  const resolvers: Array<(v: unknown) => void> = [];
  const publisher = jest.fn(
    (
      moduleId: string,
      commandType: string,
      _requestedBy: unknown,
      _params: unknown,
      _expires: unknown,
      requestId?: string,
    ) =>
      new Promise((resolve) => {
        resolvers.push(() =>
          resolve({
            request_id: requestId ?? 'generated-request-id',
            command_type: commandType,
            module_id: moduleId,
            delivered: true,
            denied: false,
          }),
        );
      }),
  );
  return { publisher, liberar: () => resolvers.forEach((r) => r(undefined)) };
}

describe('Diagnóstico · idempotencia bajo CONCURRENCIA (doble clic real)', () => {
  const REQ = '33333333-3333-3333-3333-333333333333';

  it('dos led_test simultáneos con el mismo request_id publican UNA sola vez', async () => {
    const { publisher, liberar } = deferredPublisher();
    const { service } = build({ mqtt: { sendModuleMaintenanceCommand: publisher } });

    // Se lanzan SIN await: las dos quedan en vuelo a la vez.
    const a = service.testLed('mod-a', 3, ADMIN, 4000, REQ);
    const b = service.testLed('mod-a', 3, ADMIN, 4000, REQ);
    // Se deja avanzar la cola de microtareas para que ambas atraviesen sus
    // `await` previos (resolve/resolveTarget/isPanelOccupied) y lleguen al
    // despacho. Sin esto, la segunda ni siquiera habría llegado a mirar.
    await new Promise((r) => setImmediate(r));
    liberar();
    const [primera, segunda] = await Promise.all([a, b]);

    expect(publisher).toHaveBeenCalledTimes(1);
    expect(primera.duplicate).toBe(false);
    expect(segunda).toMatchObject({ duplicate: true, request_id: REQ });
  });

  it('cinco start_calibration simultáneos con el mismo request_id: una sola actuación física', async () => {
    const { publisher, liberar } = deferredPublisher();
    const { service } = build({ mqtt: { sendModuleMaintenanceCommand: publisher } });

    const enVuelo = Array.from({ length: 5 }, () => service.calibrate('mod-a', 3, ADMIN, REQ));
    await new Promise((r) => setImmediate(r));
    liberar();
    const resultados = await Promise.all(enVuelo);

    expect(publisher).toHaveBeenCalledTimes(1);
    expect(resultados.filter((r) => r.duplicate === false)).toHaveLength(1);
    expect(resultados.filter((r) => r.duplicate === true)).toHaveLength(4);
  });

  it('también en abort_calibration, que no pasa por dispatch()', async () => {
    const { publisher, liberar } = deferredPublisher();
    const { service } = build({ mqtt: { sendModuleMaintenanceCommand: publisher } });

    const a = service.abortCalibration('mod-a', ADMIN, REQ);
    const b = service.abortCalibration('mod-a', ADMIN, REQ);
    await new Promise((r) => setImmediate(r));
    liberar();
    await Promise.all([a, b]);

    expect(publisher).toHaveBeenCalledTimes(1);
  });

  it('request_id DISTINTOS en paralelo sí publican los dos (no se deduplica de más)', async () => {
    // Control negativo: si la reserva estuviera puesta con una clave global o
    // el `Map` se hubiera degradado a "una orden en vuelo a la vez", esta
    // prueba lo delataría.
    const { publisher, liberar } = deferredPublisher();
    const { service } = build({ mqtt: { sendModuleMaintenanceCommand: publisher } });

    const a = service.testLed('mod-a', 3, ADMIN, 4000, REQ);
    const b = service.testLed('mod-a', 3, ADMIN, 4000, '44444444-4444-4444-4444-444444444444');
    await new Promise((r) => setImmediate(r));
    liberar();
    await Promise.all([a, b]);

    expect(publisher).toHaveBeenCalledTimes(2);
  });

  it('si el despacho FALLA, la reserva se libera y un reintento puede publicar', async () => {
    // El otro lado de la moneda: reservar antes de publicar no puede dejar el
    // `request_id` quemado cuando la publicación revienta.
    const sendModuleMaintenanceCommand = jest
      .fn()
      .mockRejectedValueOnce(new Error('broker caído'))
      .mockResolvedValue({ request_id: REQ, delivered: true, denied: false });
    const { service } = build({ mqtt: { sendModuleMaintenanceCommand } });

    await expect(service.testLed('mod-a', 3, ADMIN, 4000, REQ)).rejects.toThrow('broker caído');
    const reintento = await service.testLed('mod-a', 3, ADMIN, 4000, REQ);

    expect(sendModuleMaintenanceCommand).toHaveBeenCalledTimes(2);
    expect(reintento.duplicate).toBe(false);
  });
});

describe('Diagnóstico · ordenar no es saber el resultado', () => {
  it('la respuesta dice que el resultado llega por otro sitio', async () => {
    const { service } = build();
    const res = await service.identify('mod-a', 4000, ADMIN);
    expect(res.delivered).toBe(true);
    expect(res.note).toMatch(/El resultado lo publica el módulo/);
    // Y NO se devuelve ninguna medida: nadie la ha tomado.
    expect(res).not.toHaveProperty('amplitude');
    expect(res).not.toHaveProperty('ok');
  });

  it('si el broker no acepta la orden se dice, no se da por hecha', async () => {
    const { service } = build({
      mqtt: {
        sendModuleMaintenanceCommand: jest.fn(() => ({
          request_id: 'r1',
          delivered: false,
          denied: false,
        })),
      },
    });
    const res = await service.testLed('mod-a', 3, ADMIN);
    expect(res.delivered).toBe(false);
    expect(res.denied).toBe(false);
    expect(res.note).toMatch(/NO llegó al broker/);
  });

  /**
   * Éste es EXACTAMENTE el defecto de producción del encargo: F6 publicaba en
   * `targets/v1/module/{id}/command`, la ACL real del backend no le concedía
   * ese permiso, y antes de este cambio la API respondía `delivered: true`.
   * Ahora `denied: true` lo dice, y la nota no sugiere que la orden se entregó.
   */
  it('si el broker DENIEGA la orden por ACL, la respuesta lo dice explícitamente', async () => {
    const { service } = build({
      mqtt: {
        sendModuleMaintenanceCommand: jest.fn(() => ({
          request_id: 'r1',
          delivered: false,
          denied: true,
        })),
      },
    });
    const res = await service.identify('mod-a', 4000, ADMIN);
    expect(res.delivered).toBe(false);
    expect(res.denied).toBe(true);
    expect(res.note).toMatch(/DENEGÓ/);
  });

  it('los resultados reales se leen de las incidencias del módulo', async () => {
    const { service, prisma } = build();
    await service.results('mod-a', ADMIN, 5);
    expect(prisma.incident.findMany.mock.calls[0][0]).toMatchObject({
      where: {
        source: 'diagnostic',
        OR: [{ moduleId: 'm1' }, { moduleSlug: 'mod-a' }],
      },
      take: 5,
    });
  });

  it('expone request_id para correlacionar orden y resultado', async () => {
    const { service } = build({
      incident: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'i1',
            kind: 'self_test_result',
            severity: 'info',
            message: 'Correcto',
            occurredAt: new Date('2026-08-05T10:00:00Z'),
            deviceOccurredAt: null,
            deviceEventUs: 1n,
            deviceEpochMs: null,
            requestId: '11111111-1111-1111-1111-111111111111',
          },
        ]),
      },
    });
    const result = await service.results('mod-a', ADMIN);
    expect(result.items[0].requestId).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('un diagnóstico espontáneo (sin request_id) expone null, no undefined ni error', async () => {
    const { service } = build({
      incident: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'i2',
            kind: 'boot',
            severity: 'info',
            message: 'Arranque',
            occurredAt: new Date('2026-08-05T10:00:00Z'),
            deviceOccurredAt: null,
            deviceEventUs: 1n,
            deviceEpochMs: null,
            requestId: null,
          },
        ]),
      },
    });
    const result = await service.results('mod-a', ADMIN);
    expect(result.items[0].requestId).toBeNull();
  });

  it('expone la hora del módulo y distingue la recepción cuando no había reloj', async () => {
    const receivedAt = new Date('2026-08-04T10:00:03Z');
    const deviceOccurredAt = new Date('2026-08-04T10:00:00Z');
    const { service } = build({
      incident: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'i-con-reloj',
            kind: 'calibration_result',
            severity: 'info',
            message: 'Calibrado',
            occurredAt: receivedAt,
            deviceOccurredAt,
            deviceEventUs: 4_000_000n,
            deviceEpochMs: BigInt(deviceOccurredAt.getTime()),
          },
          {
            id: 'i-sin-reloj',
            kind: 'self_test_result',
            severity: 'info',
            message: 'Correcto',
            occurredAt: receivedAt,
            deviceOccurredAt: null,
            deviceEventUs: 5_000_000n,
            deviceEpochMs: null,
          },
        ]),
      },
    });

    const result = await service.results('mod-a', ADMIN);
    expect(result.items[0]).toMatchObject({
      occurredAt: deviceOccurredAt,
      receivedAt,
      timeBasis: 'module_epoch',
      deviceEventUs: '4000000',
    });
    expect(result.items[1]).toMatchObject({
      occurredAt: null,
      receivedAt,
      timeBasis: 'ingest_received',
      deviceEventUs: '5000000',
    });
  });

  it('el admin consulta por slug diagnósticos recibidos antes del alta del módulo', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'i-huerfana',
        kind: 'self_test_result',
        severity: 'warning',
        message: 'Publicado antes del alta',
        occurredAt: new Date('2026-08-04T10:00:03Z'),
        deviceOccurredAt: null,
        deviceEventUs: 1_000n,
        deviceEpochMs: null,
      },
    ]);
    const { service } = build({
      module: { findUnique: jest.fn().mockResolvedValue(null) },
      incident: { findMany },
    });

    const result = await service.results('module-sin-alta', ADMIN);

    expect(findMany.mock.calls[0][0].where).toEqual({
      source: 'diagnostic',
      moduleSlug: 'module-sin-alta',
    });
    expect(result.moduleRegistered).toBe(false);
    expect(result.items).toHaveLength(1);
    expect(result.note).toMatch(/no está registrado.*diagnósticos conservados/i);
  });

  it('sin respuestas del módulo se dice que no hay, no se finge silencio normal', async () => {
    const { service } = build();
    expect((await service.results('mod-a', ADMIN)).note).toMatch(/no ha respondido/);
  });

  it('el número de resultados se acota', async () => {
    const { service, prisma } = build();
    await service.results('mod-a', ADMIN, 5000);
    expect(prisma.incident.findMany.mock.calls[0][0].take).toBe(100);
  });
});

describe('Los comandos de mantenimiento emitidos CUMPLEN el contrato v1.1', () => {
  const validator = new ContractValidator();
  const builder = new CommandBuilder();

  const valida = (commandType: string, params?: Record<string, unknown>) => {
    const command = builder.maintenanceCommand(
      'mod-a',
      commandType as never,
      { actor_type: 'operator', actor_id: 'u-admin' },
      params,
    );
    return validator.validate('module-maintenance-command.schema.json', command as never);
  };

  it('identify con duration_ms', () => expect(valida('identify', { duration_ms: 4000 }).ok).toBe(true));
  it('self_test sin params', () => expect(valida('self_test').ok).toBe(true));
  it('start_calibration con target_index informativo', () =>
    expect(valida('start_calibration', { target_index: 3 }).ok).toBe(true));

  it('led_test con duration_ms y target_index', () => {
    const r = valida('led_test', { duration_ms: 3000, target_index: 3 });
    expect(r.ok).toBe(true);
  });

  it('led_test SIN duration_ms no valida (el esquema lo exige)', () => {
    const r = valida('led_test', { target_index: 3 });
    expect(r.ok).toBe(false);
  });

  it('la forma INVENTADA del contrato de juego (`targets`/`state`) NO valida aquí', () => {
    const r = valida('led_test', { targets: [{ target_index: 3, state: 'active' }] });
    expect(r.ok).toBe(false);
  });

  it('identify SIN duration_ms no valida', () => {
    expect(valida('identify').ok).toBe(false);
  });
});

describe('El backend NUNCA construye una publicación con el tópico de juego para F6', () => {
  /**
   * Mutante de control: si alguien reintrodujera
   * `topics.moduleCommand(moduleId)` dentro de `dispatch`/`sendModule*`
   * de este servicio, esta prueba de topología lo detecta comparando los
   * dos tópicos —no dependen el uno del otro por accidente de string—.
   */
  it('moduleMaintenanceCommand() y moduleCommand() son tópicos DISTINTOS', () => {
    expect(topics.moduleMaintenanceCommand('mod-a')).not.toBe(topics.moduleCommand('mod-a'));
    expect(topics.moduleMaintenanceCommand('mod-a')).toBe(
      'targets/v1/module/mod-a/maintenance/command',
    );
    expect(topics.moduleCommand('mod-a')).toBe('targets/v1/module/mod-a/command');
  });
});
