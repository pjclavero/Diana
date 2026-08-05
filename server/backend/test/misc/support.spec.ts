import { CommandBuilder, NonceSource } from '../../src/contracts/command-builder';
import { ContractValidator } from '../../src/contracts/contract-validator';
import { parseTopic, topics, BACKEND_SUBSCRIPTIONS } from '../../src/contracts/topics';
import { toCsv, escapeCell } from '../../src/domain/exports/csv';
import { computeRoundStatistics } from '../../src/domain/statistics/round-statistics';
import { redact } from '../../src/modules/audit/audit.service';

describe('Tópicos MQTT (contrato §1-§2)', () => {
  it('reconoce todos los tópicos del contrato', () => {
    expect(parseTopic('targets/v1/module/module-03/hit')?.kind).toBe('module-hit');
    expect(parseTopic('targets/v1/module/module-03/config/desired')?.kind).toBe(
      'module-config-desired',
    );
    expect(parseTopic('targets/v1/system/system-a/game/state')?.kind).toBe('game-state');
  });

  it('rechaza identificadores ilegales y tópicos ajenos', () => {
    expect(parseTopic('targets/v1/module/MODULE-03/hit')).toBeNull();
    expect(parseTopic('targets/v1/module/m/hit')).toBeNull();
    expect(parseTopic('targets/v2/module/module-03/hit')).toBeNull();
    expect(parseTopic('otro/tema')).toBeNull();
  });

  it('los eventos nunca son retenidos y la telemetría va a QoS 0', () => {
    expect(parseTopic('targets/v1/module/module-03/hit')?.retain).toBe(false);
    expect(parseTopic('targets/v1/system/system-a/game/event')?.retain).toBe(false);
    expect(parseTopic('targets/v1/module/module-03/presence')?.retain).toBe(true);
    expect(parseTopic('targets/v1/module/module-03/telemetry')?.qos).toBe(0);
  });

  it('las suscripciones del backend son todas tópicos válidos', () => {
    for (const subscription of BACKEND_SUBSCRIPTIONS) {
      const concrete = subscription.filter.replace('+', 'module-01');
      expect(parseTopic(concrete)).not.toBeNull();
    }
  });

  it('los constructores de tópico producen rutas válidas', () => {
    expect(topics.moduleHit('module-03')).toBe('targets/v1/module/module-03/hit');
    expect(topics.gameEvent('system-a')).toBe('targets/v1/system/system-a/game/event');
  });
});

