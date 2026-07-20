import { useState } from "react";
import { apiClient } from "../../api";
import { useAsync } from "../../hooks/useAsync";
import { Card, ErrorState, LoadingState } from "../../components/ui/Feedback";

export function BackupsPage() {
  const { data, loading, error, reload } = useAsync(() => apiClient.listBackups(), []);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function trigger() {
    setCreating(true);
    setMessage(null);
    try {
      await apiClient.triggerBackup();
      setMessage("Copia de seguridad iniciada.");
      reload();
    } catch {
      setMessage("No se pudo iniciar la copia de seguridad. Inténtelo de nuevo.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <h1>Copias y estado del sistema</h1>
      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {message && <p role="status">{message}</p>}

      <Card title="Copias de seguridad" actions={
        <button type="button" onClick={trigger} disabled={creating}>
          {creating ? "Creando…" : "Crear copia ahora"}
        </button>
      }>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Fecha</th>
                <th scope="col">Tipo</th>
                <th scope="col">Tamaño</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((b) => (
                <tr key={b.id}>
                  <td>{new Date(b.created_at).toLocaleString("es-ES")}</td>
                  <td>{b.kind === "auto" ? "Automática" : "Manual"}</td>
                  <td>{Math.round(b.size_bytes / (1024 * 1024))} MiB</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
