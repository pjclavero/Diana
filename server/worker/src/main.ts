/**
 * Worker de Diana: proceso SEPARADO del backend para tareas diferidas
 * (estadísticas, exportaciones programadas y retención).
 *
 * Se ejecuta como servicio propio en Docker Compose. No expone puertos ni
 * atiende peticiones: sólo trabaja contra la base de datos.
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { dueTasks, TaskDefinition } from './schedule';
import { applyRetention, recomputePlayerStatistics, WorkerConfig } from './tasks';
import { HeartbeatState, initialHeartbeat, recordTaskOutcome, touchHeartbeat } from './health';

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function loadConfig(): WorkerConfig {
  return {
    hitEventsDays: int(process.env.RETENTION_HIT_EVENTS_DAYS, 730),
    telemetryDays: int(process.env.RETENTION_TELEMETRY_DAYS, 30),
    auditDays: int(process.env.RETENTION_AUDIT_DAYS, 1095),
    exportsDir: process.env.EXPORTS_DIR ?? '/var/lib/diana/exports',
    dryRun: process.env.WORKER_DRY_RUN === '1',
  };
}

function log(message: string): void {
  process.stdout.write(`[worker] ${new Date().toISOString()} ${message}\n`);
}

/**
 * Vuelca el heartbeat a disco (best-effort). Un fallo al escribirlo NO debe
 * tumbar el worker: si el disco falla, el heartbeat se queda obsoleto y el
 * HEALTHCHECK lo marcará no-sano por sí solo (ver health.ts, `maxAgeMs`).
 */
function writeHeartbeat(heartbeatFile: string, state: HeartbeatState): void {
  try {
    fs.writeFileSync(heartbeatFile, JSON.stringify(state));
  } catch (error) {
    log(`Aviso: no se pudo escribir el heartbeat en ${heartbeatFile}: ${(error as Error).message}`);
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const prisma = new PrismaClient();
  const tickMs = int(process.env.WORKER_TICK_MS, 60000);
  const heartbeatFile = process.env.HEARTBEAT_FILE ?? '/var/lib/diana/worker-heartbeat.json';

  const tasks: TaskDefinition[] = [
    {
      name: 'statistics',
      intervalMs: int(process.env.WORKER_STATISTICS_INTERVAL_MS, 5 * 60 * 1000),
      lastRunAt: null,
      enabled: true,
    },
    {
      name: 'retention',
      intervalMs: int(process.env.WORKER_RETENTION_INTERVAL_MS, 24 * 60 * 60 * 1000),
      lastRunAt: null,
      enabled: process.env.WORKER_RETENTION_ENABLED !== '0',
    },
  ];

  if (!fs.existsSync(config.exportsDir)) {
    try {
      fs.mkdirSync(config.exportsDir, { recursive: true });
    } catch {
      log(`Aviso: no se pudo crear ${config.exportsDir}; las exportaciones diferidas fallarán.`);
    }
  }

  const heartbeatDir = path.dirname(heartbeatFile);
  if (!fs.existsSync(heartbeatDir)) {
    try {
      fs.mkdirSync(heartbeatDir, { recursive: true });
    } catch {
      log(`Aviso: no se pudo crear ${heartbeatDir}; el HEALTHCHECK no podrá leer el heartbeat.`);
    }
  }

  let heartbeat = initialHeartbeat(new Date());
  writeHeartbeat(heartbeatFile, heartbeat);

  log(`Iniciado. dryRun=${config.dryRun} tick=${tickMs}ms`);
  let running = true;
  const stop = () => {
    running = false;
    log('Parando…');
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  while (running) {
    const now = new Date();
    const due = dueTasks(tasks, now);
    for (const task of due) {
      try {
        if (task.name === 'statistics') {
          const result = await recomputePlayerStatistics(prisma, config);
          log(`${result.task}: ${result.affected} métricas`);
        } else if (task.name === 'retention') {
          for (const result of await applyRetention(prisma, config, now)) {
            log(`${result.task}: ${result.affected} ${result.detail ?? ''}`);
          }
        }
        heartbeat = recordTaskOutcome(heartbeat, task.name, { ok: true }, new Date());
      } catch (error) {
        const message = (error as Error).message;
        log(`ERROR en ${task.name}: ${message}`);
        heartbeat = recordTaskOutcome(heartbeat, task.name, { ok: false, error: message }, new Date());
      }
      task.lastRunAt = new Date();
    }
    if (due.length === 0) {
      // Vuelta sin tareas debidas: el bucle sigue vivo, se refresca el
      // heartbeat sin tocar el contador de fallos consecutivos.
      heartbeat = touchHeartbeat(heartbeat, new Date());
    }
    writeHeartbeat(heartbeatFile, heartbeat);
    await new Promise((resolve) => setTimeout(resolve, tickMs));
  }

  await prisma.$disconnect();
  log('Detenido.');
}

void main().catch((error) => {
  process.stderr.write(`[worker] fallo fatal: ${(error as Error).stack}\n`);
  process.exit(1);
});
