import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { Injectable } from '@nestjs/common';
import { MqttCredentialStorePort } from './mqtt-identity.ports';

export const MOSQUITTO_PASSWD_FILE_ENV = 'DIANA_MOSQUITTO_PASSWD_FILE';
export const MOSQUITTO_PASSWD_BIN_ENV = 'DIANA_MOSQUITTO_PASSWD_BIN';

/**
 * Almacén de credenciales del broker = el fichero `passwd` de Mosquitto,
 * escrito con `mosquitto_passwd`.
 *
 * ── El secreto NO pasa por argv ──────────────────────────────────────────────
 * `mosquitto_passwd -b <fichero> <usuario> <contraseña>` es la forma cómoda y
 * es la que usa `infrastructure/mosquitto/generate-users.sh`, pero deja la
 * contraseña en la línea de comandos, donde cualquier usuario del host la lee
 * con `ps`. Aquí se usa el modo INTERACTIVO —`mosquitto_passwd <fichero>
 * <usuario>`, que pide la contraseña dos veces por la entrada estándar— y se
 * escribe por stdin. El coste es tener que hablar con un prompt; a cambio el
 * secreto no aparece en ninguna tabla de procesos.
 *
 * ── Por qué no se invoca generate-users.sh ───────────────────────────────────
 * Ese script GENERA él la contraseña (`openssl rand`) y la imprime. Serviría
 * para un operador en una terminal, pero no para esta ruta: el servidor tiene
 * que ser la autoridad del secreto y entregarlo por HTTP una sola vez, y con
 * ese script el secreto nacería fuera y saldría por stdout. La parte canónica
 * de ese script —que una identidad no declarada en `identities.json` no puede
 * tener credencial— sí se conserva, y la impone `CanonicalIdentitySource`
 * antes de llegar aquí.
 */
@Injectable()
export class MosquittoPasswdStore implements MqttCredentialStorePort {
  private readonly file: string;
  private readonly bin: string;

  constructor(file?: string, bin?: string) {
    const resolved = file ?? process.env[MOSQUITTO_PASSWD_FILE_ENV];
    if (!resolved) {
      throw new Error(
        `No hay fichero passwd de Mosquitto configurado (${MOSQUITTO_PASSWD_FILE_ENV}). ` +
          'Sin él no se puede emitir ninguna credencial.',
      );
    }
    this.file = resolved;
    this.bin = bin ?? process.env[MOSQUITTO_PASSWD_BIN_ENV] ?? 'mosquitto_passwd';
  }

  describe(): string {
    return `${this.bin} sobre ${this.file}`;
  }

  async upsert(username: string, secret: string): Promise<void> {
    // `-c` CREA el fichero (y lo trunca). Sólo se usa cuando no existe: pasarlo
    // siempre borraría el resto de identidades en cada emisión, que es una
    // forma silenciosa de dejar sin credencial a los otros ocho módulos.
    const crear = existsSync(this.file) ? [] : ['-c'];
    await this.exec([...crear, this.file, username], `${secret}\n${secret}\n`);
  }

  async remove(username: string): Promise<void> {
    await this.exec(['-D', this.file, username]);
  }

  private exec(args: string[], stdin?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (c: Buffer) => {
        stderr += c.toString();
      });
      // stdout se consume y se DESCARTA: `mosquitto_passwd` no imprime el
      // secreto, pero registrar su salida sería una forma fácil de que algún
      // día lo hiciera sin que nadie lo notase.
      child.stdout.resume();
      child.on('error', (e) => reject(e));
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        // El mensaje de error lleva el usuario y el código, nunca el secreto.
        reject(
          new Error(
            `${this.bin} ${args.filter((a) => a !== undefined).join(' ')} terminó con código ` +
              `${code}: ${stderr.trim()}`,
          ),
        );
      });
      if (stdin !== undefined) child.stdin.write(stdin);
      child.stdin.end();
    });
  }
}
