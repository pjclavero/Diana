import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, ErrorState, LoadingState } from "../../components/ui/Feedback";
import { ApiError } from "../../api/client";
import { modulesOverview, type ModuleOverviewItem, type ModulesOverview } from "../../api/modulesApi";
import "./ModulesPage.css";

const MODULE_STATE_LABEL: Record<string, string> = {
  boot: "Arrancando",
  selftest: "Autodiagnóstico",
  network: "Conectando red",
  registering: "Registrando",
  ready: "Listo",
  calibration: "Calibrando",
  maintenance: "Mantenimiento",
  game_prepare: "Preparando partida",
  game_countdown: "Cuenta atrás",
  game_active: "Partida activa",
  game_paused: "Partida en pausa",
  game_finished: "Partida finalizada",
  error: "Error",
};

const ROLE_LABEL: Record<string, string> = { principal: "Principal", satellite: "Satélite", auto: "Automático" };

const PAGE_SIZE = 9;

/**
 * G-C · Dashboard de módulos (datos REALES vía /modules/overview). Muestra un
 * resumen (total, en línea, actualizaciones pendientes), la lista paginada de
 * módulos (adiós al scroll infinito con muchos módulos) y, al pinchar uno, expande
 * en la misma ventana su panel con más información, sus acciones y "Actualizar"
 * cuando hay una versión firmada pendiente.
 */
export function ModulesPage() {
  const [data, setData] = useState<ModulesOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await modulesOverview());
    } catch (e) {
      setError(e instanceof ApiError ? e.userMessage : "No se han podido cargar los módulos.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const items = data?.items ?? [];
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount - 1);
  const pageItems = items.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE);

  return (
    <div>
      <h1>Módulos conectados</h1>

      {error && <ErrorState message={error} onRetry={load} />}
      {!data && !error && <LoadingState />}

      {data && (
        <>
          <div className="module-summary" role="group" aria-label="Resumen de módulos">
            <span className="module-summary__stat">
              <strong>{data.summary.total}</strong> módulos
            </span>
            <span className="module-summary__stat module-summary__stat--ok">
              <strong>{data.summary.online}</strong> en línea
            </span>
            <span className="module-summary__stat">
              <strong>{data.summary.offline}</strong> desconectados
            </span>
            <span className={`module-summary__stat ${data.summary.updatesPending > 0 ? "module-summary__stat--warn" : ""}`}>
              <strong>{data.summary.updatesPending}</strong> con actualización pendiente
            </span>
          </div>

          {items.length === 0 && <p>No hay módulos {data.summary.total === 0 ? "registrados" : "para mostrar"}.</p>}

          {pageItems.map((m) => (
            <ModuleRow key={m.id} module={m} expanded={expanded === m.id} onToggle={() => setExpanded((id) => (id === m.id ? null : m.id))} />
          ))}

          {pageCount > 1 && (
            <nav className="module-pager" aria-label="Paginación de módulos">
              <button type="button" disabled={clampedPage === 0} onClick={() => setPage(clampedPage - 1)}>
                ← Anteriores
              </button>
              <span>
                Página {clampedPage + 1} de {pageCount}
              </span>
              <button type="button" disabled={clampedPage >= pageCount - 1} onClick={() => setPage(clampedPage + 1)}>
                Siguientes →
              </button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}

function ModuleRow({ module: m, expanded, onToggle }: { module: ModuleOverviewItem; expanded: boolean; onToggle: () => void }) {
  return (
    <Card title={m.friendlyName || m.slug}>
      <div className="module-row__head">
        <button type="button" className="module-row__toggle" aria-expanded={expanded} onClick={onToggle}>
          {expanded ? "▾" : "▸"} <code>{m.slug}</code>
        </button>
        <span className={`badge ${m.online ? "badge--ok" : "badge--muted"}`}>{m.online ? "en línea" : "desconectado"}</span>
        <span>{MODULE_STATE_LABEL[m.state ?? ""] ?? m.state ?? "—"}</span>
        <span>firmware {m.firmwareVersion ?? "—"}</span>
        {m.updateAvailable && (
          <Link to="/firmware" className="badge badge--warn" title={`Disponible ${m.latestSignedVersion}`}>
            Actualización disponible
          </Link>
        )}
      </div>

      {expanded && (
        <div className="module-row__detail">
          <p>
            Rol: {ROLE_LABEL[m.role ?? ""] ?? m.role ?? "—"} · Posición: {m.position ? `(${m.position.x}, ${m.position.y})` : "sin asignar"}
            {m.maintenance ? " · en mantenimiento" : ""}
          </p>
          <p>
            Dueño: {m.owner ? <strong>{m.owner.displayName || m.owner.username}</strong> : <em>sin vincular</em>} · Última señal:{" "}
            {m.lastSeenAt ? new Date(m.lastSeenAt).toLocaleString("es-ES") : "—"}
          </p>
          <nav className="module-row__actions" aria-label={`Acciones de ${m.slug}`}>
            <Link to={`/modulos/${m.id}`}>Ver 9 dianas</Link>
            <Link to={`/modulos/${m.id}/calibracion`}>Calibración</Link>
            <Link to={`/modulos/${m.id}/prueba-sensores`}>Prueba sensores</Link>
            <Link to={`/modulos/${m.id}/prueba-leds`}>Prueba LED</Link>
            {m.updateAvailable && (
              <Link to="/firmware" className="module-row__update">
                Actualizar → {m.latestSignedVersion}
              </Link>
            )}
          </nav>
        </div>
      )}
    </Card>
  );
}
