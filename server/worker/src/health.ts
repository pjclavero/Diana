/**
 * Salud "de verdad" del worker: distinguir proceso VIVO de worker ÚTIL.
 *
 * Antes de este módulo el HEALTHCHECK de Docker sólo comprobaba `pgrep -f
 * "node dist/main.js"`: si el proceso seguía en memoria, el contenedor se
 * declaraba `healthy` aunque TODAS las tareas fallaran en bucle (p. ej. el
 * cliente Prisma con el motor equivocado — ver Dockerfile). El orquestador
 * creía que el worker recalculaba estadísticas cuando en realidad no
 * ejecutaba nada útil.
 *
 * `main.ts` actualiza un `HeartbeatState` en cada vuelta del bucle y lo
 * vuelca a un fichero JSON (`writeHeartbeat`); `healthcheck.ts` lo lee y
 * decide si el contenedor está sano de verdad con `evaluateHealth`.
 */

/** Estado de UNA tarea. Cada una lleva su propia cuenta: ver `HeartbeatState`. */
export interface TaskState {
  /** Fallos consecutivos DE ESTA TAREA (se resetea a 0 cuando ella acierta). */
  consecutiveFailures: number;
  /** Mensaje del último error de esta tarea, o null si no ha fallado (aún). */
  lastError: string | null;
  /** Última vez que ESTA tarea terminó con éxito, o null si nunca lo hizo. */
  lastSuccessAt: string | null;
}

export interface HeartbeatState {
  /** Última vez que el bucle principal completó una vuelta. */
  updatedAt: string;
  /**
   * Arranque de ESTE proceso. Sin él, «todavía no ha corrido nada» y «lleva
   * horas sin conseguir correr nada» eran indistinguibles, y ambos salían
   * SANOS: ver `evaluateHealth`. Opcional para poder leer latidos escritos por
   * una versión anterior sin declararlos ilegibles.
   */
  startedAt?: string;
  /**
   * Cuenta POR TAREA, no una global.
   *
   * Con un único contador compartido, el éxito de una tarea frecuente borraba
   * los fallos de otra rara: `statistics` corre cada 5 minutos y `retention`
   * cada 24 horas, así que `retention` podía llevar SEMANAS rota sin llegar
   * nunca a acumular fallos consecutivos —cada vuelta de `statistics` reseteaba
   * el contador antes de que volviera a intentarlo—. Era el mismo fallo
   * silencioso que este módulo venía a eliminar, colado por otra puerta.
   */
  tasks: Record<string, TaskState>;
  /** Mensaje del último error de CUALQUIER tarea, para el diagnóstico rápido. */
  lastError: string | null;
  /** Última vez que alguna tarea terminó con éxito, o null si ninguna lo hizo. */
  lastSuccessAt: string | null;
}

export function initialHeartbeat(now: Date): HeartbeatState {
  return {
    updatedAt: now.toISOString(),
    startedAt: now.toISOString(),
    tasks: {},
    lastError: null,
    lastSuccessAt: null,
  };
}

/**
 * Reductor puro: aplica el resultado de UNA tarea al estado. No toca el
 * disco ni el reloj real; recibe `now` explícito para ser comprobable.
 */
export function recordTaskOutcome(
  state: HeartbeatState,
  task: string,
  outcome: { ok: true } | { ok: false; error: string },
  now: Date,
): HeartbeatState {
  const previous: TaskState = state.tasks[task] ?? {
    consecutiveFailures: 0,
    lastError: null,
    lastSuccessAt: null,
  };
  // El resultado de una tarea SÓLO afecta a su propia cuenta. Que
  // `statistics` funcione no dice absolutamente nada sobre `retention`.
  const updated: TaskState = outcome.ok
    ? { consecutiveFailures: 0, lastError: null, lastSuccessAt: now.toISOString() }
    : {
        consecutiveFailures: previous.consecutiveFailures + 1,
        lastError: outcome.error,
        lastSuccessAt: previous.lastSuccessAt,
      };
  const tasks = { ...state.tasks, [task]: updated };
  // El error de cabecera es el de la tarea que peor va, no el último que se
  // vio: si `statistics` acierta mientras `retention` sigue rota, el resumen
  // tiene que seguir enseñando el fallo de `retention`, no quedarse en blanco.
  const enFallo = Object.values(tasks).find((t) => t.consecutiveFailures > 0);
  return {
    ...state,
    updatedAt: now.toISOString(),
    tasks,
    lastError: enFallo ? enFallo.lastError : null,
    lastSuccessAt: outcome.ok ? now.toISOString() : state.lastSuccessAt,
  };
}

/** La tarea que peor va: es la que decide la salud del conjunto. */
export function worstTask(state: HeartbeatState): { name: string; task: TaskState } | null {
  const entries = Object.entries(state.tasks);
  if (entries.length === 0) return null;
  const [name, task] = entries.reduce((peor, actual) =>
    actual[1].consecutiveFailures > peor[1].consecutiveFailures ? actual : peor,
  );
  return { name, task };
}

