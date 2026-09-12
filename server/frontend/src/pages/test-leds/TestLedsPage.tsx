import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { getDiagnostics, testLed } from "../../api/diagnosticsApi";
import {
  aplicarAck,
  aplicarDiagnostico,
  aplicarEspera,
  describir,
  iniciar,
  seEjecuto,
  type MaintenanceOperation,
} from "../../utils/maintenanceOperation";
import { Card } from "../../components/ui/Feedback";
import { BackButton } from "../../components/ui/BackButton";
import { TargetLight } from "../../components/target/TargetLight";
import { TARGET_STATE_META } from "../../utils/targetStateMeta";
import type { TargetState } from "../../types/domain";

const TESTABLE_STATES: TargetState[] = ["safe", "active", "hit", "countdown", "penalty", "error", "calibration", "maintenance"];

/** Identificador de la operación, elegido por el CLIENTE (P1.1). */
function nuevoRequestId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // Entornos sin WebCrypto (jsdom antiguo): sirve porque sólo tiene que ser
  // único dentro de esta pantalla, no criptográfico.
  return "req-" + Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
}

export function TestLedsPage() {
  const { moduleId = "" } = useParams();
  const [preview, setPreview] = useState<Record<number, TargetState>>({});
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Operación en curso por diana, correlada por `request_id`. La rejilla NO se
   * pinta con el ack del backend: sólo cuando el MÓDULO confirma. Un HTTP 200
   * significa «el backend publicó», y eso no dice nada del hardware.
   */
  const [ops, setOps] = useState<Record<number, MaintenanceOperation>>({});
  /** Estado pedido en cada operación, para pintar sólo si se ejecuta. */
  const deseado = useRef<Record<string, { idx: number; state: TargetState }>>({});
  /**
   * Último estado PEDIDO por diana. Gobierna el interruptor del botón, que es
   * una decisión de interfaz sobre lo que el operador quiso hacer. La rejilla,
   * en cambio, se pinta desde `preview`, que sólo avanza cuando el módulo
   * confirma: mezclar ambas cosas es lo que hacía que la pantalla afirmara
   * efectos que no habían ocurrido.
   */
  const [intencion, setIntencion] = useState<Record<number, TargetState>>({});

  /**
   * Envía un estado a una diana. Es un interruptor: si la diana ya está en ese
   * estado, el mismo botón la **apaga** (`off`). Así un solo botón enciende y apaga.
   */
  async function apply(targetIndex: number, state: TargetState) {
    const next: TargetState = intencion[targetIndex] === state ? "off" : state;
    const requestId = nuevoRequestId();
    setIntencion((i) => ({ ...i, [targetIndex]: next }));
    deseado.current[requestId] = { idx: targetIndex, state: next };
    setSending(`${targetIndex}-${state}`);
    setError(null);
    setOps((o) => ({ ...o, [targetIndex]: iniciar(requestId, "led_test", `D${targetIndex}`) }));
    try {
      const ack = await testLed(moduleId, targetIndex, next, requestId);
      // El ack sólo puede llevar la operación hasta PUBLICADA. La rejilla se
      // pinta más abajo, y únicamente cuando el módulo confirma por
      // `diagnostic` correlado: antes bastaba `delivered:true` para pintar la
      // diana, y una orden publicada puede acabar rechazada por el módulo
      // —medido en el banco: volvió como `expired` 32 s después, sin que
      // ninguna diana se encendiera.
      setOps((o) => ({ ...o, [targetIndex]: aplicarAck(o[targetIndex], ack, Date.now()) }));
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
      await Promise.all(
        Array.from({ length: 9 }, (_, i) => {
          const idx = i + 1;
          const rid = nuevoRequestId();
          deseado.current[rid] = { idx, state: "off" };
          setIntencion((i) => ({ ...i, [idx]: "off" as TargetState }));
          setOps((o) => ({ ...o, [idx]: iniciar(rid, "led_test", `D${idx}`) }));
          return testLed(moduleId, idx, "off", rid).then((ack) =>
            setOps((o) => ({ ...o, [idx]: aplicarAck(o[idx], ack, Date.now()) })),
          );
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron apagar todas las dianas.");
    } finally {
      setSending(null);
    }
  }

  /**
   * Correlación (P1.3): se consultan los diagnósticos del módulo y cada uno se
   * ofrece a TODAS las operaciones vivas. Sólo mueve aquella cuyo `request_id`
   * coincide: un diagnóstico del mismo `kind` pero de otra orden —o de hace dos
   * horas— no puede responder a este botón.
   */
  const refrescar = useCallback(async () => {
    let items;
    try {
      items = (await getDiagnostics(moduleId, 30)).items;
    } catch {
      return; // un fallo al consultar no inventa un veredicto
    }
    setOps((actuales) => {
      const siguiente: Record<number, MaintenanceOperation> = { ...actuales };
      for (const [clave, op] of Object.entries(actuales)) {
        let o = op;
        for (const d of items) o = aplicarDiagnostico(o, d);
        o = aplicarEspera(o, Date.now());
        siguiente[Number(clave)] = o;
        if (seEjecuto(o) && !seEjecuto(op)) {
          const pedido = deseado.current[o.requestId];
          if (pedido) setPreview((pv) => ({ ...pv, [pedido.idx]: pedido.state }));
        }
      }
      return siguiente;
    });
  }, [moduleId]);

  // Sondeo mientras haya alguna operación esperando respuesta del módulo.
  const hayEnCurso = Object.values(ops).some(
    (o) => o.state === "requested" || o.state === "published",
  );
  useEffect(() => {
    if (!hayEnCurso) return;
    const t = setInterval(refrescar, 1500);
    return () => clearInterval(t);
  }, [hayEnCurso, refrescar]);

  return (
    <div>
      <BackButton />
      <h1>Prueba de LED · módulo {moduleId}</h1>
      <Card title="Estado real de las órdenes">
        {/* Lo que ve el operador ya no es «se envió», sino qué ha pasado de
            verdad con cada orden: publicada, ejecutada, rechazada por el
            módulo, repetida o sin respuesta. */}
        {Object.keys(ops).length === 0 ? (
          <p>Ninguna orden enviada todavía.</p>
        ) : (
          <ul>
            {Object.entries(ops)
              .sort((a, b) => Number(a[0]) - Number(b[0]))
              .map(([idx, o]) => (
                <li key={idx} data-testid={`op-${idx}`} data-estado={o.state}>
                  <strong>D{idx}</strong> · {o.state} — {describir(o)}
                </li>
              ))}
          </ul>
        )}
      </Card>
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
                    // El botón es un CONTROL: refleja lo último que el
                    // operador pidió. Lo que no puede mentir es la rejilla de
                    // arriba, que sólo pinta lo que el módulo ha confirmado.
                    const active = intencion[idx] === s;
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
