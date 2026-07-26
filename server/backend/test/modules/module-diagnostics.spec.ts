import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ModuleDiagnosticsService } from '../../src/modules/modules/module-diagnostics.service';

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
    await expect(service.testLed('mod-a', 3, 'blink', OTHER)).rejects.toBeInstanceOf(
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
  it('la prueba de LED va con la diana y el patrón', async () => {
    const { service, sendModuleCommand } = build();
    await service.testLed('mod-a', 3, 'chase', ADMIN);
    expect(sendModuleCommand).toHaveBeenCalledWith('mod-a', 'led_test', {
      target_index: 3,
      pattern: 'chase',
    });
  });

  it('un patrón inventado se rechaza en vez de mandarlo al firmware', async () => {
    const { service, sendModuleCommand } = build();
    await expect(service.testLed('mod-a', 3, 'discoteca', ADMIN)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(sendModuleCommand).not.toHaveBeenCalled();
  });

  it('una diana fuera de rango se rechaza', async () => {
    const { service } = build();
    await expect(service.testLed('mod-a', 10, 'solid', ADMIN)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('una diana que el módulo no tiene da 404', async () => {
    const { service } = build({ target: { findFirst: jest.fn().mockResolvedValue(null) } });
    await expect(service.testLed('mod-a', 5, 'solid', ADMIN)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('la calibración se pide por diana', async () => {
    const { service, sendModuleCommand } = build();
    await service.calibrate('mod-a', 3, ADMIN);
    expect(sendModuleCommand).toHaveBeenCalledWith('mod-a', 'start_calibration', {
      target_index: 3,
    });
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
    const res = await service.testLed('mod-a', 3, 'solid', ADMIN);
    expect(res.delivered).toBe(false);
    expect(res.note).toMatch(/NO llegó al broker/);
  });

  it('los resultados reales se leen de las incidencias del módulo', async () => {
    const { service, prisma } = build();
    await service.results('mod-a', ADMIN, 5);
    expect(prisma.incident.findMany.mock.calls[0][0]).toMatchObject({
      where: { moduleId: 'm1', source: 'diagnostic' },
      take: 5,
    });
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
