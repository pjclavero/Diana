import { useCallback, useState } from "react";
import { apiClient } from "../../api";
import { ApiError } from "../../api/client";
import {
  resultadoDePublicacion,
  type AccionAprovisionamiento,
  type EstadoAprovisionamientoObservado,
  type ModoAprovisionamiento,
  type OrdenAprovisionamiento,
  type ResultadoOrden,
} from "../../api/provisioningApi";
import { useAuth } from "../../auth/AuthContext";
import { Card, EmptyState, ErrorState, LoadingState } from "../../components/ui/Feedback";
import { estadoDeLista } from "../../utils/estadoModulo";
import "./ProvisioningPage.css";

/**
 * T2 · APROVISIONAMIENTO (datos REALES, sin relleno).
 *
 * Tres cosas que esta pantalla hace distinto de una pantalla normal, y las tres
 * por un motivo concreto:
 *
 *  1. **No dice «aceptado».** El POST devuelve el resultado real de la
 *     publicación MQTT: `delivered`, `denied`, `timed_out` y `reason_code`. Una
 *     denegación de ACL del broker no se distingue por el código de retorno del
 *     cliente MQTT — sólo por el `reason_code` del PUBACK —, así que ese matiz
 *     se pinta con esas palabras en vez de quedarse en un log.
 *
 *  2. **Distingue «sin estado observado» de «no he podido preguntar».** El 404
 *     del backend significa que ese módulo nunca ha reportado, que es el caso
 *     NORMAL hoy porque no hay ningún dispositivo físico. Un fallo de red, en
 *     cambio, se pinta como error con su botón de reintento. Se reutiliza
 *     `estadoDeLista` para que esa distinción no dependa de recordarla.
 *
 *  3. **Trata `observational_only` como lo que es.** Lo que se lee es lo que el
 *     módulo DIJO, no una verdad del sistema ni un `desired state` ejecutable:
 *     de esa lectura no cuelga ninguna acción.
 *
 * Y una que NO hace: generar credenciales. La huella de la clave de
 * aprovisionamiento la APORTA el operador; el panel ni la calcula ni la deriva.
 */
export function ProvisioningPage() {
  const { can } = useAuth();
  const puedeLeer = can("provisioning:read");
  const puedeEmitir = can("provisioning:issue");

  if (!puedeLeer && !puedeEmitir) return <SinPermiso />;

  return (
    <div className="provisioning">
      <h1>Aprovisionamiento de módulos</h1>
      <p>
        Plano <code>DEVICE_MANAGEMENT</code>: establece la autoridad criptográfica de un dispositivo. El panel
        no publica MQTT ni firma nada — se lo pide al backend, que es la única entrada humana al plano.
      </p>

      {puedeLeer ? <ConsultaDeEstado /> : <FaltaPermiso permiso="provisioning:read" que="consultar el estado observado" />}
      {puedeEmitir ? <EmisionDeOrden /> : <FaltaPermiso permiso="provisioning:issue" que="emitir órdenes" />}
    </div>
  );
}

/** Ni leer ni emitir. Se explica POR QUÉ, que aquí no es obvio. */
function SinPermiso() {
  return (
    <div className="provisioning">
      <h1>Aprovisionamiento de módulos</h1>
      <ErrorState
        message={
          "No tiene permisos de aprovisionamiento. No es un fallo: «provisioning:read» y " +
          "«provisioning:issue» no los tiene ningún rol salvo el administrador, y NO se heredan de " +
          "«commands:publish» aunque su rol lo tenga. Concedérselos a otro rol es un cambio explícito " +
          "en el backend."
        }
      />
    </div>
  );
}

function FaltaPermiso({ permiso, que }: { permiso: string; que: string }) {
  return (
    <Card title={`Sin permiso para ${que}`}>
      <p role="status">
        Le falta <code>{permiso}</code>. Hoy sólo el rol administrador lo cubre (con <code>*</code>); no se hereda
        de <code>commands:publish</code>.
      </p>
    </Card>
  );
}

/* ───────────────────────── Estado observado ────────────────────────────── */

