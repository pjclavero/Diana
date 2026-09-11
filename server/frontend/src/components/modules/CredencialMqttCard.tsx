import { useCallback, useEffect, useState } from "react";
import { Card, ErrorState, LoadingState } from "../ui/Feedback";
import { ApiError } from "../../api/client";
import {
  consultarCredencialMqtt,
  emitirCredencialMqtt,
  esConflictoDeCredencial,
  revocarCredencialMqtt,
  tieneCredencial,
  type ConsultaCredencial,
  type CredencialEmitida,
} from "../../api/mqttIdentityApi";
import "./ModuleFormCard.css";

/**
 * CREDENCIAL MQTT de un módulo: emitir, ver metadatos, rotar y revocar.
 *
 * Lo que esta tarjeta tiene PROHIBIDO, y cómo se cumple:
 *
 *  - **Generar nada.** El secreto lo produce el backend con `randomBytes` y lo
 *    escribe en el `passwd` del broker. Aquí no hay generador de aleatorios ni
 *    derivación alguna: sólo se enseña lo que llega.
 *  - **Persistir el secreto.** Vive en un `useState` y en ningún otro sitio: ni
 *    `localStorage`, ni `sessionStorage`, ni la URL, ni una caché de consulta.
 *    Se borra al cerrar el aviso y desaparece con el desmontaje del componente,
 *    es decir, al navegar. Lo vigila además
 *    `auth/sin-credenciales-en-el-panel.test.ts`, que recorre el árbol.
 *  - **Fingir que los metadatos traen el secreto.** El `GET` no lo devuelve
 *    —el backend guarda un hash bcrypt— y la ficha lo dice explícitamente.
 *
 * El 409 de reemisión merece párrafo propio: NO es una avería. Es la respuesta
 * correcta a pedir por segunda vez algo que se entrega una sola vez, y la única
 * salida es ROTAR (que invalida la anterior y deja al dispositivo físico fuera
 * del broker hasta que alguien le cargue la nueva). Por eso se pinta como
 * conflicto con su mensaje real y con la rotación al lado, no como un fallo.
 */
