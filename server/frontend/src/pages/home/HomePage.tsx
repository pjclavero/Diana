import { Link } from "react-router-dom";
import { apiClient } from "../../api";
import { DEFAULT_SYSTEM_ID } from "../../config";
import { useAsync } from "../../hooks/useAsync";
import { useAuth } from "../../auth/AuthContext";
import { Card, ErrorState, LoadingState } from "../../components/ui/Feedback";
import { summarizeConflicts, systemStateLabel } from "../../api/systemStatusLabels";

/**
 * `system` se fusionó aquí (auditoría 2026-08-05 §4, decisión del operador):
 * era una pantalla aparte que sólo repetía y ampliaba lo que Inicio ya
 * mostraba. La tarjeta de Conflictos SE CONSERVA — el carril E acaba de
 * cablear la detección real en el backend (`GET /systems/:id/status`,
 * permiso `systems:read`) — pero ya no afirma «sin conflictos detectados»
 * a secas: dice qué se comprueba de verdad, para no confundir «no hay» con
 * «no se mira» (mismo defecto de fondo del proyecto, G4).
 */
export function HomePage() {
  const { can } = useAuth();
  const seesSystem = can("systems:read");
  const { data: system, loading, error, reload } = useAsync(() => apiClient.getSystemStatus(DEFAULT_SYSTEM_ID), []);
  const { data: modules } = useAsync(() => apiClient.listModules(DEFAULT_SYSTEM_ID), []);
  const { data: incidents } = useAsync(() => apiClient.listIncidents(), []);

  const conflictSummary = system ? summarizeConflicts(system.conflicts) : null;

  return (
    <div>
      <h1>Inicio</h1>

      {loading && <LoadingState label="Cargando estado general…" />}
      {error && <ErrorState message={error} onRetry={reload} />}

      {system && seesSystem && (
        <Card title={`Sistema ${system.name}`}>
          <dl className="kv-list">
            <div>
              <dt>Estado</dt>
              <dd>
                <strong>{systemStateLabel(system.state)}</strong>
              </dd>
            </div>
            <div>
              <dt>Módulo coordinador</dt>
              <dd>{system.coordinator_module_id ?? "sin asignar"}</dd>
            </div>
            <div>
              <dt>Módulos en línea</dt>
              <dd>
                {system.modules_online} / {system.modules_expected}
              </dd>
            </div>
            <div>
              <dt>Partida activa</dt>
              <dd>{system.active_game_id ?? "ninguna"}</dd>
            </div>
          </dl>
        </Card>
      )}

      {system && !seesSystem && (
        <Card title="Estado general">
          <p>
            Estado <strong>{systemStateLabel(system.state)}</strong>. Módulos en línea{" "}
            <strong>
              {system.modules_online} / {system.modules_expected}
            </strong>
            . Partida activa: <strong>{system.active_game_id ?? "ninguna"}</strong>.
          </p>
        </Card>
      )}

      {system && seesSystem && conflictSummary && (
        <Card title="Conflictos">
          {conflictSummary.messages.length > 0 ? (
            <ul>
              {conflictSummary.messages.map((m) => (
                <li key={m} role="alert">
                  {m}
                </li>
              ))}
            </ul>
          ) : (
            <p>Sin conflictos activos.</p>
          )}
          <p className="hint">{conflictSummary.scopeNote}</p>
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
