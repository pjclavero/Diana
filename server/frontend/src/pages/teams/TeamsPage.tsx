import { useState } from "react";
import { apiClient } from "../../api";
import { useAsync } from "../../hooks/useAsync";
import { Card, ErrorState, LoadingState } from "../../components/ui/Feedback";

export function TeamsPage() {
  const { data: teams, loading, error, reload } = useAsync(() => apiClient.listTeams(), []);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#2563eb");
  const [busy, setBusy] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await apiClient.createTeam({ name: name.trim(), color });
      setName("");
      reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1>Equipos</h1>
      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={reload} />}

      <Card title="Añadir equipo">
        <form onSubmit={handleCreate} className="inline-form">
          <label>
            Nombre
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            Color
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Color del equipo" />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? "Añadiendo…" : "Añadir"}
          </button>
        </form>
      </Card>

      <Card title="Lista de equipos">
        <ul>
          {teams?.map((t) => (
            <li key={t.id}>
              <span
                aria-hidden="true"
                style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", background: t.color, marginRight: 6 }}
              />
              {t.name} <span className="sr-only">color {t.color}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
