import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, ErrorState, LoadingState } from "../../components/ui/Feedback";
import { ApiError } from "../../api/client";
import { modulesOverview, type ModuleOverviewItem, type ModulesOverview } from "../../api/modulesApi";
import {
  diagnosticarModulo,
  estadoDeConfiguracion,
  estadoDeLista,
  recuentoPorEstado,
  type EstadoModulo,
} from "../../utils/estadoModulo";
import { AltaModuloCard, EdicionModuloCard } from "../../components/modules/ModuleFormCard";
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
  const [cargando, setCargando] = useState(true);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setCargando(true);
    try {
      setData(await modulesOverview());
    } catch (e) {
      // El dato viejo NO se conserva: si esto falla, la pantalla no puede
      // seguir enseñando la foto anterior como si fuera la de ahora.
      setData(null);
      setError(e instanceof ApiError ? e.userMessage : "No se han podido cargar los módulos.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const items = data?.items ?? [];
  // El "ahora" se congela por render: si no, dos módulos idénticos podrían
  // salir con estados distintos por unos milisegundos de diferencia.
  const ahora = new Date();
  const recuento = recuentoPorEstado(items, ahora);
  const estadoLista = estadoDeLista({ cargando, error, datos: data ? items : null });
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount - 1);
  const pageItems = items.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE);

  return (
    <div>
      <h1>Módulos</h1>

      {/* El alta va SIEMPRE visible, también con la lista vacía o en error: dar de
          alta el primer módulo es justo lo que hay que poder hacer cuando no hay
          ninguno. Al crear se recarga el resumen. */}
      <AltaModuloCard onCreado={load} />

      {estadoLista === "error" && (
        <ErrorState
          message={`${error} No se puede afirmar cuántos módulos hay ni cuántos están en línea: la consulta no llegó a responder.`}
          onRetry={load}
        />
      )}
      {estadoLista === "cargando" && <LoadingState label="Consultando módulos…" />}

      {estadoLista === "vacio" && (
        <Card title="Sin módulos registrados">
          <p>
            <strong>0 módulos registrados</strong> — comprobado ahora mismo contra el backend. No es un fallo
            de consulta: la respuesta llegó y venía vacía.
          </p>
          <p className="hint">
            Un módulo aparece aquí en cuanto se da de alta, aunque todavía no se haya conectado nunca (saldrá
            como «pendiente»).
          </p>
        </Card>
      )}

      {estadoLista === "con-datos" && (
        <>
          <div className="module-summary" role="group" aria-label="Resumen de módulos">
            <span className="module-summary__stat">
              <strong>{recuento.total}</strong> módulos
            </span>
            <span className="module-summary__stat module-summary__stat--ok">
              <strong>{recuento.online}</strong> en línea
            </span>
            <span className={`module-summary__stat ${recuento.stale > 0 ? "module-summary__stat--warn" : ""}`}>
              <strong>{recuento.stale}</strong> sin señal reciente
            </span>
            <span className="module-summary__stat">
              <strong>{recuento.offline}</strong> desconectados
            </span>
            <span className="module-summary__stat">
              <strong>{recuento.pendiente}</strong> pendientes de primera conexión
            </span>
            <span className={`module-summary__stat ${data!.summary.updatesPending > 0 ? "module-summary__stat--warn" : ""}`}>
              <strong>{data!.summary.updatesPending}</strong> con actualización pendiente
            </span>
          </div>
          <p className="hint">
            «En línea» se cuenta AQUÍ a partir de la última señal de cada módulo, no de la bandera del
            backend: un módulo que consta conectado pero lleva más de 90 s callado se cuenta como «sin señal
            reciente», no como en línea.
          </p>

          {pageItems.map((m) => (
            <ModuleRow key={m.id} module={m} ahora={ahora} expanded={expanded === m.id} onToggle={() => setExpanded((id) => (id === m.id ? null : m.id))} onCambiado={load} />
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

/**
 * Versión de configuración tal cual, sin adornar.
 *
 * `null` es un dato REAL del backend («el módulo nunca ha reportado ninguna»)
 * y se escribe `null`; `undefined` es «el backend no me lo ha mandado» y se
 * escribe «sin dato». Pintar los dos como «—» fue lo que permitió que la ficha
 * dijera «aplicada» sin que nadie pudiera comprobar contra qué.
 */
export function formatearVersion(v: number | string | null | undefined): string {
  if (v === undefined) return "sin dato";
  if (v === null) return "null";
  return `v${v}`;
}

/** Clase CSS de la insignia por estado. `stale` NO comparte color con `online`. */
const CLASE_INSIGNIA: Record<EstadoModulo, string> = {
  online: "badge--ok",
  stale: "badge--warn",
  offline: "badge--muted",
  pendiente: "badge--muted",
};

function ModuleRow({ module: m, ahora, expanded, onToggle, onCambiado }: { module: ModuleOverviewItem; ahora: Date; expanded: boolean; onToggle: () => void; onCambiado: () => void }) {
  const diag = diagnosticarModulo(m, ahora);
  const config = estadoDeConfiguracion(m);
  return (
    <Card title={m.friendlyName || m.slug}>
      <div className="module-row__head">
        <button type="button" className="module-row__toggle" aria-expanded={expanded} onClick={onToggle}>
          {expanded ? "▾" : "▸"} <code>{m.slug}</code>
        </button>
        <span className={`badge ${CLASE_INSIGNIA[diag.estado]}`} title={diag.motivo}>
          {diag.etiqueta}
        </span>
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
          <p>{diag.motivo}</p>
          <p>
            Configuración: <strong>{config.estado}</strong> — {config.motivo}
          </p>
          {/* LAS DOS VERSIONES, SIEMPRE Y CON EL NOMBRE DEL BACKEND.
              Antes sólo se pintaba el veredicto (`aplicada`/`pendiente`) y su
              frase, y en la rama `applied` esa frase no lleva ningún número:
              el operador veía «aplicada» sin poder decir CUÁL. Peor aún, no
              había forma de distinguir «reportada 7 = deseada 7» de «el
              backend dice applied y la reportada está a NULL», que es
              exactamente el desacuerdo que hay que poder ver.
              `null`/`undefined` se escriben como tales: un «—» ambiguo
              volvería a mezclar «no lo ha reportado nunca» con «no lo sé». */}
          <p className="module-row__versions">
            <code>desired_config_version</code>: <strong>{formatearVersion(m.desiredConfigVersion)}</strong>{" "}
            · <code>reported_config_version</code>:{" "}
            <strong>{formatearVersion(m.reportedConfigVersion)}</strong>
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
          <EdicionModuloCard
            moduleId={m.id}
            slug={m.slug}
            friendlyName={m.friendlyName}
            onCambiado={onCambiado}
          />
        </div>
      )}
    </Card>
  );
}