describe('Comandos (contrato §6, dosier 23.3)', () => {
  const validator = new ContractValidator();

  it('el nonce es estrictamente creciente, incluso con el mismo reloj', () => {
    const source = new NonceSource(1000);
    const values = [source.next(1000), source.next(1000), source.next(1000), source.next(2000)];
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]).toBeGreaterThan(values[i - 1]);
    }
  });

  it('el nonce nunca retrocede tras un reinicio (siembra con el reloj)', () => {
    const before = new NonceSource(1_700_000_000_000).next(1_700_000_000_000);
    const afterRestart = new NonceSource(1_700_000_001_000).next(1_700_000_001_000);
    expect(afterRestart).toBeGreaterThan(before);
  });

  it('un comando de módulo cumple su esquema (emitido por el coordinador, no por el backend)', () => {
    // Ampliación v1.1: `module/{id}/command` es el canal de JUEGO, exclusivo
    // del coordinador (README §2.1) y el enum `issuer` de este esquema ya NO
    // admite `"backend"` — se retiró explícitamente. Ya NO existe ningún
    // camino de publicación del backend hacia ese canal: se retiraron
    // `MqttService.sendModuleCommand` y `POST /mqtt/modules/:id/command`.
    // `CommandBuilder.moduleCommand` sobrevive sólo como constructor de
    // sobres para validar conformidad (construir no es publicar) y por eso
    // exige `issuer` EXPLÍCITO: heredar el `defaultIssuer` de la clase
    // (`'backend'`, que sigue siendo válido para
    // `system-command`/`ota-command.schema.json`, ver más abajo) fabricaba en
    // silencio un mensaje inválido para ESTE esquema.
    const command = new CommandBuilder().moduleCommand(
      'module-03',
      'identify',
      { duration_ms: 4000 },
      { issuer: 'operator-cli' },
    );
    const outcome = validator.validate('module-command.schema.json', command);
    expect(outcome.ok).toBe(true);
  });

  /**
   * Esta es la prueba que el operador pidió que quedara en verde por
   * MIGRACIÓN, no por relajar nada: fija, de forma explícita y positiva, que
   * el backend NUNCA puede declararse `issuer: 'backend'` en un comando de
   * `module-command.schema.json` — es la mitad "documento" de la misma
   * decisión cuya mitad "código" fijan `no-backend-writes-game-command.spec.ts`
   * y `maintenance-command-topic.spec.ts`.
   */
  it('`issuer: "backend"` está PROHIBIDO en module-command.schema.json (ampliación v1.1)', () => {
    const command = new CommandBuilder().moduleCommand(
      'module-03',
      'identify',
      { duration_ms: 4000 },
      { issuer: 'backend' },
    );
    const outcome = validator.validate('module-command.schema.json', command);
    expect(outcome.ok).toBe(false);
  });

  it('el `defaultIssuer` de CommandBuilder SIGUE siendo backend, y sigue siendo válido para system-command', () => {
    // Control negativo del cambio anterior: si alguien "arreglara" esto
    // cambiando el `defaultIssuer` de la clase entera a otra cosa, esta
    // prueba lo detectaría — `system-command`/`ota-command.schema.json` SÍ
    // admiten `backend` (sólo `module-command` lo prohíbe).
    const command = new CommandBuilder().systemCommand('system-a', 'all_safe');
    expect(command.issuer).toBe('backend');
    expect(validator.validate('system-command.schema.json', command).ok).toBe(true);
  });

  it('todo comando lleva caducidad dentro del rango del contrato', () => {
    const command = new CommandBuilder().moduleCommand('module-03', 'reboot', undefined, {
      issuer: 'coordinator',
    });
    expect(command.expires_in_ms).toBe(5000);
    expect(() =>
      new CommandBuilder().moduleCommand('module-03', 'reboot', {}, {
        issuer: 'coordinator',
        expiresInMs: 50,
      }),
    ).toThrow();
    expect(() =>
      new CommandBuilder().moduleCommand('module-03', 'reboot', {}, {
        issuer: 'coordinator',
        expiresInMs: 999999,
      }),
    ).toThrow();
  });

  it('un comando de sistema start_game cumple su esquema', () => {
    const command = new CommandBuilder().systemCommand(
      'system-a',
      'start_game',
      {
        game: {
          game_id: '7a2d3d5f-7c2b-4a3f-8c4e-2b3c4d5e6f70',
          round_id: '8b3e4e60-8d3c-4b4a-9d5f-3c4d5e6f7081',
          mode: 'random',
          targets: [{ module_id: 'module-01', target_index: 1 }],
          seed: 20260720,
        },
      },
      { expiresInMs: 10000 },
    );
    const outcome = validator.validate('system-command.schema.json', command);
    if (!outcome.ok) throw new Error(outcome.errors.join('; '));
    expect(outcome.ok).toBe(true);
  });

  it('una orden OTA sin firma no se construye (dosier 23.3)', () => {
    const builder = new CommandBuilder();
    expect(() =>
      builder.otaCommand('module-03', 'update', {
        version: '0.2.0',
        url: 'http://192.168.1.209/fw.bin',
        size_bytes: 1024,
        sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        target_board: 'esp32s3-w5500-protoA',
      }),
    ).toThrow(/firma/i);
  });

  it('una orden OTA firmada cumple su esquema', () => {
    const command = new CommandBuilder().otaCommand('module-03', 'update', {
      version: '0.2.0',
      url: 'http://192.168.1.209/firmware/diana-0.2.0.bin',
      size_bytes: 1048576,
      sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      signature: 'MEUCIQDexampleSignatureBase64==',
      target_board: 'esp32s3-w5500-protoA',
    });
    const outcome = validator.validate('ota-command.schema.json', command);
    if (!outcome.ok) throw new Error(outcome.errors.join('; '));
    expect(outcome.ok).toBe(true);
  });
});

