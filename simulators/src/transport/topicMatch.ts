/** Comprueba si un tópico concreto casa con un filtro de suscripción MQTT (+, #). */
export function topicMatches(filter: string, topic: string): boolean {
  const filterParts = filter.split('/');
  const topicParts = topic.split('/');

  for (let i = 0; i < filterParts.length; i++) {
    const f = filterParts[i];
    if (f === '#') {
      // '#' sólo es válido al final y casa con cero o más niveles restantes.
      return true;
    }
    if (i >= topicParts.length) {
      return false;
    }
    if (f === '+') {
      continue;
    }
    if (f !== topicParts[i]) {
      return false;
    }
  }
  return filterParts.length === topicParts.length;
}
