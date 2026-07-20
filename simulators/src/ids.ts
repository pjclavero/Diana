import { randomUUID } from 'node:crypto';
import type { Rng } from './rng.js';

/**
 * UUIDv4 no determinista, para uso fuera de escenarios reproducibles
 * (p.ej. CLI interactiva sin semilla fija).
 */
export function uuid(): string {
  return randomUUID();
}

const HEX = '0123456789abcdef';

/**
 * UUIDv4 determinista derivado de un Rng con semilla. Cumple el patrón
 * de common.schema.json#/$defs/uuid (versión y variante correctas), y con
 * la misma semilla produce siempre la misma secuencia de identificadores.
 */
export function seededUuid(rng: Rng): string {
  const bytes = new Array<number>(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = rng.int(0, 255);
  }
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40; // versión 4
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80; // variante RFC 4122

  let out = '';
  for (let i = 0; i < 16; i++) {
    const b = bytes[i] as number;
    out += HEX[(b >> 4) & 0xf];
    out += HEX[b & 0xf];
    if (i === 3 || i === 5 || i === 7 || i === 9) out += '-';
  }
  return out;
}
