import { useState } from "react";
import { apiClient } from "../../api";
import { useAsync } from "../../hooks/useAsync";
import { Card, EmptyState, ErrorState, LoadingState } from "../../components/ui/Feedback";

const SEVERITY_LABEL: Record<string, string> = { info: "Información", warning: "Aviso", critical: "Crítica" };

export function IncidentsPage() {
  const { data, loading, error, reload } = useAsync(() => apiClient.listIncidents(), []);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function resolve(id: string) {
    setBusyId(id);
    try {
      await apiClient.resolveIncident(id);
      reload();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <h1>Incidencias</h1>
      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && data.length === 0 && <EmptyState>No hay incidencias registradas.</EmptyState>}

      <Card title="Registro de incidencias">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Fecha</th>
                <th scope="col">Severidad</th>
                <th scope="col">Origen</th>
                <th scope="col">Mensaje</th>
                <th scope="col">Estado</th>
                <th scope="col">Acción</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((i) => (
                <tr key={i.id}>
                  <td>{new Date(i.created_at).toLocaleString("es-ES")}</td>
                  <td>{SEVERITY_LABEL[i.severity] ?? i.severity}</td>
                  <td>{i.source}</td>
                  <td>{i.message}</td>
                  <td>{i.resolved ? "Resuelta" : "Abierta"}</td>
                  <td>
                    {!i.resolved && (
                      <button type="button" onClick={() => resolve(i.id)} disabled={busyId === i.id}>
                        {busyId === i.id ? "Resolviendo…" : "Marcar resuelta"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
