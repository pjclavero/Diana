import { useState } from "react";
import { useParams } from "react-router-dom";
import { apiClient } from "../../api";
import { Card } from "../../components/ui/Feedback";
import { BackButton } from "../../components/ui/BackButton";
import { TargetLight } from "../../components/target/TargetLight";
import { TARGET_STATE_META } from "../../utils/targetStateMeta";
import type { TargetState } from "../../types/domain";

const TESTABLE_STATES: TargetState[] = ["safe", "active", "hit", "countdown", "penalty", "error", "calibration", "maintenance"];

export function TestLedsPage() {
  const { moduleId = "" } = useParams();
  const [preview, setPreview] = useState<Record<number, TargetState>>({});
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Envía un estado a una diana. Es un interruptor: si la diana ya está en ese
   * estado, el mismo botón la **apaga** (`off`). Así un solo botón enciende y apaga.
   */
  async function apply(targetIndex: number, state: TargetState) {
    const next: TargetState = preview[targetIndex] === state ? "off" : state;
    setSending(`${targetIndex}-${state}`);
    setError(null);
    try {
      const ack = await apiClient.testLed(moduleId, targetIndex, next);
      // La rejilla se pinta DESPUÉS de que el servidor acepte, y sólo si la
      // orden llegó al broker. Antes se pintaba antes del `await` y sin
      // `catch`: el operador veía la diana encendida en pantalla mientras en la
      // sala no se encendía nada. Era la misma pantalla de mentira que este
      // bloque venía a eliminar.
      if (ack.delivered === false) {
        setError("La orden NO llegó al broker: el módulo no la ha recibido.");
        return;
      }
      setPreview((p) => ({ ...p, [targetIndex]: next }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo enviar la orden.");
    } finally {
      setSending(null);
    }
  }

  /** Apaga las 9 dianas del módulo. */
  async function turnAllOff() {
    setSending("all-off");
    setError(null);
    try {
      await Promise.all(Array.from({ length: 9 }, (_, i) => apiClient.testLed(moduleId, i + 1, "off")));
      setPreview(Object.fromEntries(Array.from({ length: 9 }, (_, i) => [i + 1, "off" as TargetState])));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron apagar todas las dianas.");
    } finally {
      setSending(null);
    }
  }

  return (
    <div>
      <BackButton />
      <h1>Prueba de LED · módulo {moduleId}</h1>
      <Card
        title="Enviar patrón a cada diana"
        actions={
          <button type="button" onClick={turnAllOff} disabled={sending === "all-off"}>
            {sending === "all-off" ? "Apagando…" : "Apagar todas"}
          </button>
        }
      >
        <div className="target-grid-3x3" role="group" aria-label="Vista previa de las 9 dianas">
          {Array.from({ length: 9 }, (_, i) => i + 1).map((idx) => (
            <TargetLight key={idx} targetIndex={idx} state={preview[idx] ?? "off"} size="md" />
          ))}
        </div>

        <div className="table-scroll" style={{ marginTop: "1rem" }}>
          <table>
            <thead>
              <tr>
                <th scope="col">Diana</th>
                {TESTABLE_STATES.map((s) => (
                  <th key={s} scope="col">
                    {TARGET_STATE_META[s].shortLabel}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 9 }, (_, i) => i + 1).map((idx) => (
                <tr key={idx}>
                  <th scope="row">{idx}</th>
                  {TESTABLE_STATES.map((s) => {
                    const active = preview[idx] === s;
                    return (
                      <td key={s}>
                        <button
                          type="button"
                          onClick={() => apply(idx, s)}
                          disabled={sending === `${idx}-${s}`}
                          aria-pressed={active}
                          className={active ? "is-active" : undefined}
                          aria-label={`${active ? "Apagar" : "Aplicar"} estado ${TARGET_STATE_META[s].label} en la diana ${idx}`}
                        >
                          {sending === `${idx}-${s}` ? "…" : active ? "Apagar" : "Aplicar"}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      {error && <p role="alert">{error}</p>}
      </Card>
    </div>
  );
}
