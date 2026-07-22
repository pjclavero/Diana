import { useState } from "react";
import { useParams } from "react-router-dom";
import { apiClient } from "../../api";
import { Card } from "../../components/ui/Feedback";
import { BackButton } from "../../components/ui/BackButton";

export function TestSensorsPage() {
  const { moduleId = "" } = useParams();
  const [results, setResults] = useState<Record<number, { ok: boolean; amplitude: number } | "running">>({});

  async function test(targetIndex: number) {
    setResults((r) => ({ ...r, [targetIndex]: "running" }));
    try {
      const result = await apiClient.testSensor(moduleId, targetIndex);
      setResults((r) => ({ ...r, [targetIndex]: result }));
    } catch {
      setResults((r) => ({ ...r, [targetIndex]: { ok: false, amplitude: 0 } }));
    }
  }

  return (
    <div>
      <BackButton />
      <h1>Prueba de sensores · módulo {moduleId}</h1>
      <Card title="Golpee cada diana o pulse Probar">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Diana</th>
                <th scope="col">Resultado</th>
                <th scope="col">Amplitud</th>
                <th scope="col">Acción</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 9 }, (_, i) => i + 1).map((idx) => {
                const r = results[idx];
                return (
                  <tr key={idx}>
                    <th scope="row">{idx}</th>
                    <td>
                      {r === "running" && "Probando…"}
                      {r && r !== "running" && (r.ok ? "Sensor OK" : "Sin respuesta")}
                      {!r && "Sin probar"}
                    </td>
                    <td>{r && r !== "running" ? r.amplitude : "—"}</td>
                    <td>
                      <button type="button" onClick={() => test(idx)} disabled={r === "running"}>
                        Probar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
