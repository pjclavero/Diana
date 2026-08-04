import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { getDiagnostics, testSensor } from "../../api/diagnosticsApi";
import type { DiagnosticResult } from "../../api/client";
import { Card } from "../../components/ui/Feedback";
import { BackButton } from "../../components/ui/BackButton";

const REFRESH_MS = 3000;

/** Resultados que interesan de una prueba de sensores. */
const SENSOR_KINDS = ["self_test_result", "sensor_error", "calibration_result"];

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString();
}

function formatDiagnosticWhen(result: DiagnosticResult): string {
  return result.occurredAt
    ? `Hora del módulo: ${formatWhen(result.occurredAt)}`
    : `Módulo sin reloj · recibido: ${formatWhen(result.receivedAt)}`;
}

/**
 * Prueba de sensores (F6).
 *
 * Esta pantalla pedía la prueba y pintaba «Sensor OK» con una amplitud. Contra
 * el backend real eso sólo se podía cumplir inventando una medida: el comando
 * viaja por MQTT y el módulo contesta cuando puede, por `diagnostic`. Aquí se
 * ordena la prueba y se muestra **lo que el módulo ha contestado de verdad**; si
 * no ha contestado, se dice que se está esperando.
 */
export function TestSensorsPage() {
  const { moduleId = "" } = useParams();
  const [ordered, setOrdered] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<DiagnosticResult[]>([]);
  const [note, setNote] = useState<string | null>(null);
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
      const data = await getDiagnostics(moduleId);
      if (!mounted.current) return;
      setResults(data.items.filter((i) => SENSOR_KINDS.includes(i.kind)));
      setNote(data.note);
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : "No se pudo consultar.");
    }
  }, [moduleId]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  async function test(targetIndex: number) {
    setBusy(true);
    setError(null);
    try {
      const ack = await testSensor(moduleId, targetIndex);
      setOrdered(
        ack.delivered === false
          ? "La orden NO llegó al broker: el módulo no la ha recibido."
          : `Prueba pedida${ack.scope === "module" ? " para el módulo completo" : ""}. ` +
              "Esperando la respuesta del módulo…",
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo pedir la prueba.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <div>
      <BackButton />
      <h1>Prueba de sensores · módulo {moduleId}</h1>

      <Card title="Pedir la prueba">
        <p>
          El contrato de módulos no tiene una prueba de sensor por diana: se pide el{" "}
          <strong>autodiagnóstico del módulo completo</strong>. Pedirla no da el resultado — lo
          publica el módulo cuando termina, y aparece abajo.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Diana</th>
                <th scope="col">Acción</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 9 }, (_, i) => i + 1).map((idx) => (
                <tr key={idx}>
                  <th scope="row">{idx}</th>
                  <td>
                    <button type="button" onClick={() => test(idx)} disabled={busy}>
                      Probar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {ordered && <p role="status">{ordered}</p>}
        {error && <p role="alert">{error}</p>}
      </Card>

      <Card title="Lo que ha contestado el módulo">
        {results.length === 0 ? (
          <p>{note ?? "Sin respuestas todavía. No se da por buena ninguna diana."}</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Cuándo</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Gravedad</th>
                  <th scope="col">Mensaje</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.id}>
                    <td>{formatDiagnosticWhen(r)}</td>
                    <td>{r.kind}</td>
                    <td>{r.severity}</td>
                    <td>{r.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
