/**
 * Atribución de un impacto a un participante.
 *
 * El impacto que llega por MQTT NO dice de quién es: el módulo detecta un
 * golpe en una diana, no quién disparó. Hasta ahora `HitEvent.participantId`
 * quedaba siempre a NULL y el marcador no podía dar aciertos por jugador.
 *
 * Sólo se atribuye cuando la respuesta es FORZOSA:
 *  - Un único participante en la ronda ⇒ el impacto es suyo.
 *  - Varios participantes, cada uno en su PANEL (duelo sobre una vista) ⇒ el
 *    impacto es de quien juega en el panel del módulo que lo detectó.
 * Si varios comparten panel a la vez, el sistema NO puede saber quién disparó:
 * se deja sin atribuir. Adivinar aquí sería falsear el resultado.
 */

export interface AttributionParticipant {
  id: string;
  /** Panel en el que juega ese participante (duelo/vista). */
  targetSystemId: string | null;
  slot: number;
}

export interface AttributionInput {
  /** Panel del módulo que detectó el impacto. */
  moduleTargetSystemId: string | null;
  participants: AttributionParticipant[];
}

export type AttributionBasis = 'sole_participant' | 'panel' | 'unknown';

export interface Attribution {
  participantId: string | null;
  basis: AttributionBasis;
  /** Por qué se ha atribuido (o por qué no). Se guarda para poder auditarlo. */
  reason: string;
}

export function attributeHit({
  moduleTargetSystemId,
  participants,
}: AttributionInput): Attribution {
  if (participants.length === 0) {
    return {
      participantId: null,
      basis: 'unknown',
      reason: 'La ronda no tiene participantes registrados.',
    };
  }

  if (participants.length === 1) {
    return {
      participantId: participants[0].id,
      basis: 'sole_participant',
      reason: 'Único participante de la ronda: la atribución es forzosa.',
    };
  }

  if (moduleTargetSystemId === null) {
    return {
      participantId: null,
      basis: 'unknown',
      reason: 'El módulo no está asignado a ningún panel: no se puede atribuir.',
    };
  }

  const onThisPanel = participants.filter((p) => p.targetSystemId === moduleTargetSystemId);
  if (onThisPanel.length === 1) {
    return {
      participantId: onThisPanel[0].id,
      basis: 'panel',
      reason: 'Único participante asignado al panel del módulo que detectó el impacto.',
    };
  }

  if (onThisPanel.length === 0) {
    return {
      participantId: null,
      basis: 'unknown',
      reason: 'Ningún participante está asignado al panel de ese módulo.',
    };
  }

  return {
    participantId: null,
    basis: 'unknown',
    reason: `${onThisPanel.length} participantes comparten ese panel: el sistema no puede saber quién disparó.`,
  };
}
