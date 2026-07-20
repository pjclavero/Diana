import { useState } from "react";
import { apiClient } from "../../api";
import { useAsync } from "../../hooks/useAsync";
import { Card, ErrorState, LoadingState } from "../../components/ui/Feedback";

export function PlayersPage() {
  const { data: players, loading, error, reload } = useAsync(() => apiClient.listPlayers(), []);
  const { data: teams } = useAsync(() => apiClient.listTeams(), []);
  const [name, setName] = useState("");
  const [teamId, setTeamId] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await apiClient.createPlayer({ name: name.trim(), team_id: teamId || null });
      setName("");
      setTeamId("");
      reload();
    } finally {
      setBusy(false);
    }
  }

  const teamName = (id?: string | null) => teams?.find((t) => t.id === id)?.name ?? "sin equipo";

  return (
    <div>
      <h1>Jugadores</h1>
      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={reload} />}

      <Card title="Añadir jugador">
        <form onSubmit={handleCreate} className="inline-form">
          <label>
            Nombre
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            Equipo
            <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">sin equipo</option>
              {teams?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={busy}>
            {busy ? "Añadiendo…" : "Añadir"}
          </button>
        </form>
      </Card>

      <Card title="Lista de jugadores">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Nombre</th>
                <th scope="col">Equipo</th>
              </tr>
            </thead>
            <tbody>
              {players?.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{teamName(p.team_id)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
