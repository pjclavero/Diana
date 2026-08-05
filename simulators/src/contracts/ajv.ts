import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
// ajv-formats no publica un "exports" moderno compatible con moduleResolution
// NodeNext: su import por defecto tipa mal (aunque funciona en runtime,
// donde CommonJS interop lo resuelve bien). Se tipa explícitamente aquí.
import addFormatsPkg from 'ajv-formats';
const addFormats = addFormatsPkg as unknown as (ajv: Ajv2020) => void;
import type { ValidateFunction } from 'ajv';

/**
 * Carga los esquemas MQTT congelados de contracts/ y expone un validador
 * por nombre de esquema (p.ej. "hit-event.schema.json").
 *
 * Localiza contracts/ subiendo desde este fichero: simulators/src/contracts/
 * -> simulators/ -> raíz del repo -> contracts/. Así funciona igual en
 * ts-node/tsx (ejecutando desde src/) que en dist/ tras compilar.
 */
function findContractsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'contracts');
    try {
      const stat = readdirSync(candidate);
      if (stat.includes('mqtt') && stat.includes('schemas')) {
        return candidate;
      }
    } catch {
      // sigue subiendo
    }
    dir = dirname(dir);
  }
  throw new Error(
    `No se ha encontrado contracts/ subiendo desde ${here}. ` +
      'El simulador debe ejecutarse dentro del repositorio Diana.',
  );
}

let cachedAjv: Ajv2020 | null = null;
const validators = new Map<string, ValidateFunction>();
// filename ("hit-event.schema.json") -> $id real del documento.
const idByFilename = new Map<string, string>();

/**
 * Registra cada esquema ÚNICAMENTE bajo su propio `$id` (hallazgo H-02 del
 * supervisor: registrar además por nombre de fichero o por una base
 * "mqtt/common.schema.json" enmascararía un `$ref` roto y dejaría pasar en
 * ajv lo que fallaría en cualquier otra herramienta). Desde el cambio de
 * contrato, los `$ref` de mqtt/*.schema.json son relativos
 * ("../schemas/common.schema.json#/...") y resuelven solos contra el `$id`
 * real de common.schema.json sin necesidad de atajos. Mismo criterio que
 * contracts/validate.py (load_registry).
 */
function buildAjv(): Ajv2020 {
  if (cachedAjv) return cachedAjv;

  const contractsDir = findContractsDir();
  // strict:false porque el propio contrato congelado (hit-event.schema.json,
  // system-command.schema.json, ota-command.schema.json) usa "allOf/if/then"
  // para exigir campos condicionalmente sin repetirlos en "properties" del
  // nivel raíz, lo cual el modo estricto de Ajv marca como sospechoso aunque
  // sea JSON Schema válido. No podemos tocar el esquema (está congelado).
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);

  const commonPath = join(contractsDir, 'schemas', 'common.schema.json');
  const common = JSON.parse(readFileSync(commonPath, 'utf-8'));
  if (!common.$id) throw new Error('common.schema.json no declara $id');
  ajv.addSchema(common); // clave = common.$id

  const mqttDir = join(contractsDir, 'mqtt');
  for (const file of readdirSync(mqttDir)) {
    if (!file.endsWith('.schema.json')) continue;
    const schema = JSON.parse(readFileSync(join(mqttDir, file), 'utf-8'));
    if (!schema.$id) throw new Error(`${file} no declara $id`);
    ajv.addSchema(schema); // clave = schema.$id
    idByFilename.set(file, schema.$id);
  }

  cachedAjv = ajv;
  return ajv;
}

/** Nombres de fichero de los esquemas MQTT congelados (contracts/mqtt/*.schema.json). */
export type SchemaName =
  | 'hit-event.schema.json'
  | 'module-status.schema.json'
  | 'module-presence.schema.json'
  | 'module-telemetry.schema.json'
  | 'module-command.schema.json'
  | 'module-maintenance-command.schema.json'
  | 'module-config.schema.json'
  | 'module-diagnostic.schema.json'
  | 'game-state.schema.json'
  | 'game-event.schema.json'
  | 'system-status.schema.json'
  | 'system-command.schema.json'
  | 'ota-command.schema.json';

function getValidator(schemaName: SchemaName): ValidateFunction {
  let v = validators.get(schemaName);
  if (!v) {
    const ajv = buildAjv();
    const id = idByFilename.get(schemaName);
    if (!id) {
      throw new Error(`Esquema no encontrado: ${schemaName}`);
    }
    const found = ajv.getSchema(id);
    if (!found) {
      throw new Error(`Esquema registrado pero no resoluble por $id: ${schemaName} (${id})`);
    }
    v = found;
    validators.set(schemaName, v);
  }
  return v;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Valida un payload contra un esquema congelado del contrato. No muta el payload. */
export function validateAgainstSchema(
  schemaName: SchemaName,
  payload: unknown,
): ValidationResult {
  const validate = getValidator(schemaName);
  const valid = validate(payload) as boolean;
  if (valid) {
    return { valid: true, errors: [] };
  }
  const errors = (validate.errors ?? []).map(
    (e) => `${e.instancePath || '(raíz)'} ${e.message ?? ''}`.trim(),
  );
  return { valid: false, errors };
}

/** Lanza si el payload no valida. Útil para "falla rápido" dentro del simulador. */
export function assertValid(schemaName: SchemaName, payload: unknown): void {
  const result = validateAgainstSchema(schemaName, payload);
  if (!result.valid) {
    throw new Error(
      `Payload inválido contra ${schemaName}:\n  ${result.errors.join('\n  ')}\n` +
        JSON.stringify(payload, null, 2),
    );
  }
}
