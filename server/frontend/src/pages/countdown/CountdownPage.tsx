import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiClient } from "../../api";
import { Card, ErrorState } from "../../components/ui/Feedback";

export function CountdownPage() {
  const { gameId = "" } = useParams();
  const navigate = useNavigate();
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        await apiClient.startGame(gameId);
        if (!cancelled) setStarted(true);
      } catch {
        if (!cancelled) setError("No se ha podido iniciar la partida. Compruebe la conexión con los módulos.");
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  useEffect(() => {
    if (!started) return;
    const t = setTimeout(() => navigate(`/partidas/${gameId}/directo`), 1500);
    return () => clearTimeout(t);
  }, [started, gameId, navigate]);

  return (
    <div>
      <h1>Cuenta atrás</h1>
      {error && <ErrorState message={error} />}
      <Card title={`Partida ${gameId}`}>
        <p role="status" aria-live="assertive">
          {started ? "Preparados… la partida comienza." : "Enviando orden de inicio a los módulos…"}
        </p>
      </Card>
    </div>
  );
}
