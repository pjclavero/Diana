import { execFile } from 'node:child_process';
import { Injectable, Logger } from '@nestjs/common';
import { IdentitySourcePort } from './mqtt-identity.ports';

/** Ruta al generador canónico. Se puede reapuntar para pruebas. */
export const IDENTITY_GENERATOR_ENV = 'DIANA_IDENTITY_GENERATOR';
export const IDENTITY_SOURCE_ENV = 'DIANA_IDENTITIES_FILE';

const DEFAULT_GENERATOR = 'infrastructure/mosquitto/generate-identities.mjs';

function run(generator: string, args: string[], source?: string): Promise<string> {
  const argv = source ? [generator, '--source', source, ...args] : [generator, ...args];
  return new Promise((resolve, reject) => {
    execFile('node', argv, { encoding: 'utf8', timeout: 15_000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${generator} ${args.join(' ')} falló: ${stderr.trim() || error.message}`));
        return;
      }
      resolve(stdout);
    });
  });
}

/**
 * Fuente de identidades = el generador canónico, invocado por su CLI.
 *
 * `generate-identities.mjs` expone `--list-users` y `--module-id-of` justo para
 * esto, y `generate-users.sh` ya los usa igual. Se le pregunta a él en vez de
 * leer `identities.json` por nuestra cuenta porque él es quien VALIDA la fuente
 * (patrón de identificador del contrato, duplicados, identificadores
 * reservados, y la invariante F-02 `username == module_id`) y quien genera la
 * ACL a partir de ella. Un segundo lector aquí podría aceptar una identidad
 * que el generador rechaza; el resultado sería una credencial válida en el
 * broker sin ninguna regla de ACL que la acote, que es la peor combinación
 * posible: autentica y no está confinada.
 */
@Injectable()
export class CanonicalIdentitySource implements IdentitySourcePort {
  private readonly logger = new Logger(CanonicalIdentitySource.name);
  private readonly generator: string;
  private readonly source?: string;

  constructor(generator?: string, source?: string) {
    this.generator = generator ?? process.env[IDENTITY_GENERATOR_ENV] ?? DEFAULT_GENERATOR;
    this.source = source ?? process.env[IDENTITY_SOURCE_ENV];
  }

  describe(): string {
    return this.source ? `${this.generator} --source ${this.source}` : this.generator;
  }

  async listUsernames(): Promise<string[]> {
    const out = await run(this.generator, ['--list-users'], this.source);
    return out
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }

  async moduleIdOf(username: string): Promise<string | null> {
    try {
      const out = await run(this.generator, ['--module-id-of', username], this.source);
      const id = out.trim();
      return id.length > 0 ? id : null;
    } catch (error) {
      // El generador sale con 1 cuando el usuario no está declarado. Eso no es
      // un fallo del sistema: es la respuesta «no existe».
      this.logger.debug(`moduleIdOf(${username}) → no declarado: ${(error as Error).message}`);
      return null;
    }
  }
}
