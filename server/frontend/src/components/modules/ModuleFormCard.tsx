import { useState, type FormEvent } from "react";
import { Card } from "../ui/Feedback";
import { ApiError } from "../../api/client";
import {
  createModule,
  deleteModule,
  updateModule,
  sinVacios,
  PATRON_SLUG,
  type ActualizarModuloBody,
  type CrearModuloBody,
} from "../../api/modulesAdminApi";
import "./ModuleFormCard.css";

/**
 * ALTA, EDICIÓN y BAJA de un módulo desde el panel.
 *
 * El hueco que cierra: hasta ahora `ModulesPage` era SÓLO LECTURA y dar de alta
 * un ESP32 físico obligaba a `curl` o a Swagger. La API estaba entera; lo que
 * faltaba era la pantalla.
 *
 * Tres decisiones que no son de estilo:
 *
 *  1. **`slug` sólo existe en el alta.** `UpdateModuleDto` no lo declara y un
 *     PATCH que lo traiga recibe 400. Ofrecer un campo deshabilitado, o uno que
 *     el panel descarte en silencio, sería prometer que la identidad MQTT se
 *     puede cambiar. No se puede: es el `module_id` del broker (F-02).
 *  2. **El mensaje del backend se enseña tal cual.** Un 400 dice qué campo está
 *     mal y un 409 que el slug ya está ocupado. «Ha ocurrido un error» convierte
 *     un dato accionable en un callejón sin salida.
 *  3. **La baja pide confirmación explícita** y nombra el slug que va a
 *     desaparecer, para que un clic de más no borre el módulo equivocado.
 */

interface CamposFormulario {
  slug: string;
  friendlyName: string;
  targetSystemId: string;
  hardwareRevision: string;
  serial: string;
  mac: string;
}

const VACIO: CamposFormulario = {
  slug: "",
  friendlyName: "",
  targetSystemId: "",
  hardwareRevision: "",
  serial: "",
  mac: "",
};

/** Campos comunes a alta y edición (todo menos `slug`). */
function CamposComunes({
  campos,
  set,
  deshabilitado,
  prefijo,
}: {
  campos: CamposFormulario;
  set: (parcial: Partial<CamposFormulario>) => void;
  deshabilitado: boolean;
  prefijo: string;
}) {
  return (
    <>
      <label htmlFor={`${prefijo}-friendlyName`}>Nombre visible</label>
      <input
        id={`${prefijo}-friendlyName`}
        value={campos.friendlyName}
        disabled={deshabilitado}
        onChange={(e) => set({ friendlyName: e.target.value })}
      />

      <label htmlFor={`${prefijo}-targetSystemId`}>Sistema (UUID)</label>
      <input
        id={`${prefijo}-targetSystemId`}
        value={campos.targetSystemId}
        disabled={deshabilitado}
        onChange={(e) => set({ targetSystemId: e.target.value })}
      />

      <label htmlFor={`${prefijo}-hardwareRevision`}>Revisión de hardware</label>
      <input
        id={`${prefijo}-hardwareRevision`}
        value={campos.hardwareRevision}
        disabled={deshabilitado}
        onChange={(e) => set({ hardwareRevision: e.target.value })}
      />

      <label htmlFor={`${prefijo}-serial`}>Número de serie</label>
      <input
        id={`${prefijo}-serial`}
        value={campos.serial}
        disabled={deshabilitado}
        onChange={(e) => set({ serial: e.target.value })}
      />

      <label htmlFor={`${prefijo}-mac`}>MAC (AA:BB:CC:DD:EE:FF)</label>
      <input
        id={`${prefijo}-mac`}
        value={campos.mac}
        disabled={deshabilitado}
        onChange={(e) => set({ mac: e.target.value })}
      />
    </>
  );
}

/** Mensaje para el operador a partir del fallo real, sin aplanarlo. */
function textoDeFallo(e: unknown, accionFallida: string): string {
  if (e instanceof ApiError) {
    if (e.status === 409) {
      return `Conflicto: ${e.userMessage} (Ese identificador ya está en uso; elija otro.)`;
    }
    return e.userMessage;
  }
  return `No se ha podido ${accionFallida}.`;
}

