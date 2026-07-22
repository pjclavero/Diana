import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "../../components/ui/Feedback";
import { TargetLight } from "../../components/target/TargetLight";
import { DEMO_TARGET_COUNT, formatTime, makeSequence } from "../demo/demoLogic";
import { rankPlayers, type DueloPlayerResult, type DueloRanking } from "./dueloLogic";
import "../demo/DemoPage.css";
import "./DueloPage.css";

type Format = "simultaneo" | "turnos";
type Phase = "setup" | "playing" | "results";

/**
 * G-E · Duelo (práctica, sin hardware ni BD). La idea original es **1vs1 a la vez**:
 * ambos jugadores reciben LOS MISMOS elementos (misma secuencia, mismas 9 dianas) y
 * corren simultáneamente; gana quien más acierta en menos tiempo. También se ofrece un
 * modo por turnos (hot-seat) para 2+ jugadores. Efímero: no guarda nada.
 */
export function DueloPage() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [format, setFormat] = useState<Format>("simultaneo");
  const [names, setNames] = useState<string[]>(["Jugador 1", "Jugador 2"]);
  const [sequence, setSequence] = useState<number[]>([]);
  const [ranking, setRanking] = useState<DueloRanking | null>(null);

  // El modo simultáneo es 1vs1: exactamente 2 jugadores con los mismos elementos.
  const players = format === "simultaneo" ? names.slice(0, 2) : names;

  function start() {
    const clean = players.map((n) => n.trim()).filter(Boolean);
    if (clean.length < 2) return;
    setNames((ns) => ns.map((n) => n.trim() || n));
    setSequence(makeSequence(DEMO_TARGET_COUNT));
    setRanking(null);
    setPhase("playing");
  }

  function finish(results: DueloPlayerResult[]) {
    setRanking(rankPlayers(results));
    setPhase("results");
  }

  return (
    <div>
      <h1>Duelo (práctica)</h1>
      <p>
        Mismos elementos para todos: la misma secuencia de {DEMO_TARGET_COUNT} dianas y las mismas 9 posiciones. Gana
        quien más acierta en menos tiempo. No se guarda nada (sólo esta sesión).
      </p>

      {phase === "setup" && (
        <Card title="Configurar duelo">
          <fieldset className="duelo-format">
            <legend>Formato</legend>
            <label>
              <input type="radio" name="format" checked={format === "simultaneo"} onChange={() => setFormat("simultaneo")} /> A la vez (1vs1)
            </label>
            <label>
              <input type="radio" name="format" checked={format === "turnos"} onChange={() => setFormat("turnos")} /> Por turnos (2+)
            </label>
          </fieldset>

          {(format === "simultaneo" ? names.slice(0, 2) : names).map((n, i) => (
            <div key={i} className="duelo-player-row">
              <input
                value={n}
                onChange={(e) => setNames((ns) => ns.map((x, j) => (j === i ? e.target.value : x)))}
                aria-label={`Nombre del jugador ${i + 1}`}
              />
              {format === "turnos" && names.length > 2 && (
                <button type="button" onClick={() => setNames((ns) => ns.filter((_, j) => j !== i))}>
                  Quitar
                </button>
              )}
            </div>
          ))}

          <div className="demo-actions">
            {format === "turnos" && (
              <button type="button" onClick={() => setNames((ns) => [...ns, `Jugador ${ns.length + 1}`])}>
                Añadir jugador
              </button>
            )}{" "}
            <button type="button" onClick={start}>
              Empezar duelo
            </button>
          </div>
        </Card>
      )}

      {phase === "playing" && format === "simultaneo" && (
        <SimultaneousDuelo names={[players[0], players[1]]} sequence={sequence} onDone={finish} />
      )}
      {phase === "playing" && format === "turnos" && <TurnDuelo names={players} sequence={sequence} onDone={finish} />}

      {phase === "results" && ranking && <Results ranking={ranking} onNew={() => setPhase("setup")} />}
    </div>
  );
}

/** Cronómetro por requestAnimationFrame; devuelve el tiempo vivo y controles. */
function useStopwatch() {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const tick = useCallback(() => {
    setElapsed(performance.now() - startRef.current);
    rafRef.current = requestAnimationFrame(tick);
  }, []);
  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);
  const startAt = useCallback(
    (t: number) => {
      startRef.current = t;
      stop();
      rafRef.current = requestAnimationFrame(tick);
    },
    [stop, tick],
  );
  useEffect(() => stop, [stop]);
  return { elapsed, startRef, startAt, stop };
}

