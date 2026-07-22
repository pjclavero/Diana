import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "../../components/ui/Feedback";
import { TargetLight } from "../../components/target/TargetLight";
import type { TargetState } from "../../types/domain";
import { DEMO_TARGET_COUNT, formatTime, loadTimes, makeSequence, pushTime, saveTimes } from "./demoLogic";
import "./DemoPage.css";

type Phase = "idle" | "running" | "done";

/**
 * G-E · Modo demo (§6.4). Práctica sin jugadores ni BD: saca N dianas aleatorias,
 * las vas "impactando" (tocando la encendida) y mide el tiempo. Al relanzar, repite.
 * Efímero: los 10 últimos tiempos viven SÓLO en la sesión (se pierden al cerrar).
 *
 * Sin hardware conectado, el "impacto" se simula tocando la diana encendida en el
 * panel; con módulos reales, el mismo flujo lo dispararía el evento de impacto.
 */
export function DemoPage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [sequence, setSequence] = useState<number[]>([]);
  const [step, setStep] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [times, setTimes] = useState<number[]>(() => loadTimes());
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

  function start() {
    setSequence(makeSequence(DEMO_TARGET_COUNT));
    setStep(0);
    setElapsed(0);
    setPhase("running");
    startRef.current = performance.now();
    stopTicking();
    rafRef.current = requestAnimationFrame(tick);
  }

  function hit(index: number) {
    if (phase !== "running" || index !== sequence[step]) return;
    const next = step + 1;
    if (next >= sequence.length) {
      stopTicking();
      const total = performance.now() - startRef.current;
      setElapsed(total);
      setPhase("done");
      const updated = pushTime(times, Math.round(total));
      setTimes(updated);
      saveTimes(updated);
    } else {
      setStep(next);
    }
  }

  const current = phase === "running" ? sequence[step] : -1;

  function stateFor(idx: number): TargetState {
    return idx === current ? "active" : "off";
  }

  return (
    <div>
      <h1>Modo demo</h1>
      <p>
        Práctica rápida sin jugadores ni registro. Se encienden {DEMO_TARGET_COUNT} dianas al azar; impacta la
        encendida lo más rápido que puedas. No se guarda nada: los tiempos son sólo de esta sesión.
      </p>

      <Card title={phase === "running" ? `Diana ${step + 1} de ${sequence.length}` : "Listo para empezar"}>
        <p className="demo-timer" role="status" aria-live="off">
          {formatTime(elapsed)}
        </p>
        <div className="target-grid-3x3" role="group" aria-label="Dianas del demo">
          {Array.from({ length: 9 }, (_, i) => i + 1).map((idx) => (
            <TargetLight
              key={idx}
              targetIndex={idx}
              state={stateFor(idx)}
              size="lg"
              onClick={phase === "running" && idx === current ? () => hit(idx) : undefined}
            />
          ))}
        </div>
        <div className="demo-actions">
          <button type="button" onClick={start}>
            {phase === "idle" ? "Empezar demo" : "Repetir"}
          </button>
        </div>
        {phase === "done" && (
          <p role="status" className="demo-result">
            ¡Hecho! Tiempo: <strong>{formatTime(elapsed)}</strong>
          </p>
        )}
      </Card>

      {times.length > 0 && (
        <Card title="Últimos 10 tiempos (sólo esta sesión)">
          <ol className="demo-times">
            {times.map((t, i) => (
              <li key={i}>{formatTime(t)}</li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}
