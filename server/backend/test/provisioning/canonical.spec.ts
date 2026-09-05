import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as path from 'node:path';

import {
  ABSENT,
  CanonicalOrder,
  canonicalizeDelegation,
  canonicalizeOrder,
  record,
} from '../../src/modules/provisioning/provisioning-canonical';

/**
 * La canonicalización del backend contra la REFERENCIA del firmware.
 *
 * No se compara contra una copia de los vectores: se IMPORTA
 * `firmware/esp32/tools/gen_prov_vectors.py` y se le piden sus propias
 * `canon_order`/`canon_deleg` sobre los mismos casos. Si alguien cambia la
 * referencia, este test cambia con ella; si alguien cambia sólo el backend,
 * se pone rojo. Comparar contra una copia congelada no distinguiría esas dos
 * cosas.
 *
 * Se compara el DIGEST y la LONGITUD, no una cadena legible: un byte de
 * diferencia en cualquier posición cambia el SHA-256, que es exactamente el
 * mismo criterio con el que una firma verifica o no.
 */

const TOOLS = path.resolve(__dirname, '../../../../firmware/esp32/tools');

interface PyCase {
  name: string;
  canon_len: number;
  canon_sha256: string;
}

/** Pide a la referencia Python los digests de sus propios vectores. */
function referenceDigests(): { orders: Record<string, PyCase>; delegations: Record<string, PyCase> } | null {
  const driver = `
import hashlib, json, sys
sys.path.insert(0, ${JSON.stringify(TOOLS)})
try:
    import gen_prov_vectors as g
except Exception as exc:            # cryptography ausente, p. ej.
    print(json.dumps({"unavailable": str(exc)}))
    raise SystemExit(0)

def digest(raw):
    return {"canon_len": len(raw), "canon_sha256": hashlib.sha256(raw).hexdigest()}

orders = {}
for c in [
    g.order("provision_ok", action="PROVISION", provisioning_sequence=10,
            epoch=g.EPOCH_A, provision_id=g.PROV_ID),
    g.order("prepare_ok", action="PREPARE", mode="NORMAL", provisioning_sequence=20,
            rotation_id=g.ROT_1, current_epoch=g.EPOCH_A, next_epoch=g.EPOCH_B),
    g.order("commit_ok", action="COMMIT", mode="EMERGENCY", provisioning_sequence=30,
            rotation_id=g.ROT_1),
    g.order("canon_minimo", action="PROVISION", provisioning_sequence=1),
    g.order("canon_seq_cero", action="PROVISION", provisioning_sequence=0),
    g.order("canon_seq_max", action="PROVISION",
            provisioning_sequence=18446744073709551615),
    g.order("canon_ts_cero", action="PROVISION", provisioning_sequence=2, issued_at_ms=0),
    g.order("canon_ts_max", action="PROVISION", provisioning_sequence=3,
            issued_at_ms=18446744073709551615),
    g.order("canon_todos_opcionales", action="COMMIT", mode="EMERGENCY",
            provisioning_sequence=4,
            rotation_id="11111111-1111-4111-8111-111111111111",
            current_epoch="22222222-2222-4222-8222-222222222222",
            next_epoch="33333333-3333-4333-8333-333333333333",
            epoch="44444444-4444-4444-8444-444444444444",
            provision_id="55555555-5555-4555-8555-555555555555"),
    g.order("canon_vacio_explicito", action="PROVISION", provisioning_sequence=5,
            rotation_id="", current_epoch="", provision_id=""),
    g.order("canon_vacio_ausente", action="PROVISION", provisioning_sequence=5),
    g.order("canon_utf8", action="PROVISION", provisioning_sequence=6,
            rotation_id="rotacion-\\u00f1-\\u20ac-\\u4e2d"),
    g.order("canon_un_byte_a", action="PROVISION", provisioning_sequence=7,
            rotation_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    g.order("canon_un_byte_b", action="PROVISION", provisioning_sequence=7,
            rotation_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab"),
]:
    d = digest(g.canon_order(c))
    d["name"] = c["name"]
    orders[c["name"]] = d

deleg = {
    "delegation_version": 1,
    "delegation_id": "dede1111-0000-4000-8000-000000000000",
    "root_key_id": "root-key-2026",
    "operational_key_id": "op-key-1",
    "operational_public_key": "QUJDREVG",
    "scope": g.SCOPE,
    "delegation_sequence": 1,
    "system_id": g.SYSTEM,
}
d = digest(g.canon_deleg(deleg))
d["name"] = "deleg_1"

print(json.dumps({"orders": orders, "delegations": {"deleg_1": d}}))
`;
  const out = execFileSync('python3', ['-c', driver], { encoding: 'utf8' });
  const parsed = JSON.parse(out) as Record<string, unknown>;
  if (parsed.unavailable) return null;
  return parsed as unknown as { orders: Record<string, PyCase>; delegations: Record<string, PyCase> };
}

