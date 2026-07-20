import * as fs from 'fs';
import * as path from 'path';

/**
 * Localiza el directorio `contracts/` del repositorio.
 *
 * Los contratos son propiedad de WP-00 y el backend sólo los LEE. Se busca
 * subiendo desde este fichero para que funcione igual en `src/`, en `dist/` y
 * dentro del contenedor. `DIANA_CONTRACTS_DIR` permite fijarlo explícitamente.
 */
export function resolveContractsDir(): string {
  const fromEnv = process.env.DIANA_CONTRACTS_DIR;
  if (fromEnv) {
    assertContractsDir(fromEnv);
    return fromEnv;
  }

  let dir = __dirname;
  for (let depth = 0; depth < 10; depth += 1) {
    const candidate = path.join(dir, 'contracts');
    if (fs.existsSync(path.join(candidate, 'mqtt'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    'No se encuentra el directorio contracts/. Define DIANA_CONTRACTS_DIR con su ruta absoluta.',
  );
}

function assertContractsDir(dir: string): void {
  if (!fs.existsSync(path.join(dir, 'mqtt'))) {
    throw new Error(`DIANA_CONTRACTS_DIR='${dir}' no contiene un subdirectorio mqtt/`);
  }
}
