import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiClient, createGameSocket, type ConnectionStatus } from "../../api";
import { isFinishedPhase } from "../../api/liveContract";
import { Card } from "../../components/ui/Feedback";
import { ConnectionBadge } from "../../components/ui/ConnectionBadge";
import { ResiliencePanel } from "../../components/game/ResiliencePanel";
import { TargetLight } from "../../components/target/TargetLight";
import { ACCURACY_NOT_COMPUTABLE_TEXT } from "../../utils/accuracy";
import type { GameEvent, GameState, GameSummary, TargetState } from "../../types/domain";
import "./LiveGamePage.css";

function formatElapsed(us: number): string {
  const totalMs = Math.round(us / 1000);
  const m = Math.floor(totalMs / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const cs = Math.floor((totalMs % 1000) / 10);
  return `${m}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

export function LiveGamePage() {
  const { gameId = "" } = useParams();
  const [state, setState] = useState<GameState | null>(null);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [connStatus, setConnStatus] = useState<ConnectionStatus>("connecting");
  const [summary, setSummary] = useState<GameSummary | null>(null);
  const socketRef = useRef<ReturnType<typeof createGameSocket> | null>(null);
  const targetStatesRef = useRef<Map<string, TargetState>>(new Map());
  const [, forceRender] = useState(0);

  const refreshSummary = useCallback(() => {
    apiClient
      .getGameResult(gameId)
      .then(setSummary)
      .catch(() => {
        /* el resumen se reintentará en el próximo evento; el operador ya ve el error de conexión si procede */
      });
  }, [gameId]);

  useEffect(() => {
    const socket = createGameSocket();
    socketRef.current = socket;
    const offMsg = socket.onMessage(({ state: s, event }) => {
      setState(s);
      // Defensa en profundidad: `active_targets` no es obligatorio en el
      // contrato. El adaptador ya lo normaliza, pero la pantalla no puede
      // reventar por un campo ausente (el mock es otro productor).
      for (const t of s.active_targets ?? []) {
        targetStatesRef.current.set(`${t.module_id}:${t.target_index}`, "active");
      }
      if (event) {
        setEvents((prev) => [event, ...prev].slice(0, 20));
        if (event.module_id && event.target_index) {
          const key = `${event.module_id}:${event.target_index}`;
          targetStatesRef.current.set(key, event.detail?.includes("válido") ? "hit" : "penalty");
        }
        refreshSummary();
      }
      forceRender((n) => n + 1);
    });
    const offStatus = socket.onStatusChange(setConnStatus);
    socket.connect(gameId);

    return () => {
      offMsg();
      offStatus();
      socket.disconnect();
    };
  }, [gameId, refreshSummary]);

  const isFinished = isFinishedPhase(state?.phase);

  return (
    <div>
      <h1>Partida en directo</h1>
      {/* G-I: si cae un módulo implicado, el aviso aparece aquí con la decisión. */}
      {gameId && <ResiliencePanel gameId={gameId} />}
      <div className="live-header">
        <ConnectionBadge status={connStatus} />
        <span>
          Fase: <strong>{state?.phase ?? "cargando"}</strong>
        </span>
        <span role="timer" aria-live="off">
          Cronómetro: <strong>{formatElapsed(state?.elapsed_us ?? 0)}</strong>
        </span>
      </div>

      <Card title="Matriz de dianas">
        <div className="live-matrix" role="group" aria-label="Estado en directo de las dianas en juego">
          {[...targetStatesRef.current.entries()].map(([key, st]) => {
            const [moduleId, idx] = key.split(":");
            return (
              <div key={key} className="live-matrix__cell">
                <TargetLight targetIndex={Number(idx)} state={st} size="md" />
                <span className="live-matrix__module">{moduleId}</span>
              </div>
            );
          })}
          {targetStatesRef.current.size === 0 && <p>Esperando actividad de las dianas…</p>}
        </div>
      </Card>

      <div className="live-columns">
        <Card title="Últimos impactos">
          {events.length === 0 && <p>Sin impactos todavía.</p>}
          <ul>
            {events.map((e) => (
              <li key={e.event_id}>
                {e.module_id} · diana {e.target_index} · {formatElapsed(e.elapsed_us)} · {e.detail}
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Parciales y puntuación">
          <dl className="kv-list">
            <div>
              <dt>Dianas acertadas</dt>
              <dd>{state?.targets_hit ?? 0}</dd>
            </div>
            <div>
              <dt>Dianas restantes</dt>
              <dd>{state?.targets_remaining ?? 0}</dd>
            </div>
            <div>
              <dt>Penalizaciones</dt>
              <dd>{state?.penalties ?? 0}</dd>
            </div>
          </dl>
        </Card>

        <Card title="Precisión por jugador">
          {!summary && <p>Sin datos todavía.</p>}
          {summary && (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Jugador</th>
                    <th scope="col">Aciertos</th>
                    <th scope="col">Incorrectos</th>
                    <th scope="col">Precisión</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.results.map((r) => (
                    <tr key={r.player_id}>
                      <td>{r.player_id}</td>
                      <td>{r.hits_valid}</td>
                      <td>{r.hits_incorrect}</td>
                      <td>
                        {r.accuracy.status === "not_computable"
                          ? ACCURACY_NOT_COMPUTABLE_TEXT
                          : `${r.accuracy.valid_accuracy_pct?.toFixed(1)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {isFinished && (
        <Card title="Partida finalizada">
          <p>La partida ha terminado.</p>
          <Link to={`/resultados/${gameId}`}>Ver resultados completos</Link>
        </Card>
      )}
    </div>
  );
}
