/**
 * Sonda FUNCIONAL del worker: comprueba que puede hacer su trabajo, no que
 * exista.
 *
 * El worker no atiende HTTP, así que la tentación es declararlo sano porque el
 * proceso sigue en memoria. Eso ya se descartó (ver `health.ts`) a favor de un
 * latido, pero un latido tampoco basta por sí solo: `touchHeartbeat` se
 * refresca en CADA vuelta del bucle, también cuando no toca ninguna tarea. Con
 * PostgreSQL caído, el bucle sigue dando vueltas y refrescando el latido, y el
 * worker se declara sano hasta que la tarea de estadísticas —cada 5 minutos por
 * defecto— acumule fallos suficientes. Peor: si sus intervalos se alargasen, no
 * los acumularía nunca.
 *
 * Esta sonda cierra ese hueco haciendo, en cada vuelta, lo único que de verdad
 * demuestra que el worker sirve para algo: **una consulta real contra la base
 * de datos**. No un `connect()` (Prisma conecta de forma perezosa y no falla
 * hasta la primera consulta: fue exactamente el modo de fallo del motor
 * equivocado, ver Dockerfile) sino una consulta que viaja al servidor.
 */

/** Lo mínimo de Prisma que necesita la sonda; así se prueba sin base de datos. */
export interface ConsultaCruda {
  $queryRawUnsafe(query: string): Promise<unknown>;
}

export type ResultadoSonda = { ok: true } | { ok: false; error: string };

/** Nombre con el que el resultado de la sonda entra en el latido. */
export const TAREA_SONDA = 'database';

/**
 * Consulta trivial pero REAL: si vuelve, hay conexión, credenciales válidas y
 * un motor Prisma compatible. `SELECT 1` no toca ninguna tabla a propósito —
 * fallar por un esquema sin migrar sería un diagnóstico distinto, y quien lo
 * detecta son las tareas.
 */
export async function probeDatabase(prisma: ConsultaCruda): Promise<ResultadoSonda> {
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}
