import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiClient } from "../../api";
import { useAsync } from "../../hooks/useAsync";
import { Card, ErrorState, LoadingState } from "../../components/ui/Feedback";
import { BackButton } from "../../components/ui/BackButton";
import { TargetLight } from "../../components/target/TargetLight";
import { rotatedTargetIndices } from "../../utils/gridRotation";
import "./ModuleDetailPage.css";

export function ModuleDetailPage() {
  const { moduleId = "" } = useParams();
  const { data: module, loading, error, reload } = useAsync(() => apiClient.getModule(moduleId), [moduleId]);
  const { data: telemetry } = useAsync(() => apiClient.getModuleTelemetry(moduleId), [moduleId]);
  const [identifying, setIdentifying] = useState(false);

  const targetsByIndex = new Map((module?.targets ?? []).map((t) => [t.target_index, t]));
  const order = module ? rotatedTargetIndices(module.rotation) : [];

  async function handleIdentify() {
    setIdentifying(true);
    try {
      await apiClient.identifyModule(moduleId, 4000);
    } finally {
      setTimeout(() => setIdentifying(false), 4000);
    }
  }

  return (
    <div>
      <BackButton />
      <h1>Módulo {moduleId}</h1>
      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={reload} />}

      {module && (
        <>
          <Card
            title="Las 9 dianas"
            actions={
              <button type="button" onClick={handleIdentify} disabled={identifying}>
                {identifying ? "Identificando…" : "Identificar módulo (parpadeo)"}
              </button>
            }
          >
            <p>
              Posición ({module.position.x}, {module.position.y}) · Rotación {module.rotation}° · Rol {module.role}
            </p>
            <div className="target-grid-3x3" role="group" aria-label="Estado de las 9 dianas del módulo">
              {order.map((idx) => {
                const t = targetsByIndex.get(idx);
                return <TargetLight key={idx} targetIndex={idx} state={t?.state ?? "off"} size="lg" />;
              })}
            </div>
          </Card>

          <Card title="Enlaces">
            <nav aria-label={`Más acciones sobre ${moduleId}`}>
              <ul>
                <li>
                  <Link to={`/modulos/${moduleId}/calibracion`}>Calibración</Link>
                </li>
                <li>
                  <Link to={`/modulos/${moduleId}/prueba-sensores`}>Prueba de sensores</Link>
                </li>
                <li>
                  <Link to={`/modulos/${moduleId}/prueba-leds`}>Prueba de LED</Link>
                </li>
              </ul>
            </nav>
          </Card>

          {telemetry && (
            <Card title="Diagnóstico rápido">
              <dl className="kv-list">
                <div>
                  <dt>Uptime</dt>
                  <dd>{telemetry.uptime_s} s</dd>
                </div>
                <div>
                  <dt>Memoria libre</dt>
                  <dd>{Math.round(telemetry.free_heap_bytes / 1024)} KiB</dd>
                </div>
                <div>
                  <dt>CPU</dt>
                  <dd>{telemetry.cpu_load_pct}%</dd>
                </div>
                <div>
                  <dt>5V / 12V</dt>
                  <dd>
                    {(telemetry.voltage_5v_mv / 1000).toFixed(2)} V / {(telemetry.voltage_12v_mv / 1000).toFixed(2)} V
                  </dd>
                </div>
                <div>
                  <dt>Reconexiones MQTT</dt>
                  <dd>{telemetry.mqtt_reconnects}</dd>
                </div>
                <div>
                  <dt>Cola pendiente</dt>
                  <dd>{telemetry.queue_depth}</dd>
                </div>
              </dl>
              <h3>Cadenas LED</h3>
              <ul>
                {telemetry.led_chains.map((c) => (
                  <li key={c.chain}>
                    Cadena {c.chain}: {c.ok ? "OK" : "AVERÍA"} ({c.current_ma} mA)
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
