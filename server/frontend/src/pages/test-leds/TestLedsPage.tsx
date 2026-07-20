import { useState } from "react";
import { useParams } from "react-router-dom";
import { apiClient } from "../../api";
import { Card } from "../../components/ui/Feedback";
import { TargetLight } from "../../components/target/TargetLight";
import { TARGET_STATE_META } from "../../utils/targetStateMeta";
import type { TargetState } from "../../types/domain";

const TESTABLE_STATES: TargetState[] = ["safe", "active", "hit", "countdown", "penalty", "error", "calibration", "maintenance"];

export function TestLedsPage() {
  const { moduleId = "" } = useParams();
  const [preview, setPreview] = useState<Record<number, TargetState>>({});
  const [sending, setSending] = useState<string | null>(null);

  async function apply(targetIndex: number, state: TargetState) {
    setSending(`${targetIndex}-${state}`);
    setPreview((p) => ({ ...p, [targetIndex]: state }));
    try {
      await apiClient.testLed(moduleId, targetIndex, state);
    } finally {
      setSending(null);
    }
  }

  return (
    <div>
      <h1>Prueba de LED · módulo {moduleId}</h1>
      <Card title="Enviar patrón a cada diana">
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
                  {TESTABLE_STATES.map((s) => (
                    <td key={s}>
                      <button
                        type="button"
                        onClick={() => apply(idx, s)}
                        disabled={sending === `${idx}-${s}`}
                        aria-label={`Aplicar estado ${TARGET_STATE_META[s].label} a la diana ${idx}`}
                      >
                        {sending === `${idx}-${s}` ? "…" : "Aplicar"}
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
