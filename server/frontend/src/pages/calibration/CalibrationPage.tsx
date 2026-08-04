import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  abortCalibration,
  calibrateTarget,
  getDiagnostics,
  type DiagnosticItem,
} from "../../api/diagnosticsApi";
import { Card, ErrorState } from "../../components/ui/Feedback";
import { BackButton } from "../../components/ui/BackButton";

/** Los diagnósticos que informan de una calibración, según el contrato v1. */
const CALIBRATION_KINDS = ["calibration_result", "sensor_error"];
const TARGETS = Array.from({ length: 9 }, (_, i) => i + 1);
const POLL_MS = 3000;

function formatWhen(item: DiagnosticItem): string {
  if (item.timeBasis === "module_epoch" && item.occurredAt) {
    return `Hora del módulo: ${new Date(item.occurredAt).toLocaleString()}`;
  }
  return `Módulo sin reloj · recibido: ${new Date(item.receivedAt).toLocaleString()}`;
}

/**
 * Calibración de dianas (F6), contra la API real.
 *
 * Esta pantalla mostraba una tabla de parámetros por diana —umbral, histéresis,
 * ruido base, ventana de grupo…— que salía del adaptador de demostración: eran
 * números inventados. El backend **no expone** `/modules/:id/config`, así que
 * esa tabla no se podía cablear sin construir antes ese endpoint.
 *
 * Se ha quitado en vez de conservarla con datos falsos. Lo que queda es lo que
 * el sistema sabe de verdad: ordenar la calibración de una diana, abortarla, y
 * enseñar **lo que el módulo ha respondido**. Cuando exista la configuración
 * real por diana, se añade aquí.
 */
export function CalibrationPage() {
  const { moduleId = "" } = useParams();
  const [running, setRunning] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<DiagnosticItem[] | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await getDiagnostics(moduleId);
      setItems(data.items.filter((i) => CALIBRATION_KINDS.includes(i.kind)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron leer los resultados.");
    }
  }, [moduleId]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  async function calibrate(targetIndex: number) {
    setRunning(targetIndex);
    setMessage(null);
    setError(null);
    try {
      const ack = await calibrateTarget(moduleId, targetIndex);
      // Igual que en la prueba de LED: «he publicado» no es «ha llegado».
      // El contrato v1 calibra el MÓDULO entero: decirlo evita que el operador
      // crea que ha calibrado sólo esa diana.
      const alcance = ack.scope === 'module' ? ' Se calibra el MÓDULO completo, no sólo esa diana.' : '';
      setMessage(
        ack.delivered
          ? `Calibración ordenada desde la diana ${targetIndex}.${alcance} El resultado lo publica el módulo.`
          : `La orden NO llegó al broker: queda encolada.${alcance}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo ordenar la calibración.");
    } finally {
      setRunning(null);
    }
  }

  async function abort() {
    setRunning(-1);
    setMessage(null);
    setError(null);
    try {
      const ack = await abortCalibration(moduleId);
      setMessage(
        ack.delivered ? "Calibración abortada." : "La orden de abortar NO llegó al broker.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo abortar.");
    } finally {
      setRunning(null);
    }
  }

  return (
    <div>
      <BackButton />
      <h1>Calibración · módulo {moduleId}</h1>
      {message && <p role="status">{message}</p>}
      {error && <ErrorState message={error} />}

      <Card
        title="Ordenar calibración por diana"
        actions={
          <button type="button" onClick={abort} disabled={running !== null}>
            Abortar calibración
          </button>
        }
      >
        <p>
          Calibrar mide el ruido de fondo del sensor. <strong>El contrato del firmware calibra
          el módulo completo</strong>, no una diana suelta: se elige una diana para comprobar
          que está habilitada, pero la orden alcanza a las nueve. El módulo responde cuando
          termina y su resultado aparece abajo.
        </p>
        <ul className="target-actions">
          {TARGETS.map((t) => (
            <li key={t}>
              <button type="button" onClick={() => calibrate(t)} disabled={running !== null}>
                {running === t ? "Ordenando…" : `Calibrar desde la diana ${t}`}
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Lo que ha respondido el módulo">
        {items === null ? (
          <p>Consultando…</p>
        ) : items.length === 0 ? (
          <p>
            El módulo no ha respondido a ninguna calibración todavía. Aquí no se muestra nada
            hasta que lo haga.
          </p>
        ) : (
          <ul>
            {items.map((i) => (
              <li key={i.id}>
                <strong>{i.kind}</strong> · {i.severity} · {i.message}
                <br />
                <small>{formatWhen(i)}</small>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