describe('Exportación CSV', () => {
  it('escapa comillas, comas y saltos de línea', () => {
    expect(escapeCell('a,b')).toBe('"a,b"');
    expect(escapeCell('di"jo')).toBe('"di""jo"');
    expect(escapeCell('línea\nsiguiente')).toBe('"línea\nsiguiente"');
  });

  it('null se escribe como celda VACÍA, nunca como 0 (ADR-0006)', () => {
    const csv = toCsv(['accuracy_total', 'valid_hits'], [{ accuracy_total: null, valid_hits: 0 }]);
    expect(csv).toContain('\r\n,0\r\n');
    expect(csv).not.toContain('0,0');
  });

  it('los BigInt (microsegundos) no se truncan', () => {
    const csv = toCsv(['device_event_us'], [{ device_event_us: 9007199254740993n }]);
    expect(csv).toContain('9007199254740993');
  });
});

describe('Estadísticas de ronda (dosier 17.4)', () => {
  it('calcula parciales, mejor, peor y variabilidad a partir de T2', () => {
    const stats = computeRoundStatistics([
      { elapsedUs: 1_000_000, classification: 'valid_hit', moduleSlug: 'm1', targetIndex: 1 },
      { elapsedUs: 2_000_000, classification: 'valid_hit', moduleSlug: 'm1', targetIndex: 2 },
      { elapsedUs: 2_500_000, classification: 'valid_hit', moduleSlug: 'm1', targetIndex: 3 },
      { elapsedUs: 2_600_000, classification: 'hit_on_safe', moduleSlug: 'm1', targetIndex: 4 },
      { elapsedUs: null, classification: 'crosstalk_rejected', moduleSlug: 'm1', targetIndex: 5 },
    ]);
    expect(stats.validHits).toBe(3);
    expect(stats.invalidHits).toBe(1);
    expect(stats.detectedHits).toBe(4);
    expect(stats.firstHitUs).toBe(1_000_000);
    expect(stats.totalTimeUs).toBe(2_500_000);
    expect(stats.bestIntervalUs).toBe(500_000);
    expect(stats.worstIntervalUs).toBe(1_000_000);
    expect(stats.meanIntervalUs).toBe(750_000);
  });

  it('un impacto válido sin T2 se excluye de los tiempos y se contabiliza aparte', () => {
    const stats = computeRoundStatistics([
      { elapsedUs: null, classification: 'valid_hit', moduleSlug: 'm1', targetIndex: 1 },
      { elapsedUs: 3_000_000, classification: 'valid_hit', moduleSlug: 'm1', targetIndex: 2 },
    ]);
    expect(stats.validHits).toBe(2);
    expect(stats.withoutCoordinatorTime).toBe(1);
    expect(stats.firstHitUs).toBe(3_000_000);
    expect(stats.meanIntervalUs).toBeNull();
  });

  it('sin impactos, todas las métricas temporales son null', () => {
    const stats = computeRoundStatistics([]);
    expect(stats.firstHitUs).toBeNull();
    expect(stats.totalTimeUs).toBeNull();
    expect(stats.intervalStdDevUs).toBeNull();
  });
});

describe('Auditoría', () => {
  it('redacta credenciales a cualquier profundidad', () => {
    const redacted = redact({
      username: 'admin',
      password: 'secreto',
      nested: { passwordHash: 'abc', token: 'xyz', ok: 1 },
      list: [{ secret: 's' }],
    }) as Record<string, unknown>;

    expect(redacted.username).toBe('admin');
    expect(redacted.password).toBe('«redactado»');
    expect((redacted.nested as Record<string, unknown>).passwordHash).toBe('«redactado»');
    expect((redacted.nested as Record<string, unknown>).token).toBe('«redactado»');
    expect((redacted.nested as Record<string, unknown>).ok).toBe(1);
    expect((redacted.list as Array<Record<string, unknown>>)[0].secret).toBe('«redactado»');
  });

  it('convierte BigInt a cadena para poder serializarlo', () => {
    const redacted = redact({ deviceEventUs: 1832456712n }) as Record<string, unknown>;
    expect(redacted.deviceEventUs).toBe('1832456712');
  });
});
