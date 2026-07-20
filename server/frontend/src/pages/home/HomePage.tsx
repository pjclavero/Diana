import { Link } from "react-router-dom";
import { apiClient } from "../../api";
import { DEFAULT_SYSTEM_ID } from "../../config";
import { useAsync } from "../../hooks/useAsync";
import { Card, ErrorState, LoadingState } from "../../components/ui/Feedback";

export function HomePage() {
  const { data: system, loading, error, reload } = useAsync(() => apiClient.getSystemStatus(DEFAULT_SYSTEM_ID), []);
  const { data: modules } = useAsync(() => apiClient.listModules(DEFAULT_SYSTEM_ID), []);
  const { data: incidents } = useAsync(() => apiClient.listIncidents(), []);

  return (
    <div>
      <h1>Inicio</h1>

      {loading && <LoadingState label="Cargando estado general…" />}
      {error && <ErrorState message={error} onRetry={reload} />}

      {system && (
        <Card title="Estado general">
          <p>
            Sistema <strong>{system.system_id}</strong>: estado <strong>{system.state}</strong>. Módulos en línea{" "}
            <strong>
              {system.modules_online} / {system.modules_expected}
            </strong>
            . Partida activa: <strong>{system.active_game_id ?? "ninguna"}</strong>.
          </p>
          {system.conflicts.length > 0 && (
            <p role="alert">Conflictos detectados: {system.conflicts.join(", ")}</p>
          )}
        </Card>
      )}

      <Card title="Módulos conectados">
        <p>
          {modules ? `${modules.length} módulos respondiendo.` : "Cargando módulos…"} <Link to="/modulos">Ver módulos</Link>
        </p>
      </Card>

      <Card title="Alertas">
        {incidents && incidents.length > 0 ? (
          <ul>
            {incidents
              .filter((i) => !i.resolved)
              .map((i) => (
                <li key={i.id}>
                  [{i.severity}] {i.message} ({i.source})
                </li>
              ))}
          </ul>
        ) : (
          <p>Sin alertas activas.</p>
        )}
        <Link to="/incidencias">Ver incidencias</Link>
      </Card>

      <Card title="Accesos rápidos">
        <nav aria-label="Accesos rápidos">
          <ul>
            <li>
              <Link to="/topologia">Editor de matriz de módulos</Link>
            </li>
            <li>
              <Link to="/partidas/nueva">Crear partida</Link>
            </li>
            <li>
              <Link to="/modulos">Prueba y calibración de módulos</Link>
            </li>
          </ul>
        </nav>
      </Card>
    </div>
  );
}
