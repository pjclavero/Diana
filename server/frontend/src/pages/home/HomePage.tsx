import { Link } from "react-router-dom";
import { apiClient } from "../../api";
import { DEFAULT_SYSTEM_ID } from "../../config";
import { useAsync } from "../../hooks/useAsync";
import { useAuth } from "../../auth/AuthContext";
import { Card, ErrorState, LoadingState } from "../../components/ui/Feedback";
import { summarizeConflicts, systemStateLabel } from "../../api/systemStatusLabels";
import type { Incident } from "../../api/client";

/** Alertas que siguen abiertas. Función aparte para no recalcularla en línea. */
function alertasAbiertas(incidencias: Incident[]): Incident[] {
  return incidencias.filter((i) => !i.resolved);
}

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
  // OJO: aquí NO se puede desestructurar sólo `data`. Ése era el defecto:
  // con `error` descartado, un fallo de red y «no hay nada» quedaban
  // indistinguibles, y la tarjeta de alertas decía «Sin alertas activas» — la
  // frase más peligrosa que puede enseñar este panel — cuando lo cierto era
  // que no había podido preguntar.
  const modulesState = useAsync(() => apiClient.listModules(DEFAULT_SYSTEM_ID), []);
  const incidentsState = useAsync(() => apiClient.listIncidents(), []);

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
        {modulesState.loading && <LoadingState label="Cargando módulos…" />}
        {modulesState.error && <ErrorState message={modulesState.error} onRetry={modulesState.reload} />}
        {!modulesState.loading && !modulesState.error && modulesState.data && (
          <p>{modulesState.data.length} módulos respondiendo.</p>
        )}
        <p>
          <Link to="/modulos">Ver módulos</Link>
        </p>
      </Card>

      <Card title="Alertas">
        {incidentsState.loading && <LoadingState label="Consultando incidencias…" />}
        {incidentsState.error && (
          // «Sin alertas» y «no he podido preguntar» NO son lo mismo, y el
          // segundo es peor. Se dice cuál de los dos es.
          <ErrorState
            message={`No se ha podido consultar el registro de incidencias, así que NO se puede afirmar que no haya alertas. ${incidentsState.error}`}
            onRetry={incidentsState.reload}
          />
        )}
        {!incidentsState.loading && !incidentsState.error && incidentsState.data && (
          alertasAbiertas(incidentsState.data).length > 0 ? (
            <ul>
              {alertasAbiertas(incidentsState.data).map((i) => (
                <li key={i.id} role="alert">
                  [{i.severity}] {i.message} ({i.source})
                </li>
              ))}
            </ul>
          ) : (
            <p>Sin alertas activas (comprobado ahora mismo).</p>
          )
        )}
        <p>
          <Link to="/incidencias">Ver incidencias</Link>
        </p>
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
