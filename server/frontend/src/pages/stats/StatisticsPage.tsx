import { apiClient } from "../../api";
import { useAsync } from "../../hooks/useAsync";
import { Card, EmptyState, ErrorState, LoadingState } from "../../components/ui/Feedback";
import { ACCURACY_NOT_COMPUTABLE_TEXT } from "../../utils/accuracy";

export function StatisticsPage() {
  const { data: results, loading, error, reload } = useAsync(() => apiClient.listResults(), []);

  const perPlayer = new Map<string, { games: number; validHits: number; incorrect: number; computableAccuracies: number[] }>();
  for (const g of results ?? []) {
    for (const r of g.results) {
      const acc = perPlayer.get(r.player_id) ?? { games: 0, validHits: 0, incorrect: 0, computableAccuracies: [] };
      acc.games += 1;
      acc.validHits += r.hits_valid;
      acc.incorrect += r.hits_incorrect;
      if (r.accuracy.status === "computable" && r.accuracy.valid_accuracy_pct !== null) {
        acc.computableAccuracies.push(r.accuracy.valid_accuracy_pct);
      }
      perPlayer.set(r.player_id, acc);
    }
  }

  return (
    <div>
      <h1>Estadísticas</h1>
      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {perPlayer.size === 0 && !loading && <EmptyState>Todavía no hay partidas con las que calcular estadísticas.</EmptyState>}

      {perPlayer.size > 0 && (
        <Card title="Resumen por jugador">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Jugador</th>
                  <th scope="col">Partidas</th>
                  <th scope="col">Aciertos totales</th>
                  <th scope="col">Incorrectos totales</th>
                  <th scope="col">Precisión media (partidas calculables)</th>
                </tr>
              </thead>
              <tbody>
                {[...perPlayer.entries()].map(([playerId, s]) => (
                  <tr key={playerId}>
                    <td>{playerId}</td>
                    <td>{s.games}</td>
                    <td>{s.validHits}</td>
                    <td>{s.incorrect}</td>
                    <td>
                      {s.computableAccuracies.length > 0
                        ? `${(s.computableAccuracies.reduce((a, b) => a + b, 0) / s.computableAccuracies.length).toFixed(1)}%`
                        : ACCURACY_NOT_COMPUTABLE_TEXT}
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
