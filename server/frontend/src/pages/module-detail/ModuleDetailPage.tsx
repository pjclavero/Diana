import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiClient } from "../../api";
import { ApiError } from "../../api/client";
import { CAMPOS_NO_SERVIDOS_POR_CONFIG_DESEADA } from "../../api/backendShapes";
import { useAsync } from "../../hooks/useAsync";
import { Card, ErrorState, LoadingState } from "../../components/ui/Feedback";
import { BackButton } from "../../components/ui/BackButton";
import { TargetLight } from "../../components/target/TargetLight";
import { rotatedTargetIndices } from "../../utils/gridRotation";
import "./ModuleDetailPage.css";

/**
 * Ficha de un módulo contra el backend real.
 *
 * Tres defectos de honestidad corregidos aquí, los tres de la misma familia
 * («ausencia de dato pintada como si fuera un dato»):
 *
 *  1. **La telemetría se pedía y su error se tiraba.** `useAsync` devuelve
 *     `error`, y esta pantalla desestructuraba sólo `data`. La telemetría por
 *     REST NO EXISTE en el backend (`getModuleTelemetry`, veredicto
 *     `IMPLEMENT_BACKEND` en `api/rutasDelPanel.ts`): la llamada falla siempre
 *     en modo real, y la tarjeta simplemente no aparecía. Resultado: un
 *     operador veía una ficha aparentemente completa, sin «Diagnóstico
 *     rápido», sin ninguna pista de que faltaba algo. Ahora se dice.
 *  2. **«Identificar módulo» era optimista.** El botón pasaba a «Identificando…»
 *     y volvía sólo, pasara lo que pasara: sin `catch`, un rechazo de permisos
 *     o un módulo desconectado producían exactamente la misma pantalla que un
 *     parpadeo correcto (y, de paso, una promesa rechazada sin capturar). Ahora
 *     se enseña el acuse REAL del backend, incluido `delivered: false`.
 *  3. **La configuración enseñaba ceros.** Ver
 *     `CAMPOS_NO_SERVIDOS_POR_CONFIG_DESEADA`.
 */
