import { Injectable, Logger } from '@nestjs/common';
import { createPrivateKey, createPublicKey, createSign, KeyObject } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

import { CanonicalOrder, canonicalizeOrder, SIGNATURE_ALG } from './provisioning-canonical';

/**
 * Firmante de órdenes del plano DEVICE_MANAGEMENT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DE DÓNDE SALE LA CLAVE PRIVADA (y de dónde NO)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * La clave OPERATIVA con la que se firman las órdenes es el material que
 * convierte una publicación MQTT en una orden ejecutable para un módulo. Quien
 * la tenga puede aprovisionar hardware ajeno. Por eso:
 *
 *  1. NUNCA vive en el repositorio. El constructor RECHAZA cualquier ruta que
 *     caiga dentro del árbol de trabajo de git (`repoRoot()`), aunque el
 *     fichero exista y los permisos sean correctos. Un `.gitignore` no es una
 *     barrera: se borra en un commit y nadie se entera.
 *  2. NUNCA se pasa por la línea de órdenes ni por una variable de entorno con
 *     el material. La variable `DIANA_PROVISIONING_KEY_FILE` transporta una
 *     RUTA, no una clave: `argv` y el entorno de un proceso son legibles por
 *     otros usuarios de la máquina (`/proc/<pid>/cmdline`, `environ`).
 *  3. El fichero debe ser 0600 (ni grupo ni otros, ningún bit de ejecución).
 *     Si no lo es, esto LANZA en el arranque en lugar de firmar. Un backend
 *     que muere diciendo por qué es preferible a uno que firma con una clave
 *     que puede leer media máquina.
 *  4. El `KeyObject` no sale nunca de esta clase, ni por `toJSON`, ni por
 *     `util.inspect`, ni en un log: los tres están cerrados explícitamente más
 *     abajo. Lo único público que se expone es el SPKI de la clave PÚBLICA y
 *     el `keyId`, que son identificadores, no secretos.
 *
 * Alternativas soportadas por diseño, por orden de preferencia operativa:
 *
 *   a) Secret store (Vault/systemd-creds/Docker secret) que MATERIALIZA el PEM
 *      en un fichero 0600 fuera del repo y exporta su ruta en
 *      `DIANA_PROVISIONING_KEY_FILE`. Es el camino recomendado en producción y
 *      no exige ningún cambio aquí: el punto de montaje es un fichero.
 *   b) Fichero 0600 gestionado a mano fuera del repo (laboratorio).
 *   c) DESARROLLO: `dev-provisioning-key.sh` (en este mismo directorio) genera
 *      una clave EFÍMERA en `$XDG_RUNTIME_DIR` (o `/tmp`) con 0600, fuera de
 *      git y fuera del árbol de trabajo. Requiere además
 *      `DIANA_PROVISIONING_KEY_DEV=1`, y entonces el arranque emite un WARN
 *      inconfundible. En `NODE_ENV=production` esa combinación ABORTA.
 *
 * Lo que este backend NO hace, y es deliberado: no tiene la clave RAÍZ. La
 * raíz de fábrica firma DELEGACIONES fuera de línea; el backend consume la
 * credencial ya firmada (material público + firma de la raíz) y sólo firma
 * órdenes con la operativa delegada. Comprometer el backend no compromete la
 * raíz.
 */

export const KEY_FILE_ENV = 'DIANA_PROVISIONING_KEY_FILE';
export const KEY_ID_ENV = 'DIANA_PROVISIONING_KEY_ID';
export const KEY_DEV_ENV = 'DIANA_PROVISIONING_KEY_DEV';

export interface SignerOptions {
  /** Ruta del PEM PKCS#8 con la clave operativa. */
  keyFile: string;
  /** `operational_key_id` que la delegación asocia a esta clave. */
  keyId: string;
  /** Sólo para pruebas: salta la comprobación de permisos del fichero. */
  allowInsecurePermissions?: boolean;
  /** `NODE_ENV` efectivo; inyectable para poder probar la rama de producción. */
  nodeEnv?: string;
  /** Marca de clave de desarrollo (`DIANA_PROVISIONING_KEY_DEV=1`). */
  devKey?: boolean;
}

