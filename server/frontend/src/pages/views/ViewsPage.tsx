import { useCallback, useEffect, useState } from "react";
import { Card, ErrorState, LoadingState } from "../../components/ui/Feedback";
import { ApiError } from "../../api/client";
import {
  addViewPanel,
  createView,
  deleteView,
  dueloReadiness,
  listPanels,
  listViews,
  removeViewPanel,
  type Panel,
  type View,
} from "../../api/viewsApi";

/**
 * G-H · Vistas: agrupan varios PANELES para jugar sobre todos a la vez (Opción B).
 * Muestra cada vista con sus paneles y si sirve para un DUELO (todos los paneles con
 * los mismos módulos — mismos elementos por jugador).
 */
export function ViewsPage() {
  const [views, setViews] = useState<View[] | null>(null);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [duelo, setDuelo] = useState<Record<string, { ready: boolean; reason: string | null }>>({});
  const [addSel, setAddSel] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      setViews(await listViews());
    } catch (e) {
      setError(e instanceof ApiError ? e.userMessage : "No se han podido cargar las vistas.");
    }
  }, []);

  useEffect(() => {
    void load();
    listPanels().then(setPanels).catch(() => setPanels([]));
  }, [load]);

  async function act(fn: () => Promise<unknown>, key: string) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.userMessage : "La operación no se ha podido completar.");
    } finally {
      setBusy(null);
    }
  }

  function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    void act(() => createView(name.trim()).then(() => setName("")), "create");
  }

  async function checkDuelo(id: string) {
    setBusy(`duelo-${id}`);
    try {
      const r = await dueloReadiness(id);
      setDuelo((d) => ({ ...d, [id]: { ready: r.ready, reason: r.reason } }));
    } catch (e) {
      setError(e instanceof ApiError ? e.userMessage : "No se ha podido comprobar el duelo.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <h1>Vistas (grupos de paneles)</h1>
      <p>Agrupa varios paneles para jugar una partida sobre todos a la vez. Un panel es un grupo de módulos (3×3).</p>

      <Card title="Nueva vista">
        <form onSubmit={create} className="inline-form">
          <label>
            Nombre <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <button type="submit" disabled={busy === "create"}>
            {busy === "create" ? "Creando…" : "Crear vista"}
          </button>
        </form>
      </Card>

      {error && <ErrorState message={error} onRetry={load} />}
      {!views && !error && <LoadingState />}
      {views && views.length === 0 && <p>Aún no hay vistas.</p>}

      {views?.map((v) => {
        const available = panels.filter((p) => !v.panels.some((vp) => vp.targetSystemId === p.id));
        const d = duelo[v.id];
        return (
          <Card key={v.id} title={v.name}>
            {v.panels.length === 0 ? (
              <p>Sin paneles todavía.</p>
            ) : (
              <ul>
                {v.panels.map((p) => (
                  <li key={p.targetSystemId}>
                    <strong>{p.name}</strong> · {p.moduleCount} módulos{" "}
                    <button type="button" disabled={busy === v.id} onClick={() => act(() => removeViewPanel(v.id, p.targetSystemId), v.id)}>
                      Quitar
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="inline-form">
              <label>
                Añadir panel{" "}
                <select value={addSel[v.id] ?? ""} onChange={(e) => setAddSel((s) => ({ ...s, [v.id]: e.target.value }))}>
                  <option value="">— elige panel —</option>
                  {available.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" disabled={!addSel[v.id] || busy === v.id} onClick={() => act(() => addViewPanel(v.id, addSel[v.id]), v.id)}>
                Añadir
              </button>
              <button type="button" disabled={busy === `duelo-${v.id}`} onClick={() => checkDuelo(v.id)}>
                ¿Vale para duelo?
              </button>
              <button type="button" disabled={busy === v.id} onClick={() => act(() => deleteView(v.id), v.id)}>
                Borrar vista
              </button>
            </div>

            {d && (
              <p role="status">
                {d.ready ? (
                  <span className="badge badge--ok">Válida para duelo</span>
                ) : (
                  <>
                    <span className="badge badge--warn">No vale para duelo</span> — {d.reason}
                  </>
                )}
              </p>
            )}
          </Card>
        );
      })}
    </div>
  );
}
