import { Link } from "react-router-dom";
import { apiClient } from "../../api";
import { DEFAULT_SYSTEM_ID } from "../../config";
import { useAsync } from "../../hooks/useAsync";
import { Card, ErrorState, LoadingState } from "../../components/ui/Feedback";
import "./ModulesPage.css";

const MODULE_STATE_LABEL: Record<string, string> = {
  boot: "Arrancando",
  selftest: "Autodiagnóstico",
  network: "Conectando red",
  registering: "Registrando",
  ready: "Listo",
  calibration: "Calibrando",
  maintenance: "Mantenimiento",
  game_prepare: "Preparando partida",
  game_countdown: "Cuenta atrás",
  game_active: "Partida activa",
  game_paused: "Partida en pausa",
  game_finished: "Partida finalizada",
  error: "Error",
};

const ROLE_LABEL: Record<string, string> = { principal: "Principal", satellite: "Satélite", auto: "Automático" };

export function ModulesPage() {
  const { data, loading, error, reload } = useAsync(() => apiClient.listModules(DEFAULT_SYSTEM_ID), []);

  return (
    <div>
      <h1>Módulos conectados</h1>
      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <div className="module-cards">
          {data.map((m) => (
            <Card key={m.module_id} title={m.module_id}>
              <p>
                Estado: <strong>{MODULE_STATE_LABEL[m.state] ?? m.state}</strong>
              </p>
              <p>
                Rol: {ROLE_LABEL[m.role]} · Selector: {m.selector}
              </p>
              <p>
                Posición: ({m.position.x}, {m.position.y}) · Rotación {m.rotation}°
              </p>
              <p>
                Firmware {m.firmware_version} · {m.targets.filter((t) => t.state === "active").length} dianas activas
              </p>
              <nav aria-label={`Acciones de ${m.module_id}`}>
                <Link to={`/modulos/${m.module_id}`}>Ver 9 dianas</Link>
                {" · "}
                <Link to={`/modulos/${m.module_id}/calibracion`}>Calibración</Link>
                {" · "}
                <Link to={`/modulos/${m.module_id}/prueba-sensores`}>Prueba sensores</Link>
                {" · "}
                <Link to={`/modulos/${m.module_id}/prueba-leds`}>Prueba LED</Link>
              </nav>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
