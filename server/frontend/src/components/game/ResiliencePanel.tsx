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
 * Cada cuánto se comprueba. Se dice el valor real en vez de «unos segundos»,
 * que era una magnitud que el backend no publicaba y que deja de ser cierta si
 * alguien configura un intervalo largo.
 */
function formatInterval(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

/** Cuánto lleva callado un módulo, en lenguaje llano. */
function formatSilence(ms: number | null): string {
  if (ms === null) return "sin señal de vida registrada";
  if (ms < 60_000) return `callado desde hace ${Math.round(ms / 1000)} s`;
  const min = Math.floor(ms / 60_000);
  return min < 60 ? `callado desde hace ${min} min` : `callado desde hace ${Math.floor(min / 60)} h`;
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

  async function decide(action: "resume" | "resume_without" | "abort") {
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

  // Sin nada que decidir no se ocupa sitio. OJO: una ronda pausada por una
  // caída sigue necesitando decisión aunque el módulo ya haya vuelto; si no, se
  // quedaba congelada y sin salida en el panel.
  // Un módulo callado todavía no declarado caído también obliga a mirar: el
  // barrido puede tardar unos segundos y el operador no debe enterarse después.
  const stale = status?.staleModules ?? [];
  if (!status || (!status.operatorMustDecide && stale.length === 0)) return null;

  return (
    <Card
      title={
        status.coordinatorDown
          ? status.paused
            ? "Pausa dura: ha caído el coordinador"
            : "Ha caído el coordinador"
          : !status.operatorMustDecide
            ? "Módulo sin señal"
            : "Módulo caído"
      }
    >
      <div className="resilience" role="alert">
        {status.coordinatorDown ? (
          <p>
            <strong>Sin coordinador no hay tiempos fiables.</strong>{" "}
            {status.paused
              ? status.note
              : "La ronda no está en curso, así que no hay nada que pausar; no podrá empezar hasta que vuelva."}
          </p>
        ) : status.missingModules.length > 0 ? (
          <p>
            {status.paused ? "La ronda está en pausa." : "La ronda NO está en pausa."} Faltan:{" "}
            <strong>
              {status.missingModules
                .map((m) => `${m.slug} (${formatSilence(m.silentForMs)})`)
                .join(", ")}
            </strong>{" "}
            de {status.involvedModules} módulo(s) implicados.
          </p>
        ) : !status.operatorMustDecide ? null : (
          <p>
            Todos los módulos han vuelto. La ronda sigue <strong>en pausa</strong>: reanudarla es
            decisión suya.
          </p>
        )}

        {/* Fuera del bloque anterior a propósito: con un módulo ya caído, otro
            que lleve minutos callado quedaba oculto y el operador decidía sin
            saberlo (N6). */}
        {stale.length > 0 && (
          <p>
            <strong>{stale.map((m) => m.slug).join(", ")}</strong> figura(n) en línea pero lleva(n)
            demasiado tiempo sin dar señal de vida (
            {stale.map((m) => formatSilence(m.silentForMs)).join(", ")}).{" "}
            {/* No prometer una pausa que el barrido no va a hacer (N-D1). */}
            {!status.sweep.enabled
              ? "La detección automática de caídas está DESACTIVADA por configuración: nadie va " +
                "a pausar la ronda por este silencio. Decida usted."
              : !status.sweep.listening
                ? "El servidor no lleva suficiente tiempo oyendo al broker, así que este " +
                  "silencio puede ser suyo y no de los módulos: no se pausará nada hasta " +
                  "recuperar la escucha."
                : status.sweep.blackout
                  ? "Han callado a la vez TODOS los módulos en línea del sistema, no sólo los " +
                    "de este panel: es más probable un fallo del broker, de la red o de la " +
                    "corriente que la caída de cada uno, así que no se declara ninguna caída de " +
                    "momento. Si el silencio persiste unos minutos, se declararán igualmente y " +
                    "la ronda se pausará. Revise el broker y la alimentación."
                  : `Si no vuelve(n), la ronda se pausará sola (se comprueba cada ${formatInterval(status.sweep.intervalMs)}).`}
          </p>
        )}

        {status.pauseCommandDelivered === false && (
          <p>
            <strong>Atención:</strong> la orden de pausa no llegó al coordinador
            {status.brokerConnected === false ? " (sin conexión con el broker MQTT)" : ""}. El
            hardware puede seguir en marcha aunque aquí figure pausada.
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

        {/* Sin caída declarada no hay nada que decidir todavía: sólo se avisa. */}
        <div className="resilience__actions" hidden={!status.operatorMustDecide}>
          {status.canResume && (
            <button type="button" onClick={() => decide("resume")} disabled={busy}>
              Reanudar
            </button>
          )}
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
          <button
            type="button"
            onClick={() => decide("abort")}
            disabled={busy || !status.paused}
            title={status.paused ? "Aborta la ronda" : "La ronda no está en curso"}
          >
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
