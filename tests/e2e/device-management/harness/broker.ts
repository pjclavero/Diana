/**
 * Broker Mosquitto EFÍMERO con TLS y con la ACL REAL del repositorio.
 *
 * Dos decisiones que definen lo que este carril puede afirmar:
 *
 *  1. La ACL NO se inventa aquí: se copia tal cual de
 *     `infrastructure/mosquitto/acl`. Una ACL de laboratorio escrita a medida
 *     probaría la ACL de laboratorio. Se copia, además, en SÓLO LECTURA para
 *     el contenedor, y el fichero del repo no se toca.
 *  2. NO se ejecuta `infrastructure/mosquitto/set-coordinator.sh`. El escenario
 *     de DEVICE_MANAGEMENT no necesita el rol de coordinador —los tópicos
 *     `provision` y `provision/state` ya están en la ACL estática— y ese script
 *     deja la ACL en 0600, con lo que el broker arranca y muere con
 *     `Exited (13)` (decisión D6). Dependerlo convertiría el escenario en
 *     bloqueante operativo.
 *
 * El listener es TLS-only (8883 dentro del contenedor): no se abre ningún
 * puerto en claro, así que "el transporte se ejerció cifrado" es un hecho del
 * montaje y no una afirmación.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { generateTls, TlsMaterial } from './pki';

export const MOSQUITTO_IMAGE = 'eclipse-mosquitto:2';

/** Ruta de la ACL REAL del despliegue. Se lee, nunca se escribe. */
export function repoAclPath(): string {
  return path.resolve(__dirname, '../../../../infrastructure/mosquitto/acl');
}

export function dockerAvailable(): boolean {
  return spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;
}

function pickFreePort(): number {
  for (let i = 0; i < 30; i += 1) {
    const candidate = 22000 + Math.floor(Math.random() * 1500);
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
  throw new Error('no se encontró puerto libre para el broker efímero');
}

export interface BrokerCredentials {
  [user: string]: string;
}

export interface EphemeralBroker {
  container: string;
  port: number;
  tls: TlsMaterial;
  /** URL TLS con la que conecta el backend. */
  url: string;
  logs(): string;
  stop(): void;
}

/**
 * Arranca el broker. `users` es un mapa usuario→contraseña; los usuarios deben
 * existir en la ACL del repositorio (`backend`, `module-01`, …), porque de eso
 * trata el escenario: el usuario MQTT es el `module_id` EXACTO, sin prefijo.
 */
export function startBroker(users: BrokerCredentials): EphemeralBroker {
  const dir = mkdtempSync(path.join(tmpdir(), 'diana-e2e-mosq-'));
  // mkdtemp crea 0700 y el proceso del contenedor corre como uid 1883: sin
  // esto no puede ni atravesar el directorio, el broker muere al arrancar y
  // desde fuera sólo se ve un ECONNREFUSED que no apunta a su causa.
  chmodSync(dir, 0o755);

  const tls = generateTls();
  const certDir = path.join(dir, 'certs');
  execFileSync('mkdir', ['-p', certDir]);
  chmodSync(certDir, 0o755);
  for (const [src, name] of [
    [tls.caFile, 'ca.crt'],
    [tls.certFile, 'server.crt'],
    [tls.keyFile, 'server.key'],
  ] as const) {
    const dst = path.join(certDir, name);
    copyFileSync(src, dst);
    // La clave del servidor la lee el uid 1883 del contenedor; en un
    // contenedor efímero de laboratorio se abre a lectura para que el broker
    // arranque. La clave muere con el directorio temporal.
    chmodSync(dst, name === 'server.key' ? 0o644 : 0o644);
  }

  const port = pickFreePort();
  const container = `diana-e2e-devmgmt-${port}`;

  writeFileSync(
    path.join(dir, 'mosquitto.conf'),
    [
      '# Broker EFÍMERO del carril E2E-3. TLS-ONLY: no hay listener en claro.',
      'listener 8883 0.0.0.0',
      'protocol mqtt',
      'cafile /mosquitto/config/certs/ca.crt',
      'certfile /mosquitto/config/certs/server.crt',
      'keyfile /mosquitto/config/certs/server.key',
      'require_certificate false',
      'tls_version tlsv1.2',
      'socket_domain ipv4',
      'allow_anonymous false',
      'password_file /mosquitto/config/passwd',
      'acl_file /mosquitto/config/acl',
      // F-02, barrera 1. Igual que en producción: el broker reescribe el
      // client_id con el usuario autenticado antes de evaluar la ACL.
      'use_username_as_clientid true',
      'persistence false',
      'log_type warning',
      'log_type error',
      'log_type notice',
      '',
    ].join('\n'),
  );

  // ACL REAL del repositorio, copiada verbatim.
  const acl = readFileSync(repoAclPath(), 'utf8');
  writeFileSync(path.join(dir, 'acl'), acl, { mode: 0o644 });

  // Las contraseñas NO viajan por argv: se escriben en un fichero y
  // `mosquitto_passwd -U` lo convierte en su sitio.
  const passwdFile = path.join(dir, 'passwd');
  writeFileSync(
    passwdFile,
    Object.entries(users)
      .map(([u, p]) => `${u}:${p}`)
      .join('\n') + '\n',
    { mode: 0o644 },
  );
  execFileSync('docker', [
    'run', '--rm',
    '-v', `${dir}:/mosquitto/config`,
    '--entrypoint', 'mosquitto_passwd',
    MOSQUITTO_IMAGE, '-U', '/mosquitto/config/passwd',
  ]);

  execFileSync('docker', [
    'run', '-d', '--rm',
    '--name', container,
    '-p', `${port}:8883`,
    '-v', `${dir}:/mosquitto/config`,
    MOSQUITTO_IMAGE,
  ]);

  return {
    container,
    port,
    tls,
    url: `mqtts://127.0.0.1:${port}`,
    logs: () => {
      const r = spawnSync('docker', ['logs', container], { encoding: 'utf8' });
      return `${r.stdout ?? ''}${r.stderr ?? ''}`;
    },
    stop: () => {
      spawnSync('docker', ['rm', '-f', container], { stdio: 'ignore' });
    },
  };
}
