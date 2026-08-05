/**
 * Árbol de tópicos MQTT v1 (contrato §1 y §2, dosier 15.1).
 * CONGELADO: cualquier cambio exige v2 y ADR.
 */

export const TOPIC_ROOT = 'targets/v1';

export const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9-]{2,62}$/;

export type TopicKind =
  | 'system-status'
  | 'system-command'
  | 'game-state'
  | 'game-event'
  | 'module-presence'
  | 'module-status'
  | 'module-telemetry'
  | 'module-config-desired'
  | 'module-config-reported'
  | 'module-command'
  | 'module-maintenance-command'
  | 'module-hit'
  | 'module-diagnostic'
  | 'module-ota';

/** Esquema JSON que gobierna cada tipo de tópico. */
export const TOPIC_SCHEMA: Record<TopicKind, string> = {
  'system-status': 'system-status.schema.json',
  'system-command': 'system-command.schema.json',
  'game-state': 'game-state.schema.json',
  'game-event': 'game-event.schema.json',
  'module-presence': 'module-presence.schema.json',
  'module-status': 'module-status.schema.json',
  'module-telemetry': 'module-telemetry.schema.json',
  'module-config-desired': 'module-config.schema.json',
  'module-config-reported': 'module-config.schema.json',
  'module-command': 'module-command.schema.json',
  'module-maintenance-command': 'module-maintenance-command.schema.json',
  'module-hit': 'hit-event.schema.json',
  'module-diagnostic': 'module-diagnostic.schema.json',
  'module-ota': 'ota-command.schema.json',
};

/** Tópicos a los que se suscribe el backend, con su QoS del contrato §2. */
export const BACKEND_SUBSCRIPTIONS: Array<{ filter: string; qos: 0 | 1 | 2 }> = [
  { filter: `${TOPIC_ROOT}/module/+/presence`, qos: 1 },
  { filter: `${TOPIC_ROOT}/module/+/status`, qos: 1 },
  { filter: `${TOPIC_ROOT}/module/+/telemetry`, qos: 0 },
  { filter: `${TOPIC_ROOT}/module/+/config/reported`, qos: 1 },
  { filter: `${TOPIC_ROOT}/module/+/hit`, qos: 1 },
  { filter: `${TOPIC_ROOT}/module/+/diagnostic`, qos: 1 },
  { filter: `${TOPIC_ROOT}/system/+/game/state`, qos: 1 },
  { filter: `${TOPIC_ROOT}/system/+/game/event`, qos: 1 },
];

export interface ParsedTopic {
  kind: TopicKind;
  /** `system_id` o `module_id` según el tópico. */
  id: string;
  schema: string;
  /** Retención esperada según el contrato §2. */
  retain: boolean;
  qos: 0 | 1;
}

const RETAINED: TopicKind[] = [
  'system-status',
  'game-state',
  'module-presence',
  'module-status',
  'module-config-desired',
  'module-config-reported',
];

const QOS0: TopicKind[] = ['module-telemetry'];

/** Devuelve `null` si el tópico no pertenece al contrato v1. */
export function parseTopic(topic: string): ParsedTopic | null {
  const parts = topic.split('/');
  if (parts.length < 5) return null;
  if (parts[0] !== 'targets' || parts[1] !== 'v1') return null;

  const scope = parts[2];
  const id = parts[3];
  if (!IDENTIFIER_PATTERN.test(id)) return null;

  const tail = parts.slice(4).join('/');
  let kind: TopicKind | null = null;

  if (scope === 'system') {
    if (tail === 'status') kind = 'system-status';
    else if (tail === 'command') kind = 'system-command';
    else if (tail === 'game/state') kind = 'game-state';
    else if (tail === 'game/event') kind = 'game-event';
  } else if (scope === 'module') {
    if (tail === 'presence') kind = 'module-presence';
    else if (tail === 'status') kind = 'module-status';
    else if (tail === 'telemetry') kind = 'module-telemetry';
    else if (tail === 'config/desired') kind = 'module-config-desired';
    else if (tail === 'config/reported') kind = 'module-config-reported';
    else if (tail === 'command') kind = 'module-command';
    else if (tail === 'maintenance/command') kind = 'module-maintenance-command';
    else if (tail === 'hit') kind = 'module-hit';
    else if (tail === 'diagnostic') kind = 'module-diagnostic';
    else if (tail === 'ota') kind = 'module-ota';
  }

  if (!kind) return null;

  return {
    kind,
    id,
    schema: TOPIC_SCHEMA[kind],
    retain: RETAINED.includes(kind),
    qos: QOS0.includes(kind) ? 0 : 1,
  };
}

export const topics = {
  systemStatus: (systemId: string) => `${TOPIC_ROOT}/system/${systemId}/status`,
  systemCommand: (systemId: string) => `${TOPIC_ROOT}/system/${systemId}/command`,
  gameState: (systemId: string) => `${TOPIC_ROOT}/system/${systemId}/game/state`,
  gameEvent: (systemId: string) => `${TOPIC_ROOT}/system/${systemId}/game/event`,
  modulePresence: (moduleId: string) => `${TOPIC_ROOT}/module/${moduleId}/presence`,
  moduleStatus: (moduleId: string) => `${TOPIC_ROOT}/module/${moduleId}/status`,
  moduleTelemetry: (moduleId: string) => `${TOPIC_ROOT}/module/${moduleId}/telemetry`,
  moduleConfigDesired: (moduleId: string) => `${TOPIC_ROOT}/module/${moduleId}/config/desired`,
  moduleConfigReported: (moduleId: string) => `${TOPIC_ROOT}/module/${moduleId}/config/reported`,
  moduleCommand: (moduleId: string) => `${TOPIC_ROOT}/module/${moduleId}/command`,
  /**
   * Canal EXCLUSIVO del backend (ampliación v1.1, README §0/§2.1). El
   * coordinador nunca publica aquí y el backend nunca publica en
   * `moduleCommand`: la autoridad se reparte por dominio, no por
   * disponibilidad. Ver `module-diagnostics.service.ts`.
   */
  moduleMaintenanceCommand: (moduleId: string) => `${TOPIC_ROOT}/module/${moduleId}/maintenance/command`,
  moduleHit: (moduleId: string) => `${TOPIC_ROOT}/module/${moduleId}/hit`,
  moduleDiagnostic: (moduleId: string) => `${TOPIC_ROOT}/module/${moduleId}/diagnostic`,
  moduleOta: (moduleId: string) => `${TOPIC_ROOT}/module/${moduleId}/ota`,
};
