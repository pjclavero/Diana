import Ajv2020, { ErrorObject, ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import * as fs from 'fs';
import * as path from 'path';
import { resolveContractsDir } from './contracts-path';

/** Versión de esquema soportada por este backend (contrato §7). */
export const SUPPORTED_SCHEMA_VERSION = 1;

export type RejectionCode =
  | 'invalid_json'
  | 'unknown_schema'
  | 'not_an_object'
  | 'schema_version_missing'
  | 'schema_version_unsupported'
  | 'schema_violation';

export type ValidationOutcome<T = Record<string, unknown>> =
  | { ok: true; value: T }
  | { ok: false; code: RejectionCode; message: string; errors: string[] };

const MQTT_BASE = 'https://diana.seccionnueve/contracts/mqtt/';
const SCHEMAS_BASE = 'https://diana.seccionnueve/contracts/schemas/';

/**
 * Validación ESTRICTA de payloads contra los esquemas congelados de
 * `contracts/`.
 *
 * Reglas del contrato §7 que se aplican aquí:
 *  - `schema_version` mayor que el soportado ⇒ RECHAZO explícito
 *    (`schema_version_unsupported`), que además se registra como incidencia.
 *  - Campos desconocidos ⇒ rechazo, porque los esquemas declaran
 *    `additionalProperties: false`. Inyectar `received_at` en un payload es
 *    por tanto un error detectable (ADR-0002).
 */
export class ContractValidator {
  private readonly ajv: Ajv2020;
  private readonly validators = new Map<string, ValidateFunction>();
  readonly contractsDir: string;

  constructor(contractsDir: string = resolveContractsDir()) {
    this.contractsDir = contractsDir;
    this.ajv = new Ajv2020({
      strict: false,
      allErrors: true,
      allowUnionTypes: true,
      validateFormats: true,
    });
    addFormats(this.ajv as never);
    this.loadSchemas();
  }

  private loadSchemas(): void {
    const mqttDir = path.join(this.contractsDir, 'mqtt');
    const schemasDir = path.join(this.contractsDir, 'schemas');

    const files: Array<{ dir: string; base: string }> = [];
    for (const file of fs.readdirSync(mqttDir).filter((f) => f.endsWith('.schema.json'))) {
      files.push({ dir: mqttDir, base: file });
    }
    if (fs.existsSync(schemasDir)) {
      for (const file of fs.readdirSync(schemasDir).filter((f) => f.endsWith('.schema.json'))) {
        files.push({ dir: schemasDir, base: file });
      }
    }

    for (const { dir, base } of files) {
      const doc = JSON.parse(fs.readFileSync(path.join(dir, base), 'utf8')) as Record<string, unknown>;
      // Los $ref son relativos ('common.schema.json#/$defs/x') y se resuelven
      // contra el $id del esquema que los contiene. common.schema.json vive en
      // schemas/ pero lo referencian esquemas de mqtt/: se registra bajo ambas
      // bases y bajo su nombre de fichero.
      this.addAs(doc, base);
      this.addAs(doc, MQTT_BASE + base);
      this.addAs(doc, SCHEMAS_BASE + base);
    }
  }

  private addAs(doc: Record<string, unknown>, id: string): void {
    if (this.ajv.getSchema(id)) return;
    const clone = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
    clone.$id = id;
    this.ajv.addSchema(clone, id);
  }

  /** Nombres de esquema disponibles (ficheros de contracts/mqtt). */
  schemaNames(): string[] {
    return fs
      .readdirSync(path.join(this.contractsDir, 'mqtt'))
      .filter((f) => f.endsWith('.schema.json'))
      .sort();
  }

  private validatorFor(schemaName: string): ValidateFunction | null {
    const cached = this.validators.get(schemaName);
    if (cached) return cached;
    const compiled = this.ajv.getSchema(MQTT_BASE + schemaName);
    if (!compiled) return null;
    this.validators.set(schemaName, compiled);
    return compiled;
  }

  /** Valida un objeto ya deserializado. */
  validate<T = Record<string, unknown>>(schemaName: string, payload: unknown): ValidationOutcome<T> {
    const validator = this.validatorFor(schemaName);
    if (!validator) {
      return {
        ok: false,
        code: 'unknown_schema',
        message: `Esquema desconocido: ${schemaName}`,
        errors: [],
      };
    }

    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      return {
        ok: false,
        code: 'not_an_object',
        message: 'El payload no es un objeto JSON',
        errors: [],
      };
    }

    const record = payload as Record<string, unknown>;

    // Contrato §7: la versión se comprueba ANTES que el resto para poder
    // distinguir "mensaje de una versión futura" de "mensaje mal formado".
    if (!('schema_version' in record)) {
      return {
        ok: false,
        code: 'schema_version_missing',
        message: 'Falta schema_version',
        errors: [],
      };
    }
    const version = record.schema_version;
    if (typeof version !== 'number' || !Number.isInteger(version)) {
      return {
        ok: false,
        code: 'schema_version_missing',
        message: `schema_version debe ser un entero, recibido: ${JSON.stringify(version)}`,
        errors: [],
      };
    }
    if (version > SUPPORTED_SCHEMA_VERSION) {
      return {
        ok: false,
        code: 'schema_version_unsupported',
        message:
          `schema_version=${version} es superior a la soportada (${SUPPORTED_SCHEMA_VERSION}). ` +
          'El receptor rechaza el mensaje y registra una incidencia (contrato §7).',
        errors: [],
      };
    }

    const valid = validator(record);
    if (!valid) {
      return {
        ok: false,
        code: 'schema_violation',
        message: `El payload no cumple ${schemaName}`,
        errors: formatErrors(validator.errors),
      };
    }

    return { ok: true, value: record as T };
  }

  /** Valida un buffer/cadena MQTT: deserializa y valida. */
  validateRaw<T = Record<string, unknown>>(
    schemaName: string,
    raw: Buffer | string,
  ): ValidationOutcome<T> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'));
    } catch (error) {
      return {
        ok: false,
        code: 'invalid_json',
        message: `JSON no deserializable: ${(error as Error).message}`,
        errors: [],
      };
    }
    return this.validate<T>(schemaName, parsed);
  }
}

export function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  if (!errors) return [];
  return errors.map((e) => {
    const details: string[] = [];
    const params = (e.params ?? {}) as Record<string, unknown>;
    if (typeof params.additionalProperty === 'string') {
      details.push(`campo desconocido: ${params.additionalProperty}`);
    }
    if (Array.isArray(params.missingProperty) || typeof params.missingProperty === 'string') {
      details.push(`falta: ${String(params.missingProperty)}`);
    }
    if (Array.isArray(params.allowedValues)) {
      details.push(`admitidos: ${(params.allowedValues as unknown[]).join(', ')}`);
    }
    const suffix = details.length > 0 ? ` (${details.join('; ')})` : '';
    return `${e.instancePath || '/'} ${e.message ?? ''}${suffix}`.trim();
  });
}

let singleton: ContractValidator | null = null;

/** Instancia compartida: compilar los esquemas es caro y son inmutables. */
export function getContractValidator(): ContractValidator {
  if (!singleton) singleton = new ContractValidator();
  return singleton;
}
