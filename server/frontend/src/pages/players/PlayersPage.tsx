import { useCallback, useEffect, useState } from "react";
import { Card, ErrorState, LoadingState } from "../../components/ui/Feedback";
import { ApiError } from "../../api/client";
import {
  createPlayer,
  listTeams,
  searchPlayers,
  setPlayerTeam,
  type PlayerRow,
  type Team,
} from "../../api/playersApi";

/**
 * G-D · Jugadores (datos REALES). Busca por nombre/usuario, da de alta jugadores de
 * plantilla y asigna/cambia su equipo. Marca quién es jugador registrado (con cuenta).
 */
export function PlayersPage() {
  const [query, setQuery] = useState("");
  const [players, setPlayers] = useState<PlayerRow[] | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [newTeam, setNewTeam] = useState("");

  const load = useCallback(async (q: string) => {
    setError(null);
    try {
      setPlayers(await searchPlayers(q));
    } catch (e) {
      setError(e instanceof ApiError ? e.userMessage : "No se han podido cargar los jugadores.");
    }
  }, []);

  useEffect(() => {
    void load("");
    listTeams().then(setTeams).catch(() => setTeams([]));
  }, [load]);

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    await load(query);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy("create");
    setError(null);
    try {
      await createPlayer({ displayName: name.trim(), teamId: newTeam || null });
      setName("");
      setNewTeam("");
      await load(query);
    } catch (e) {
      setError(e instanceof ApiError ? e.userMessage : "No se ha podido crear el jugador.");
    } finally {
      setBusy(null);
    }
  }

  async function changeTeam(id: string, teamId: string) {
    setBusy(id);
    setError(null);
    try {
      await setPlayerTeam(id, teamId || null);
      await load(query);
    } catch (e) {
      setError(e instanceof ApiError ? e.userMessage : "No se ha podido cambiar el equipo.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <h1>Jugadores</h1>

      <Card title="Buscar">
        <form onSubmit={onSearch} className="inline-form">
          <label>
            Nombre o usuario{" "}
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="buscar…" />
          </label>
          <button type="submit">Buscar</button>
        </form>
      </Card>

      <Card title="Añadir jugador de plantilla">
        <form onSubmit={create} className="inline-form">
          <label>
            Nombre <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            Equipo{" "}
            <select value={newTeam} onChange={(e) => setNewTeam(e.target.value)}>
              <option value="">sin equipo</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={busy === "create"}>
            {busy === "create" ? "Añadiendo…" : "Añadir"}
          </button>
        </form>
      </Card>

      {error && <ErrorState message={error} onRetry={() => load(query)} />}
      {!players && !error && <LoadingState />}

      {players && (
        <Card title={`Jugadores (${players.length})`}>
          {players.length === 0 ? (
            <p>No hay jugadores para esa búsqueda.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Nombre</th>
                    <th scope="col">Tipo</th>
                    <th scope="col">Equipo</th>
                  </tr>
                </thead>
                <tbody>
                  {players.map((p) => (
                    <tr key={p.id}>
                      <td>
                        {p.displayName}
                        {p.user && (
                          <span>
                            {" "}
                            · <code>{p.user.username}</code>
                          </span>
                        )}
                      </td>
                      <td>
                        {p.registered ? (
                          <span className="badge badge--ok">registrado</span>
                        ) : (
                          <span className="badge badge--muted">plantilla</span>
                        )}
                      </td>
                      <td>
                        <select
                          aria-label={`Equipo de ${p.displayName}`}
                          value={p.teamId ?? ""}
                          disabled={busy === p.id}
                          onChange={(e) => changeTeam(p.id, e.target.value)}
                        >
                          <option value="">sin equipo</option>
                          {teams.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