const DEVICE = 'module-07';
const SYSTEM = 'system-a';
const FPRINT = '1f'.repeat(32);
const EPOCH_A = '11111111-1111-4111-8111-111111111111';
const EPOCH_B = '22222222-2222-4222-8222-222222222222';
const ROT_1 = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const PROV_ID = 'cccccccc-3333-4333-8333-cccccccccccc';

/** Mismos valores por defecto que `order()` de la referencia. */
function order(over: Partial<CanonicalOrder>): CanonicalOrder {
  return {
    action: 'PROVISION',
    mode: null,
    systemId: SYSTEM,
    deviceId: DEVICE,
    provisioningSequence: 1n,
    rotationId: null,
    currentEpoch: null,
    nextEpoch: null,
    epoch: null,
    issuedAtMs: 1750000000000n,
    provisioningKeyFingerprint: FPRINT,
    provisionId: null,
    ...over,
  };
}

const CASES: Record<string, CanonicalOrder> = {
  provision_ok: order({ provisioningSequence: 10n, epoch: EPOCH_A, provisionId: PROV_ID }),
  prepare_ok: order({
    action: 'PREPARE',
    mode: 'NORMAL',
    provisioningSequence: 20n,
    rotationId: ROT_1,
    currentEpoch: EPOCH_A,
    nextEpoch: EPOCH_B,
  }),
  commit_ok: order({
    action: 'COMMIT',
    mode: 'EMERGENCY',
    provisioningSequence: 30n,
    rotationId: ROT_1,
  }),
  canon_minimo: order({ provisioningSequence: 1n }),
  canon_seq_cero: order({ provisioningSequence: 0n }),
  canon_seq_max: order({ provisioningSequence: 18446744073709551615n }),
  canon_ts_cero: order({ provisioningSequence: 2n, issuedAtMs: 0n }),
  canon_ts_max: order({ provisioningSequence: 3n, issuedAtMs: 18446744073709551615n }),
  canon_todos_opcionales: order({
    action: 'COMMIT',
    mode: 'EMERGENCY',
    provisioningSequence: 4n,
    rotationId: '11111111-1111-4111-8111-111111111111',
    currentEpoch: '22222222-2222-4222-8222-222222222222',
    nextEpoch: '33333333-3333-4333-8333-333333333333',
    epoch: '44444444-4444-4444-8444-444444444444',
    provisionId: '55555555-5555-4555-8555-555555555555',
  }),
  canon_vacio_explicito: order({
    provisioningSequence: 5n,
    rotationId: '',
    currentEpoch: '',
    provisionId: '',
  }),
  canon_vacio_ausente: order({ provisioningSequence: 5n }),
  canon_utf8: order({ provisioningSequence: 6n, rotationId: 'rotacion-ñ-€-中' }),
  canon_un_byte_a: order({
    provisioningSequence: 7n,
    rotationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  }),
  canon_un_byte_b: order({
    provisioningSequence: 7n,
    rotationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
  }),
};

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

