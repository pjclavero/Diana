/**
 * Worker de Diana: proceso SEPARADO del backend para tareas diferidas
 * (estadísticas, exportaciones programadas y retención).
 *
 * Se ejecuta como servicio propio en Docker Compose. No expone puertos ni
 * atiende peticiones: sólo trabaja contra la base de datos.
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import { dueTasks, TaskDefinition } from './schedule';
import { applyRetention, recomputePlayerStatistics, WorkerConfig } from './tasks';

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

async function main(): Promise<void> {
  const config = loadConfig();
  const prisma = new PrismaClient();
  const tickMs = int(process.env.WORKER_TICK_MS, 60000);

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
    for (const task of dueTasks(tasks, now)) {
      try {
        if (task.name === 'statistics') {
          const result = await recomputePlayerStatistics(prisma, config);
          log(`${result.task}: ${result.affected} métricas`);
        } else if (task.name === 'retention') {
          for (const result of await applyRetention(prisma, config, now)) {
            log(`${result.task}: ${result.affected} ${result.detail ?? ''}`);
          }
        }
      } catch (error) {
        log(`ERROR en ${task.name}: ${(error as Error).message}`);
      }
      task.lastRunAt = new Date();
    }
    await new Promise((resolve) => setTimeout(resolve, tickMs));
  }

  await prisma.$disconnect();
  log('Detenido.');
}

void main().catch((error) => {
  process.stderr.write(`[worker] fallo fatal: ${(error as Error).stack}\n`);
  process.exit(1);
});