/** Marca sólo que el bucle sigue vivo (vuelta sin tareas debidas). */
export function touchHeartbeat(state: HeartbeatState, now: Date): HeartbeatState {
  return { ...state, updatedAt: now.toISOString() };
}

export interface HealthThresholds {
  /** Antigüedad máxima admisible del último "latido" antes de considerar el proceso muerto/colgado. */
  maxAgeMs: number;
  /** Fallos consecutivos de tareas a partir de los cuales se declara no-sano. */
  maxConsecutiveFailures: number;
  /**
   * Tiempo máximo SIN que ninguna tarea termine con éxito. Un worker que da
   * vueltas al bucle refrescando el latido pero no completa nada NO está sano,
   * por muy vivo que esté el proceso: es «no me llegan datos, luego todo bien».
   */
  maxSuccessAgeMs: number;
  /**
   * Margen desde el arranque antes de exigir el primer éxito. Sólo cubre el
   * arranque; pasado, la ausencia de éxitos es un fallo, no una espera.
   */
  startupGraceMs: number;
}

export interface HealthResult {
  healthy: boolean;
  reason: string;
}

/**
 * Puro: decide si el worker está sano dado su último heartbeat conocido.
 * `state` es `null` cuando el fichero de heartbeat no existe o no se pudo
 * leer/parsear (arranque, disco corrupto, etc.) — eso NUNCA es "sano".
 */
export function evaluateHealth(state: HeartbeatState | null, now: Date, thresholds: HealthThresholds): HealthResult {
  if (state === null) {
    return { healthy: false, reason: 'sin heartbeat (no se pudo leer o parsear)' };
  }

  const updatedAt = new Date(state.updatedAt);
  if (Number.isNaN(updatedAt.getTime())) {
    return { healthy: false, reason: 'heartbeat con updatedAt inválido' };
  }

  const ageMs = now.getTime() - updatedAt.getTime();
  if (ageMs > thresholds.maxAgeMs) {
    return { healthy: false, reason: `heartbeat obsoleto: ${ageMs}ms > ${thresholds.maxAgeMs}ms` };
  }

  // Basta con que UNA tarea esté rota para que el worker no esté sano: no
  // sirve de nada recalcular estadísticas si la purga de datos lleva días
  // fallando y el disco se está llenando.
  const peor = worstTask(state);
  if (peor && peor.task.consecutiveFailures >= thresholds.maxConsecutiveFailures) {
    return {
      healthy: false,
      reason: `la tarea '${peor.name}' acumula ${peor.task.consecutiveFailures} fallos consecutivos (>= ${thresholds.maxConsecutiveFailures}): ${peor.task.lastError ?? 'sin detalle'}`,
    };
  }

  // AUSENCIA DE TRABAJO NO ES SALUD.
  //
  // Hasta aquí, un worker con `tasks: {}` y el latido fresco se declaraba SANO:
  // es el estado exacto de un proceso que arranca, no consigue hablar con
  // PostgreSQL y se limita a dar vueltas al bucle refrescando el latido con
  // `touchHeartbeat`. Nunca acumulaba fallos consecutivos —para fallar hay que
  // intentarlo, y las tareas sólo se intentan cuando les toca—, así que el
  // orquestador veía `healthy` indefinidamente. Es el mismo defecto que el
  // panel que pinta «sin alertas» porque no le llegó nada.
  const referencia = state.lastSuccessAt ?? state.startedAt ?? null;
  if (referencia === null) {
    return {
      healthy: false,
      reason: 'el latido no dice ni cuándo arrancó ni cuándo tuvo éxito por última vez',
    };
  }
  const desde = new Date(referencia);
  if (Number.isNaN(desde.getTime())) {
    return { healthy: false, reason: `marca de tiempo inválida en el latido: ${referencia}` };
  }
  const sinExitoMs = now.getTime() - desde.getTime();
  if (state.lastSuccessAt === null) {
    if (sinExitoMs > thresholds.startupGraceMs) {
      return {
        healthy: false,
        reason:
          `arrancó hace ${sinExitoMs}ms y no ha completado NINGUNA tarea con éxito ` +
          `(margen de arranque ${thresholds.startupGraceMs}ms)` +
          (state.lastError ? `: ${state.lastError}` : ''),
      };
    }
  } else if (sinExitoMs > thresholds.maxSuccessAgeMs) {
    return {
      healthy: false,
      reason:
        `ninguna tarea ha terminado con éxito desde hace ${sinExitoMs}ms ` +
        `(> ${thresholds.maxSuccessAgeMs}ms): el proceso vive, pero no está sirviendo` +
        (state.lastError ? `. Último error: ${state.lastError}` : ''),
    };
  }

  return { healthy: true, reason: 'ok' };
}