export function ModuleDetailPage() {
  const { moduleId = "" } = useParams();
  const { data: module, loading, error, reload } = useAsync(() => apiClient.getModule(moduleId), [moduleId]);
  const telemetry = useAsync(() => apiClient.getModuleTelemetry(moduleId), [moduleId]);
  const config = useAsync(() => apiClient.getModuleConfig(moduleId), [moduleId]);
  const [identificacion, setIdentificacion] = useState<
    { estado: "inactiva" } | { estado: "enviando" } | { estado: "resultado"; ok: boolean; texto: string }
  >({ estado: "inactiva" });

  const targetsByIndex = new Map((module?.targets ?? []).map((t) => [t.target_index, t]));
  const order = module ? rotatedTargetIndices(module.rotation) : [];

  async function handleIdentify() {
    setIdentificacion({ estado: "enviando" });
    try {
      const ack = await apiClient.identifyModule(moduleId, 4000);
      // El acuse del backend puede decir que NO se entregó. Eso no es un éxito
      // y no se pinta como tal.
      if (ack.delivered === true) {
        setIdentificacion({
          estado: "resultado",
          ok: true,
          texto: "Orden entregada: el módulo debe estar parpadeando.",
        });
      } else if (ack.delivered === false) {
        setIdentificacion({
          estado: "resultado",
          ok: false,
          texto:
            "El backend aceptó la petición pero la orden NO se entregó al módulo. " +
            "No se puede afirmar que esté parpadeando.",
        });
      } else {
        // `delivered` ausente: el backend no dice si llegó. No es un éxito.
        setIdentificacion({
          estado: "resultado",
          ok: false,
          texto:
            "Petición aceptada, pero el backend no informa de si la orden llegó al módulo. " +
            "Compruebe visualmente el parpadeo.",
        });
      }
    } catch (e) {
      setIdentificacion({
        estado: "resultado",
        ok: false,
        texto:
          e instanceof ApiError ? e.userMessage : "No se ha podido enviar la orden de identificación.",
      });
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
              <button type="button" onClick={handleIdentify} disabled={identificacion.estado === "enviando"}>
                {identificacion.estado === "enviando" ? "Identificando…" : "Identificar módulo (parpadeo)"}
              </button>
            }
          >
            {identificacion.estado === "resultado" &&
              (identificacion.ok ? (
                <p role="status">{identificacion.texto}</p>
              ) : (
                <p role="alert">{identificacion.texto}</p>
              ))}
            <p>
              Posición ({module.position.x}, {module.position.y}) · Rotación {module.rotation}° · Rol{" "}
              {module.role}
            </p>
            <div className="target-grid-3x3" role="group" aria-label="Estado de las 9 dianas del módulo">
              {order.map((idx) => {
                const t = targetsByIndex.get(idx);
                return <TargetLight key={idx} targetIndex={idx} state={t?.state ?? "off"} size="lg" />;
              })}
            </div>
          </Card>

          <Card title="Configuración">
            {config.loading && <LoadingState label="Consultando configuración deseada…" />}
            {config.error && <ErrorState message={config.error} onRetry={config.reload} />}
            {!config.loading && !config.error && config.data && (
              <>
                <dl className="kv-list">
                  <div>
                    <dt>Versión de configuración</dt>
                    <dd>v{config.data.config_version}</dd>
                  </div>
                  <div>
                    <dt>Nombre</dt>
                    <dd>{config.data.friendly_name || <em>sin asignar</em>}</dd>
                  </div>
                  <div>
                    <dt>Red</dt>
                    <dd>
                      {config.data.network.mode === "static"
                        ? `Estática ${config.data.network.ip ?? "?"} / ${config.data.network.netmask ?? "?"} · puerta ${config.data.network.gateway ?? "?"}`
                        : "DHCP"}
                    </dd>
                  </div>
                  <div>
                    <dt>Dianas calibradas</dt>
                    <dd>{config.data.calibration.length} de 9</dd>
                  </div>
                </dl>
                <p className="hint">
                  Esto es la configuración <strong>deseada</strong> (lo que el servidor quiere que el módulo
                  tenga), no la que el módulo confirma tener.
                </p>
                <p className="hint">
                  El backend no sirve todavía: {CAMPOS_NO_SERVIDOS_POR_CONFIG_DESEADA.join(", ")}. No se
                  muestran porque el valor que llega es un relleno (0), no una medida.
                </p>
              </>
            )}
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

          <Card title="Diagnóstico rápido">
            {telemetry.loading && <LoadingState label="Consultando telemetría…" />}
            {telemetry.error && (
              // Antes esta tarjeta desaparecía en silencio. Desaparecer es
              // indistinguible de «el módulo está bien».
              <ErrorState message={telemetry.error} onRetry={telemetry.reload} />
            )}
            {!telemetry.loading && !telemetry.error && telemetry.data && (
              <>
                <dl className="kv-list">
                  <div>
                    <dt>Uptime</dt>
                    <dd>{telemetry.data.uptime_s} s</dd>
                  </div>
                  <div>
                    <dt>Memoria libre</dt>
                    <dd>{Math.round(telemetry.data.free_heap_bytes / 1024)} KiB</dd>
                  </div>
                  <div>
                    <dt>CPU</dt>
                    <dd>{telemetry.data.cpu_load_pct}%</dd>
                  </div>
                  <div>
                    <dt>5V / 12V</dt>
                    <dd>
                      {(telemetry.data.voltage_5v_mv / 1000).toFixed(2)} V /{" "}
                      {(telemetry.data.voltage_12v_mv / 1000).toFixed(2)} V
                    </dd>
                  </div>
                  <div>
                    <dt>Reconexiones MQTT</dt>
                    <dd>{telemetry.data.mqtt_reconnects}</dd>
                  </div>
                  <div>
                    <dt>Cola pendiente</dt>
                    <dd>{telemetry.data.queue_depth}</dd>
                  </div>
                </dl>
                <h3>Cadenas LED</h3>
                <ul>
                  {telemetry.data.led_chains.map((c) => (
                    <li key={c.chain}>
                      Cadena {c.chain}: {c.ok ? "OK" : "AVERÍA"} ({c.current_ma} mA)
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
