import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TestLedsPage } from "./TestLedsPage";
import * as diagnosticsApi from "../../api/diagnosticsApi";

/**
 * Doble de `testLed` que devuelve el `request_id` RECIBIDO, como hace el
 * backend real. Un doble que inventa otro identificador haría imposible la
 * correlación y daría por buena una pantalla rota.
 */
function mockTestLed(over: Partial<diagnosticsApi.CommandAck> = {}) {
  return vi
    .spyOn(diagnosticsApi, "testLed")
    .mockImplementation((_m, _i, _s, rid) =>
      Promise.resolve(ack({ request_id: rid ?? "sin-id", ...over })),
    );
}

/** Doble de la respuesta del servidor, con la forma completa del contrato. */
const ack = (
  over: Partial<diagnosticsApi.CommandAck> = {},
): diagnosticsApi.CommandAck => ({
  module_id: "m1",
  command_type: "led_test",
  request_id: "c",
  delivered: true,
  note: "",
  ...over,
});

/** Diagnóstico del módulo tal y como lo sirve `GET /diagnostics`. */
const item = (
  over: Partial<diagnosticsApi.DiagnosticItem> = {},
): diagnosticsApi.DiagnosticItem => ({
  id: "i1",
  kind: "self_test_result",
  severity: "info",
  message: "orden de mantenimiento ejecutada",
  detail: { result: "ok", component: "led_test" },
  occurredAt: "2026-09-12T12:00:00.000Z",
  receivedAt: "2026-09-12T12:00:00.000Z",
  timeBasis: "module_epoch",
  requestId: null,
  ...over,
});

/** Sirve los diagnósticos indicados; por defecto, ninguno. */
function conDiagnosticos(items: diagnosticsApi.DiagnosticItem[] = []) {
  return vi.spyOn(diagnosticsApi, "getDiagnostics").mockResolvedValue({
    module: "m1",
    moduleRegistered: true,
    items,
    note: null,
  });
}

/** El request_id que la pantalla generó en la última llamada a testLed. */
function ultimoRequestId(spy: { mock: { calls: unknown[][] } }): string {
  const c = spy.mock.calls[spy.mock.calls.length - 1];
  return c[3] as string;
}

/**
 * Estado que la REJILLA está pintando para una diana. Es lo único que no puede
 * mentir: los botones reflejan la intención del operador, la rejilla refleja lo
 * que el módulo ha confirmado.
 */
function pintada(idx: number): string {
  const el = document.querySelector(`[data-target-index="${idx}"]`);
  return el?.getAttribute("data-state") ?? "(sin rejilla)";
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/modulos/m1/prueba-leds"]}>
      <Routes>
        <Route path="/modulos/:moduleId/prueba-leds" element={<TestLedsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("TestLedsPage (G-A: toggle y apagar)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("el mismo botón enciende y, al repetir, apaga (off)", async () => {
    const led = mockTestLed({});
    renderPage();

    // Primer botón "Aplicar" de la diana 1 (estado 'safe').
    const firstApply = screen.getAllByRole("button", { name: /Aplicar estado .* en la diana 1/ })[0];
    await userEvent.click(firstApply);
    await waitFor(() => expect(led).toHaveBeenCalledWith("m1", 1, "safe", expect.any(String)));

    // Ahora ese botón pasa a "Apagar": al pulsarlo envía 'off'.
    const offBtn = await screen.findByRole("button", { name: /Apagar estado .* en la diana 1/ });
    await userEvent.click(offBtn);
    await waitFor(() => expect(led).toHaveBeenLastCalledWith("m1", 1, "off", expect.any(String)));
  });

  it("'Apagar todas' envía off a las 9 dianas", async () => {
    const led = mockTestLed({});
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Apagar todas" }));
    await waitFor(() => expect(led).toHaveBeenCalledTimes(9));
    for (let i = 1; i <= 9; i++) expect(led).toHaveBeenCalledWith("m1", i, "off", expect.any(String));
  });

  it("muestra el botón de volver", () => {
    mockTestLed({});
    renderPage();
    expect(screen.getByRole("button", { name: "← Volver" })).toBeInTheDocument();
  });
});

