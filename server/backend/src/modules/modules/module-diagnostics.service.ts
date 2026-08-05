import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ROLE } from '../../domain/rbac/permissions';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MqttService } from '../mqtt/mqtt.service';
import { GamesService } from '../games/games.service';
import { MaintenanceCommandType, MaintenanceRequestedBy } from '../../contracts/command-builder';

/**
 * Estados de diana que admite el contrato (`common.schema.json#targetState`).
 *
 * Se conserva aquí porque otras capas del panel siguen usándolo para pintar
 * estados posibles de una diana; el propio F6 ya NO lo necesita para
 * `led_test` desde la ampliación v1.1 (ver comentario de `testLed`).
 */
export const TARGET_STATES = [
  'off',
  'safe',
  'active',
  'hit',
  'countdown',
  'penalty',
  'error',
  'calibration',
  'locked',
  'sensor_error',
  'maintenance',
  'disabled',
] as const;
export type TargetStateName = (typeof TARGET_STATES)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DiagnosticsActor {
  userId?: string;
  role?: string;
}

/**
 * Comandos de mantenimiento que ACTÚAN sobre el hardware (mueven un LED, el
 * piezo, disparan un autodiagnóstico o una calibración). El contrato v1.1
 * (README §6-bis) y la orden expresa del operador coinciden en un mismo
 * corte: éstos, y sólo éstos, se bloquean si hay una partida activa sobre el
 * panel del módulo. `identify`, `request_telemetry`, `query_version` y
 * `query_status` son "leer" y se permiten siempre.
 *
 * `abort_calibration` NO está aquí: el contrato lo puso en una TERCERA
 * categoría, "seguridad" (`module-maintenance-command.schema.json`,
 * descripción de `command_type`), con una regla propia y deliberadamente
 * distinta de "actuar": se acepta SIEMPRE, incluso con partida activa y
 * aunque haya vencido su caducidad — es la orden que PARA lo que otra
 * arrancó, y un «para» tardío sigue queriendo decir «para». Meterlo en este
 * `Set` por parecido con `start_calibration` sería exactamente el error que
 * el operador señaló: bloquearía abortar justo cuando más urge poder
 * hacerlo. Ver `abortCalibration()`.
 */
export const ACTING_COMMAND_TYPES: ReadonlySet<MaintenanceCommandType> = new Set([
  'led_test',
  'piezo_test',
  'self_test',
  'start_calibration',
]);

const DEFAULT_LED_TEST_DURATION_MS = 3000;

/** Resultado de una orden despachada. `duplicate` distingue al primero de los repetidos. */
interface DispatchOutcome {
  module_id: string;
  command_type: MaintenanceCommandType;
  request_id: string;
  delivered: boolean;
  denied: boolean;
  note: string;
  duplicate: boolean;
}

/**
 * Diagnóstico de módulo y diana (F6), reescrito para la ampliación v1.1.
 *
 * Hasta esta reescritura, F6 publicaba en `targets/v1/module/{id}/command`
 * —el tópico de JUEGO, propiedad exclusiva del coordinador (dosier §8)— y la
 * ACL de producción lo denegaba en silencio: `delivered` mentía como "true"
 * porque sólo miraba si había socket, no si el broker aceptaba el tópico.
 *
 * DECISIÓN DEL OPERADOR (no se reabre aquí): la autoridad se separa por
 * DOMINIO, no por disponibilidad. El backend NUNCA publica en
 * `module/{id}/command` — ni con bandera, ni "sólo en desarrollo", ni de
 * ninguna otra forma. Todo lo que este servicio ordena sale por
 * `module/{id}/maintenance/command` (`MqttService.sendModuleMaintenanceCommand`),
 * el canal nuevo y exclusivo del backend.
 *
 * Segundo guardarraíl, DOBLE con el del firmware: el contrato dice que el
 * módulo rechaza con `game_in_progress` un comando que ACTÚA mientras hay
 * partida, pero ese código vive en firmware ESP-IDF que nunca se ha
 * compilado. Este servicio comprueba lo mismo ANTES de publicar
 * (`GamesService.isPanelOccupied`), así que el bloqueo es real hoy, no
 * dentro de meses. Leer (`identify`) sigue permitido durante la partida.
 */
