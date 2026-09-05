/**
 * Canonicalización del plano DEVICE_MANAGEMENT (contrato v1.2, ADR-0008).
 *
 * REIMPLEMENTACIÓN INDEPENDIENTE de la referencia
 * `firmware/esp32/tools/gen_prov_vectors.py` (y del canonicalizador en C del
 * firmware). Que las tres coincidan byte a byte NO se supone: se comprueba
 * contra los vectores del firmware en `test/provisioning/canonical.spec.ts`.
 *
 * Reglas, todas ellas capaces de romper la firma si se tuercen un byte:
 *
 *  - Cada registro es `longitud(uint32 big-endian) ++ valor UTF-8`.
 *  - La longitud va en BYTES, no en caracteres (UTF-8 multibyte).
 *  - Campo AUSENTE ⇒ `0xFFFFFFFF` y ningún valor.
 *  - La CADENA VACÍA se trata EXACTAMENTE IGUAL que un campo ausente. No es un
 *    descuido: es la semántica vigente del contrato
 *    (CONTRACT_GAP-H4-EMPTY-VS-ABSENT) y aquí queda anclada para que una
 *    divergencia entre implementaciones se vea en el test en vez de aparecer
 *    como una firma que no verifica en campo.
 *  - Los números se canonicalizan por su representación decimal sin signo ni
 *    ceros a la izquierda; por eso el tipo es `bigint`: `provisioning_sequence`
 *    e `issued_at_ms` llegan a 2^64-1 y `number` los redondearía en silencio,
 *    que es justo el modo de fallo que rompe una firma sin avisar.
 *  - El orden de los registros es POSICIONAL: no hay nombres en la canónica.
 *    Reordenar dos campos produce otra cadena que firma igual de bien, así que
 *    el orden es contrato, no detalle de implementación.
 */

/** Marca de campo ausente. */
export const ABSENT = 0xffffffff;

export const DOMAIN_ORDER = 'diana/provision/v1';
export const DOMAIN_DELEGATION = 'diana/delegation/v1';
export const SIGNATURE_ALG = 'ECDSA-P256-SHA256-P1363-B64URL';
export const DELEGATION_SCOPE = 'DIANA_PROVISIONING';
export const COMMAND_PLANE = 'DEVICE_MANAGEMENT';
export const SCHEMA_VERSION = 1;

/** Valor canonicalizable: cadena, entero grande o ausencia. */
export type CanonValue = string | bigint | null | undefined;

/** `longitud(4, big-endian) ++ valor`; ausente (o vacío) ⇒ `0xFFFFFFFF`. */
export function record(value: CanonValue): Buffer {
  if (value === null || value === undefined || value === '') {
    const absent = Buffer.alloc(4);
    absent.writeUInt32BE(ABSENT, 0);
    return absent;
  }
  const text = typeof value === 'bigint' ? value.toString(10) : value;
  const body = Buffer.from(text, 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}

/** Campos que entran en la canónica de una ORDEN, en su orden posicional. */
export interface CanonicalOrder {
  action: 'PROVISION' | 'PREPARE' | 'COMMIT';
  mode?: 'NORMAL' | 'EMERGENCY' | null;
  systemId: string;
  deviceId: string;
  provisioningSequence: bigint;
  rotationId?: string | null;
  currentEpoch?: string | null;
  nextEpoch?: string | null;
  epoch?: string | null;
  issuedAtMs: bigint;
  provisioningKeyFingerprint: string;
  provisionId?: string | null;
}

export function canonicalizeOrder(order: CanonicalOrder): Buffer {
  return Buffer.concat([
    record(DOMAIN_ORDER),
    record(order.action),
    record(order.mode ?? null),
    record(order.systemId),
    record(order.deviceId),
    record(order.provisioningSequence),
    record(order.rotationId ?? null),
    record(order.currentEpoch ?? null),
    record(order.nextEpoch ?? null),
    record(order.epoch ?? null),
    record(order.issuedAtMs),
    record(order.provisioningKeyFingerprint),
    record(order.provisionId ?? null),
  ]);
}

/** Campos que entran en la canónica de una DELEGACIÓN. Dominio de firma propio. */
export interface CanonicalDelegation {
  delegationVersion: bigint;
  delegationId: string;
  rootKeyId: string;
  operationalKeyId: string;
  operationalPublicKey: string;
  scope: string;
  delegationSequence: bigint;
  systemId: string;
}

export function canonicalizeDelegation(delegation: CanonicalDelegation): Buffer {
  return Buffer.concat([
    record(DOMAIN_DELEGATION),
    record(delegation.delegationVersion),
    record(delegation.delegationId),
    record(delegation.rootKeyId),
    record(delegation.operationalKeyId),
    record(delegation.operationalPublicKey),
    record(delegation.scope),
    record(delegation.delegationSequence),
    record(delegation.systemId),
  ]);
}
