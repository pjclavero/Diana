import * as fs from 'fs';
import * as path from 'path';
import { resolveContractsDir } from '../../src/contracts/contracts-path';
import { topics } from '../../src/contracts/topics';

export interface ContractExample {
  /** Ruta relativa a contracts/examples, para nombrar la prueba. */
  name: string;
  schema: string;
  reason?: string;
  /** Payload sin las claves meta `_schema` y `_reason`. */
  payload: Record<string, unknown>;
  /** Tópico MQTT en el que ese payload viajaría. */
  topic: string;
}

const META_KEYS = ['_schema', '_reason'];

/** Tópico canónico de cada esquema, según la tabla del contrato §2. */
function topicFor(schema: string, payload: Record<string, unknown>): string {
  const rawModule = typeof payload.module_id === 'string' ? payload.module_id : 'module-01';
  const rawSystem = typeof payload.system_id === 'string' ? payload.system_id : 'system-a';
  // Si el identificador del payload es ilegal para MQTT, el tópico usa un
  // marcador legal: el rechazo debe venir del esquema, no del parseo del tópico.
  const legal = /^[a-z0-9][a-z0-9-]{2,62}$/;
  const moduleId = legal.test(rawModule) ? rawModule : 'module-placeholder';
  const systemId = legal.test(rawSystem) ? rawSystem : 'system-placeholder';

  switch (schema) {
    case 'hit-event.schema.json':
      return topics.moduleHit(moduleId);
    case 'module-presence.schema.json':
      return topics.modulePresence(moduleId);
    case 'module-status.schema.json':
      return topics.moduleStatus(moduleId);
    case 'module-telemetry.schema.json':
      return topics.moduleTelemetry(moduleId);
    case 'module-config.schema.json':
      return topics.moduleConfigReported(moduleId);
    case 'module-command.schema.json':
      return topics.moduleCommand(moduleId);
    case 'module-diagnostic.schema.json':
      return topics.moduleDiagnostic(moduleId);
    case 'ota-command.schema.json':
      return topics.moduleOta(moduleId);
    case 'system-status.schema.json':
      return topics.systemStatus(systemId);
    case 'system-command.schema.json':
      return topics.systemCommand(systemId);
    case 'game-state.schema.json':
      return topics.gameState(systemId);
    case 'game-event.schema.json':
      return topics.gameEvent(systemId);
    default:
      throw new Error(`Sin tópico conocido para el esquema ${schema}`);
  }
}

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith('.json') ? [full] : [];
  });
}

export function loadExamples(kind: 'valid' | 'invalid'): ContractExample[] {
  const root = path.join(resolveContractsDir(), 'examples', kind);
  return walk(root)
    .sort()
    .map((file) => {
      const doc = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
      const schema = doc._schema as string;
      if (!schema) throw new Error(`${file}: falta la clave _schema`);
      const payload: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(doc)) {
        if (!META_KEYS.includes(key)) payload[key] = value;
      }
      return {
        name: path.relative(root, file),
        schema,
        reason: doc._reason as string | undefined,
        payload,
        topic: topicFor(schema, payload),
      };
    });
}
