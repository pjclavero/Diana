import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  getParticipantHistory,
  getScoreboard,
  listRecentGames,
  resetParticipantStats,
  type ParticipantHistory,
  type Scoreboard,
  type StatsResetOutcome,
} from "../../api/scoreboardApi";
import { useAuth } from "../../auth/AuthContext";
import { useAsync } from "../../hooks/useAsync";
import { BackButton } from "../../components/ui/BackButton";
import { Card, EmptyState, ErrorState, LoadingState } from "../../components/ui/Feedback";
import "./ScoreboardPage.css";

/** Refresco del marcador mientras la partida está viva. */
const LIVE_REFRESH_MS = 3000;
const LIVE_STATUSES = ["armed", "running", "paused"];

function formatTime(us: number | null): string {
  if (us === null) return "—";
  return `${(us / 1_000_000).toFixed(2)} s`;
}

function formatAccuracy(value: number | null): string {
  // No calculable ≠ 0 %: se dice, no se rellena con un número falso.
  return value === null ? "no calculable" : `${(value * 100).toFixed(1)} %`;
}

/** Un recuento desconocido se dice; jamás se pinta como 0. */
function formatCount(value: number | null): string {
  return value === null ? "sin atribuir" : String(value);
}

const STATE_LABEL: Record<string, string> = {
  hit: "acertada",
  invalid: "impacto no válido",
  pending: "pendiente",
};