export function AltaModuloCard({ onCreado }: { onCreado: () => void }) {
  const [campos, setCampos] = useState<CamposFormulario>(VACIO);
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  const set = (parcial: Partial<CamposFormulario>) => setCampos((c) => ({ ...c, ...parcial }));

  async function enviar(ev: FormEvent) {
    ev.preventDefault();
    setFallo(null);
    setExito(null);

    const slug = campos.slug.trim();
    if (slug === "") {
      setFallo("El identificador (slug) es obligatorio: es el module_id del módulo en MQTT.");
      return;
    }
    // Aviso local, NO sustituto de la validación del backend: si el patrón de
    // aquí y el de allí divergieran, manda el de allí y su mensaje es el que se
    // pinta.
    if (!PATRON_SLUG.test(slug)) {
      setFallo(
        "El identificador debe tener entre 3 y 63 caracteres, empezar por letra minúscula o dígito " +
          "y contener sólo minúsculas, dígitos y guiones.",
      );
      return;
    }

    const body: CrearModuloBody = {
      slug,
      ...sinVacios({
        friendlyName: campos.friendlyName,
        targetSystemId: campos.targetSystemId,
        hardwareRevision: campos.hardwareRevision,
        serial: campos.serial,
        mac: campos.mac,
      }),
    };

    setEnviando(true);
    try {
      const creado = await createModule(body);
      setCampos(VACIO);
      setExito(
        `Módulo «${creado.slug}» dado de alta. Aparecerá como PENDIENTE hasta que el dispositivo ` +
          "publique de verdad: el alta registra la ficha, no conecta nada.",
      );
      onCreado();
    } catch (e) {
      setFallo(textoDeFallo(e, "dar de alta el módulo"));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Card title="Dar de alta un módulo">
      <form className="modulo-form" onSubmit={enviar} aria-label="Alta de módulo">
        <label htmlFor="alta-slug">Identificador MQTT (slug) *</label>
        <input
          id="alta-slug"
          value={campos.slug}
          disabled={enviando}
          required
          onChange={(e) => set({ slug: e.target.value })}
        />
        <p className="hint">
          Es el <code>module_id</code> del broker y no se puede cambiar después: minúsculas, dígitos y
          guiones, de 3 a 63 caracteres.
        </p>

        <CamposComunes campos={campos} set={set} deshabilitado={enviando} prefijo="alta" />

        <button type="submit" disabled={enviando}>
          {enviando ? "Dando de alta…" : "Dar de alta"}
        </button>
      </form>

      {fallo && <p role="alert">{fallo}</p>}
      {exito && <p role="status">{exito}</p>}
    </Card>
  );
}

export function EdicionModuloCard({
  moduleId,
  slug,
  friendlyName,
  onCambiado,
}: {
  moduleId: string;
  slug: string;
  friendlyName: string | null;
  onCambiado: () => void;
}) {
  const [campos, setCampos] = useState<CamposFormulario>({ ...VACIO, friendlyName: friendlyName ?? "" });
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [confirmandoBaja, setConfirmandoBaja] = useState(false);

  const set = (parcial: Partial<CamposFormulario>) => setCampos((c) => ({ ...c, ...parcial }));

  async function guardar(ev: FormEvent) {
    ev.preventDefault();
    setFallo(null);
    setExito(null);

    const body: ActualizarModuloBody = sinVacios({
      friendlyName: campos.friendlyName,
      targetSystemId: campos.targetSystemId,
      hardwareRevision: campos.hardwareRevision,
      serial: campos.serial,
      mac: campos.mac,
    });
    if (Object.keys(body).length === 0) {
      setFallo("No hay ningún cambio que enviar: todos los campos están vacíos.");
      return;
    }

    setEnviando(true);
    try {
      await updateModule(moduleId, body);
      setExito(`Cambios guardados en «${slug}».`);
      onCambiado();
    } catch (e) {
      setFallo(textoDeFallo(e, "guardar los cambios"));
    } finally {
      setEnviando(false);
    }
  }

  async function darDeBaja() {
    setFallo(null);
    setExito(null);
    setEnviando(true);
    try {
      await deleteModule(moduleId);
      setConfirmandoBaja(false);
      setExito(`Módulo «${slug}» dado de baja.`);
      onCambiado();
    } catch (e) {
      setFallo(textoDeFallo(e, "dar de baja el módulo"));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="modulo-edicion">
      <form className="modulo-form" onSubmit={guardar} aria-label={`Edición de ${slug}`}>
        <p className="hint">
          El identificador <code>{slug}</code> <strong>no es editable</strong>: es la identidad MQTT del
          dispositivo (F-02) y el backend rechaza cualquier intento de cambiarlo.
        </p>
        <CamposComunes campos={campos} set={set} deshabilitado={enviando} prefijo={`edit-${moduleId}`} />
        <p className="hint">
          Los campos que se dejen vacíos <strong>no se envían</strong>: se quedan como estaban.
        </p>
        <button type="submit" disabled={enviando}>
          {enviando ? "Guardando…" : "Guardar cambios"}
        </button>
      </form>

      {!confirmandoBaja ? (
        <button type="button" disabled={enviando} onClick={() => setConfirmandoBaja(true)}>
          Dar de baja
        </button>
      ) : (
        <div role="group" aria-label={`Confirmar baja de ${slug}`}>
          <p role="alert">
            ¿Dar de baja «{slug}»? Se elimina la ficha del módulo. Esta acción no se puede deshacer.
          </p>
          <button type="button" disabled={enviando} onClick={darDeBaja}>
            Sí, dar de baja «{slug}»
          </button>
          <button type="button" disabled={enviando} onClick={() => setConfirmandoBaja(false)}>
            Cancelar
          </button>
        </div>
      )}

      {fallo && <p role="alert">{fallo}</p>}
      {exito && <p role="status">{exito}</p>}
    </div>
  );
}
