import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "../../components/ui/Feedback";
import { TargetLight } from "../../components/target/TargetLight";
import type { TargetState } from "../../types/domain";
import { DEMO_TARGET_COUNT, formatTime, makeSequence } from "../demo/demoLogic";
import { rankPlayers, type DueloPlayerResult, type DueloRanking } from "./dueloLogic";
import "../demo/DemoPage.css";

type Phase = "setup" | "playing" | "results";

/**
 * G-E · Práctica de duelo (hot-seat, sin hardware ni BD). Todos los jugadores
 * reciben la MISMA secuencia; cada uno juega su turno y se cronometra. Gana quien
 * más acierta en menos tiempo (misma regla que el motor). Efímero: no guarda nada.
 */
export function DueloPage() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [names, setNames] = useState<string[]>(["Jugador 1", "Jugador 2"]);
  const [sequence, setSequence] = useState<number[]>([]);
  const [turn, setTurn] = useState(0);
  const [step, setStep] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [results, setResults] = useState<DueloPlayerResult[]>([]);
  const [ranking, setRanking] = useState<DueloRanking | null>(null);
  const [awaitingNext, setAwaitingNext] = useState(false);
  const startRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  const tick = useCallback(() => {
    setElapsed(performance.now() - startRef.current);
    rafRef.current = requestAnimationFrame(tick);
  }, []);
  const stopTicking = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);
  useEffect(() => stopTicking, [stopTicking]);

  function startDuelo() {
    const clean = names.map((n) => n.trim()).filter(Boolean);
    if (clean.length < 2) return;
    setNames(clean);
    setSequence(makeSequence(DEMO_TARGET_COUNT));
    setResults([]);
    setRanking(null);
    setTurn(0);
    beginTurn();
  }

  function beginTurn() {
    setStep(0);
    setElapsed(0);
    setPhase("playing");
    startRef.current = performance.now();
    stopTicking();
    rafRef.current = requestAnimationFrame(tick);
  }

  function hit(index: number) {
    if (phase !== "playing" || index !== sequence[step]) return;
    const next = step + 1;
    if (next >= sequence.length) {
      stopTicking();
      const time = Math.round(performance.now() - startRef.current);
      const updated = [...results, { name: names[turn], hits: sequence.length, timeMs: time }];
      setResults(updated);
      if (turn + 1 >= names.length) {
        setRanking(rankPlayers(updated));
        setPhase("results");
      } else {
        setTurn(turn + 1);
        // Pausa entre turnos: vuelve a "setup" del turno siguiente con un botón.
        setPhase("playing");
        setStep(0);
        setElapsed(0);
        // Espera a que el siguiente jugador pulse "Empezar mi turno".
        stopTicking();
        setAwaitingNext(true);
      }
    } else {
      setStep(next);
    }
  }

  function startMyTurn() {
    setAwaitingNext(false);
    beginTurn();
  }

  const current = phase === "playing" && !awaitingNext ? sequence[step] : -1;
  const stateFor = (idx: number): TargetState => (idx === current ? "active" : "off");

  return (
    <div>
      <h1>Duelo (práctica)</h1>
      <p>
        Todos los jugadores reciben la misma secuencia de {DEMO_TARGET_COUNT} dianas. Cada uno juega su turno; gana
        quien más acierta en menos tiempo. No se guarda nada (sólo esta sesión).
      </p>

      {phase === "setup" && (
        <Card title="Jugadores">
          {names.map((n, i) => (
            <div key={i} className="duelo-player-row">
              <input
                value={n}
                onChange={(e) => setNames((ns) => ns.map((x, j) => (j === i ? e.target.value : x)))}
                aria-label={`Nombre del jugador ${i + 1}`}
              />
              {names.length > 2 && (
                <button type="button" onClick={() => setNames((ns) => ns.filter((_, j) => j !== i))}>
                  Quitar
                </button>
              )}
            </div>
          ))}
          <div className="demo-actions">
            <button type="button" onClick={() => setNames((ns) => [...ns, `Jugador ${ns.length + 1}`])}>
              Añadir jugador
            </button>{" "}
            <button type="button" onClick={startDuelo}>
              Empezar duelo
            </button>
          </div>
        </Card>
      )}

      {phase === "playing" && (
        <Card title={awaitingNext ? `Prepara el turno de ${names[turn]}` : `Turno de ${names[turn]} · diana ${step + 1} de ${sequence.length}`}>
          {awaitingNext ? (
            <div className="demo-actions">
              <p>Pasa el mando a {names[turn]}.</p>
              <button type="button" onClick={startMyTurn}>
                Empezar mi turno
              </button>
            </div>
          ) : (
            <>
              <p className="demo-timer" role="status" aria-live="off">
                {formatTime(elapsed)}
              </p>
              <div className="target-grid-3x3" role="group" aria-label={`Dianas de ${names[turn]}`}>
                {Array.from({ length: 9 }, (_, i) => i + 1).map((idx) => (
                  <TargetLight
                    key={idx}
                    targetIndex={idx}
                    state={stateFor(idx)}
                    size="lg"
                    onClick={idx === current ? () => hit(idx) : undefined}
                  />
                ))}
              </div>
            </>
          )}
        </Card>
      )}

      {phase === "results" && ranking && (
        <Card title="Resultado del duelo">
          <p className="demo-result">
            Gana: <strong>{ranking.winners.join(", ")}</strong>
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Puesto</th>
                  <th scope="col">Jugador</th>
                  <th scope="col">Aciertos</th>
                  <th scope="col">Tiempo</th>
                </tr>
              </thead>
              <tbody>
                {ranking.ranking.map((r) => (
                  <tr key={r.name}>
                    <td>{r.position}</td>
                    <td>{r.name}</td>
                    <td>{r.hits}</td>
                    <td>{formatTime(r.timeMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="demo-actions">
            <button type="button" onClick={() => setPhase("setup")}>
              Nuevo duelo
            </button>
          </div>
        </Card>
      )}
    </div>
  );
}
