/**
 * Ciclo de vida de una operación de MANTENIMIENTO, correlada por `request_id`.
 *
 * POR QUÉ EXISTE ESTO. El panel daba por hecho que un HTTP 200 significaba «el
 * hardware lo hizo», y buscaba el resultado cogiendo *el último diagnóstico de
 * ese `kind`*. Las dos cosas son falsas:
 *
 *   · un 200 sólo dice que el backend aceptó y publicó en el broker; el módulo
 *     puede estar apagado, rechazar la orden por caducada o no recibirla nunca
 *     —medido en el banco: una orden encolada volvió como `expired` 32 s
 *     después, sin que ninguna diana se encendiera;
 *   · «el último de ese kind» puede ser de hace dos horas, o la respuesta a la
 *     orden de otra pantalla abierta en otra pestaña.
 *
 * Aquí la única forma de llegar a `executed` o `rejected` es un diagnóstico
 * cuyo `request_id` coincide EXACTAMENTE con el de la operación. Todo lo demás
 * se ignora sin tocar el estado.
 *
 * Es lógica pura a propósito: sin React, sin red y sin reloj propio (el tiempo
 * entra como parámetro), para que las reglas se puedan probar sin montar una
 * pantalla ni esperar a que pase nada.
 */

/** Estados que la UI debe poder distinguir (MODULE_DIAGNOSTICS_V1 · P1.2). */
export type MaintenanceState =
  | 'requested' // se pulsó; aún no ha contestado el backend
  | 'published' // el backend aceptó y publicó en el broker. NO es «ejecutado»
  | 'not_published' // el backend no lo publicó (denegado por ACL, o delivered:false)
  | 'executed' // el MÓDULO confirmó, correlado por request_id
  | 'rejected' // el módulo lo rechazó, correlado por request_id
  | 'duplicate' // rechazado por ser una repetición de una orden ya ejecutada
  | 'timeout'; // se publicó y el módulo no ha contestado dentro de la ventana

export interface MaintenanceOperation {
  readonly requestId: string;
  readonly kind: string; // command_type pedido: led_test, identify…
  readonly label: string; // para la UI: «D1», «módulo»…
  readonly state: MaintenanceState;
  /** Motivo del vocabulario cerrado del contrato, cuando lo hay. */
  readonly reason: string | null;
  /** Texto del módulo o del backend, para que el operador lea qué pasó. */
  readonly detail: string | null;
  /** Instante (ms) en que se publicó; base de la ventana de espera. */
  readonly publishedAt: number | null;
}

/** Diagnóstico tal y como lo entrega el backend (`GET /diagnostics`). */
export interface DiagnosticoCorrelable {
  kind: string;
  severity: string;
  message: string;
  requestId: string | null;
  detail?: Record<string, unknown> | null;
}

/** Respuesta del backend a la orden (`CommandAck`). */
export interface AckBackend {
  request_id: string;
  delivered: boolean;
  denied?: boolean;
  duplicate?: boolean;
  note?: string | null;
}

/** Ventana por defecto antes de declarar que el módulo no ha contestado. */
export const ESPERA_RESPUESTA_MS = 15_000;

export function iniciar(requestId: string, kind: string, label: string): MaintenanceOperation {
  return {
    requestId,
    kind,
    label,
    state: 'requested',
    reason: null,
    detail: null,
    publishedAt: null,
  };
}

/**
 * Aplica la respuesta HTTP del backend.
 *
 * El techo de este paso es `published`: que el backend haya publicado no dice
 * NADA sobre el hardware. `duplicate` del backend sí es terminal, porque
 * significa que esa orden ya se había cursado y no se ha vuelto a publicar.
 */