describe('canonicalización · registros con prefijo de longitud', () => {
  it('un campo ausente es 0xFFFFFFFF y nada más', () => {
    const expected = Buffer.from([0xff, 0xff, 0xff, 0xff]);
    expect(record(null)).toEqual(expected);
    expect(record(undefined)).toEqual(expected);
    expect(record(ABSENT.toString(16))).not.toEqual(expected);
  });

  it('la cadena VACÍA se canonicaliza EXACTAMENTE igual que un campo ausente', () => {
    // Semántica vigente del contrato (CONTRACT_GAP-H4-EMPTY-VS-ABSENT). Si
    // alguien la cambia en un lado y no en el otro, la firma deja de verificar
    // en campo; aquí se ve antes.
    expect(record('')).toEqual(record(null));
    expect(sha256(canonicalizeOrder(CASES.canon_vacio_explicito))).toBe(
      sha256(canonicalizeOrder(CASES.canon_vacio_ausente)),
    );
  });

  it('la longitud va en BYTES, no en caracteres', () => {
    const utf8 = record('ñ');            // 1 carácter, 2 bytes
    expect(utf8.readUInt32BE(0)).toBe(2);
    expect(utf8.length).toBe(6);
  });

  it('un solo byte de diferencia produce canónicas distintas', () => {
    expect(sha256(canonicalizeOrder(CASES.canon_un_byte_a))).not.toBe(
      sha256(canonicalizeOrder(CASES.canon_un_byte_b)),
    );
  });

  it('la secuencia máxima de uint64 no se redondea', () => {
    // Con `number` en vez de `bigint`, 18446744073709551615 se convertiría en
    // 18446744073709552000 y la canónica sería otra sin que nada avisara.
    const canon = canonicalizeOrder(CASES.canon_seq_max);
    expect(canon.includes(Buffer.from('18446744073709551615', 'utf8'))).toBe(true);
  });
});

describe('canonicalización · acuerdo byte a byte con la referencia del firmware', () => {
  const reference = referenceDigests();

  if (reference === null) {
    // NO MEDIDO, y se dice. Un `it.skip` silencioso dejaría creer que el
    // acuerdo con el firmware está comprobado cuando no lo está.
    it('NO MEDIDO: falta el módulo python `cryptography` para cargar la referencia', () => {
      expect(reference).toBeNull();
    });
    return;
  }

  it.each(Object.keys(CASES))('orden «%s» coincide con gen_prov_vectors.py', (name) => {
    const canon = canonicalizeOrder(CASES[name]);
    const expected = reference.orders[name];
    expect(expected).toBeDefined();
    expect(canon.length).toBe(expected.canon_len);
    expect(sha256(canon)).toBe(expected.canon_sha256);
  });

  it('la delegación tiene su PROPIO dominio de firma y también coincide', () => {
    const canon = canonicalizeDelegation({
      delegationVersion: 1n,
      delegationId: 'dede1111-0000-4000-8000-000000000000',
      rootKeyId: 'root-key-2026',
      operationalKeyId: 'op-key-1',
      operationalPublicKey: 'QUJDREVG',
      scope: 'DIANA_PROVISIONING',
      delegationSequence: 1n,
      systemId: SYSTEM,
    });
    expect(canon.length).toBe(reference.delegations.deleg_1.canon_len);
    expect(sha256(canon)).toBe(reference.delegations.deleg_1.canon_sha256);
  });

  it('CONTROL NEGATIVO: alterar un campo rompe el acuerdo', () => {
    // Sin esto, un test que compara digests podría estar comparando dos
    // constantes iguales por casualidad. Aquí se demuestra que sabe fallar.
    const mutated = canonicalizeOrder({ ...CASES.provision_ok, deviceId: 'module-08' });
    expect(sha256(mutated)).not.toBe(reference.orders.provision_ok.canon_sha256);
  });
});
