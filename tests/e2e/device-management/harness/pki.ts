/**
 * Material criptográfico EFÍMERO del carril E2E-3.
 *
 * Todo lo que se genera aquí vive en un directorio temporal y muere con la
 * ejecución. Nada toca `infrastructure/mosquitto/` ni el repositorio: la clave
 * operativa se escribe 0600 FUERA del árbol de trabajo porque
 * `ProvisioningSigner` rechaza —correctamente— cualquier ruta que caiga dentro
 * de él, y no se pasa ningún secreto por `argv`.
 *
 * Se generan TRES cosas distintas y no hay que confundirlas:
 *
 *  1. PKI de TLS del broker (CA + certificado de servidor con SAN 127.0.0.1).
 *     Es el transporte. No autoriza nada: la identidad MQTT sigue siendo
 *     usuario/contraseña + ACL.
 *  2. Clave RAÍZ de fábrica (P-256). Nunca la tiene el backend. Firma fuera de
 *     línea la credencial de delegación, exactamente como en el diseño.
 *  3. Clave OPERATIVA (P-256), la que el backend usa para firmar órdenes, y la
 *     credencial de delegación que la raíz emite sobre ella.
 */
import { execFileSync } from 'node:child_process';
import { createPublicKey, createSign, generateKeyPairSync, KeyObject } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { canonicalizeDelegation } from '../../../../server/backend/src/modules/provisioning/provisioning-canonical';
import { DelegationCredential } from '../../../../server/backend/src/modules/provisioning/provisioning-command.service';

export interface TlsMaterial {
  dir: string;
  caFile: string;
  certFile: string;
  keyFile: string;
}

/** CA propia + certificado de servidor. SAN con IP: el cliente conecta por IP. */
export function generateTls(): TlsMaterial {
  const dir = mkdtempSync(path.join(tmpdir(), 'diana-e2e-tls-'));
  const caKey = path.join(dir, 'ca.key');
  const caCrt = path.join(dir, 'ca.crt');
  const srvKey = path.join(dir, 'server.key');
  const srvCsr = path.join(dir, 'server.csr');
  const srvCrt = path.join(dir, 'server.crt');
  const ext = path.join(dir, 'server.ext');

  // SAN obligatoria: sin `IP:127.0.0.1` el cliente falla la verificación de
  // nombre. Y la verificación NO se desactiva en ningún punto de este carril:
  // `MqttService` deja `rejectUnauthorized: true` explícito y aquí se le da la
  // CA de verdad para que pueda validarla.
  writeFileSync(
    ext,
    ['subjectAltName=DNS:localhost,IP:127.0.0.1', 'extendedKeyUsage=serverAuth', ''].join('\n'),
  );

  const ssl = (args: string[]): void => {
    execFileSync('openssl', args, { stdio: 'pipe' });
  };
  ssl(['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', caKey]);
  ssl(['req', '-x509', '-new', '-key', caKey, '-sha256', '-days', '1', '-out', caCrt,
       '-subj', '/CN=diana-e2e-ca']);
  ssl(['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', srvKey]);
  ssl(['req', '-new', '-key', srvKey, '-out', srvCsr, '-subj', '/CN=127.0.0.1']);
  ssl(['x509', '-req', '-in', srvCsr, '-CA', caCrt, '-CAkey', caKey, '-CAcreateserial',
       '-out', srvCrt, '-days', '1', '-sha256', '-extfile', ext]);

  return { dir, caFile: caCrt, certFile: srvCrt, keyFile: srvKey };
}

export interface Authority {
  /** Directorio 0700 fuera del repo donde vive la clave operativa 0600. */
  dir: string;
  /** Ruta del PEM PKCS#8 de la clave OPERATIVA (0600). */
  operationalKeyFile: string;
  operationalKeyId: string;
  /** SPKI DER en base64url de la operativa, tal y como viaja en el contrato. */
  operationalPublicKeySpki: string;
  /** Punto SEC1 no comprimido (65 bytes) de la RAÍZ, en base64url. Es lo que
   *  el utillaje de fábrica graba en el dispositivo. */
  rootPublicKeySec1: string;
  rootKeyId: string;
  delegation: DelegationCredential;
}

function sec1Base64Url(pub: KeyObject): string {
  // El SPKI DER de P-256 lleva una cabecera fija de 26 bytes y a continuación
  // el punto SEC1 no comprimido de 65 bytes (0x04 || X || Y). Se extrae por
  // longitud y se comprueba el 0x04: es lo mismo que hace
  // `diana_prov_decode_pubkey` en el firmware, y por eso ambos tienen que
  // coincidir byte a byte o la delegación no verifica.
  const der = pub.export({ type: 'spki', format: 'der' }) as Buffer;
  const point = der.subarray(der.length - 65);
  if (point.length !== 65 || point[0] !== 0x04) {
    throw new Error('la clave raíz no produjo un punto SEC1 no comprimido de 65 bytes');
  }
  return point.toString('base64url');
}

/**
 * Genera raíz + operativa y firma la credencial de delegación con la RAÍZ.
 *
 * La firma es P1363 (r||s, 64 bytes) en base64url, que es lo único que
 * `diana_p256_verify_message` acepta. El dominio de firma de la delegación es
 * distinto del de la orden a propósito: ninguna firma de una vale en la otra.
 */
export function generateAuthority(systemId: string): Authority {
  const dir = mkdtempSync(path.join(tmpdir(), 'diana-e2e-auth-'));
  const root = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const operational = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

  const operationalKeyFile = path.join(dir, 'operational.pem');
  writeFileSync(
    operationalKeyFile,
    operational.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    { mode: 0o600 },
  );

  const operationalPublicKeySpki = (
    createPublicKey(operational.privateKey).export({ type: 'spki', format: 'der' }) as Buffer
  ).toString('base64url');

  const rootKeyId = 'root-key-e2e';
  const operationalKeyId = 'op-key-e2e';
  const base = {
    delegationVersion: 1n,
    delegationId: 'de1e6a71-0000-4000-8000-00000000e2e3',
    rootKeyId,
    operationalKeyId,
    operationalPublicKey: operationalPublicKeySpki,
    scope: 'DIANA_PROVISIONING',
    delegationSequence: 1n,
    systemId,
  };

  const signer = createSign('sha256');
  signer.update(canonicalizeDelegation(base));
  signer.end();
  const rootSignature = signer
    .sign({ key: root.privateKey, dsaEncoding: 'ieee-p1363' })
    .toString('base64url');

  return {
    dir,
    operationalKeyFile,
    operationalKeyId,
    operationalPublicKeySpki,
    rootPublicKeySec1: sec1Base64Url(createPublicKey(root.privateKey)),
    rootKeyId,
    delegation: { ...base, rootSignature },
  };
}
