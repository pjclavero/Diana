import { apiClient } from "../../api";
import { DEFAULT_SYSTEM_ID } from "../../config";
import { useAsync } from "../../hooks/useAsync";
import { Card, ErrorState, LoadingState } from "../../components/ui/Feedback";

const STATE_LABEL: Record<string, string> = {
  boot: "Arrancando",
  ready: "Listo",
  degraded: "Degradado",
  conflict: "En conflicto",
  game_active: "Partida en curso",
  maintenance: "Mantenimiento",
  error: "Error",
};

export function SystemStatusPage() {
  const { data, loading, error, reload } = useAsync(() => apiClient.getSystemStatus(DEFAULT_SYSTEM_ID), []);

  return (
    <div>
      <h1>Estado del sistema</h1>
      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <>
          <Card title={`Sistema ${data.system_id}`}>
            <dl className="kv-list">
              <div>
                <dt>Estado</dt>
                <dd>
                  <strong>{STATE_LABEL[data.state] ?? data.state}</strong>
                </dd>
              </div>
              <div>
                <dt>Módulo coordinador</dt>
                <dd>{data.coordinator_module_id ?? "sin asignar"}</dd>
              </div>
              <div>
                <dt>Módulos en línea</dt>
                <dd>
                  {data.modules_online} / {data.modules_expected}
                </dd>
              </div>
              <div>
                <dt>Partida activa</dt>
                <dd>{data.active_game_id ?? "ninguna"}</dd>
              </div>
              <div>
                <dt>Hora del backend</dt>
                <dd>{new Date(data.backend_time_ms).toLocaleString("es-ES")}</dd>
              </div>
            </dl>
          </Card>

          <Card title="Conflictos">
            {data.conflicts.length === 0 ? (
              <p>Sin conflictos detectados.</p>
            ) : (
              <ul>
                {data.conflicts.map((c) => (
                  <li key={c} role="alert">
                    {c}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
