import { useParams } from "react-router-dom";
import { apiClient } from "../../api";
import { useAsync } from "../../hooks/useAsync";
import { Card, EmptyState, ErrorState, LoadingState } from "../../components/ui/Feedback";
import { ACCURACY_NOT_COMPUTABLE_TEXT } from "../../utils/accuracy";

export function ResultsPage() {
  const { gameId } = useParams();
  const { data: results, loading, error, reload } = useAsync(() => apiClient.listResults(), []);

  const filtered = gameId ? results?.filter((r) => r.game_id === gameId) : results;

  return (
    <div>
      <h1>Resultados</h1>
      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {filtered && filtered.length === 0 && <EmptyState>No hay partidas finalizadas todavía.</EmptyState>}

      {filtered?.map((g) => (
        <Card key={g.game_id} title={`Partida ${g.game_id} · ${g.mode}`}>
          <p>
            Inicio: {new Date(g.started_at).toLocaleString("es-ES")} · Fin:{" "}
            {g.finished_at ? new Date(g.finished_at).toLocaleString("es-ES") : "en curso"} · Fase: {g.phase}
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Jugador</th>
                  <th scope="col">Aciertos</th>
                  <th scope="col">Incorrectos</th>
                  <th scope="col">Penalizaciones</th>
                  <th scope="col">Tiempo total</th>
                  <th scope="col">Precisión total</th>
                  <th scope="col">Precisión válida</th>
                </tr>
              </thead>
              <tbody>
                {g.results.map((r) => (
                  <tr key={r.player_id}>
                    <td>{r.player_id}</td>
                    <td>{r.hits_valid}</td>
                    <td>{r.hits_incorrect}</td>
                    <td>{r.penalties}</td>
                    <td>{(r.total_time_ms / 1000).toFixed(1)} s</td>
                    <td colSpan={r.accuracy.status === "not_computable" ? 2 : 1}>
                      {r.accuracy.status === "not_computable" ? (
                        <span role="note">{ACCURACY_NOT_COMPUTABLE_TEXT}</span>
                      ) : (
                        `${r.accuracy.total_accuracy_pct?.toFixed(1)}%`
                      )}
                    </td>
                    {r.accuracy.status !== "not_computable" && <td>{r.accuracy.valid_accuracy_pct?.toFixed(1)}%</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </div>
  );
}