/** Raíz del árbol de trabajo de git que contiene este fichero, o `null`. */
export function repoRoot(from: string = __dirname): string | null {
  let dir = path.resolve(from);
  for (;;) {
    if (existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function base64url(raw: Buffer): string {
  return raw.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

@Injectable()
export class ProvisioningSigner {
  private readonly logger = new Logger(ProvisioningSigner.name);
  /** NO se expone. Ver la cabecera de este fichero. */
  private readonly privateKey: KeyObject;
  readonly keyId: string;
  /** SPKI DER en base64url. Material PÚBLICO: es un identificador, no un secreto. */
  readonly publicKeySpki: string;

  constructor(options: SignerOptions) {
    const keyFile = path.resolve(options.keyFile);
    const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? 'development';

    const root = repoRoot();
    if (root && (keyFile === root || keyFile.startsWith(root + path.sep))) {
      throw new Error(
        `La clave de aprovisionamiento no puede vivir dentro del repositorio (${root}). ` +
          'Colócala en un fichero 0600 fuera del árbol de trabajo, o móntala desde el ' +
          'gestor de secretos. Un .gitignore no es una barrera.',
      );
    }

    if (options.devKey && nodeEnv === 'production') {
      throw new Error(
        `${KEY_DEV_ENV}=1 en producción: una clave de desarrollo jamás firma órdenes reales.`,
      );
    }

    const stats = statSync(keyFile);
    if (!stats.isFile()) {
      throw new Error(`${KEY_FILE_ENV} no apunta a un fichero regular: ${keyFile}`);
    }
    const mode = stats.mode & 0o777;
    if (!options.allowInsecurePermissions && (mode & 0o177) !== 0) {
      throw new Error(
        `La clave de aprovisionamiento ${keyFile} tiene permisos ${mode.toString(8)}; ` +
          'se exige 0600 (sólo lectura/escritura del propietario).',
      );
    }

    // El PEM se lee, se convierte a KeyObject y el Buffer intermedio se suelta
    // de inmediato: no se guarda en ningún campo ni se registra en ningún log.
    const pem = readFileSync(keyFile, 'utf8');
    let key: KeyObject;
    try {
      key = createPrivateKey(pem);
    } catch {
      // El mensaje del error de OpenSSL puede arrastrar contenido del fichero.
      throw new Error(`No se pudo leer la clave privada de ${keyFile} (PEM PKCS#8 P-256 esperado).`);
    }
    const details = key.asymmetricKeyDetails;
    if (key.asymmetricKeyType !== 'ec' || details?.namedCurve !== 'prime256v1') {
      throw new Error(
        `La clave de ${keyFile} no es ECDSA P-256 (prime256v1); ` +
          `${SIGNATURE_ALG} no se negocia.`,
      );
    }

    this.privateKey = key;
    this.keyId = options.keyId;
    this.publicKeySpki = base64url(
      createPublicKey(key).export({ type: 'spki', format: 'der' }) as Buffer,
    );

    if (options.devKey) {
      this.logger.warn(
        '=== CLAVE DE APROVISIONAMIENTO DE DESARROLLO EN USO ===  Las órdenes que ' +
          'firme este backend NO tienen valor de autoridad real. No usar fuera del ' +
          `laboratorio (${KEY_DEV_ENV}=1).`,
      );
    }
  }

  /** Construye el firmante desde el entorno. Devuelve `null` si no está configurado. */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): ProvisioningSigner | null {
    const keyFile = env[KEY_FILE_ENV];
    if (!keyFile) return null;
    return new ProvisioningSigner({
      keyFile,
      keyId: env[KEY_ID_ENV] ?? 'op-key-unnamed',
      nodeEnv: env.NODE_ENV,
      devKey: env[KEY_DEV_ENV] === '1',
    });
  }

  /**
   * Firma la cadena canónica de una orden. P1363 (r||s, 64 bytes) en base64url
   * sin relleno, que es lo único que el firmware verifica.
   *
   * `dsaEncoding: 'ieee-p1363'` NO es cosmético: el valor por defecto de Node
   * es DER, y una firma DER tiene longitud variable y no la verifica el
   * `diana_p256_verify_message` del módulo.
   */
  signOrder(order: CanonicalOrder): string {
    return this.signCanonical(canonicalizeOrder(order));
  }

  signCanonical(canonical: Buffer): string {
    const signer = createSign('sha256');
    signer.update(canonical);
    signer.end();
    const raw = signer.sign({ key: this.privateKey, dsaEncoding: 'ieee-p1363' });
    if (raw.length !== 64) {
      throw new Error(`Firma P1363 de ${raw.length} bytes; se esperaban 64 (r||s de P-256).`);
    }
    return base64url(raw);
  }

  /* Cierra las tres vías por las que una clave acaba en un log sin querer. */
  toJSON(): Record<string, string> {
    return { keyId: this.keyId, publicKeySpki: this.publicKeySpki };
  }
  toString(): string {
    return `ProvisioningSigner(keyId=${this.keyId})`;
  }
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return this.toString();
  }
}

export const PROVISIONING_SIGNER = Symbol('PROVISIONING_SIGNER');
