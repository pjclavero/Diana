/**
 * Sumidero de `targets/v1/module/{id}/config/reported`.
 *
 * Es un puerto y no una llamada directa por el mismo motivo que
 * `PROVISION_STATE_SINK`: la ingesta no debe conocer a Prisma, y sin puerto no
 * se puede probar el camino de ingesta sin base de datos.
 */
export const CONFIG_REPORTED_SINK = Symbol('CONFIG_REPORTED_SINK');

export type ConfigReportedOutcome = 'applied' | 'noop' | 'rejected' | 'unknown_module';

export interface ConfigReportedResult {
  outcome: ConfigReportedOutcome;
  reason: string;
  /** Versión reportada que consta tras procesar el mensaje. */
  reportedConfigVersion: number | null;
  desiredConfigVersion: number | null;
  configState: 'pending' | 'applied' | 'failed' | null;
}

export interface ConfigReportedSinkPort {
  /**
   * @param moduleSlug `module_id` del TÓPICO, no del payload.
   * @param configVersion versión que el módulo dice tener aplicada.
   * @param appliedAt marca declarada por el módulo (observacional, opcional).
   * @param receivedAt T3: instante de recepción, lo pone el backend.
   */
  record(
    moduleSlug: string,
    configVersion: number,
    appliedAt: Date | null,
    receivedAt: Date,
  ): Promise<ConfigReportedResult>;
}