/** 1vs1 A LA VEZ: dos rejillas en paralelo con la misma secuencia; ambos corren juntos. */
function SimultaneousDuelo({ names, sequence, onDone }: { names: [string, string]; sequence: number[]; onDone: (r: DueloPlayerResult[]) => void }) {
  const { elapsed, startRef, startAt, stop } = useStopwatch();
  const [steps, setSteps] = useState<[number, number]>([0, 0]);
  const [started, setStarted] = useState(false);

  function begin() {
    setSteps([0, 0]);
    setStarted(true);
    startAt(performance.now());
  }

  function hit(player: 0 | 1, idx: number) {
    if (!started || idx !== sequence[steps[player]]) return;
    const nextStep = steps[player] + 1;
    if (nextStep >= sequence.length) {
      // Carrera 1vs1: el PRIMERO que completa gana; la ronda termina en ese
      // instante y el rival se queda con los aciertos que llevaba. Así "más
      // aciertos en menos tiempo" se cumple de verdad (el ganador completó).
      stop();
      const time = Math.round(performance.now() - startRef.current);
      const other: 0 | 1 = player === 0 ? 1 : 0;
      const result: DueloPlayerResult[] = [];
      result[player] = { name: names[player], hits: sequence.length, timeMs: time };
      result[other] = { name: names[other], hits: steps[other], timeMs: time };
      onDone([result[0], result[1]]);
    } else {
      const ns: [number, number] = [...steps] as [number, number];
      ns[player] = nextStep;
      setSteps(ns);
    }
  }

  if (!started) {
    return (
      <Card title="A la vez — preparados">
        <p>
          {names[0]} y {names[1]} juegan al mismo tiempo, cada uno en su rejilla, con la misma secuencia. ¡A la de ya!
        </p>
        <div className="demo-actions">
          <button type="button" onClick={begin}>
            ¡Ya!
          </button>
        </div>
      </Card>
    );
  }

  return (
    <Card title="Duelo a la vez">
      <p className="demo-timer" role="status" aria-live="off">
        {formatTime(elapsed)}
      </p>
      <div className="duelo-arena">
        {([0, 1] as const).map((p) => {
          const current = sequence[steps[p]];
          return (
            <div key={p} className="duelo-side">
              <h3>
                {names[p]} · {steps[p]}/{sequence.length}
              </h3>
              <div className="target-grid-3x3" role="group" aria-label={`Dianas de ${names[p]}`}>
                {Array.from({ length: 9 }, (_, i) => i + 1).map((idx) => (
                  <TargetLight key={idx} targetIndex={idx} state={idx === current ? "active" : "off"} size="md" onClick={idx === current ? () => hit(p, idx) : undefined} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** Por turnos (hot-seat): cada jugador juega su turno con la misma secuencia. */
function TurnDuelo({ names, sequence, onDone }: { names: string[]; sequence: number[]; onDone: (r: DueloPlayerResult[]) => void }) {
  const { elapsed, startRef, startAt, stop } = useStopwatch();
  const [turn, setTurn] = useState(0);
  const [step, setStep] = useState(0);
  const [results, setResults] = useState<DueloPlayerResult[]>([]);
  const [awaiting, setAwaiting] = useState(true);

  function beginTurn() {
    setStep(0);
    setAwaiting(false);
    startAt(performance.now());
  }

  function hit(idx: number) {
    if (awaiting || idx !== sequence[step]) return;
    const next = step + 1;
    if (next >= sequence.length) {
      stop();
      const time = Math.round(performance.now() - startRef.current);
      const updated = [...results, { name: names[turn], hits: sequence.length, timeMs: time }];
      setResults(updated);
      if (turn + 1 >= names.length) {
        onDone(updated);
      } else {
        setTurn(turn + 1);
        setAwaiting(true);
      }
    } else {
      setStep(next);
    }
  }

  const current = awaiting ? -1 : sequence[step];

  return (
    <Card title={awaiting ? `Prepara el turno de ${names[turn]}` : `Turno de ${names[turn]} · diana ${step + 1} de ${sequence.length}`}>
      {awaiting ? (
        <div className="demo-actions">
          <p>Pasa el mando a {names[turn]}.</p>
          <button type="button" onClick={beginTurn}>
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
              <TargetLight key={idx} targetIndex={idx} state={idx === current ? "active" : "off"} size="lg" onClick={idx === current ? () => hit(idx) : undefined} />
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

function Results({ ranking, onNew }: { ranking: DueloRanking; onNew: () => void }) {
  return (
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
        <button type="button" onClick={onNew}>
          Nuevo duelo
        </button>
      </div>
    </Card>
  );
}
