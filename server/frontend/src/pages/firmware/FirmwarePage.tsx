import { apiClient } from "../../api";
import { useAsync } from "../../hooks/useAsync";
import { Card, EmptyState, ErrorState, LoadingState } from "../../components/ui/Feedback";

export function FirmwarePage() {
  const { data, loading, error, reload } = useAsync(() => apiClient.listFirmware(), []);

  return (
    <div>
      <h1>Firmware</h1>
      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && data.length === 0 && <EmptyState>No hay versiones de firmware publicadas.</EmptyState>}

      <Card title="Versiones publicadas">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Versión</th>
                <th scope="col">Placa</th>
                <th scope="col">Tamaño</th>
                <th scope="col">SHA-256</th>
                <th scope="col">Publicado</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((f) => (
                <tr key={f.version}>
                  <td>{f.version}</td>
                  <td>{f.target_board}</td>
                  <td>{Math.round(f.size_bytes / 1024)} KiB</td>
                  <td>
                    <code>{f.sha256.slice(0, 12)}…</code>
                  </td>
                  <td>{new Date(f.released_at).toLocaleDateString("es-ES")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
