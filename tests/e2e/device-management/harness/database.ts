/**
 * PostgreSQL EFÍMERO con las migraciones REALES del backend.
 *
 * El último tramo del escenario es «backend → BD», y una BD de mentira lo
 * volvería una afirmación sobre un doble. Aquí se levanta un contenedor
 * efímero, se aplica `prisma migrate deploy` (las migraciones del repo, no un
 * `db push`) y se usan los repositorios Prisma REALES del módulo de
 * aprovisionamiento. Nada de esto toca ninguna base de datos de producción:
 * puerto efímero, contenedor `--rm`, nombre propio.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import * as path from 'node:path';

export const POSTGRES_IMAGE = 'postgres:16-alpine';

export interface EphemeralDatabase {
  container: string;
  port: number;
  url: string;
  stop(): void;
}

function pickFreePort(): number {
  for (let i = 0; i < 30; i += 1) {
    const candidate = 24000 + Math.floor(Math.random() * 1500);
    try {
      const out = execFileSync(
        'sh',
        ['-c', `ss -ltn 2>/dev/null | grep -c ':${candidate} ' || true`],
        { encoding: 'utf8' },
      ).trim();
      if (out === '0') return candidate;
    } catch {
      return candidate;
    }
  }
  throw new Error('no se encontró puerto libre para PostgreSQL efímero');
}

export function backendDir(): string {
  return path.resolve(__dirname, '../../../../server/backend');
}

/** Arranca Postgres, espera a que ACEPTE conexiones y aplica las migraciones. */
export function startDatabase(): EphemeralDatabase {
  const port = pickFreePort();
  const container = `diana-e2e-devmgmt-pg-${port}`;
  execFileSync('docker', [
    'run', '-d', '--rm',
    '--name', container,
    '-e', 'POSTGRES_PASSWORD=diana',
    '-e', 'POSTGRES_DB=diana',
    '-p', `${port}:5432`,
    POSTGRES_IMAGE,
  ]);

  const url = `postgresql://postgres:diana@127.0.0.1:${port}/diana?schema=public`;
  const stop = (): void => {
    spawnSync('docker', ['rm', '-f', container], { stdio: 'ignore' });
  };

  // Espera ACTIVA por la condición final (el servidor acepta conexiones), no
  // un sleep: un sleep corto da rojo intermitente y uno largo alarga el carril.
  let ready = false;
  for (let i = 0; i < 60; i += 1) {
    const probe = spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'postgres'], {
      stdio: 'ignore',
    });
    if (probe.status === 0) {
      ready = true;
      break;
    }
    spawnSync('sleep', ['1']);
  }
  if (!ready) {
    stop();
    throw new Error('PostgreSQL efímero no aceptó conexiones');
  }

  // NO se prueba el puerto del host con un TCP a pelo: MEDIDO que el proxy de
  // docker rootless ACEPTA la conexión antes de que PostgreSQL escuche detrás,
  // así que ese sondeo da verde y no significa nada. La única prueba honesta de
  // que la BD está lista es la propia migración, así que se reintenta con
  // paciencia (la máquina puede estar compartida con otros carriles) y se falla
  // ruidosamente si nunca llega.
  let lastError = '';
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
        cwd: backendDir(),
        env: { ...process.env, DATABASE_URL: url },
        stdio: 'pipe',
      });
      lastError = '';
      break;
    } catch (error) {
      lastError = (error as Error).message;
      spawnSync('sleep', ['3']);
    }
  }
  if (lastError) {
    stop();
    throw new Error(`prisma migrate deploy falló: ${lastError}`);
  }

  return { container, port, url, stop };
}
