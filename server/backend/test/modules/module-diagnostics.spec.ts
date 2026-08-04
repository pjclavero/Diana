import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ModuleDiagnosticsService } from '../../src/modules/modules/module-diagnostics.service';
import { CommandBuilder } from '../../src/contracts/command-builder';
import { ContractValidator } from '../../src/contracts/contract-validator';
import { TARGET_STATES } from '../../src/modules/modules/module-diagnostics.service';

const MODULE = { id: 'm1', slug: 'mod-a', ownerId: 'u-gestor' };
const ADMIN = { userId: 'u-admin', role: 'administrador' };
const OWNER = { userId: 'u-gestor', role: 'gestor' };
const OTHER = { userId: 'u-otro', role: 'gestor' };

function build(over: any = {}) {
  const prisma = {
    module: {
      findUnique: jest.fn().mockResolvedValue(MODULE),
      ...over.module,
    },
    target: {
      findFirst: jest.fn().mockResolvedValue({ id: 't1', targetIndex: 3, enabled: true }),
      ...over.target,
    },
    incident: { findMany: jest.fn().mockResolvedValue([]), ...over.incident },
  } as any;
  const sendModuleCommand = jest.fn(() => ({ command_id: 'c1', delivered: true }));
  const mqtt = { sendModuleCommand, ...over.mqtt } as any;
  return { service: new ModuleDiagnosticsService(prisma, mqtt), prisma, sendModuleCommand };
}