describe("TestLedsPage · no pinta lo que no ha ocurrido (F6 · B2)", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("si el servidor rechaza la orden, la diana NO se pinta encendida", async () => {
    const { ApiError } = await import("../../api/client");
    vi.spyOn(diagnosticsApi, "testLed").mockRejectedValue(new ApiError("Estado no admitido"));
    renderPage();
    await userEvent.click(screen.getAllByRole("button", { name: /Aplicar estado .* en la diana 1/ })[0]);
    expect(await screen.findByText("Estado no admitido")).toBeInTheDocument();
    // Lo que importa NO es que salga el error, sino que la rejilla no mienta:
    // comprobar sólo el texto dejaba pasar el pintado optimista, que es
    // exactamente el defecto que este bloque dice cerrar.
    expect(pintada(1)).toBe("off");
  });

  it("si la orden no se publicó se dice, y no se pinta", async () => {
    mockTestLed({ delivered: false });
    conDiagnosticos();
    renderPage();
    await userEvent.click(screen.getAllByRole("button", { name: /Aplicar estado .* en la diana 1/ })[0]);
    expect(await screen.findByTestId("op-1")).toHaveAttribute("data-estado", "not_published");
    expect(pintada(1)).toBe("off");
  });

  it("UI_EXECUTED_ONLY_ON_MODULE_ACK · delivered:true NO pinta la diana", async () => {
    // El defecto: la pantalla pintaba la diana con el 200 del backend. Una
    // orden publicada puede acabar rechazada por el módulo —en el banco volvió
    // como `expired` 32 s después, sin que se encendiera nada.
    mockTestLed({ delivered: true });
    conDiagnosticos();
    renderPage();
    await userEvent.click(screen.getAllByRole("button", { name: /Aplicar estado .* en la diana 1/ })[0]);
    expect(await screen.findByTestId("op-1")).toHaveAttribute("data-estado", "published");
    expect(pintada(1)).toBe("off");
  });

  it("sólo el diagnóstico CORRELADO del módulo pinta la diana", async () => {
    // Control positivo del caso anterior: sin esto, una prueba que exige «no
    // pintada» pasaría aunque la pantalla no pintara nunca.
    const led = mockTestLed({ delivered: true });
    const diags = conDiagnosticos();
    renderPage();
    await userEvent.click(screen.getAllByRole("button", { name: /Aplicar estado .* en la diana 1/ })[0]);
    await waitFor(() => expect(led).toHaveBeenCalled());

    const rid = ultimoRequestId(led);
    diags.mockResolvedValue({
      module: "m1",
      moduleRegistered: true,
      items: [item({ requestId: rid })],
      note: null,
    });
    await waitFor(
      () => expect(screen.getByTestId("op-1")).toHaveAttribute("data-estado", "executed"),
      { timeout: 5000 },
    );
    expect(pintada(1)).not.toBe("off");
  });

  it("STALE_DIAGNOSTIC_REJECTION · un diagnóstico de OTRA orden no la resuelve", async () => {
    const led = mockTestLed({ delivered: true });
    conDiagnosticos([item({ requestId: "de-otra-orden-distinta" })]);
    renderPage();
    await userEvent.click(screen.getAllByRole("button", { name: /Aplicar estado .* en la diana 1/ })[0]);
    await waitFor(() => expect(led).toHaveBeenCalled());
    // Se deja correr el sondeo: el diagnóstico existe y es del mismo `kind`.
    await new Promise((r) => setTimeout(r, 2000));
    expect(screen.getByTestId("op-1")).toHaveAttribute("data-estado", "published");
    expect(pintada(1)).toBe("off");
  });

  it("UI_REJECTED_FROM_REAL_DIAGNOSTIC · un rechazo del módulo se muestra como tal", async () => {
    const led = mockTestLed({ delivered: true });
    const diags = conDiagnosticos();
    renderPage();
    await userEvent.click(screen.getAllByRole("button", { name: /Aplicar estado .* en la diana 1/ })[0]);
    await waitFor(() => expect(led).toHaveBeenCalled());

    const rid = ultimoRequestId(led);
    diags.mockResolvedValue({
      module: "m1",
      moduleRegistered: true,
      items: [
        item({
          requestId: rid,
          kind: "command_rejected",
          severity: "warning",
          message: "led_test es 'act': caducada",
          detail: { reason: "expired", accepted: false },
        }),
      ],
      note: null,
    });
    await waitFor(
      () => expect(screen.getByTestId("op-1")).toHaveAttribute("data-estado", "rejected"),
      { timeout: 5000 },
    );
    // Y desde luego no se pinta como encendida.
    expect(pintada(1)).toBe("off");
  });

  it("FRONTEND_REQUEST_ID_GENERATION · cada orden lleva su propio request_id", async () => {
    const led = mockTestLed({ delivered: true });
    conDiagnosticos();
    renderPage();
    await userEvent.click(screen.getAllByRole("button", { name: /Aplicar estado .* en la diana 1/ })[0]);
    await waitFor(() => expect(led).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getAllByRole("button", { name: /Aplicar estado .* en la diana 2/ })[0]);
    await waitFor(() => expect(led).toHaveBeenCalledTimes(2));

    const r1 = led.mock.calls[0][3];
    const r2 = led.mock.calls[1][3];
    expect(typeof r1).toBe("string");
    expect(r1).not.toBe("");
    expect(r2).not.toBe(r1);
  });

  it("manda un ESTADO del contrato, no un patrón inventado", async () => {
    const led = mockTestLed({ delivered: true });
    renderPage();
    await userEvent.click(screen.getAllByRole("button", { name: /Aplicar estado .* en la diana 1/ })[0]);
    await waitFor(() => expect(led).toHaveBeenCalled());
    const estado = led.mock.calls[0][2];
    expect(["off", "safe", "active", "hit", "countdown", "penalty", "error", "calibration", "maintenance"]).toContain(estado);
  });
});
