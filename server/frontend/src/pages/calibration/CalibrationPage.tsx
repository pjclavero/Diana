import { useState } from "react";
import { useParams } from "react-router-dom";
import { apiClient } from "../../api";
import { useAsync } from "../../hooks/useAsync";
import { Card, ErrorState, LoadingState } from "../../components/ui/Feedback";
import { BackButton } from "../../components/ui/BackButton";

export function CalibrationPage() {
  const { moduleId = "" } = useParams();
  const { data: config, loading, error, reload } = useAsync(() => apiClient.getModuleConfig(moduleId), [moduleId]);
  const [running, setRunning] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function calibrate(targetIndex: number) {
    setRunning(targetIndex);
    setMessage(null);
    try {
      await apiClient.calibrateTarget(moduleId, targetIndex);
      setMessage(`Calibración enviada a la diana ${targetIndex}.`);
    } catch {
      setMessage(`No se pudo calibrar la diana ${targetIndex}. Inténtelo de nuevo.`);
    } finally {
      setRunning(null);
    }
  }

  return (
    <div>
      <BackButton />
      <h1>Calibración · módulo {moduleId}</h1>
      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {message && <p role="status">{message}</p>}

      {config && (
        <Card title="Parámetros por diana">
          <div className="table-scroll">
            <table>
              <caption className="sr-only">Parámetros de calibración de las 9 dianas</caption>
              <thead>
                <tr>
                  <th scope="col">Diana</th>
                  <th scope="col">Umbral</th>
                  <th scope="col">Histéresis</th>
                  <th scope="col">Ruido base</th>
                  <th scope="col">Blanking (µs)</th>
                  <th scope="col">Ventana grupo (µs)</th>
                  <th scope="col">Ratio vecino</th>
                  <th scope="col">Habilitada</th>
                  <th scope="col">Acción</th>
                </tr>
              </thead>
              <tbody>
                {config.calibration.map((c) => (
                  <tr key={c.target_index}>
                    <th scope="row">{c.target_index}</th>
                    <td>{c.threshold}</td>
                    <td>{c.hysteresis}</td>
                    <td>{c.noise_floor}</td>
                    <td>{c.blanking_us}</td>
                    <td>{c.group_window_us}</td>
                    <td>{c.neighbour_ratio}</td>
                    <td>{c.enabled ? "sí" : "no"}</td>
                    <td>
                      <button type="button" onClick={() => calibrate(c.target_index)} disabled={running === c.target_index}>
                        {running === c.target_index ? "Calibrando…" : "Recalibrar"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
