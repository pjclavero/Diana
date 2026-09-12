import { describe, it, expect } from "vitest";
import {
  iniciar,
  aplicarAck,
  aplicarDiagnostico,
  aplicarEspera,
  seEjecuto,
  describir,
  ESPERA_RESPUESTA_MS,
  type DiagnosticoCorrelable,
} from "./maintenanceOperation";

const R1 = "11111111-1111-4111-8111-111111111111";
const R2 = "22222222-2222-4222-8222-222222222222";
const T0 = 1_700_000_000_000;

const diag = (over: Partial<DiagnosticoCorrelable> = {}): DiagnosticoCorrelable => ({
  kind: "self_test_result",
  severity: "info",
  message: "orden de mantenimiento ejecutada",
  requestId: R1,
  detail: { result: "ok", component: "led_test", target_index: 1 },
  ...over,
});

describe("operación de mantenimiento · HTTP 200 no es «se hizo»", () => {
  it("un 200 con delivered deja la operación en PUBLICADA, nunca en ejecutada", () => {
    // La regla que más daño hizo: el panel pintaba la diana encendida al
    // recibir el 200, mientras en la sala no se encendía nada.
    const op = aplicarAck(iniciar(R1, "led_test", "D1"), { request_id: R1, delivered: true }, T0);
    expect(op.state).toBe("published");
    expect(seEjecuto(op)).toBe(false);
    expect(describir(op)).toMatch(/Esperando confirmación/);
  });

  it("sólo un diagnóstico correlado del MÓDULO lleva a ejecutada", () => {
    let op = aplicarAck(iniciar(R1, "led_test", "D1"), { request_id: R1, delivered: true }, T0);
    op = aplicarDiagnostico(op, diag());
    expect(op.state).toBe("executed");
    expect(seEjecuto(op)).toBe(true);
  });

  it("delivered:false y denied NO son ejecución, y se distinguen entre sí", () => {
    const base = iniciar(R1, "led_test", "D1");
    const noPub = aplicarAck(base, { request_id: R1, delivered: false }, T0);
    expect(noPub.state).toBe("not_published");
    expect(noPub.reason).toBe("not_delivered");

    const denegado = aplicarAck(base, { request_id: R1, delivered: false, denied: true }, T0);
    expect(denegado.state).toBe("not_published");
    expect(denegado.reason).toBe("denied");
    // El panel decía «queda encolada» ante una denegación del broker. Es falso.
    expect(describir(denegado)).toMatch(/DENEG/);
    expect(describir(denegado)).not.toMatch(/encolad/i);
  });
});

describe("correlación por request_id · STALE_DIAGNOSTIC_REJECTION", () => {
  it("un diagnóstico VIEJO del mismo kind no responde a la orden nueva", () => {
    // El defecto real: las pantallas filtraban por `kind` y presentaban un
    // self_test_result de hace dos horas como respuesta al botón recién pulsado.
    let op = aplicarAck(iniciar(R2, "led_test", "D1"), { request_id: R2, delivered: true }, T0);
    op = aplicarDiagnostico(op, diag({ requestId: R1 })); // de otra orden
    expect(op.state).toBe("published");
    expect(seEjecuto(op)).toBe(false);
  });

  it("un diagnóstico ESPONTÁNEO (sin request_id) no mueve ninguna operación", () => {
    let op = aplicarAck(iniciar(R1, "led_test", "D1"), { request_id: R1, delivered: true }, T0);
    op = aplicarDiagnostico(op, diag({ kind: "sensor_error", requestId: null }));
    expect(op.state).toBe("published");
  });

  it("un ack de otra orden tampoco toca esta", () => {
    const op = aplicarAck(iniciar(R1, "led_test", "D1"), { request_id: R2, delivered: true }, T0);
    expect(op.state).toBe("requested");
  });
});

