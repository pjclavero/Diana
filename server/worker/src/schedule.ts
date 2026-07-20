/**
 * Planificador mínimo del worker.
 *
 * Sin dependencias externas: una tarea es un nombre, un intervalo y una
 * función. La lógica de decisión (¿toca ejecutar?) es PURA y por tanto
 * comprobable sin relojes reales ni base de datos.
 */

export interface TaskDefinition {
  name: string;
  /** Intervalo entre ejecuciones, en milisegundos. */
  intervalMs: number;
  /** Momento de la última ejecución, o `null` si nunca se ejecutó. */
  lastRunAt: Date | null;
  enabled: boolean;
}

export function isDue(task: TaskDefinition, now: Date): boolean {
  if (!task.enabled) return false;
  if (task.lastRunAt === null) return true;
  return now.getTime() - task.lastRunAt.getTime() >= task.intervalMs;
}

export function dueTasks(tasks: TaskDefinition[], now: Date): TaskDefinition[] {
  return tasks.filter((task) => isDue(task, now));
}

/** Fecha de corte de retención: todo lo anterior es candidato a purga. */
export function retentionCutoff(now: Date, days: number): Date {
  if (!Number.isFinite(days) || days < 0) {
    throw new Error(`Retención inválida: ${days} días`);
  }
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * ¿Puede purgarse este lote?
 *
 * Salvaguarda deliberada: la retención NUNCA borra eventos de una partida sin
 * resultado calculado, porque los resultados derivados deben poder
 * reproducirse a partir de los eventos (dosier 21.2).
 */
export function canPurgeRound(round: { hasResults: boolean; finishedAt: Date | null }): boolean {
  return round.hasResults && round.finishedAt !== null;
}
