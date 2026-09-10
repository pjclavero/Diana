/**
 * LOS CINCO ESTADOS que el panel tiene que saber distinguir, y por qué son
 * cinco y no dos.
 *
 * El backend entrega una bandera `online` y una marca `lastSeenAt`. Pintar sólo
 * la bandera produce dos mentiras distintas:
 *
 *  - **El módulo pegado a «en línea».** `online` sólo baja cuando llega el Last
 *    Will del broker, y ese mensaje puede no llegar nunca (broker reiniciado
 *    sin persistencia, sesión perdida). Un módulo muerto se queda «en línea»
 *    indefinidamente. Eso es `stale`: la bandera dice sí y el silencio dice no.
 *    Se declara el conflicto, no se resuelve a favor de la bandera.
 *  - **El módulo recién dado de alta.** Está registrado y todavía no ha dicho
 *    nada. No es una avería: es `pendiente`. Meterlo en «desconectado» hace que
 *    un alta normal parezca una caída.
 *
 * El quinto —**sin módulos**— no es un estado de módulo sino de la lista, y va
 * aparte a propósito: «no hay módulos registrados» y «no he podido preguntar»
 * se pintan distinto (ver `EstadoDeLista`).
 *
 * El umbral de silencio (90 s) es el MISMO que usa el backend en
 * `server/backend/src/domain/resilience/resilience.ts` (`STALE_AFTER_MS`), y
 * está duplicado a conciencia: el panel no puede leer una constante del backend
 * y no hay ruta que la sirva. Si allí cambia, aquí se queda corto o largo — por
 * eso es un parámetro con valor por defecto y no un número escondido.
 */

export type EstadoModulo = "pendiente" | "offline" | "stale" | "online";

/** Silencio máximo tolerado a un módulo que consta EN LÍNEA. Ver nota de arriba. */
export const SILENCIO_MAXIMO_MS = 90_000;

export interface ModuloObservado {
  online: boolean;
  /** ISO-8601, o `null` si nunca ha dado señal. */
  lastSeenAt: string | null;
}

export interface Diagnostico {
  estado: EstadoModulo;
  /** Etiqueta corta para la insignia. */
  etiqueta: string;
  /** Frase que explica en qué se basa. Nunca «OK» a secas. */
  motivo: string;
  /** Silencio medido, o `null` si no se puede medir (nunca dio señal). */
  silencioMs: number | null;
}

/**
 * Diagnostica UN módulo. Función pura: recibe el «ahora» en vez de leer el
 * reloj, para que la prueba pueda situarse en el borde exacto del umbral.
 */
export function diagnosticarModulo(
  m: ModuloObservado,
  ahora: Date,
  silencioMaximoMs: number = SILENCIO_MAXIMO_MS,
): Diagnostico {
  const visto = m.lastSeenAt ? Date.parse(m.lastSeenAt) : NaN;
  const silencioMs = Number.isNaN(visto) ? null : ahora.getTime() - visto;

  if (silencioMs === null) {
    if (m.online) {
      // Consta en línea y NADA lo respalda. No se le concede el «en línea».
      return {
        estado: "stale",
        etiqueta: "sin confirmar",
        motivo:
          "El backend lo da por conectado, pero no consta ninguna señal de vida suya. " +
          "No se puede confirmar que esté vivo.",
        silencioMs: null,
      };
    }
    return {
      estado: "pendiente",
      etiqueta: "pendiente",
      motivo: "Registrado y todavía sin primera señal. No ha llegado a conectarse nunca.",
      silencioMs: null,
    };
  }

  if (!m.online) {
    return {
      estado: "offline",
      etiqueta: "desconectado",
      motivo: `Desconectado. Última señal hace ${formatearSilencio(silencioMs)}.`,
      silencioMs,
    };
  }

  if (silencioMs > silencioMaximoMs) {
    return {
      estado: "stale",
      etiqueta: "sin señal reciente",
      motivo:
        `Consta en línea, pero lleva ${formatearSilencio(silencioMs)} sin dar señal ` +
        `(máximo tolerado ${Math.round(silencioMaximoMs / 1000)} s). Puede estar caído sin que se haya notado.`,
      silencioMs,
    };
  }

  return {
    estado: "online",
    etiqueta: "en línea",
    motivo: `En línea. Última señal hace ${formatearSilencio(silencioMs)}.`,
    silencioMs,
  };
}

