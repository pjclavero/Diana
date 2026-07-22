import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Card, ErrorState, LoadingState } from "../../components/ui/Feedback";
import { ApiError } from "../../api/client";
import { gameByJoinCode, joinByCode, type JoinGameInfo } from "../../api/participantsApi";

/**
 * G-D · Pantalla PÚBLICA de unión por QR (`/unirse/:code`), sin login. Muestra la
 * partida del código y permite unirse como jugador temporal (por nombre). El código
 * de unión actúa de autorización.
 */
export function JoinPage() {
  const { code = "" } = useParams();
  const [game, setGame] = useState<JoinGameInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [joinedAs, setJoinedAs] = useState<string | null>(null);

  useEffect(() => {
    gameByJoinCode(code)
      .then(setGame)
      .catch((e) => setError(e instanceof ApiError ? e.userMessage : "No se ha encontrado la partida."));
  }, [code]);

  async function join(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await joinByCode(code, name.trim());
      setJoinedAs(r.name ?? name.trim());
    } catch (e) {
      setError(e instanceof ApiError ? e.userMessage : "No se ha podido unir a la partida.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 480, margin: "2rem auto", padding: "0 1rem" }}>
      <h1>Unirse a la partida</h1>
      {!game && !error && <LoadingState />}
      {error && <ErrorState message={error} />}

      {game && joinedAs && (
        <Card title="¡Dentro!">
          <p>
            Te has unido como <strong>{joinedAs}</strong> a la partida{" "}
            <strong>{game.name || game.gameMode?.name || "sin nombre"}</strong>. Ya puedes jugar cuando empiece.
          </p>
        </Card>
      )}

      {game && !joinedAs && (
        <Card title={game.name || game.gameMode?.name || "Partida"}>
          {game.gameMode && <p>Modo: {game.gameMode.name}</p>}
          {game.joinable ? (
            <form onSubmit={join} className="inline-form">
              <label>
                Tu nombre <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={128} />
              </label>
              <button type="submit" disabled={busy}>
                {busy ? "Uniéndote…" : "Unirme"}
              </button>
            </form>
          ) : (
            <p>Esta partida ya no admite nuevas incorporaciones.</p>
          )}
        </Card>
      )}
    </div>
  );
}