/** Sin partida en la URL: se elige entre las partidas recientes. */
function ScoreboardPicker() {
  const { data: games, loading, error, reload } = useAsync(() => listRecentGames(), []);
  return (
    <div>
      <BackButton />
      <h1>Marcador</h1>
      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {games && games.length === 0 && <EmptyState>No hay partidas creadas todavía.</EmptyState>}
      {games && games.length > 0 && (
        <Card title="Elija una partida">
          <ul className="scoreboard-games">
            {games.map((game) => (
              <li key={game.id}>
                <Link to={`/marcador/${game.id}`}>
                  {game.name ?? `Partida ${game.id.slice(0, 8)}`} · {game.status}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

export function ScoreboardPage() {
  const { gameId } = useParams();
  const [board, setBoard] = useState<Scoreboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [history, setHistory] = useState<ParticipantHistory | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetOutcome, setResetOutcome] = useState<StatsResetOutcome | null>(null);
  const { can } = useAuth();

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!gameId) return;
    try {
      const data = await getScoreboard(gameId);
      if (!mounted.current) return;
      setBoard(data);
      setError(null);
    } catch (e) {
      if (!mounted.current) return;
      setError(e instanceof Error ? e.message : "No se pudo cargar el marcador.");
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [gameId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Mientras la partida está viva el marcador se refresca solo; al terminar, para.
  const live = board ? LIVE_STATUSES.includes(board.game.status) : false;
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => void load(), LIVE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [live, load]);

  useEffect(() => {
    // Cambiar de jugador cierra cualquier confirmación o resultado anterior:
    // confirmar un borrado y que lo reciba otro sería un desastre silencioso.
    setConfirmingReset(false);
    setResetError(null);
    setResetOutcome(null);
    if (!selected) {
      setHistory(null);
      return;
    }
    let cancelled = false;
    setHistoryError(null);
    getParticipantHistory(selected)
      .then((data) => {
        if (!cancelled) setHistory(data);
      })
      .catch((e: unknown) => {
        if (!cancelled) setHistoryError(e instanceof Error ? e.message : "No se pudo cargar el histórico.");
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const doReset = useCallback(async () => {
    if (!gameId || !selected) return;
    setResetting(true);
    setResetError(null);
    try {
      const outcome = await resetParticipantStats(gameId, selected);
      if (!mounted.current) return;
      setResetOutcome(outcome);
      setConfirmingReset(false);
      // Marcador y ficha quedan obsoletos en cuanto se borra: se recargan.
      await load();
      const refreshed = await getParticipantHistory(selected);
      if (mounted.current) setHistory(refreshed);
    } catch (e) {
      if (mounted.current) setResetError(e instanceof Error ? e.message : "No se pudo reiniciar la estadística.");
    } finally {
      if (mounted.current) setResetting(false);
    }
  }, [gameId, selected, load]);

  if (!gameId) return <ScoreboardPicker />;

  return (
    <div>
      <BackButton />
      <h1>Marcador</h1>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={load} />}

      {board && (
        <>
          <Card title={board.game.name ?? `Partida ${board.game.id.slice(0, 8)}`}>
            <p>
              Modo <strong>{board.game.mode.name}</strong> ·{" "}
              {board.multiPanel
                ? `${board.panels.length} paneles (vista)`
                : `Panel ${board.game.panel.name}`}{" "}
              · Estado{" "}
              <strong>{board.game.status}</strong>
              {board.round ? ` · Ronda ${board.round.index} (${board.round.phase})` : " · sin rondas todavía"}
            </p>
            <p>
              Impactos detectados: {board.totals.detected} · válidos: {board.totals.valid} · no válidos:{" "}
              {board.totals.invalid}
            </p>
            {board.totals.unattributed > 0 && (
              <p role="alert">
                {board.totals.unattributed} impacto(s) sin atribuir a ningún jugador.
              </p>
            )}
            {board.warnings.map((warning) => (
              <p role="alert" key={warning}>
                {warning}
              </p>
            ))}
            <p>
              {live
                ? "Marcador en directo: se actualiza solo cada 3 s."
                : "La partida no está en curso: el marcador no se actualiza solo."}{" "}
              <button type="button" onClick={() => void load()}>
                Actualizar ahora
              </button>
            </p>
          </Card>

          <Card title="Clasificación">
            {board.ranking.length === 0 ? (
              <EmptyState>Esta partida no tiene participantes todavía.</EmptyState>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">Jugador</th>
                      <th scope="col">Equipo</th>
                      <th scope="col">Aciertos</th>
                      <th scope="col">No válidos</th>
                      <th scope="col">Tiempo</th>
                      <th scope="col">Precisión</th>
                      <th scope="col">Ficha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {board.ranking.map((row) => (
                      <tr key={row.participantId} className={row.position === 1 ? "scoreboard-leader" : ""}>
                        <td>{row.position ?? "—"}</td>
                        <td>
                          {row.name}
                          {row.temporary && <span className="badge">temporal</span>}
                        </td>
                        <td>{row.teamName ?? "—"}</td>
                        <td>{formatCount(row.validHits)}</td>
                        <td>{formatCount(row.invalidHits)}</td>
                        <td>
                          {formatTime(row.totalTimeUs)}
                          {row.provisional && row.attributed && (
                            <span className="badge badge--warn">provisional</span>
                          )}
                          {!row.attributed && <span className="badge badge--warn">sin datos</span>}
                          {row.inferred && <span className="badge badge--warn">deducido</span>}
                        </td>
                        <td>{formatAccuracy(row.accuracyValid)}</td>
                        <td>
                          <button type="button" onClick={() => setSelected(row.participantId)}>
                            Ver jugador
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Estado de las dianas">
            {board.board.length === 0 ? (
              <EmptyState>El panel de esta partida no tiene módulos con dianas dadas de alta.</EmptyState>
            ) : (
              <div className="scoreboard-modules">
                {board.board.map((module) => (
                  <div key={module.moduleSlug} className="scoreboard-module">
                    <h3>
                      {module.moduleSlug}
                      {module.x !== null && module.y !== null ? ` (${module.x}, ${module.y})` : " (sin posición)"}
                    </h3>
                    {board.multiPanel && (
                      // Las coordenadas son POR panel: sin el panel, dos módulos
                      // distintos se leerían como el mismo (0, 0).
                      <p className="scoreboard-module__panel">Panel: {module.panelName}</p>
                    )}
                    <div className="scoreboard-targets" role="grid" aria-label={`Dianas de ${module.moduleSlug}`}>
                      {module.targets.map((target) => (
                        <div
                          key={target.targetIndex}
                          role="gridcell"
                          className={`scoreboard-target scoreboard-target--${target.state}`}
                          title={
                            target.lastClassification
                              ? `Diana ${target.targetIndex}: ${STATE_LABEL[target.state]} (${target.lastClassification})`
                              : `Diana ${target.targetIndex}: ${STATE_LABEL[target.state]}`
                          }
                        >
                          <span className="scoreboard-target__index">{target.targetIndex}</span>
                          <span className="scoreboard-target__state">{STATE_LABEL[target.state]}</span>
                          {target.hits > 1 && <span className="scoreboard-target__hits">×{target.hits}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {selected && (
            <Card
              title="Ficha del jugador"
              actions={
                <button type="button" onClick={() => setSelected(null)}>
                  Cerrar
                </button>
              }
            >
              {historyError && <ErrorState message={historyError} />}
              {!history && !historyError && <LoadingState />}
              {history && (
                <>
                  <p>
                    <strong>{history.name}</strong>
                  </p>
                  {history.history === null ? (
                    <p role="note">{history.note}</p>
                  ) : (
                    <>
                      <ul>
                        <li>Rondas registradas: {history.history.rounds}</li>
                        <li>Aciertos válidos acumulados: {history.history.totalValidHits}</li>
                        <li>Precisión media: {formatAccuracy(history.history.averageAccuracyValid)}</li>
                        <li>Mejor tiempo: {formatTime(history.history.bestTimeUs)}</li>
                        {history.history.roundsWithoutAccuracy > 0 && (
                          <li>
                            Rondas sin precisión calculable: {history.history.roundsWithoutAccuracy} (no cuentan
                            como cero)
                          </li>
                        )}
                      </ul>
                      {history.history.recent.length > 0 && (
                        <div className="table-scroll">
                          <table>
                            <thead>
                              <tr>
                                <th scope="col">Ronda</th>
                                <th scope="col">Aciertos</th>
                                <th scope="col">Tiempo</th>
                                <th scope="col">Precisión</th>
                              </tr>
                            </thead>
                            <tbody>
                              {history.history.recent.map((r) => (
                                <tr key={r.roundId}>
                                  <td>{r.roundId.slice(0, 8)}</td>
                                  <td>{r.validHits}</td>
                                  <td>{formatTime(r.totalTimeUs)}</td>
                                  <td>{formatAccuracy(r.accuracyValid)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  )}

                  {/* §3.4: reinicio por partida. Sólo gestor/admin (stats:reset);
                      el backend vuelve a comprobarlo, esto sólo evita enseñar
                      un botón que no se puede usar. */}
                  {can("stats:reset") && (
                    <div className="scoreboard-reset">
                      <h3>Reiniciar estadística de esta partida</h3>
                      {!confirmingReset && !resetOutcome && (
                        <button type="button" onClick={() => setConfirmingReset(true)}>
                          Reiniciar estadística de {history.name} en esta partida
                        </button>
                      )}

                      {confirmingReset && (
                        <div role="alertdialog" aria-label="Confirmar reinicio de estadística">
                          <p>
                            Va a reiniciar la estadística de <strong>{history.name}</strong> en{" "}
                            <strong>esta partida</strong>. No se puede deshacer.
                          </p>
                          <p>
                            <strong>Se borra:</strong> sus resultados, penalizaciones y munición de esta
                            partida.
                          </p>
                          <p>
                            <strong>No se borra:</strong> los impactos registrados (se conservan, pero dejarán
                            de estar atribuidos a este jugador y el marcador los contará como «sin atribuir»),
                            su puesto en la partida, ni ninguna otra partida.
                          </p>
                          <p>
                            {history.temporary
                              ? "Es un jugador temporal: no tiene estadística acumulada, así que no hay nada global que descontar."
                              : "Su estadística global se calcula sumando sus partidas: al quitar los resultados de ésta, el acumulado se ajusta solo; las demás partidas no se tocan."}
                          </p>
                          <button type="button" onClick={() => void doReset()} disabled={resetting}>
                            {resetting ? "Reiniciando…" : "Sí, reiniciar"}
                          </button>
                          <button type="button" onClick={() => setConfirmingReset(false)} disabled={resetting}>
                            Cancelar
                          </button>
                        </div>
                      )}

                      {resetError && <ErrorState message={resetError} />}

                      {resetOutcome && (
                        <div role="status">
                          <p>
                            Estadística reiniciada. Borrados: {resetOutcome.deleted.results} resultado(s),{" "}
                            {resetOutcome.deleted.penalties} penalización(es) y {resetOutcome.deleted.shotCounts}{" "}
                            registro(s) de munición. Impactos conservados pero sin atribuir:{" "}
                            {resetOutcome.hitsDetached}.
                          </p>
                          {resetOutcome.notes.map((note) => (
                            <p key={note}>{note}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