@Injectable()
export class ModuleDiagnosticsService {
  /**
   * IDEMPOTENCIA de `request_id` — dónde vive y por qué aquí.
   *
   * El contrato asigna la autoridad de idempotencia al MÓDULO: cachea las
   * últimas 128 órdenes de este canal y descarta duplicados con
   * `detail.reason="duplicate"`. Igual que con `game_in_progress`, ese código
   * vive en firmware que nunca se ha compilado, así que hoy NO hay ninguna
   * defensa real contra un duplicado si sólo se confía en el módulo.
   *
   * Esta caché, en el PROCESO del backend, es un cortafuegos de emergencia —
   * NO la implementación definitiva de la idempotencia del contrato, que
   * seguirá siendo responsabilidad del módulo el día que exista firmware
   * real.
   *
   * RESERVA ANTES DE PUBLICAR, no memoria después. Guarda la PROMESA del
   * despacho, no su resultado, y la inscribe en el mismo turno síncrono en
   * que arranca —antes de ceder el control en el `await` de la publicación—.
   * Esto importa porque la versión anterior consultaba, luego hacía `await`
   * de la publicación y sólo después escribía: dos peticiones concurrentes
   * con el mismo `request_id` pasaban las dos por la consulta antes de que
   * ninguna hubiera escrito, y las DOS publicaban de verdad. Y un doble clic
   * real es exactamente eso, dos peticiones casi simultáneas — es decir, el
   * caso que el cortafuegos decía cubrir era justo el que no cubría. Para
   * `led_test`, `self_test` y `start_calibration` eso significaba doble
   * actuación física sobre el hardware.
   *
   * El duplicado no recibe un error: espera a la misma promesa y recibe el
   * mismo resultado con `duplicate: true`. Si el despacho FALLA, la reserva
   * se retira, para que un reintento honesto tras un fallo pueda publicar.
   *
   * Tamaño acotado a 128 entradas (el mismo límite que el contrato exige al
   * módulo, para que el comportamiento observable no sorprenda) y política
   * FIFO.
   *
   * Límite HONESTO, y es el que de verdad acota la garantía: vive en la
   * memoria de ESTE proceso. Cubre la concurrencia DENTRO de una instancia —
   * que es donde ocurre el doble clic—, pero no sobrevive a un reinicio ni se
   * comparte entre instancias: dos réplicas del backend recibiendo el mismo
   * `request_id` publicarían una cada una. Para eso haría falta una tabla o
   * una caché distribuida, que no se justifica mientras el backend corra en
   * una sola instancia (es el caso hoy). Tampoco es un cierre exacto de la
   * ventana física: la reserva se libera si el despacho falla, así que un
   * reintento inmediato tras un error de publicación puede llegar al módulo
   * si la primera publicación sí había salido pese al error.
   */
  private static readonly IDEMPOTENCY_CACHE_SIZE = 128;
  private readonly recentRequests = new Map<string, Promise<DispatchOutcome>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly mqtt: MqttService,
    private readonly games: GamesService,
  ) {}

  /** Comprueba que el módulo existe y que el actor puede tocarlo. */
  private async resolve(idOrSlug: string, actor: DiagnosticsActor) {
    const module = UUID.test(idOrSlug)
      ? await this.prisma.module.findUnique({ where: { id: idOrSlug } })
      : await this.prisma.module.findUnique({ where: { slug: idOrSlug } });
    if (!module) throw new NotFoundException(`Módulo ${idOrSlug} no encontrado`);
    const isAdmin = actor.role === ROLE.ADMINISTRADOR;
    // Un gestor sólo diagnostica lo suyo. Encender los LED o disparar una
    // calibración en un módulo ajeno se nota en la sala de al lado.
    if (!isAdmin && module.ownerId && module.ownerId !== actor.userId) {
      throw new NotFoundException(`Módulo ${idOrSlug} no encontrado`);
    }
    return module;
  }

  private async resolveTarget(moduleId: string, targetIndex: number) {
    if (!Number.isInteger(targetIndex) || targetIndex < 1 || targetIndex > 9) {
      throw new BadRequestException('El índice de diana debe estar entre 1 y 9.');
    }
    const target = await this.prisma.target.findFirst({
      where: { moduleId, targetIndex },
      select: { id: true, targetIndex: true, enabled: true },
    });
    if (!target) throw new NotFoundException(`El módulo no tiene la diana ${targetIndex}`);
    return target;
  }

  private requestedBy(actor: DiagnosticsActor): MaintenanceRequestedBy {
    const isAdmin = actor.role === ROLE.ADMINISTRADOR;
    return {
      actor_type: isAdmin ? 'operator' : 'user',
      actor_id: actor.userId ?? 'desconocido',
    };
  }

  /**
   * Guardarraíl DOBLE de `game_in_progress` (ver cabecera de la clase).
   * Sólo se llama para comandos de categoría "actuar"; nunca para "leer".
   */
  private async assertPanelFreeToAct(
    module: { slug: string; targetSystemId: string | null },
    commandType: MaintenanceCommandType,
  ): Promise<void> {
    if (!ACTING_COMMAND_TYPES.has(commandType)) return;
    if (!module.targetSystemId) return; // Sin panel asignado, no hay partida que pueda ocuparlo.
    const occupied = await this.games.isPanelOccupied(module.targetSystemId);
    if (occupied) {
      throw new ConflictException(
        `No se puede ordenar «${commandType}» en «${module.slug}»: su panel tiene una partida ` +
          'activa (armed/running/paused). El contrato reserva la actuación sobre hardware al ' +
          'coordinador mientras dura la partida (motivo game_in_progress); léelo con las rutas de ' +
          'lectura o espera a que la partida termine.',
      );
    }
  }

  /** Ordena identificarse (parpadeo) para localizar el módulo físicamente. Categoría "leer". */
  async identify(
    idOrSlug: string,
    durationMs: number,
    actor: DiagnosticsActor,
    requestId?: string,
  ) {
    const module = await this.resolve(idOrSlug, actor);
    if (!Number.isInteger(durationMs) || durationMs < 500 || durationMs > 60_000) {
      throw new BadRequestException('La duración debe estar entre 500 y 60000 ms.');
    }
    return this.dispatch(module, 'identify', { duration_ms: durationMs }, actor, requestId);
  }

  /**
   * Prueba de LED de una diana. La ampliación v1.1 cambia la forma del
   * mensaje: `module-maintenance-command.schema.json` no tiene el campo
   * `state` que sí tenía `module-command` (targets/juego) — el LED de
   * mantenimiento se prueba con una duración (`duration_ms`), no con un
   * estado de partida. Pedir `state` aquí sería, otra vez, mandar un campo
   * que el validador de salida del esquema nuevo rechaza.
   */
  async testLed(
    idOrSlug: string,
    targetIndex: number,
    actor: DiagnosticsActor,
    durationMs = DEFAULT_LED_TEST_DURATION_MS,
    requestId?: string,
  ) {
    const module = await this.resolve(idOrSlug, actor);
    await this.resolveTarget(module.id, targetIndex);
    if (!Number.isInteger(durationMs) || durationMs < 0 || durationMs > 60_000) {
      throw new BadRequestException('La duración debe estar entre 0 y 60000 ms.');
    }
    await this.assertPanelFreeToAct(module, 'led_test');
    return this.dispatch(
      module,
      'led_test',
      { duration_ms: durationMs, target_index: targetIndex },
      actor,
      requestId,
    );
  }

  /**
   * Prueba de sensor. El contrato MQTT v1 **no tiene** una acción propia para
   * esto: la más cercana es `self_test`, que el módulo ejecuta sobre todas
   * sus dianas. No se inventa una acción que el firmware no entendería; se
   * pide el autodiagnóstico y se dice, en la respuesta, qué se ha pedido de
   * verdad.
   */
  async testSensor(
    idOrSlug: string,
    targetIndex: number,
    actor: DiagnosticsActor,
    requestId?: string,
  ) {
    const module = await this.resolve(idOrSlug, actor);
    const target = await this.resolveTarget(module.id, targetIndex);
    await this.assertPanelFreeToAct(module, 'self_test');
    const sent = await this.dispatch(
      module,
      'self_test',
      { target_index: targetIndex },
      actor,
      requestId,
    );
    return {
      ...sent,
      target_index: target.targetIndex,
      scope: 'module' as const,
      note:
        'El contrato v1 no tiene una prueba de sensor por diana: se ha pedido el ' +
        'autodiagnóstico del módulo completo. El resultado llega por `diagnostic`, no aquí.',
    };
  }

  /**
   * Arranca la calibración. Se comprueba que la diana exista y esté
   * habilitada —pedir calibrar por una diana apagada no tiene sentido— y la
   * respuesta declara el alcance real (módulo, no diana) en vez de sugerir
   * que se calibra sólo ésa.
   */
  async calibrate(
    idOrSlug: string,
    targetIndex: number,
    actor: DiagnosticsActor,
    requestId?: string,
  ) {
    const module = await this.resolve(idOrSlug, actor);
    const target = await this.resolveTarget(module.id, targetIndex);
    if (!target.enabled) {
      throw new BadRequestException(`La diana ${targetIndex} está deshabilitada: no se calibra.`);
    }
    await this.assertPanelFreeToAct(module, 'start_calibration');
    const sent = await this.dispatch(
      module,
      'start_calibration',
      { target_index: targetIndex },
      actor,
      requestId,
    );
    return {
      ...sent,
      target_index: target.targetIndex,
      scope: 'module' as const,
      note:
        'El contrato v1.1 calibra el MÓDULO completo, no una diana suelta. ' +
        'El resultado llega por `diagnostic`, no aquí.',
    };
  }

  /**
   * Abortar una calibración en curso NO tiene hueco en el repertorio cerrado
   * de `module-maintenance-command.schema.json` (`command_type` no incluye
   * `abort_calibration`: esa acción sigue siendo del canal de JUEGO,
   * `module/{id}/command`, que este servicio tiene terminantemente prohibido
   * escribir). No se inventa un `command_type` fuera del esquema —el
   * validador de salida lo rechazaría igualmente— ni se publica en el canal
   * del coordinador para colar la orden por otra puerta. Se dice la verdad:
   * hoy esta operación no tiene canal legal desde el backend.
   */
  /**
   * `abort_calibration` es ahora `command_type` legal en `maintenance/command`
   * (categoría "seguridad"): ampliación del contrato pedida a raíz de que
   * esta ruta se quedaba muerta ("no hay canal legal"). Regla explícita del
   * carril de contratos, no negociable aquí: se despacha DIRECTAMENTE por
   * `mqtt.sendModuleMaintenanceCommand`, sin pasar por `assertPanelFreeToAct`
   * — abortar se acepta SIEMPRE, incluso con partida activa, porque es la
   * orden que PARA lo que otra arrancó. NO se llama a `dispatch()` (que sólo
   * gestiona `command_type` de `ACTING_COMMAND_TYPES`): sería fácil, por
   * simetría con `calibrate()`, colar `abort_calibration` en ese `Set` algún
   * día y bloquearla igual que a `start_calibration`. Mantenerla en su propio
   * camino, sin la comprobación, hace ese error mucho más difícil de cometer
   * por accidente.
   */
  async abortCalibration(idOrSlug: string, actor: DiagnosticsActor, requestId?: string) {
    const module = await this.resolve(idOrSlug, actor);
    return this.idempotent(requestId, async () => {
      const command = (await this.mqtt.sendModuleMaintenanceCommand(
        module.slug,
        'abort_calibration',
        this.requestedBy(actor),
        undefined,
        undefined,
        requestId,
      )) as Record<string, unknown>;
      const delivered = command.delivered === true;
      const denied = command.denied === true;
      return {
        module_id: module.slug,
        command_type: 'abort_calibration' as const,
        request_id: command.request_id as string,
        delivered,
        denied,
        duplicate: false as boolean,
        note: denied
          ? 'ATENCIÓN: el broker DENEGÓ la orden (ACL). El módulo NO la ha recibido; hay incidencia registrada.'
          : delivered
            ? 'Orden de PARADA entregada al broker. Se acepta siempre (categoría seguridad): sin reloj y aunque haya caducado.'
            : 'ATENCIÓN: la orden NO llegó al broker (sin conexión). Queda encolada.',
      };
    });
  }

  /**
   * Últimos resultados que el módulo ha devuelto de verdad. Es lo único que
   * permite saber cómo fue una prueba: la llamada que la ordena no lo sabe.
   */
  async results(idOrSlug: string, actor: DiagnosticsActor, take = 20) {
    let module: { id: string; slug: string } | null;
    try {
      module = await this.resolve(idOrSlug, actor);
    } catch (error) {
      // Un administrador puede consultar por slug los diagnósticos de un
      // dispositivo que publica antes de estar dado de alta. Para gestores no
      // se abre este atajo: sin módulo registrado no se puede probar propiedad.
      if (
        actor.role === ROLE.ADMINISTRADOR &&
        !UUID.test(idOrSlug) &&
        error instanceof NotFoundException
      ) {
        module = null;
      } else {
        throw error;
      }
    }
    const items = await this.prisma.incident.findMany({
      // `moduleSlug` rescata diagnósticos recibidos antes de que el módulo se
      // registrara en la base; una vez conocido, aparecen en su historial.
      where: module
        ? {
            source: 'diagnostic',
            OR: [{ moduleId: module.id }, { moduleSlug: module.slug }],
          }
        : { source: 'diagnostic', moduleSlug: idOrSlug },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: Math.min(Math.max(take, 1), 100),
    });
    return {
      module: module?.slug ?? idOrSlug,
      moduleRegistered: module !== null,
      items: items.map((item) => ({
        ...item,
        // `occurredAt` significa aquí hora del SUCESO según el módulo. Si no
        // tenía reloj (`epoch_ms=null`) queda a null: no se suplanta con T3.
        occurredAt: item.deviceOccurredAt,
        receivedAt: item.occurredAt,
        timeBasis: item.deviceOccurredAt ? ('module_epoch' as const) : ('ingest_received' as const),
        // Ampliación v1.1: `requestId` correlaciona este diagnóstico con la
        // orden de mantenimiento que lo originó (`null` en espontáneos).
        requestId: item.requestId ?? null,
        deviceEventUs: item.deviceEventUs?.toString() ?? null,
        deviceEpochMs: item.deviceEpochMs?.toString() ?? null,
      })),
      note:
        module === null
          ? `El módulo «${idOrSlug}» no está registrado. Se muestran los diagnósticos ` +
            'conservados bajo su identificador MQTT.'
          : items.length === 0
          ? 'Sin resultados: el módulo no ha respondido a ninguna prueba todavía.'
          : null,
    };
  }

  /**
   * Emite el comando de MANTENIMIENTO e informa de si el broker lo aceptó.
   * Publica EXCLUSIVAMENTE en `module/{id}/maintenance/command`
   * (`MqttService.sendModuleMaintenanceCommand`) — nunca en
   * `module/{id}/command`. `delivered: false` significa que la orden se ha
   * encolado y el módulo NO la ha recibido.
   *
   * Idempotencia: la reserva del `requestId` la hace `idempotent()` ANTES de
   * publicar, no después. Ver el comentario de `recentRequests`.
   */
  private dispatch(
    module: { slug: string },
    commandType: MaintenanceCommandType,
    params: Record<string, unknown> | undefined,
    actor: DiagnosticsActor,
    requestId?: string,
  ) {
    return this.idempotent(requestId, async () => {
      const command = (await this.mqtt.sendModuleMaintenanceCommand(
        module.slug,
        commandType,
        this.requestedBy(actor),
        params,
        undefined,
        requestId,
      )) as Record<string, unknown>;
      const delivered = command.delivered === true;
      const denied = command.denied === true;
      return {
        module_id: module.slug,
        command_type: commandType,
        request_id: command.request_id as string,
        delivered,
        denied,
        duplicate: false as boolean,
        note: denied
          ? 'ATENCIÓN: el broker DENEGÓ la orden (ACL). El módulo NO la ha recibido; hay incidencia registrada.'
          : delivered
            ? 'Orden entregada al broker. El resultado lo publica el módulo en `diagnostic`, correlado por request_id.'
            : 'ATENCIÓN: la orden NO llegó al broker (sin conexión). Queda encolada.',
      };
    });
  }

  /**
   * Reserva-antes-de-publicar. Es la pieza que hace real la idempotencia
   * frente a CONCURRENCIA, no sólo frente a repeticiones secuenciales.
   *
   * Sin `requestId` no hay nada que deduplicar (un `request_id` generado
   * internamente en cada llamada nunca puede repetirse: cachearlo no
   * protegería nada y sólo llenaría la caché), así que se ejecuta directo.
   *
   * Con `requestId`, el orden es INNEGOCIABLE y el motivo de que no haya
   * ningún `await` entre estas dos líneas: se arranca el despacho y se
   * inscribe su promesa en el MISMO turno síncrono. JavaScript no puede
   * interponer otra petición ahí, así que la segunda llamada concurrente
   * encuentra la reserva puesta y se cuelga de la misma promesa en vez de
   * publicar por su cuenta. Si mueves la inscripción detrás de un `await`,
   * vuelve la doble actuación física sobre el hardware.
   */
  private idempotent<T extends DispatchOutcome>(
    requestId: string | undefined,
    run: () => Promise<T>,
  ): Promise<T> {
    if (!requestId) return run();

    const reservada = this.recentRequests.get(requestId) as Promise<T> | undefined;
    if (reservada) return reservada.then((previo) => ({ ...previo, duplicate: true }));

    const enCurso = run();
    this.rememberRequest(requestId, enCurso);
    // Un despacho FALLIDO no debe dejar el `request_id` quemado para siempre:
    // se libera la reserva (sólo si sigue siendo la nuestra) para que un
    // reintento honesto tras el error pueda publicar. El `catch` es sólo para
    // limpiar; el rechazo se le sigue entregando a quien llamó, a través de
    // `enCurso`, que es lo que se devuelve.
    enCurso.catch(() => {
      if (this.recentRequests.get(requestId) === enCurso) this.recentRequests.delete(requestId);
    });
    return enCurso;
  }

  private rememberRequest(requestId: string, result: Promise<DispatchOutcome>): void {
    if (this.recentRequests.has(requestId)) this.recentRequests.delete(requestId);
    this.recentRequests.set(requestId, result);
    if (this.recentRequests.size > ModuleDiagnosticsService.IDEMPOTENCY_CACHE_SIZE) {
      const oldest = this.recentRequests.keys().next().value;
      if (oldest !== undefined) this.recentRequests.delete(oldest);
    }
  }
}