/** Silencio en palabras. Un futuro (reloj desviado) se dice, no se pinta como 0 s. */
export function formatearSilencio(ms: number): string {
  if (ms < 0) return "una marca de tiempo futura (relojes desincronizados)";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 48 ? `${h} h` : `${Math.floor(h / 24)} días`;
}

export interface RecuentoPorEstado {
  total: number;
  online: number;
  stale: number;
  offline: number;
  pendiente: number;
}

/**
 * Recuento honesto de una lista ya recibida.
 *
 * OJO con `online`: NO se copia `summary.online` del backend, que cuenta la
 * bandera. Aquí se cuenta el diagnóstico, así que un módulo `stale` NO suma
 * como «en línea». Con cero dispositivos conectados el panel enseña 0.
 */
export function recuentoPorEstado(
  modulos: ModuloObservado[],
  ahora: Date,
  silencioMaximoMs: number = SILENCIO_MAXIMO_MS,
): RecuentoPorEstado {
  const r: RecuentoPorEstado = { total: modulos.length, online: 0, stale: 0, offline: 0, pendiente: 0 };
  for (const m of modulos) r[diagnosticarModulo(m, ahora, silencioMaximoMs).estado] += 1;
  return r;
}

/**
 * ESTADO DE LA LISTA, que no es el de un módulo.
 *
 * `vacio` significa «he preguntado y no hay ninguno». `error` significa «no he
 * podido preguntar». Confundirlos es el defecto que ya se coló una vez en este
 * panel (Inicio pintaba «Sin alertas activas» ante un fallo de red), y es la
 * razón de que esta función exija recibir las tres entradas: no se puede
 * concluir «vacío» sin haber mirado `error` antes.
 */
export type EstadoDeLista = "cargando" | "error" | "vacio" | "con-datos";

export function estadoDeLista<T>(entrada: {
  cargando: boolean;
  error: string | null;
  datos: T[] | null;
}): EstadoDeLista {
  if (entrada.error !== null) return "error";
  if (entrada.cargando || entrada.datos === null) return "cargando";
  return entrada.datos.length === 0 ? "vacio" : "con-datos";
}

/**
 * ESTADO DE LA CONFIGURACIÓN de un módulo (deseada vs. reportada).
 *
 * DEPENDE DEL CARRIL DE BACKEND, que está añadiendo `config_version` deseada y
 * reportada con estado `pending|applied|failed`. Mientras el contrato no traiga
 * esos campos llegan `undefined`, y `undefined` NO es «aplicada»: es
 * `desconocida`. Suponer «aplicada» por ausencia de dato es exactamente la
 * clase de optimismo que este carril tiene prohibida.
 */
export type EstadoConfig = "aplicada" | "pendiente" | "fallida" | "desconocida";

export interface ConfigObservada {
  /* Nombres EXACTOS de la respuesta del backend (`modules-overview.service.ts`).
   * Antes el panel leia `configVersionDesired`/`configStatus`, que el backend
   * no emite: la ficha decia siempre «desconocida». Lo cazó el E2E de
   * navegador contra el backend real, no las pruebas con dobles -- porque un
   * doble devuelve los nombres que uno le enseña. */
  configState?: "pending" | "applied" | "failed" | null;
  desiredConfigVersion?: number | string | null;
  reportedConfigVersion?: number | string | null;
}

export function estadoDeConfiguracion(c: ConfigObservada): { estado: EstadoConfig; motivo: string } {
  switch (c.configState) {
    case "applied":
      return { estado: "aplicada", motivo: "El módulo confirma la configuración vigente." };
    case "pending":
      return {
        estado: "pendiente",
        motivo: `Configuración enviada (v${c.desiredConfigVersion ?? "?"}) y aún sin confirmar por el módulo.`,
      };
    case "failed":
      return {
        estado: "fallida",
        motivo: `El módulo rechazó o no pudo aplicar la configuración v${c.desiredConfigVersion ?? "?"}.`,
      };
  }

  // Sin `configState`: sólo se puede decir algo si vienen las dos versiones.
  const deseada = c.desiredConfigVersion;
  const reportada = c.reportedConfigVersion;
  if (deseada === undefined || deseada === null || reportada === undefined || reportada === null) {
    return {
      estado: "desconocida",
      motivo: "El backend no informa del estado de la configuración: no se puede afirmar que esté aplicada.",
    };
  }
  return String(deseada) === String(reportada)
    ? { estado: "aplicada", motivo: `El módulo reporta la versión deseada (v${deseada}).` }
    : {
        estado: "pendiente",
        motivo: `Deseada v${deseada}, reportada v${reportada}: pendiente de aplicar.`,
      };
}