export function aplicarAck(
  op: MaintenanceOperation,
  ack: AckBackend,
  ahora: number,
): MaintenanceOperation {
  // Un ack de OTRA orden no toca esta. Puede llegar si el operador dispara
  // varias pruebas seguidas y las respuestas se cruzan.
  if (ack.request_id !== op.requestId) return op;

  if (ack.denied) {
    return { ...op, state: 'not_published', reason: 'denied', detail: ack.note ?? null };
  }
  if (ack.duplicate) {
    return { ...op, state: 'duplicate', reason: 'duplicate', detail: ack.note ?? null };
  }
  if (!ack.delivered) {
    return { ...op, state: 'not_published', reason: 'not_delivered', detail: ack.note ?? null };
  }
  return { ...op, state: 'published', publishedAt: ahora, detail: ack.note ?? null };
}

/**
 * Aplica un diagnóstico del módulo.
 *
 * REGLA CENTRAL: sólo cuenta si su `request_id` es el de esta operación. Un
 * diagnóstico sin correlación (espontáneo: `boot`, `sensor_error`…) o de otra
 * orden NO puede mover este estado, por mucho que coincida el `kind`.
 *
 * Tampoco se retrocede desde un estado terminal: si ya llegó el veredicto del
 * módulo, un diagnóstico posterior de la misma orden —una reentrega QoS 1, por
 * ejemplo— no lo cambia.
 */
export function aplicarDiagnostico(
  op: MaintenanceOperation,
  d: DiagnosticoCorrelable,
): MaintenanceOperation {
  if (!d.requestId || d.requestId !== op.requestId) return op;
  if (esTerminal(op.state)) return op;

  if (d.kind === 'command_rejected') {
    const reason = typeof d.detail?.reason === 'string' ? d.detail.reason : null;
    return {
      ...op,
      state: reason === 'duplicate' ? 'duplicate' : 'rejected',
      reason,
      detail: d.message ?? null,
    };
  }
  // Cualquier otro diagnóstico correlado es la confirmación de ejecución. Hoy
  // el módulo usa `self_test_result` con `detail.component`; el contrato v1 no
  // define un `led_test_result` y no se inventa aquí.
  return { ...op, state: 'executed', reason: null, detail: d.message ?? null };
}

/**
 * Declara que el módulo no ha contestado.
 *
 * Sólo se aplica a una operación PUBLICADA: si el backend no llegó a publicar,
 * el silencio del módulo no es un dato sobre el módulo.
 */
export function aplicarEspera(
  op: MaintenanceOperation,
  ahora: number,
  ventanaMs: number = ESPERA_RESPUESTA_MS,
): MaintenanceOperation {
  if (op.state !== 'published' || op.publishedAt === null) return op;
  if (ahora - op.publishedAt < ventanaMs) return op;
  return {
    ...op,
    state: 'timeout',
    reason: 'no_reply',
    detail: 'El módulo no ha confirmado la orden.',
  };
}

export function esTerminal(s: MaintenanceState): boolean {
  return s === 'executed' || s === 'rejected' || s === 'duplicate' || s === 'not_published';
}

/** true SÓLO si el módulo confirmó. Es lo único que autoriza a pintar efecto. */
export function seEjecuto(op: MaintenanceOperation): boolean {
  return op.state === 'executed';
}

/** Texto corto para el operador. Nunca afirma un efecto que no esté confirmado. */
export function describir(op: MaintenanceOperation): string {
  switch (op.state) {
    case 'requested':
      return 'Enviando la orden…';
    case 'published':
      return 'Orden publicada en el broker. Esperando confirmación del módulo…';
    case 'not_published':
      return op.reason === 'denied'
        ? 'El broker DENEGÓ la publicación: el módulo no la ha recibido.'
        : 'La orden NO se publicó: el módulo no la ha recibido.';
    case 'executed':
      return 'El módulo confirma que la ha ejecutado.';
    case 'rejected':
      return `El módulo la RECHAZÓ${op.reason ? ` (${op.reason})` : ''}.`;
    case 'duplicate':
      return 'Repetida: ya se había cursado esa misma orden. Sin efecto nuevo.';
    case 'timeout':
      return 'Sin respuesta del módulo. No se sabe si llegó a ejecutarse.';
  }
}
