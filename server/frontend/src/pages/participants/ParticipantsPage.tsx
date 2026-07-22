import { useCallback, useEffect, useState } from "react";
import QRCode from "react-qr-code";
import { Card, ErrorState, LoadingState } from "../../components/ui/Feedback";
import { ApiError } from "../../api/client";
import { listTeams, searchPlayers, type PlayerRow, type Team } from "../../api/playersApi";
import {
  addRegisteredParticipant,
  addTemporaryParticipant,
  ensureJoinCode,
  listGames,
  listParticipants,
  removeParticipant,
  setParticipantTeam,
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
  const [teams, setTeams] = useState<Team[]>([]);

  useEffect(() => {
    listTeams().then(setTeams).catch(() => setTeams([]));
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

          <JoinQr gameId={gameId} />

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
                      <th scope="col">Equipo</th>
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
                          <select
                            aria-label={`Equipo de ${p.temporary ? p.guestName : p.player?.displayName}`}
                            value={p.team?.id ?? ""}
                            disabled={busy === p.id}
                            onChange={(e) => act(() => setParticipantTeam(p.id, e.target.value || null), p.id)}
                          >
                            <option value="">sin equipo</option>
                            {teams.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                          </select>
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

/** Código + QR para unirse a la partida escaneando (G-D). Se regenera bajo demanda. */
function JoinQr({ gameId }: { gameId: string }) {
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // El código no se muestra hasta pedirlo (así no se genera para todas las partidas).
  useEffect(() => {
    setCode(null);
    setError(null);
  }, [gameId]);

  async function generate(regenerate: boolean) {
    setBusy(true);
    setError(null);
    try {
      const r = await ensureJoinCode(gameId, regenerate);
      setCode(r.joinCode);
    } catch (e) {
      setError(e instanceof ApiError ? e.userMessage : "No se ha podido generar el código.");
    } finally {
      setBusy(false);
    }
  }

  const joinUrl = code ? `${window.location.origin}/unirse/${code}` : "";

  return (
    <Card title="Unirse por QR">
      <p>Comparte este código o QR: quien lo escanee podrá unirse como jugador temporal, sin cuenta.</p>
      {!code ? (
        <button type="button" onClick={() => generate(false)} disabled={busy}>
          {busy ? "Generando…" : "Generar código de unión"}
        </button>
      ) : (
        <div className="join-qr">
          <div className="join-qr__code">
            <QRCode value={joinUrl} size={148} aria-label={`QR de unión: ${joinUrl}`} />
          </div>
          <div>
            <p>
              Código: <strong className="join-qr__text">{code}</strong>
            </p>
            <p>
              <code>{joinUrl}</code>
            </p>
            <button type="button" onClick={() => generate(true)} disabled={busy}>
              {busy ? "Regenerando…" : "Regenerar"}
            </button>
          </div>
        </div>
      )}
      {error && <ErrorState message={error} />}
    </Card>
  );
}