export function CredencialMqttCard({ moduleId, slug }: { moduleId: string; slug?: string }) {
  const [consulta, setConsulta] = useState<ConsultaCredencial | null>(null);
  const [cargando, setCargando] = useState(true);
  const [errorConsulta, setErrorConsulta] = useState<string | null>(null);

  /** El secreto en claro. Estado EFÍMERO y deliberadamente no persistido. */
  const [emitida, setEmitida] = useState<CredencialEmitida | null>(null);
  const [conflicto, setConflicto] = useState<string | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmandoRevocacion, setConfirmandoRevocacion] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorConsulta(null);
    try {
      setConsulta(await consultarCredencialMqtt(moduleId));
    } catch (e) {
      // Igual que en el resto del panel: el dato viejo no se conserva. «No he
      // podido preguntar» no se pinta como «no hay credencial».
      setConsulta(null);
      setErrorConsulta(
        e instanceof ApiError ? e.userMessage : "No se ha podido consultar la credencial MQTT.",
      );
    } finally {
      setCargando(false);
    }
  }, [moduleId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  /**
   * Barrido del secreto al desmontar. React ya descartaría el estado, pero
   * dejarlo explícito documenta la garantía y falla de forma visible si alguien
   * convierte este estado en algo que sobreviva al componente.
   */
  useEffect(() => () => setEmitida(null), []);

  async function emitir(rotar: boolean) {
    setFallo(null);
    setConflicto(null);
    setCopiado(false);
    setOcupado(true);
    try {
      const resultado = await emitirCredencialMqtt(moduleId, rotar);
      setEmitida(resultado);
      await cargar();
    } catch (e) {
      if (esConflictoDeCredencial(e)) {
        setConflicto(e.userMessage);
      } else {
        setFallo(
          e instanceof ApiError ? e.userMessage : "No se ha podido emitir la credencial MQTT.",
        );
      }
    } finally {
      setOcupado(false);
    }
  }

  async function revocar() {
    setFallo(null);
    setConflicto(null);
    setOcupado(true);
    try {
      await revocarCredencialMqtt(moduleId);
      setConfirmandoRevocacion(false);
      setEmitida(null);
      await cargar();
    } catch (e) {
      setFallo(e instanceof ApiError ? e.userMessage : "No se ha podido revocar la credencial MQTT.");
    } finally {
      setOcupado(false);
    }
  }

  async function copiar() {
    if (!emitida) return;
    try {
      await navigator.clipboard?.writeText(emitida.secret);
      setCopiado(true);
    } catch {
      // Sin portapapeles (contexto no seguro, permiso denegado): se dice, para
      // que nadie crea que el secreto ya está copiado y cierre el aviso.
      setCopiado(false);
      setFallo("No se ha podido copiar al portapapeles: cópielo a mano antes de cerrar este aviso.");
    }
  }

  const emitido = consulta !== null && tieneCredencial(consulta);

  return (
    <Card title="Credencial MQTT">
      {emitida && (
        <div role="alert" className="credencial-emitida">
          <p className="credencial-aviso">
            Ésta es la ÚNICA vez que se muestra esta contraseña. No se guarda en ningún sitio y no se
            puede volver a consultar: si se pierde, hay que ROTARLA.
          </p>
          <dl className="kv-list">
            <div>
              <dt>Usuario</dt>
              <dd>{emitida.username}</dd>
            </div>
            <div>
              <dt>client_id</dt>
              <dd>{emitida.clientId}</dd>
            </div>
            <div>
              <dt>Contraseña</dt>
              <dd className="credencial-secreto">{emitida.secret}</dd>
            </div>
            <div>
              <dt>Huella</dt>
              <dd>{emitida.fingerprint}</dd>
            </div>
            <div>
              <dt>Generación</dt>
              <dd>{emitida.generation}</dd>
            </div>
          </dl>
          <button type="button" onClick={copiar}>
            Copiar contraseña
          </button>
          {copiado && <span role="status">Copiada al portapapeles.</span>}
          <button
            type="button"
            onClick={() => {
              setEmitida(null);
              setCopiado(false);
            }}
          >
            He guardado la contraseña, cerrar
          </button>
          <p className="hint">
            Emitir la credencial NO conecta el módulo: seguirá PENDIENTE hasta que el dispositivo
            publique de verdad con ella.
          </p>
        </div>
      )}

      {conflicto && (
        <div role="alert">
          <p>
            <strong>Ya tiene credencial emitida.</strong> {conflicto}
          </p>
          <p>
            La contraseña se entregó una sola vez y no se puede recuperar. Si se ha perdido, la única
            salida es <strong>rotarla</strong>, lo que invalida la anterior: el dispositivo físico se
            quedará fuera del broker hasta que se le cargue la nueva.
          </p>
          <button type="button" disabled={ocupado} onClick={() => void emitir(true)}>
            Rotar la credencial de {slug ?? "este módulo"}
          </button>
        </div>
      )}

      {fallo && <p role="alert">{fallo}</p>}

      {cargando && <LoadingState label="Consultando la credencial…" />}
      {errorConsulta && <ErrorState message={errorConsulta} onRetry={cargar} />}

      {!cargando && !errorConsulta && consulta !== null && !emitido && (
        <>
          <p>
            <strong>Sin credencial MQTT emitida.</strong> {(consulta as { note?: string }).note ?? ""}
          </p>
          <button type="button" disabled={ocupado} onClick={() => void emitir(false)}>
            {ocupado ? "Emitiendo…" : "Emitir credencial"}
          </button>
        </>
      )}

      {!cargando && !errorConsulta && consulta !== null && emitido && tieneCredencial(consulta) && (
        <>
          <dl className="kv-list">
            <div>
              <dt>Usuario</dt>
              <dd>{consulta.username}</dd>
            </div>
            <div>
              <dt>client_id</dt>
              <dd>{consulta.clientId}</dd>
            </div>
            <div>
              <dt>Huella</dt>
              <dd>{consulta.fingerprint}</dd>
            </div>
            <div>
              <dt>Generación</dt>
              <dd>{consulta.generation}</dd>
            </div>
            <div>
              <dt>Emitida</dt>
              <dd>{new Date(consulta.issuedAt).toLocaleString("es-ES")}</dd>
            </div>
            <div>
              <dt>Revocada</dt>
              <dd>
                {consulta.revokedAt ? new Date(consulta.revokedAt).toLocaleString("es-ES") : "no"}
              </dd>
            </div>
            <div>
              <dt>Emitida por</dt>
              <dd>{consulta.issuedByUsername ?? "—"}</dd>
            </div>
          </dl>
          <p className="hint">
            Estos son los METADATOS. La contraseña no aparece aquí porque el servidor no la tiene:
            guarda un hash. Sólo existió en claro en el momento de emitirla.
          </p>
          <button type="button" disabled={ocupado} onClick={() => void emitir(true)}>
            Rotar credencial
          </button>
          {!confirmandoRevocacion ? (
            <button type="button" disabled={ocupado} onClick={() => setConfirmandoRevocacion(true)}>
              Revocar credencial
            </button>
          ) : (
            <div role="group" aria-label="Confirmar revocación">
              <p role="alert">
                ¿Revocar la credencial de «{consulta.username}»? El módulo dejará de poder conectarse
                al broker inmediatamente.
              </p>
              <button type="button" disabled={ocupado} onClick={() => void revocar()}>
                Sí, revocar
              </button>
              <button type="button" disabled={ocupado} onClick={() => setConfirmandoRevocacion(false)}>
                Cancelar
              </button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
