import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CredencialMqttCard } from "./CredencialMqttCard";
import * as identidad from "../../api/mqttIdentityApi";
import { ApiError } from "../../api/client";
import type { CredencialEmitida, MetadatosCredencial } from "../../api/mqttIdentityApi";

/**
 * T4 · La credencial se enseña UNA vez y no sobrevive a nada.
 *
 * La prueba que importa aquí no es «aparece el secreto», sino que DESAPARECE:
 * un panel que lo deje en el DOM (o en almacenamiento) después de cerrar el
 * aviso ha convertido una contraseña de un solo uso en una contraseña
 * consultable, y el operador no tiene forma de notarlo.
 */

const SECRETO = "s3cr3t0-de-un-solo-uso";

const EMITIDA: CredencialEmitida = {
  moduleId: "m1",
  slug: "diana-01",
  username: "diana-01",
  clientId: "diana-01",
  secret: SECRETO,
  fingerprint: "abcdef0123456789",
  generation: 1,
  issuedAt: "2026-09-11T10:00:00.000Z",
  warning: "Se muestra una sola vez.",
};

const METADATOS: MetadatosCredencial = {
  moduleId: "m1",
  slug: "diana-01",
  username: "diana-01",
  clientId: "diana-01",
  fingerprint: "abcdef0123456789",
  generation: 1,
  issuedAt: "2026-09-11T10:00:00.000Z",
  deliveredAt: "2026-09-11T10:00:00.000Z",
  revokedAt: null,
  issuedByUsername: "admin",
};

function pintar() {
  return render(<CredencialMqttCard moduleId="m1" slug="diana-01" />);
}

describe("CredencialMqttCard", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("emite la credencial, enseña el secreto una vez y lo borra del DOM al cerrar el aviso", async () => {
    const consulta = vi
      .spyOn(identidad, "consultarCredencialMqtt")
      .mockResolvedValueOnce({ issued: false, note: "Este módulo no tiene credencial MQTT emitida." })
      .mockResolvedValue(METADATOS);
    const emitir = vi.spyOn(identidad, "emitirCredencialMqtt").mockResolvedValue(EMITIDA);

    pintar();
    await screen.findByText(/Sin credencial MQTT emitida/);

    await userEvent.click(screen.getByRole("button", { name: "Emitir credencial" }));

    expect(emitir).toHaveBeenCalledWith("m1", false);
    expect(await screen.findByText(SECRETO)).toBeInTheDocument();
    expect(screen.getByText(/ÚNICA vez/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /He guardado la contraseña/ }));

    // Desaparece del DOM. No queda en ningún nodo, ni oculto ni en un atributo.
    expect(screen.queryByText(SECRETO)).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(SECRETO);
    expect(consulta).toHaveBeenCalled();
  });

  it("nunca deja el secreto en el almacenamiento del navegador ni en la URL", async () => {
    vi.spyOn(identidad, "consultarCredencialMqtt").mockResolvedValue({
      issued: false,
      note: "Sin credencial.",
    });
    vi.spyOn(identidad, "emitirCredencialMqtt").mockResolvedValue(EMITIDA);

    pintar();
    await userEvent.click(await screen.findByRole("button", { name: "Emitir credencial" }));
    await screen.findByText(SECRETO);

    expect(JSON.stringify(localStorage)).not.toContain(SECRETO);
    expect(JSON.stringify(sessionStorage)).not.toContain(SECRETO);
    expect(window.location.href).not.toContain(SECRETO);
  });

  it("la vista de metadatos no enseña ningún secreto y lo dice", async () => {
    vi.spyOn(identidad, "consultarCredencialMqtt").mockResolvedValue(METADATOS);

    pintar();

    expect(await screen.findByText("abcdef0123456789")).toBeInTheDocument();
    expect(screen.getByText(/La contraseña no aparece aquí/)).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(SECRETO);
    // Y no hay ningún campo que prometa la contraseña en esta vista.
    expect(screen.queryByText("Contraseña")).not.toBeInTheDocument();
  });

  it("un 409 al reemitir se explica como conflicto y ofrece ROTAR", async () => {
    vi.spyOn(identidad, "consultarCredencialMqtt").mockResolvedValue({
      issued: false,
      note: "Sin credencial.",
    });
    vi.spyOn(identidad, "emitirCredencialMqtt").mockRejectedValue(
      new ApiError(
        "El módulo 'diana-01' ya tiene credencial MQTT emitida (generación 1). La contraseña se " +
          "entregó una sola vez y no se puede volver a leer.",
        undefined,
        409,
      ),
    );

    pintar();
    await userEvent.click(await screen.findByRole("button", { name: "Emitir credencial" }));

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent(/Ya tiene credencial emitida/);
    expect(alerta).toHaveTextContent(/no se puede volver a leer/);
    expect(alerta).toHaveTextContent(/rotarla/i);
    // No se pinta como avería genérica del servidor.
    expect(alerta).not.toHaveTextContent(/no se ha podido emitir/i);
    expect(screen.getByRole("button", { name: /Rotar la credencial/ })).toBeInTheDocument();
  });

  it("la revocación exige confirmación explícita", async () => {
    vi.spyOn(identidad, "consultarCredencialMqtt").mockResolvedValue(METADATOS);
    const revocar = vi
      .spyOn(identidad, "revocarCredencialMqtt")
      .mockResolvedValue({ username: "diana-01", revokedAt: "2026-09-11T11:00:00.000Z" });

    pintar();
    await userEvent.click(await screen.findByRole("button", { name: "Revocar credencial" }));
    expect(revocar).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Sí, revocar" }));
    await waitFor(() => expect(revocar).toHaveBeenCalledWith("m1"));
  });
});
