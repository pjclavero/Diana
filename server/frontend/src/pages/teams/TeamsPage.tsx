import { useCallback, useEffect, useState } from "react";
import { Card, ErrorState, LoadingState } from "../../components/ui/Feedback";
import { ApiError } from "../../api/client";
import { createTeam, listTeams, type Team } from "../../api/playersApi";

/** G-D · Equipos (datos REALES). Crear equipos y listarlos; los jugadores se asignan
 *  desde la pantalla de Jugadores. */
export function TeamsPage() {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setTeams(await listTeams());
    } catch (e) {
      setError(e instanceof ApiError ? e.userMessage : "No se han podido cargar los equipos.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await createTeam({ name: name.trim(), description: description.trim() || undefined });
      setName("");
      setDescription("");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.userMessage : "No se ha podido crear el equipo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1>Equipos</h1>

      <Card title="Añadir equipo">
        <form onSubmit={create} className="inline-form">
          <label>
            Nombre <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            Descripción <input value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? "Añadiendo…" : "Añadir"}
          </button>
        </form>
      </Card>

      {error && <ErrorState message={error} onRetry={load} />}
      {!teams && !error && <LoadingState />}

      {teams && (
        <Card title={`Equipos (${teams.length})`}>
          {teams.length === 0 ? (
            <p>Aún no hay equipos.</p>
          ) : (
            <ul>
              {teams.map((t) => (
                <li key={t.id}>
                  <strong>{t.name}</strong>
                  {t.description && <span> — {t.description}</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