describe("CONCURRENT_SAME_KIND_ISOLATION", () => {
  it("dos operaciones del mismo kind a la vez no se cruzan", () => {
    let a = aplicarAck(iniciar(R1, "led_test", "D1"), { request_id: R1, delivered: true }, T0);
    let b = aplicarAck(iniciar(R2, "led_test", "D2"), { request_id: R2, delivered: true }, T0);

    // Llega la respuesta de la SEGUNDA primero: sólo debe mover a `b`.
    const respuestaB = diag({ requestId: R2, detail: { component: "led_test", target_index: 2 } });
    a = aplicarDiagnostico(a, respuestaB);
    b = aplicarDiagnostico(b, respuestaB);

    expect(b.state).toBe("executed");
    expect(a.state).toBe("published");

    // Y ahora la de la primera, que además es un RECHAZO.
    const rechazoA = diag({
      kind: "command_rejected",
      severity: "warning",
      message: "led_test es 'act': caducada",
      requestId: R1,
      detail: { reason: "expired", accepted: false },
    });
    a = aplicarDiagnostico(a, rechazoA);
    b = aplicarDiagnostico(b, rechazoA);

    expect(a.state).toBe("rejected");
    expect(a.reason).toBe("expired");
    expect(b.state).toBe("executed"); // intacta
  });
});

describe("rechazos reales del módulo · UI_REJECTED_FROM_REAL_DIAGNOSTIC", () => {
  it("command_rejected correlado lleva a rechazada con su motivo del contrato", () => {
    // Este es el caso medido en el banco: orden encolada, módulo sin reloj al
    // arrancar, veredicto `expired` de vuelta con el mismo request_id.
    let op = aplicarAck(iniciar(R1, "identify", "módulo"), { request_id: R1, delivered: true }, T0);
    op = aplicarDiagnostico(op, diag({
      kind: "command_rejected",
      message: "led_test es 'act': caducada",
      detail: { reason: "expired", accepted: false },
    }));
    expect(op.state).toBe("rejected");
    expect(op.reason).toBe("expired");
    expect(describir(op)).toMatch(/RECHAZ/);
  });

  it("un rechazo por duplicado se presenta como duplicado, no como fallo", () => {
    let op = aplicarAck(iniciar(R1, "led_test", "D3"), { request_id: R1, delivered: true }, T0);
    op = aplicarDiagnostico(op, diag({
      kind: "command_rejected",
      message: "command_id ya ejecutado",
      detail: { reason: "duplicate", accepted: false },
    }));
    expect(op.state).toBe("duplicate");
    expect(describir(op)).toMatch(/Sin efecto nuevo/);
  });

  it("el duplicado detectado por el BACKEND también es terminal", () => {
    const op = aplicarAck(
      iniciar(R1, "led_test", "D1"),
      { request_id: R1, delivered: false, duplicate: true },
      T0,
    );
    expect(op.state).toBe("duplicate");
  });

  it("un estado terminal no retrocede con una reentrega posterior", () => {
    // QoS 1 puede reentregar: el módulo volvió a rechazar la misma orden dos
    // veces en el banco. Eso no puede reabrir una operación ya resuelta.
    let op = aplicarAck(iniciar(R1, "led_test", "D3"), { request_id: R1, delivered: true }, T0);
    op = aplicarDiagnostico(op, diag()); // executed
    op = aplicarDiagnostico(op, diag({
      kind: "command_rejected",
      detail: { reason: "duplicate", accepted: false },
    }));
    expect(op.state).toBe("executed");
  });
});

describe("sin respuesta · timeout", () => {
  it("una orden publicada sin respuesta acaba en timeout, no en ejecutada", () => {
    let op = aplicarAck(iniciar(R1, "led_test", "D1"), { request_id: R1, delivered: true }, T0);
    op = aplicarEspera(op, T0 + ESPERA_RESPUESTA_MS - 1);
    expect(op.state).toBe("published");
    op = aplicarEspera(op, T0 + ESPERA_RESPUESTA_MS);
    expect(op.state).toBe("timeout");
    expect(op.reason).toBe("no_reply");
    expect(describir(op)).toMatch(/No se sabe si llegó a ejecutarse/);
  });

  it("si el backend NO publicó, el silencio del módulo no se le atribuye", () => {
    let op = aplicarAck(iniciar(R1, "led_test", "D1"), { request_id: R1, delivered: false }, T0);
    op = aplicarEspera(op, T0 + 10 * ESPERA_RESPUESTA_MS);
    expect(op.state).toBe("not_published");
  });

  it("una ejecución confirmada ya no puede caer en timeout", () => {
    let op = aplicarAck(iniciar(R1, "led_test", "D1"), { request_id: R1, delivered: true }, T0);
    op = aplicarDiagnostico(op, diag());
    op = aplicarEspera(op, T0 + 10 * ESPERA_RESPUESTA_MS);
    expect(op.state).toBe("executed");
  });
});
