import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AltaModuloCard, EdicionModuloCard } from "./ModuleFormCard";
import * as admin from "../../api/modulesAdminApi";
import { ApiError } from "../../api/client";
import type { ModuleEntity } from "../../api/modulesApi";

/**
 * Pruebas del alta/edición/baja contra un DOBLE del cliente de API. Lo que se
 * comprueba no es que «la pantalla se pinta», sino las dos propiedades que el
 * carril tiene que garantizar: que el CUERPO que sale es el que el DTO admite
 * (ni un campo de más, ni los vacíos que el backend rechazaría), y que el
 * mensaje REAL del backend llega al operador en vez de un genérico.
 */

const CREADO: ModuleEntity = {
  id: "m1",
  slug: "diana-01",
  friendlyName: "Diana 1",
  serial: null,
  firmwareVersion: null,
  state: null,
  online: false,
  ownerId: null,
  owner: null,
};

describe("AltaModuloCard", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("envía al endpoint de alta el cuerpo exacto, sin los opcionales vacíos", async () => {
    const spy = vi.spyOn(admin, "createModule").mockResolvedValue(CREADO);
    const onCreado = vi.fn();
    render(<AltaModuloCard onCreado={onCreado} />);

    await userEvent.type(screen.getByLabelText(/Identificador MQTT/), "diana-01");
    await userEvent.type(screen.getByLabelText("Nombre visible"), "Diana 1");
    await userEvent.type(screen.getByLabelText("Revisión de hardware"), "rev-b");
    await userEvent.click(screen.getByRole("button", { name: "Dar de alta" }));

    expect(spy).toHaveBeenCalledTimes(1);
    // `serial`, `mac` y `targetSystemId` quedaron vacíos: NO viajan. Enviar
    // `mac: ""` provocaría un 400 del backend.
    expect(spy.mock.calls[0][0]).toEqual({
      slug: "diana-01",
      friendlyName: "Diana 1",
      hardwareRevision: "rev-b",
    });
    expect(onCreado).toHaveBeenCalled();
    expect(await screen.findByRole("status")).toHaveTextContent(/PENDIENTE/);
  });

  it("muestra el mensaje REAL de un 400 de validación del backend", async () => {
    vi.spyOn(admin, "createModule").mockRejectedValue(
      new ApiError(
        "slug debe cumplir el patrón de identificador del contrato (minúsculas, dígitos y guiones).",
        undefined,
        400,
      ),
    );
    render(<AltaModuloCard onCreado={vi.fn()} />);

    // Un slug que SÍ pasa el aviso local, para que el que hable sea el backend.
    await userEvent.type(screen.getByLabelText(/Identificador MQTT/), "diana-01");
    await userEvent.click(screen.getByRole("button", { name: "Dar de alta" }));

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent(/patrón de identificador del contrato/);
    expect(alerta).not.toHaveTextContent(/ha ocurrido un error/i);
  });

  it("explica un 409 como conflicto de identificador, no como avería", async () => {
    vi.spyOn(admin, "createModule").mockRejectedValue(
      new ApiError("Ya existe un module con slug 'diana-01'.", undefined, 409),
    );
    render(<AltaModuloCard onCreado={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/Identificador MQTT/), "diana-01");
    await userEvent.click(screen.getByRole("button", { name: "Dar de alta" }));

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent(/Conflicto/);
    expect(alerta).toHaveTextContent(/Ya existe un module con slug 'diana-01'/);
  });

  it("no llama al backend si falta el slug obligatorio", async () => {
    const spy = vi.spyOn(admin, "createModule").mockResolvedValue(CREADO);
    render(<AltaModuloCard onCreado={vi.fn()} />);

    // El `required` del navegador ya frena el envío; aquí se comprueba la
    // guarda PROPIA, que es la que queda si alguien quita el atributo: se envía
    // el formulario directamente, saltándose la validación nativa.
    await userEvent.type(screen.getByLabelText("Nombre visible"), "sin slug");
    fireEvent.submit(screen.getByRole("form", { name: "Alta de módulo" }));

    expect(spy).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(/obligatorio/);
  });
});

describe("EdicionModuloCard", () => {
  beforeEach(() => vi.restoreAllMocks());

  function pintar() {
    return render(
      <EdicionModuloCard
        moduleId="m1"
        slug="diana-01"
        friendlyName="Diana 1"
        onCambiado={vi.fn()}
      />,
    );
  }

  it("NO ofrece editar el slug: el backend lo rechaza con 400", () => {
    pintar();
    expect(screen.queryByLabelText(/Identificador MQTT/)).not.toBeInTheDocument();
    expect(screen.getByText(/no es editable/)).toBeInTheDocument();
  });

  it("envía sólo los campos rellenos en el PATCH", async () => {
    const spy = vi.spyOn(admin, "updateModule").mockResolvedValue(CREADO);
    pintar();

    await userEvent.type(screen.getByLabelText("Número de serie"), "SN-7");
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(spy).toHaveBeenCalledWith("m1", { friendlyName: "Diana 1", serial: "SN-7" });
  });

  it("la baja exige una confirmación explícita antes de llamar al backend", async () => {
    const spy = vi.spyOn(admin, "deleteModule").mockResolvedValue(undefined);
    pintar();

    await userEvent.click(screen.getByRole("button", { name: "Dar de baja" }));
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/no se puede deshacer/);

    await userEvent.click(screen.getByRole("button", { name: /Sí, dar de baja/ }));
    expect(spy).toHaveBeenCalledWith("m1");
  });
});
