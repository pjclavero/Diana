import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { Card, ErrorState, LoadingState } from "../../components/ui/Feedback";
import { ApiError } from "../../api/client";
import { linkModule, listModules, listMyModules, listUsers, unlinkModule, type ModuleEntity, type UserOption } from "../../api/modulesApi";

/**
 * F2 · Propiedad de módulos (datos REALES). El admin vincula/desvincula cualquier
 * módulo; el gestor ve y desvincula los suyos. Vincular un módulo a un jugador lo
 * convierte en gestor; desvincular el último lo devuelve a jugador (lo aplica el backend).
 */
export function ModuleOwnershipPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole("administrador");

  const [modules, setModules] = useState<ModuleEntity[] | null>(null);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [selection, setSelection] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      const mods = isAdmin ? await listModules() : await listMyModules();
      setModules(mods);
      if (isAdmin) setUsers(await listUsers());
    } catch (e) {
      setError(e instanceof ApiError ? e.userMessage : "No se han podido cargar los módulos.");
    }
  }, [isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: () => Promise<unknown>, moduleId: string) {
    setBusy(moduleId);
    setError(null);
    try {
      await action();
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.userMessage : "La operación no se ha podido completar.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <h1>Propiedad de módulos</h1>
      <p>
        Vincular un módulo a una persona la convierte en <strong>gestor</strong> de ese módulo.
        {isAdmin ? " Como administrador, puedes vincular y desvincular cualquier módulo." : " Aquí ves los módulos de los que eres dueño."}
      </p>

      {error && <ErrorState message={error} onRetry={load} />}
      {!modules && !error && <LoadingState />}
      {modules && modules.length === 0 && <p>No hay módulos {isAdmin ? "registrados" : "vinculados a tu cuenta"}.</p>}

      {modules && modules.length > 0 && (
        <div className="module-cards">
          {modules.map((m) => (
            <Card key={m.id} title={m.friendlyName || m.slug}>
              <p>
                <code>{m.slug}</code> · {m.online ? "en línea" : "desconectado"} · firmware {m.firmwareVersion ?? "—"}
              </p>
              <p>
                Dueño:{" "}
                {m.owner ? (
                  <strong>
                    {m.owner.displayName || m.owner.username} <em>({m.owner.role.name})</em>
                  </strong>
                ) : (
                  <em>sin vincular</em>
                )}
              </p>

              {isAdmin && !m.owner && (
                <div>
                  <label>
                    Vincular a:{" "}
                    <select
                      value={selection[m.id] ?? ""}
                      onChange={(e) => setSelection((s) => ({ ...s, [m.id]: e.target.value }))}
                    >
                      <option value="">— elige usuario —</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.displayName || u.username}
                        </option>
                      ))}
                    </select>
                  </label>{" "}
                  <button disabled={!selection[m.id] || busy === m.id} onClick={() => act(() => linkModule(m.id, selection[m.id]), m.id)}>
                    Vincular
                  </button>
                </div>
              )}

              {m.owner && (
                <button disabled={busy === m.id} onClick={() => act(() => unlinkModule(m.id), m.id)}>
                  Desvincular
                </button>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