describe('Diagnóstico de módulo (F6) · quién puede', () => {
  it('el dueño puede diagnosticar lo suyo', async () => {
    const { service, sendModuleCommand } = build();
    await service.identify('mod-a', 4000, OWNER);
    expect(sendModuleCommand).toHaveBeenCalled();
  });

  it('el admin puede con cualquier módulo', async () => {
    const { service, sendModuleCommand } = build();
    await service.identify('mod-a', 4000, ADMIN);
    expect(sendModuleCommand).toHaveBeenCalled();
  });

  it('un gestor ajeno NO enciende los LED de un módulo que no es suyo', async () => {
    const { service, sendModuleCommand } = build();
    // 404 y no 403: a quien no le corresponde, el módulo ni siquiera existe.
    await expect(service.testLed('mod-a', 3, 'active', OTHER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(sendModuleCommand).not.toHaveBeenCalled();
  });

  it('un módulo sin dueño lo puede diagnosticar cualquier gestor', async () => {
    const { service, sendModuleCommand } = build({
      module: { findUnique: jest.fn().mockResolvedValue({ ...MODULE, ownerId: null }) },
    });
    await service.identify('mod-a', 4000, OTHER);
    expect(sendModuleCommand).toHaveBeenCalled();
  });

  it('un módulo inexistente da 404', async () => {
    const { service } = build({ module: { findUnique: jest.fn().mockResolvedValue(null) } });
    await expect(service.identify('mod-x', 4000, ADMIN)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('acepta tanto el identificador como el slug', async () => {
    const { service, prisma } = build();
    await service.identify('11111111-2222-3333-4444-555555555555', 4000, ADMIN);
    expect(prisma.module.findUnique.mock.calls[0][0].where).toHaveProperty('id');
    await service.identify('mod-a', 4000, ADMIN);
    expect(prisma.module.findUnique.mock.calls[1][0].where).toHaveProperty('slug');
  });
});

describe('Diagnóstico · lo que se ordena de verdad', () => {
  it('la prueba de LED va como la define el contrato: targets[{index, state}]', async () => {
    const { service, sendModuleCommand } = build();
    await service.testLed('mod-a', 3, 'active', ADMIN);
    expect(sendModuleCommand).toHaveBeenCalledWith('mod-a', 'led_test', {
      targets: [{ target_index: 3, state: 'active' }],
    });
  });

  it('un estado inventado se rechaza en vez de mandarlo al firmware', async () => {
    const { service, sendModuleCommand } = build();
    await expect(service.testLed('mod-a', 3, 'discoteca', ADMIN)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(sendModuleCommand).not.toHaveBeenCalled();
  });

  it('una diana fuera de rango se rechaza', async () => {
    const { service } = build();
    await expect(service.testLed('mod-a', 10, 'active', ADMIN)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('una diana que el módulo no tiene da 404', async () => {
    const { service } = build({ target: { findFirst: jest.fn().mockResolvedValue(null) } });
    await expect(service.testLed('mod-a', 5, 'active', ADMIN)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('la calibración se pide SIN parámetros y se declara que es del módulo', async () => {
    // El contrato v1 no admite parámetros aquí: mandarlos hacía que el
    // validador de salida tumbara la publicación y la calibración no salía.
    const { service, sendModuleCommand } = build();
    const res = await service.calibrate('mod-a', 3, ADMIN);
    expect(sendModuleCommand).toHaveBeenCalledWith('mod-a', 'start_calibration', undefined);
    expect(res.scope).toBe('module');
    expect(res.note).toMatch(/calibra el MÓDULO completo/);
  });

  it('una diana deshabilitada no se calibra', async () => {
    const { service } = build({
      target: { findFirst: jest.fn().mockResolvedValue({ id: 't', targetIndex: 3, enabled: false }) },
    });
    await expect(service.calibrate('mod-a', 3, ADMIN)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('la prueba de sensor DICE que pide el autodiagnóstico del módulo entero', async () => {
    // El contrato v1 no tiene prueba de sensor por diana. Inventar una acción
    // que el firmware no entiende sería peor que decirlo.
    const { service, sendModuleCommand } = build();
    const res = await service.testSensor('mod-a', 3, ADMIN);
    expect(sendModuleCommand).toHaveBeenCalledWith('mod-a', 'self_test', undefined);
    expect(res.scope).toBe('module');
    expect(res.note).toMatch(/no tiene una prueba de sensor por diana/);
  });
});

describe('Diagnóstico · ordenar no es saber el resultado', () => {
  it('la respuesta dice que el resultado llega por otro sitio', async () => {
    const { service } = build();
    const res = await service.identify('mod-a', 4000, ADMIN);
    expect(res.delivered).toBe(true);
    expect(res.note).toMatch(/El resultado lo publica el módulo/);
    // Y NO se devuelve ninguna medida: nadie la ha tomado.
    expect(res).not.toHaveProperty('amplitude');
    expect(res).not.toHaveProperty('ok');
  });

  it('si el broker no acepta la orden se dice, no se da por hecha', async () => {
    const { service } = build({
      mqtt: { sendModuleCommand: jest.fn(() => ({ command_id: 'c1', delivered: false })) },
    });
    const res = await service.testLed('mod-a', 3, 'active', ADMIN);
    expect(res.delivered).toBe(false);
    expect(res.note).toMatch(/NO llegó al broker/);
  });

  it('los resultados reales se leen de las incidencias del módulo', async () => {
    const { service, prisma } = build();
    await service.results('mod-a', ADMIN, 5);
    expect(prisma.incident.findMany.mock.calls[0][0]).toMatchObject({
      where: {
        source: 'diagnostic',
        OR: [{ moduleId: 'm1' }, { moduleSlug: 'mod-a' }],
      },
      take: 5,
    });
  });

  it('expone la hora del módulo y distingue la recepción cuando no había reloj', async () => {
    const receivedAt = new Date('2026-08-04T10:00:03Z');
    const deviceOccurredAt = new Date('2026-08-04T10:00:00Z');
    const { service } = build({
      incident: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'i-con-reloj',
            kind: 'calibration_result',
            severity: 'info',
            message: 'Calibrado',
            occurredAt: receivedAt,
            deviceOccurredAt,
            deviceEventUs: 4_000_000n,
            deviceEpochMs: BigInt(deviceOccurredAt.getTime()),
          },
          {
            id: 'i-sin-reloj',
            kind: 'self_test_result',
            severity: 'info',
            message: 'Correcto',
            occurredAt: receivedAt,
            deviceOccurredAt: null,
            deviceEventUs: 5_000_000n,
            deviceEpochMs: null,
          },
        ]),
      },
    });

    const result = await service.results('mod-a', ADMIN);
    expect(result.items[0]).toMatchObject({
      occurredAt: deviceOccurredAt,
      receivedAt,
      timeBasis: 'module_epoch',
      deviceEventUs: '4000000',
    });
    expect(result.items[1]).toMatchObject({
      occurredAt: null,
      receivedAt,
      timeBasis: 'ingest_received',
      deviceEventUs: '5000000',
    });
  });

  it('el admin consulta por slug diagnósticos recibidos antes del alta del módulo', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'i-huerfana',
        kind: 'self_test_result',
        severity: 'warning',
        message: 'Publicado antes del alta',
        occurredAt: new Date('2026-08-04T10:00:03Z'),
        deviceOccurredAt: null,
        deviceEventUs: 1_000n,
        deviceEpochMs: null,
      },
    ]);
    const { service } = build({
      module: { findUnique: jest.fn().mockResolvedValue(null) },
      incident: { findMany },
    });

    const result = await service.results('module-sin-alta', ADMIN);

    expect(findMany.mock.calls[0][0].where).toEqual({
      source: 'diagnostic',
      moduleSlug: 'module-sin-alta',
    });
    expect(result.moduleRegistered).toBe(false);
    expect(result.items).toHaveLength(1);
    expect(result.note).toMatch(/no está registrado.*diagnósticos conservados/i);
  });

  it('sin respuestas del módulo se dice que no hay, no se finge silencio normal', async () => {
    const { service } = build();
    expect((await service.results('mod-a', ADMIN)).note).toMatch(/no ha respondido/);
  });

  it('el número de resultados se acota', async () => {
    const { service, prisma } = build();
    await service.results('mod-a', ADMIN, 5000);
    expect(prisma.incident.findMany.mock.calls[0][0].take).toBe(100);
  });
});

describe('Los comandos emitidos CUMPLEN el contrato congelado', () => {
  // Esto es lo que nadie comprobaba: `led_test` y `start_calibration` se
  // emitían con parámetros que el esquema no admite (`additionalProperties:
  // false`), así que la publicación reventaba en el validador de salida y la
  // prueba de LED no llegaba jamás al módulo.
  const validator = new ContractValidator();
  const builder = new CommandBuilder();

  const valida = (action: string, params?: Record<string, unknown>) => {
    const command = builder.moduleCommand('mod-a', action, params);
    return validator.validate('module-command.schema.json', command as never);
  };

  it('identify', () => expect(valida('identify', { duration_ms: 4000 }).ok).toBe(true));
  it('self_test', () => expect(valida('self_test').ok).toBe(true));
  it('abort_calibration', () => expect(valida('abort_calibration').ok).toBe(true));
  it('start_calibration', () => expect(valida('start_calibration').ok).toBe(true));

  it('led_test con la forma del contrato', () => {
    const r = valida('led_test', { targets: [{ target_index: 3, state: 'active' }] });
    expect(r.ok).toBe(true);
  });

  it('led_test con la forma INVENTADA que había antes NO valida', () => {
    const r = valida('led_test', { target_index: 3, pattern: 'blink' });
    expect(r.ok).toBe(false);
  });

  it('start_calibration con parámetros NO valida', () => {
    expect(valida('start_calibration', { target_index: 3 }).ok).toBe(false);
  });

  it('todos los estados admitidos por el servicio son válidos en el contrato', () => {
    for (const state of TARGET_STATES) {
      const r = valida('led_test', { targets: [{ target_index: 1, state }] });
      expect([state, r.ok]).toEqual([state, true]);
    }
  });
});
