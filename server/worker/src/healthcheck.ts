/**
 * CLI de HEALTHCHECK del worker (invocado por Docker, ver Dockerfile).
 *
 * Sustituye al antiguo `pgrep -f "node dist/main.js"`: ese comando sólo
 * comprobaba que el proceso seguía vivo, no que las tareas se ejecutaran con
 * éxito. Lee el heartbeat que `main.ts` escribe en cada vuelta del bucle y
 * decide con `evaluateHealth` (health.ts, lógica pura y comprobable).
 *
 * Sale con código 0 si está sano, 1 en caso contrario (convención Docker
 * HEALTHCHECK). Imprime el motivo en stderr para que quede en `docker logs`.
 */
import * as fs from 'fs';
import { evaluateHealth, HeartbeatState } from './health';

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Lee y VALIDA el latido. La validación tiene que seguir a la forma real del
 * fichero: cuando los contadores pasaron de uno global a uno por tarea, esta
 * función siguió exigiendo el campo viejo (`consecutiveTaskFailures`) y empezó
 * a descartar TODOS los latidos por «ilegibles», declarando enfermo un worker
 * perfectamente sano. Un healthcheck que se equivoca en esa dirección es menos
 * peligroso que el contrario, pero igual de inútil: reinicia en bucle un
 * servicio que funciona.
 */
export function readHeartbeat(path: string): HeartbeatState | null {
  try {
    const raw = fs.readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as HeartbeatState).updatedAt === 'string' &&
      typeof (parsed as HeartbeatState).tasks === 'object' &&
      (parsed as HeartbeatState).tasks !== null
    ) {
      return parsed as HeartbeatState;
    }
    return null;
  } catch {
    return null;
  }
}

function main(): void {
  const heartbeatFile = process.env.HEARTBEAT_FILE ?? '/var/lib/diana/worker-heartbeat.json';
  const tickMs = int(process.env.WORKER_TICK_MS, 60000);
  const thresholds = {
    // Margen generoso sobre el intervalo de vuelta del bucle: una vuelta se
    // considera "colgada" a partir de 3 ticks sin actualizar el heartbeat.
    maxAgeMs: int(process.env.WORKER_HEALTH_MAX_AGE_MS, tickMs * 3),
    maxConsecutiveFailures: int(process.env.WORKER_HEALTH_MAX_FAILURES, 3),
  };

  const state = readHeartbeat(heartbeatFile);
  const result = evaluateHealth(state, new Date(), thresholds);

  if (!result.healthy) {
    process.stderr.write(`[healthcheck] NO SANO: ${result.reason}\n`);
    process.exit(1);
  }
  process.exit(0);
}

// Sólo se ejecuta cuando Docker lo invoca como programa. Al importarlo (por
// ejemplo desde una prueba) no debe salir del proceso: era lo que impedía
// probar `readHeartbeat`, y por eso el fallo del validador llegó a producción.
if (require.main === module) {
  main();
}
