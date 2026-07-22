import { useCallback, useEffect, useState } from "react";
import { Card, ErrorState, LoadingState } from "../../components/ui/Feedback";
import { ApiError } from "../../api/client";
import { searchPlayers, type PlayerRow } from "../../api/playersApi";
import {
  addRegisteredParticipant,
  addTemporaryParticipant,
  listGames,
  listParticipants,
  removeParticipant,
  type GameLite,
  type Participant,
} from "../../api/participantsApi";

/**
 * G-D.2 · Participantes de una partida, incluidos los TEMPORALES (§3.4). Un
 * participante es o registrado/plantilla (jugador) o temporal (nombre suelto, sin
 * cuenta ni estadística). Los temporales sólo existen en esa partida.
 */
export function ParticipantsPage() {
  const [games, setGames] = useState<GameLite[] | null>(null);
  const [gameId, setGameId] = useState("");
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [guest, setGuest] = useState("");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<PlayerRow[]>([]);

  useEffect(() => {
    listGames()
      .then((g) => {
        setGames(g);
        if (g.length > 0) setGameId(g[0].id);
      })
      .catch((e) => setError(e instanceof ApiError ? e.userMessage : "No se han podido cargar las partidas."));
  }, []);

  const loadParticipants = useCallback(async (id: string) => {
    if (!id) return;
    setError(null);
    try {
      setParticipants(await listParticipants(id));
    } catch (e) {
      setError(e instanceof ApiError ? e.userMessage : "No se han podido cargar los participantes.");
    }
  }, []);

  useEffect(() => {
    void loadParticipants(gameId);
  }, [gameId, loadParticipants]);

  async function act(fn: () => Promise<unknown>, key: string) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await loadParticipants(gameId);
    } catch (e) {
      setError(e instanceof ApiError ? e.userMessage : "La operación no se ha podido completar.");
    } finally {
      setBusy(null);
    }
  }

  async function search(e: React.FormEvent) {
    e.preventDefault();
    try {
      setFound(await searchPlayers(q));
    } catch {
      setFound([]);
    }
  }

  function addTemp(e: React.FormEvent) {
    e.preventDefault();
    if (!guest.trim() || !gameId) return;
    void act(() => addTemporaryParticipant(gameId, guest.trim()).then(() => setGuest("")), "temp");
  }

  return (
    <div>
      <h1>Participantes de la partida</h1>

      {!games && !error && <LoadingState />}
      {games && games.length === 0 && (
        <p>No hay partidas. Crea una partida antes de añadir participantes.</p>
      )}

      {games && games.length > 0 && (
        <>
          <Card title="Partida">
            <label>
              Elige partida{" "}
              <select value={gameId} onChange={(e) => setGameId(e.target.value)}>
                {games.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name || g.id.slice(0, 8)} · {g.gameMode?.name ?? g.status}
                  </option>
                ))}
              </select>
            </label>
          </Card>

          <Card title="Añadir jugador temporal">
            <p>Para quien no quiere registrarse: sólo aparece en esta partida y no guarda estadística.</p>
            <form onSubmit={addTemp} className="inline-form">
              <label>
                Nombre <input value={guest} onChange={(e) => setGuest(e.target.value)} required />
              </label>
              <button type="submit" disabled={busy === "temp"}>
                {busy === "temp" ? "Añadiendo…" : "Añadir temporal"}
              </button>
            </form>
          </Card>

          <Card title="Añadir jugador registrado o de plantilla">
            <form onSubmit={search} className="inline-form">
              <label>
                Buscar <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="nombre o usuario" />
              </label>
              <button type="submit">Buscar</button>
            </form>
            {found.length > 0 && (
              <ul className="participant-found">
                {found.map((p) => (
                  <li key={p.id}>
                    {p.displayName}
                    {p.user && (
                      <span>
                        {" "}
                        · <code>{p.user.username}</code>
                      </span>
                    )}{" "}
                    <button type="button" disabled={busy === p.id} onClick={() => act(() => addRegisteredParticipant(gameId, p.id), p.id)}>
                      Añadir
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {error && <ErrorState message={error} onRetry={() => loadParticipants(gameId)} />}

          <Card title={`Participantes (${participants.length})`}>
            {participants.length === 0 ? (
              <p>Aún no hay participantes en esta partida.</p>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">Jugador</th>
                      <th scope="col">Tipo</th>
                      <th scope="col"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {participants.map((p) => (
                      <tr key={p.id}>
                        <td>{p.slot}</td>
                        <td>{p.temporary ? p.guestName : p.player?.displayName}</td>
                        <td>
                          {p.temporary ? (
                            <span className="badge badge--warn">temporal</span>
                          ) : p.player?.userId ? (
                            <span className="badge badge--ok">registrado</span>
                          ) : (
                            <span className="badge badge--muted">plantilla</span>
                          )}
                        </td>
                        <td>
                          <button type="button" disabled={busy === p.id} onClick={() => act(() => removeParticipant(p.id), p.id)}>
                            Quitar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
