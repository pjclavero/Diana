/**
 * Ampliación v1.2 del contrato MQTT: plano DEVICE_MANAGEMENT (ADR-0008).
 *
 * Estas pruebas existen por dos motivos, y el segundo es el importante:
 *
 *  1. Fijar los dos tópicos nuevos y su retención.
 *  2. Demostrar que la ampliación es ADITIVA. «v1.2» sólo es legítimo si ningún
 *     tópico preexistente cambia de tipo, retención o QoS. Si alguno cambiara,
 *     esto ya no sería una ampliación compatible: sería `v2`, y exigiría otro
 *     ADR. Sin el bloque final, «aditivo» sería una afirmación sin prueba.
 */
import { parseTopic, topics, BACKEND_SUBSCRIPTIONS } from '../../src/contracts/topics';

describe('contrato v1.2 · plano DEVICE_MANAGEMENT', () => {
  it('reconoce el tópico de COMANDO y lo declara NO retenido', () => {
    const p = parseTopic('targets/v1/module/module-07/provision');
    expect(p?.kind).toBe('module-provision-command');
    expect(p?.schema).toBe('module-provision-command.schema.json');
    expect(p?.qos).toBe(1);
    // Invariante de SEGURIDAD, no preferencia: un comando ejecutable retenido
    // es un replay que el broker sirve a cualquiera que se suscriba, incluido
    // un módulo que arranque meses después.
    expect(p?.retain).toBe(false);
  });

  it('reconoce el tópico de ESTADO y lo declara retenido', () => {
    const p = parseTopic('targets/v1/module/module-07/provision/state');
    expect(p?.kind).toBe('module-provision-state');
    expect(p?.schema).toBe('module-provision-state.schema.json');
    expect(p?.id).toBe('module-07');
    // Se retiene porque es la última fotografía observacional. Retenerlo NO lo
    // convierte en autoridad: es reported state y sólo eso.
    expect(p?.retain).toBe(true);
  });

  it('construye los dos tópicos', () => {
    expect(topics.moduleProvisionCommand('module-07')).toBe('targets/v1/module/module-07/provision');
    expect(topics.moduleProvisionState('module-07')).toBe('targets/v1/module/module-07/provision/state');
  });

  it('no admite sufijos parecidos, otra versión ni identificadores inválidos', () => {
    expect(parseTopic('targets/v1/module/module-07/provisionx')).toBeNull();
    expect(parseTopic('targets/v2/module/module-07/provision')).toBeNull();
    expect(parseTopic('targets/v1/module/MODULE-07/provision')).toBeNull();
  });

  it('el backend OBSERVA el estado y no se suscribe al comando que él mismo emite', () => {
    const filtros = BACKEND_SUBSCRIPTIONS.map((s) => s.filter);
    expect(filtros).toContain('targets/v1/module/+/provision/state');
    // Suscribirse a lo que uno publica no aporta nada y ensancha la superficie.
    expect(filtros).not.toContain('targets/v1/module/+/provision');
  });

  describe('la ampliación es ADITIVA: ningún tópico preexistente cambia', () => {
    const previos: Array<[string, string, boolean, number]> = [
      ['targets/v1/module/m-1/command', 'module-command', false, 1],
      ['targets/v1/module/m-1/maintenance/command', 'module-maintenance-command', false, 1],
      ['targets/v1/module/m-1/config/desired', 'module-config-desired', true, 1],
      ['targets/v1/module/m-1/config/reported', 'module-config-reported', true, 1],
      ['targets/v1/module/m-1/telemetry', 'module-telemetry', false, 0],
      ['targets/v1/module/m-1/status', 'module-status', true, 1],
      ['targets/v1/module/m-1/ota', 'module-ota', false, 1],
      ['targets/v1/system/s-1/game/state', 'game-state', true, 1],
      ['targets/v1/system/s-1/command', 'system-command', false, 1],
    ];
    it.each(previos)('%s sigue siendo %s (retain=%s, qos=%s)', (topic, kind, retain, qos) => {
      const p = parseTopic(topic);
      expect(p?.kind).toBe(kind);
      expect(p?.retain).toBe(retain);
      expect(p?.qos).toBe(qos);
    });
  });
});
