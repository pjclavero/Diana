import { useCallback, useEffect, useRef, useState } from "react";
import {
  decideResilience,
  getResilienceStatus,
  type ResilienceStatus,
} from "../../api/resilienceApi";
import { Card } from "../ui/Feedback";
import "./ResiliencePanel.css";

const POLL_MS = 2000;

function formatSeconds(ms: number): string {
  return `${Math.ceil(ms / 1000)} s`;
}

/**
 * Aviso de caída de módulo durante una ronda (G-I, §6.3): qué falta, cuánto
 * queda de la ventana de reconexión y las dos únicas salidas que tiene el
 * operador. El backend nunca reanuda solo.
 */
export function ResiliencePanel({ gameId }: { gameId: string }) {
  const [status, setStatus] = useState<ResilienceStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await getResilienceStatus(gameId);
      if (mounted.current) setStatus(data);
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : "No se pudo consultar el estado.");
    }
  }, [gameId]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  async function decide(action: "resume_without" | "abort") {
    setBusy(true);
    setError(null);
    try {
      await decideResilience(gameId, action);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo aplicar la decisión.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  // Sin caídas no se ocupa sitio en pantalla.
  if (!status || (!status.operatorMustDecide && status.missingModules.length === 0)) return null;

  return (
    <Card title={status.coordinatorDown ? "Pausa dura: ha caído el coordinador" : "Módulo caído"}>
      <div className="resilience" role="alert">
        {status.coordinatorDown ? (
          <p>
            <strong>Sin coordinador no hay tiempos fiables.</strong> {status.note}
          </p>
        ) : (
          <p>
            La ronda está en pausa automática. Faltan:{" "}
            <strong>{status.missingModules.map((m) => m.slug).join(", ")}</strong> de{" "}
            {status.involvedModules} módulo(s) implicados.
          </p>
        )}

        {status.countdown && (
          <p>
            {status.countdown.expired
              ? "Se agotó la ventana de reconexión: decida cómo continuar."
              : `Esperando reconexión: quedan ${formatSeconds(status.countdown.remainingMs)}.`}
          </p>
        )}

        {error && <p role="status">{error}</p>}

        <div className="resilience__actions">
          <button
            type="button"
            onClick={() => decide("resume_without")}
            disabled={busy || !status.canResumeWithout}
            title={
              status.canResumeWithout
                ? "Reanuda la ronda sin los módulos ausentes"
                : "No se puede reanudar sin el coordinador"
            }
          >
            Reanudar sin él
          </button>
          <button type="button" onClick={() => decide("abort")} disabled={busy}>
            Abortar la ronda
          </button>
        </div>
        <p className="resilience__note">
          Reanudar sin un módulo cambia las condiciones de la prueba y queda registrado como tal.
        </p>
      </div>
    </Card>
  );
}
