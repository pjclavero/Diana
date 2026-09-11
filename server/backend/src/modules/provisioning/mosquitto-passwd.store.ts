import { spawn } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, statSync, unlinkSync } from 'node:fs';
import { Injectable, Logger } from '@nestjs/common';
import { MqttCredentialStorePort } from './mqtt-identity.ports';

export const MOSQUITTO_PASSWD_FILE_ENV = 'DIANA_MOSQUITTO_PASSWD_FILE';
export const MOSQUITTO_PASSWD_BIN_ENV = 'DIANA_MOSQUITTO_PASSWD_BIN';

/**
 * Permisos del fichero de credenciales: dueño lee/escribe, GRUPO lee, resto
 * nada. El grupo es el del broker (gid 1883 en `eclipse-mosquitto`), que monta
 * el mismo volumen en sólo lectura y necesita poder abrirlo — con 0600, que es
 * lo que deja `mosquitto_passwd` bajo el umask habitual, el broker arranca y
 * muere con `Unable to open pwfile`.
 */
export const PASSWD_MODE = 0o640;

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
  private readonly logger = new Logger(MosquittoPasswdStore.name);
  private readonly file: string;
  private readonly bin: string;
  /**
   * Cola de un solo carril.
   *
   * `mosquitto_passwd` REESCRIBE el fichero entero: lee, modifica en memoria y
   * renombra encima. Dos invocaciones solapadas no se pisan una línea, se
   * pisan el fichero — la segunda parte de una copia que no incluye lo que
   * acaba de escribir la primera, y la credencial del módulo anterior
   * desaparece sin que nadie falle. Emitir credenciales no es una operación
   * caliente: serializarla no cuesta nada y elimina la carrera por completo.
   */
  private cola: Promise<unknown> = Promise.resolve();

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
    await this.enCola(async () => {
      // `-c` CREA el fichero (y lo trunca). Sólo se usa cuando no existe:
      // pasarlo siempre borraría el resto de identidades en cada emisión, que
      // es una forma silenciosa de dejar sin credencial a los otros ocho
      // módulos.
      const crear = existsSync(this.file) ? [] : ['-c'];
      await this.conRespaldo(() =>
        this.exec([...crear, this.file, username], `${secret}\n${secret}\n`),
      );
    });
  }

  async remove(username: string): Promise<void> {
    await this.enCola(async () => {
      await this.conRespaldo(() => this.exec(['-D', this.file, username]));
    });
  }

  /** Serializa: cada operación espera a la anterior, pase lo que pase. */
  private enCola<T>(trabajo: () => Promise<T>): Promise<T> {
    const siguiente = this.cola.then(trabajo, trabajo);
    // La cola no puede quedarse con un rechazo pendiente: si una emisión falla,
    // la siguiente debe ejecutarse igual, no heredar el error.
    this.cola = siguiente.then(
      () => undefined,
      () => undefined,
    );
    return siguiente;
  }

  /**
   * Copia de seguridad alrededor de la escritura.
   *
   * `mosquitto_passwd` es atómico en el caso normal (escribe un temporal y
   * renombra), pero si muere a mitad —sin espacio, OOM, señal— puede dejar el
   * fichero truncado, y un `passwd` truncado deja sin credencial a TODOS los
   * módulos que ya estaban dados de alta. El respaldo convierte ese escenario
   * en «la emisión ha fallado y nada ha cambiado», que es el único fallo
   * aceptable aquí.
   */
  private async conRespaldo(trabajo: () => Promise<void>): Promise<void> {
    if (!existsSync(this.file)) {
      // Primera credencial de la vida del despliegue: no hay nada que
      // respaldar, pero los permisos se exigen igual.
      await trabajo();
      this.ajustarPermisos();
      return;
    }
    const respaldo = `${this.file}.bak`;
    const tamanoPrevio = statSync(this.file).size;
    copyFileSync(this.file, respaldo);
    try {
      await trabajo();
      this.ajustarPermisos();
      // Un fichero que ENCOGE tras dar de alta a alguien es la firma exacta de
      // una escritura a medias. No se acepta: se restaura y se falla cerrado.
      if (statSync(this.file).size < tamanoPrevio) {
        copyFileSync(respaldo, this.file);
        throw new Error(
          `${this.bin} dejó ${this.file} más pequeño que antes ` +
            `(${statSync(this.file).size} < ${tamanoPrevio} bytes). Se ha restaurado el ` +
            'respaldo y NO se ha emitido la credencial.',
        );
      }
    } catch (error) {
      copyFileSync(respaldo, this.file);
      throw error;
    } finally {
      try {
        unlinkSync(respaldo);
      } catch (error) {
        this.logger.warn(`No se pudo retirar el respaldo ${respaldo}: ${(error as Error).message}`);
      }
    }
  }

  /**
   * Deja el fichero en 0640, y comprueba que ha QUEDADO así.
   *
   * `mosquitto_passwd` lo crea con el umask del proceso (0644 con el habitual
   * 022) y a veces lo deja en 0600. Ninguno de los dos sirve: 0644 lo deja
   * legible por cualquiera del host y 0600 impide que el broker lo abra —el
   * broker arranca y muere con `Unable to open pwfile`.
   *
   * Lo que se exige es el RESULTADO, no la llamada. `chmod` sólo lo puede
   * hacer el dueño: si el fichero lo creó otro (un montaje del host, una
   * siembra hecha por root) la llamada sale EPERM aunque los permisos ya sean
   * los correctos. Abortar ahí seria peor que inútil: la credencial YA está
   * escrita, y el 500 dejaría al operador creyendo que no se emitió nada.
   * Así que se intenta, se mira el modo real y sólo se falla —restaurando el
   * respaldo— si el resultado es inseguro o ilegible para el broker.
   */
  private ajustarPermisos(): void {
    try {
      chmodSync(this.file, PASSWD_MODE);
    } catch (error) {
      this.logger.debug(`chmod sobre ${this.file} no fue posible: ${(error as Error).message}`);
    }
    const modo = statSync(this.file).mode & 0o777;
    // eslint-disable-next-line no-bitwise
    const legiblePorTodos = (modo & 0o004) !== 0;
    // eslint-disable-next-line no-bitwise
    const legiblePorElGrupo = (modo & 0o040) !== 0;
    if (legiblePorTodos || !legiblePorElGrupo) {
      throw new Error(
        `${this.file} ha quedado en modo 0${modo.toString(8)}. Se exige 0${PASSWD_MODE.toString(8)}: ` +
          'legible por el grupo del broker y por nadie más. No se acepta la emisión.',
      );
    }
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
