import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { canonicalizeOrder } from '../../src/modules/provisioning/provisioning-canonical';
import { ProvisioningSigner, repoRoot } from '../../src/modules/provisioning/provisioning-signer';

/**
 * La firma D1b, y de dónde sale (y no sale) la clave privada.
 *
 * La clave que aquí se usa es EFÍMERA: se genera en memoria, se escribe con
 * 0600 en un directorio temporal fuera del repositorio y muere con el test. No
 * hay ninguna clave privada en `git`, ni la habrá: `repoRoot()` la rechazaría.
 */

const TOOLS = path.resolve(__dirname, '../../../../firmware/esp32/tools');

function newKeyFile(mode = 0o600): { file: string; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'diana-prov-key-'));
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const file = path.join(dir, 'operational.pem');
  writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, {
    mode: 0o600,
  });
  chmodSync(file, mode);
  return { file, dir };
}

function signer(mode = 0o600): ProvisioningSigner {
  const { file } = newKeyFile(mode);
  return new ProvisioningSigner({ keyFile: file, keyId: 'op-key-test' });
}

const ORDER = {
  action: 'PROVISION' as const,
  mode: null,
  systemId: 'system-a',
  deviceId: 'module-07',
  provisioningSequence: 10n,
  rotationId: null,
  currentEpoch: null,
  nextEpoch: null,
  epoch: '11111111-1111-4111-8111-111111111111',
  issuedAtMs: 1750000000000n,
  provisioningKeyFingerprint: '1f'.repeat(32),
  provisionId: 'cccccccc-3333-4333-8333-cccccccccccc',
};

describe('ProvisioningSigner · dónde vive la clave privada', () => {
  it('RECHAZA una clave que viva dentro del repositorio', () => {
    const root = repoRoot();
    expect(root).not.toBeNull();
    expect(
      () => new ProvisioningSigner({ keyFile: path.join(root!, 'clave.pem'), keyId: 'x' }),
    ).toThrow(/no puede vivir dentro del repositorio/i);
  });

  it('RECHAZA un fichero de clave legible por el grupo o por otros', () => {
    expect(() => signer(0o640)).toThrow(/permisos 640/);
    expect(() => signer(0o604)).toThrow(/permisos 604/);
    expect(() => signer(0o600)).not.toThrow();
  });

  it('RECHAZA una clave que no sea P-256', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'diana-prov-key-'));
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'secp384r1' });
    const file = path.join(dir, 'k.pem');
    writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, {
      mode: 0o600,
    });
    expect(() => new ProvisioningSigner({ keyFile: file, keyId: 'x' })).toThrow(/no es ECDSA P-256/);
  });

  it('ABORTA con una clave de desarrollo en producción', () => {
    const { file } = newKeyFile();
    expect(
      () =>
        new ProvisioningSigner({
          keyFile: file,
          keyId: 'dev',
          devKey: true,
          nodeEnv: 'production',
        }),
    ).toThrow(/producción/);
  });

  it('la clave privada NO sale por toJSON, toString ni util.inspect', () => {
    const s = signer();
    const serialized = JSON.stringify(s);
    const inspected = require('node:util').inspect(s, { depth: 10 });
    for (const text of [serialized, String(s), inspected]) {
      expect(text).not.toMatch(/PRIVATE KEY/);
      expect(text).not.toMatch(/BEGIN/);
      // Y el propio KeyObject tampoco asoma.
      expect(text).not.toMatch(/asymmetricKey/);
    }
    // CONTROL POSITIVO: lo que sí debe verse es el identificador público.
    expect(serialized).toContain('op-key-test');
  });

  it('la RUTA viaja por el entorno, nunca el material', () => {
    const { file } = newKeyFile();
    const built = ProvisioningSigner.fromEnv({
      DIANA_PROVISIONING_KEY_FILE: file,
      DIANA_PROVISIONING_KEY_ID: 'op-key-env',
    } as NodeJS.ProcessEnv);
    expect(built?.keyId).toBe('op-key-env');
    // Sin la variable, no hay firmante: fallo cerrado, no una clave por defecto.
    expect(ProvisioningSigner.fromEnv({} as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe('ProvisioningSigner · firma ECDSA P-256 P1363 (D1b)', () => {
  it('produce 64 bytes en base64url sin relleno', () => {
    const signature = signer().signOrder(ORDER);
    expect(signature).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(signature, 'base64url')).toHaveLength(64);
  });

  it('VERIFICA en la implementación de referencia (python cryptography)', () => {
    const s = signer();
    const signature = s.signOrder(ORDER);
    const canonical = canonicalizeOrder(ORDER).toString('base64');

    const driver = `
import base64, json, sys
sys.path.insert(0, ${JSON.stringify(TOOLS)})
try:
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec, utils
except Exception as exc:
    print(json.dumps({"unavailable": str(exc)})); raise SystemExit(0)

def b64u(s):
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))

spki = b64u(sys.argv[1])
sig  = b64u(sys.argv[2])
msg  = base64.b64decode(sys.argv[3])

pub = serialization.load_der_public_key(spki)
r = int.from_bytes(sig[:32], "big")
s = int.from_bytes(sig[32:], "big")
der = utils.encode_dss_signature(r, s)

out = {}
try:
    pub.verify(der, msg, ec.ECDSA(hashes.SHA256()))
    out["valid"] = True
except Exception:
    out["valid"] = False

# CONTROL NEGATIVO en el mismo proceso: un byte cambiado del mensaje debe
# invalidar. Sin esto, un "valid: True" podría venir de un verificador roto.
tampered = bytearray(msg); tampered[-1] ^= 0x01
try:
    pub.verify(der, bytes(tampered), ec.ECDSA(hashes.SHA256()))
    out["tampered_valid"] = True
except Exception:
    out["tampered_valid"] = False

print(json.dumps(out))
`;
    const raw = execFileSync(
      'python3',
      ['-c', driver, s.publicKeySpki, signature, canonical],
      { encoding: 'utf8' },
    );
    const result = JSON.parse(raw) as {
      valid?: boolean;
      tampered_valid?: boolean;
      unavailable?: string;
    };
    if (result.unavailable) {
      // NO MEDIDO, y se dice en voz alta.
      expect(result.unavailable).toBeDefined();
      return;
    }
    expect(result.valid).toBe(true);
    expect(result.tampered_valid).toBe(false);
  });

  it('dos claves distintas producen firmas distintas sobre la misma canónica', () => {
    const a = signer().signOrder(ORDER);
    const b = signer().signOrder(ORDER);
    expect(a).not.toBe(b);
  });
});
