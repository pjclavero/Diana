/** Constructores de tópicos conforme a contracts/mqtt/README.md §1. */
export const topics = {
  systemStatus: (systemId: string) => `targets/v1/system/${systemId}/status`,
  systemCommand: (systemId: string) => `targets/v1/system/${systemId}/command`,
  gameState: (systemId: string) => `targets/v1/system/${systemId}/game/state`,
  gameEvent: (systemId: string) => `targets/v1/system/${systemId}/game/event`,

  modulePresence: (moduleId: string) => `targets/v1/module/${moduleId}/presence`,
  moduleStatus: (moduleId: string) => `targets/v1/module/${moduleId}/status`,
  moduleTelemetry: (moduleId: string) => `targets/v1/module/${moduleId}/telemetry`,
  moduleConfigDesired: (moduleId: string) => `targets/v1/module/${moduleId}/config/desired`,
  moduleConfigReported: (moduleId: string) => `targets/v1/module/${moduleId}/config/reported`,
  moduleCommand: (moduleId: string) => `targets/v1/module/${moduleId}/command`,
  moduleHit: (moduleId: string) => `targets/v1/module/${moduleId}/hit`,
  moduleDiagnostic: (moduleId: string) => `targets/v1/module/${moduleId}/diagnostic`,
  moduleOta: (moduleId: string) => `targets/v1/module/${moduleId}/ota`,

  allModuleHits: () => 'targets/v1/module/+/hit',
  allModulePresence: () => 'targets/v1/module/+/presence',
  allModuleStatus: () => 'targets/v1/module/+/status',
  moduleCommandOf: (moduleId: string) => `targets/v1/module/${moduleId}/command`,
} as const;
