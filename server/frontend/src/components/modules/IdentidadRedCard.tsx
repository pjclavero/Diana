import { obtenerModulo } from "../../api/moduleRowApi";
import { useAsync } from "../../hooks/useAsync";
import { Card, ErrorState, LoadingState } from "../ui/Feedback";
import { diagnosticarModulo } from "../../utils/estadoModulo";

/**
 * IDENTIDAD, RED Y PRESENCIA de un módulo, leídas de la fila real.
 *
 * Lo que esta tarjeta arregla (ver `api/moduleRowApi.ts` para la causa): la IP,
 * la MAC y el número de serie de un módulo NO se podían ver en ningún sitio del
 * panel, ni en la lista ni en la ficha, pese a estar en la base.
 *
 * Dos reglas que aquí no son adorno:
 *
 *  1. **`null` y «no lo sé» se escriben distinto.** Una columna NULLABLE vacía
 *     significa «no consta» y se dice con esas palabras. Un «—» habría mezclado
 *     eso con «el backend no me lo mandó» y con «la consulta falló», que son
 *     tres situaciones que el operador resuelve de tres maneras distintas.
 *  2. **La clasificación de presencia sale de `diagnosticarModulo`,** el mismo
 *     juicio que usa la lista, y NO de la bandera `online`. Un módulo recién
 *     dado de alta, con `last_seen_at` a NULL, tiene que salir PENDIENTE —
 *     nunca EN LÍNEA — y esta tarjeta enseña a la vez la bandera cruda y el
 *     veredicto, que es lo único que delata a una bandera pegada a `true`.
 *
 * `last_seen_at` se pinta además en crudo (ISO-8601) junto a la fecha local: la
 * fecha local es para leerla y el ISO es para poder comparar con la base sin
 * traducir zonas horarias a ojo.
 */
export function IdentidadRedCard({ moduleId }: { moduleId: string }) {
  const { data, loading, error, reload } = useAsync(() => obtenerModulo(moduleId), [moduleId]);

  return (
    <Card title="Identidad, red y presencia">
      {loading && <LoadingState label="Consultando la ficha del módulo…" />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && <Cuerpo fila={data} />}
    </Card>
  );
}

function Cuerpo({ fila }: { fila: Awaited<ReturnType<typeof obtenerModulo>> }) {
  // El «ahora» se toma una vez para que el veredicto y el silencio mostrado
  // hablen del mismo instante.
  const ahora = new Date();
  const diag = diagnosticarModulo(
    { online: fila.online === true, lastSeenAt: fila.lastSeenAt ?? null },
    ahora,
  );

  return (
    <dl className="ficha-modulo">
      <Dato etiqueta="module_id (slug)" valor={fila.slug} />
      <Dato etiqueta="Número de serie" valor={fila.serial} />
      <Dato etiqueta="MAC" valor={fila.mac} />
      <Dato etiqueta="IP" valor={fila.ip} />
      <Dato etiqueta="Revisión de hardware" valor={fila.hardwareRevision} />
      <Dato etiqueta="Placa" valor={fila.targetBoard} />
      <Dato etiqueta="Versión de firmware" valor={fila.firmwareVersion} />

      <dt>Presencia</dt>
      <dd>
        <span className={`badge ${diag.estado === "online" ? "badge--ok" : "badge--muted"}`}>
          {diag.etiqueta}
        </span>{" "}
        <span className="hint">{diag.motivo}</span>
        <br />
        {/* La bandera CRUDA del backend, junto al veredicto y no en su lugar.
            Verlas juntas es lo que permite cazar un `online = true` que ninguna
            señal respalda. */}
        <span className="hint">
          Bandera del backend <code>online</code>: <strong>{String(fila.online === true)}</strong>
        </span>
      </dd>

      <dt>
        <code>last_seen_at</code>
      </dt>
      <dd>
        {fila.lastSeenAt ? (
          <>
            {new Date(fila.lastSeenAt).toLocaleString("es-ES")} <code>({fila.lastSeenAt})</code>
          </>
        ) : (
          <em>NULL — este módulo no ha dado señal NUNCA</em>
        )}
      </dd>

      <dt>
        <code>desired_config_version</code>
      </dt>
      <dd>{fila.desiredConfigVersion ?? <em>no consta</em>}</dd>

      <dt>
        <code>reported_config_version</code>
      </dt>
      <dd>
        {fila.reportedConfigVersion ?? <em>NULL — el módulo no ha reportado ninguna versión</em>}
      </dd>

      <dt>
        <code>config_state</code>
      </dt>
      <dd>{fila.configState ?? <em>no consta</em>}</dd>
    </dl>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor?: string | null }) {
  return (
    <>
      <dt>{etiqueta}</dt>
      <dd>{valor ? <code>{valor}</code> : <em>no consta</em>}</dd>
    </>
  );
}