function ConsultaDeEstado() {
  const [deviceId, setDeviceId] = useState("");
  const [consultado, setConsultado] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [datos, setDatos] = useState<EstadoAprovisionamientoObservado[] | null>(null);

  const consultar = useCallback(
    async (id: string) => {
      const limpio = id.trim();
      if (!limpio) return;
      setConsultado(limpio);
      setCargando(true);
      setError(null);
      setDatos(null);
      try {
        const estado = await apiClient.getProvisioningState(limpio);
        // `null` = 404 = nunca ha reportado. Lista VACÍA, no error.
        setDatos(estado ? [estado] : []);
      } catch (e) {
        // Cualquier otro fallo es un fallo DE VERDAD. No se degrada a «sin datos»:
        // ése es el defecto que Inicio ya cometió («Sin alertas activas» con el
        // backend caído).
        setError(e instanceof ApiError ? e.userMessage : "No se ha podido consultar el estado de aprovisionamiento.");
      } finally {
        setCargando(false);
      }
    },
    [],
  );

  const estado = estadoDeLista({ cargando, error, datos });
  const observado = datos && datos.length > 0 ? datos[0] : null;

  return (
    <Card title="Estado observado del módulo">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void consultar(deviceId);
        }}
      >
        <label>
          Identificador del dispositivo{" "}
          <input
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            placeholder="module-01"
            aria-label="Identificador del dispositivo a consultar"
          />
        </label>{" "}
        <button type="submit" disabled={!deviceId.trim() || cargando}>
          Consultar estado
        </button>
      </form>

      {estado === "cargando" && consultado && <LoadingState label={`Consultando ${consultado}…`} />}

      {estado === "error" && (
        <ErrorState
          message={`${error} No se ha podido preguntar por «${consultado}»: esto NO significa que el módulo no tenga estado.`}
          onRetry={() => void consultar(consultado ?? deviceId)}
        />
      )}

      {estado === "vacio" && (
        <EmptyState>
          <strong>Sin estado observado todavía</strong> para «{consultado}». El módulo nunca ha reportado nada al
          backend. Es lo normal mientras no haya un dispositivo físico conectado; no es un error ni una avería.
        </EmptyState>
      )}

      {estado === "con-datos" && observado && <FichaObservada estado={observado} />}
    </Card>
  );
}

function FichaObservada({ estado }: { estado: EstadoAprovisionamientoObservado }) {
  return (
    <div className="provisioning__observado">
      {estado.observational_only && (
        <p className="provisioning__aviso" role="note">
          <strong>Sólo observación.</strong> Esto es lo que el módulo <em>dijo</em>, no lo que el sistema sabe ni
          un estado deseado ejecutable. No hay ninguna acción que dependa de este dato: no sirve para dar por
          buena una autoridad.
        </p>
      )}
      <dl className="provisioning__campos">
        <Campo k="Dispositivo" v={estado.device_id} />
        <Campo k="Sistema" v={estado.system_id} />
        <Campo k="Estado reportado" v={estado.state} />
        <Campo k="Resultado reportado" v={estado.result} />
        <Campo
          k="Correlado con una orden"
          v={
            estado.correlated
              ? `Sí (${estado.request_id ?? "sin request_id"})`
              : "No: el módulo no ha ligado este reporte a ninguna orden emitida desde aquí."
          }
        />
        <Campo k="Época activa" v={estado.active_epoch} />
        <Campo k="Época pendiente" v={estado.pending_epoch} />
        <Campo k="Rotación" v={estado.rotation_id} />
        <Campo k="Aprovisionamiento" v={estado.provision_id} />
        <Campo k="Última secuencia de aprovisionamiento" v={estado.last_provisioning_sequence} />
        <Campo k="Última secuencia de delegación" v={estado.last_delegation_sequence} />
        <Campo k="Huella de la clave" v={estado.provisioning_key_fingerprint} />
        <Campo k="Motivo declarado" v={estado.reason} />
        <Campo k="Recibido" v={estado.received_at} />
      </dl>
    </div>
  );
}

/** Un campo ausente se dice ausente. Nunca se pinta como vacío ni como cero. */
function Campo({ k, v }: { k: string; v: string | null | undefined }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v === null || v === undefined || v === "" ? <em>no reportado</em> : <code>{v}</code>}</dd>
    </>
  );
}

/* ─────────────────────────── Emisión de orden ──────────────────────────── */

const ACCIONES: AccionAprovisionamiento[] = ["PROVISION", "PREPARE", "COMMIT"];

function EmisionDeOrden() {
  const [deviceId, setDeviceId] = useState("");
  const [systemId, setSystemId] = useState("");
  const [accion, setAccion] = useState<AccionAprovisionamiento>("PROVISION");
  const [modo, setModo] = useState<ModoAprovisionamiento | "">("");
  const [huella, setHuella] = useState("");
  const [rotationId, setRotationId] = useState("");
  const [epoch, setEpoch] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoOrden | null>(null);

  async function emitir(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    setResultado(null);
    const orden: OrdenAprovisionamiento = {
      system_id: systemId.trim(),
      action: accion,
      provisioning_key_fingerprint: huella.trim(),
      ...(modo ? { mode: modo } : {}),
      ...(rotationId.trim() ? { rotation_id: rotationId.trim() } : {}),
      ...(epoch.trim() ? { epoch: epoch.trim() } : {}),
    };
    try {
      setResultado(await apiClient.issueProvisioningOrder(deviceId.trim(), orden));
    } catch (err) {
      // La orden NO se emitió, o no se sabe. Ni una palabra que sugiera lo contrario.
      setError(
        err instanceof ApiError
          ? err.userMessage
          : "No se ha podido emitir la orden. No conste como emitida.",
      );
    } finally {
      setEnviando(false);
    }
  }

  const completo = deviceId.trim() !== "" && systemId.trim() !== "" && huella.trim() !== "";

  return (
    <Card title="Emitir orden firmada">
      <p>
        La huella <code>provisioning_key_fingerprint</code> (64 hexadecimales) la aporta usted: el panel no genera
        claves ni secretos, ni los deriva. La firma la pone el backend.
      </p>
      <form onSubmit={emitir} className="provisioning__form">
        <label>
          Dispositivo{" "}
          <input value={deviceId} onChange={(e) => setDeviceId(e.target.value)} aria-label="Dispositivo destino" />
        </label>
        <label>
          Sistema{" "}
          <input value={systemId} onChange={(e) => setSystemId(e.target.value)} aria-label="Sistema" />
        </label>
        <label>
          Acción{" "}
          <select
            value={accion}
            onChange={(e) => setAccion(e.target.value as AccionAprovisionamiento)}
            aria-label="Acción"
          >
            {ACCIONES.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label>
          Modo{" "}
          <select
            value={modo}
            onChange={(e) => setModo(e.target.value as ModoAprovisionamiento | "")}
            aria-label="Modo"
          >
            <option value="">— sin especificar —</option>
            <option value="NORMAL">NORMAL</option>
            <option value="EMERGENCY">EMERGENCY</option>
          </select>
        </label>
        <label>
          Huella de la clave{" "}
          <input value={huella} onChange={(e) => setHuella(e.target.value)} aria-label="Huella de la clave de aprovisionamiento" />
        </label>
        <label>
          Rotación (opcional){" "}
          <input value={rotationId} onChange={(e) => setRotationId(e.target.value)} aria-label="Identificador de rotación" />
        </label>
        <label>
          Época (opcional){" "}
          <input value={epoch} onChange={(e) => setEpoch(e.target.value)} aria-label="Época" />
        </label>
        <button type="submit" disabled={!completo || enviando}>
          {enviando ? "Emitiendo…" : "Emitir orden"}
        </button>
      </form>

      {enviando && <LoadingState label="Emitiendo la orden…" />}
      {error && <ErrorState message={error} />}
      {resultado && <ResultadoDeLaOrden resultado={resultado} />}
    </Card>
  );
}

/**
 * El resultado REAL de la publicación. `denied` y `timed_out` se dicen con esas
 * palabras y con su `reason_code`: no se colapsan en «enviada».
 */
function ResultadoDeLaOrden({ resultado }: { resultado: ResultadoOrden }) {
  const lectura = resultadoDePublicacion(resultado);
  return (
    <div
      className={`provisioning__resultado provisioning__resultado--${lectura.veredicto}`}
      role={lectura.correcto ? "status" : "alert"}
    >
      <p>
        <strong>{lectura.etiqueta}</strong>
      </p>
      <p>{lectura.motivo}</p>
      <dl className="provisioning__campos">
        <Campo k="request_id" v={resultado.request_id} />
        <Campo k="provisioning_sequence" v={String(resultado.provisioning_sequence)} />
        <Campo k="topic" v={resultado.topic} />
        <Campo k="delivered" v={String(resultado.delivered)} />
        <Campo k="denied" v={String(resultado.denied)} />
        <Campo k="timed_out" v={String(resultado.timed_out)} />
        <Campo k="reason_code" v={resultado.reason_code === null ? null : String(resultado.reason_code)} />
      </dl>
    </div>
  );
}
