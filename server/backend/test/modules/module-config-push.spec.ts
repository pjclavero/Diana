import { ModuleConfigService } from '../../src/modules/modules/module-config.service';

/**
 * T2 · `config/push` sube la versión deseada EXACTAMENTE UNA VEZ por empujón.
 *
 * El doble de Prisma lleva un contador de verdad, no un `jest.fn()` que
 * devuelva siempre lo mismo: la propiedad que se quiere probar es que dos
 * empujones concurrentes se llevan números DISTINTOS, y con un doble que
 * devuelva un valor fijo eso pasaría siempre.
 */
function fakePrisma(inicial = 0) {
  const fila = {
    id: 'm1',
    slug: 'module-01',
    desiredConfigVersion: inicial,
    configState: 'pending' as string,
    friendlyName: null,
    position: null,
    targetSystem: null,
    targets: [] as unknown[],
  };
  const updates: any[] = [];
  return {
    fila,
    updates,
    module: {
      findUnique: jest.fn().mockImplementation(() => Promise.resolve({ ...fila })),
      update: jest.fn().mockImplementation(async (args: any) => {
        updates.push(args.data);
        if (args.data.desiredConfigVersion?.increment) {
          // Incremento ATÓMICO simulado: se lee y se escribe sin ceder el
          // control, igual que hace PostgreSQL sobre la fila.
          fila.desiredConfigVersion += args.data.desiredConfigVersion.increment;
        }
        if (typeof args.data.configState === 'string') fila.configState = args.data.configState;
        return { ...fila };
      }),
    },
  } as any;
}

function fakeMqtt(denied = false) {
  return {
    publishModuleConfig: jest.fn().mockImplementation(async () => {
      // Cede el control: es lo que hace que dos empujones se solapen de verdad
      // y no se ejecuten uno detrás de otro por accidente.
      await new Promise((r) => setImmediate(r));
      return { delivered: !denied, denied };
    }),
  } as any;
}

describe('T2 · ModuleConfigService.push', () => {
  it('un empujón sube la deseada de N a N+1, y sólo una vez', async () => {
    const prisma = fakePrisma(7);
    const svc = new ModuleConfigService(prisma, fakeMqtt());
    const r = await svc.push('m1');

    expect(r.published.config_version).toBe(8);
    expect(r.desiredConfigVersion).toBe(8);
    expect(prisma.fila.desiredConfigVersion).toBe(8);
    // Exactamente UN incremento en toda la operación.
    const incrementos = prisma.updates.filter((d: any) => d.desiredConfigVersion?.increment);
    expect(incrementos).toHaveLength(1);
  });

  it('lo publicado lleva el MISMO número que quedó en la base', async () => {
    const prisma = fakePrisma(0);
    const svc = new ModuleConfigService(prisma, fakeMqtt());
    const r = await svc.push('m1');
    expect(r.published.config_version).toBe(prisma.fila.desiredConfigVersion);
  });

  it('DOS empujones concurrentes NO publican el mismo número', async () => {
    // Este es el fallo que había: se leía `configVersion + 1` antes de
    // publicar, así que dos llamadas simultáneas leían el mismo N y emitían
    // dos configuraciones DISTINTAS numeradas N+1.
    const prisma = fakePrisma(0);
    const mqtt = fakeMqtt();
    const svc = new ModuleConfigService(prisma, mqtt);

    const [a, b] = await Promise.all([svc.push('m1'), svc.push('m1')]);
    const numeros = [a.published.config_version, b.published.config_version].sort();
    expect(numeros).toEqual([1, 2]);
    expect(new Set(numeros).size).toBe(2);
    expect(prisma.fila.desiredConfigVersion).toBe(2);
  });

  it('`build` NO consume número: es una vista previa', async () => {
    const prisma = fakePrisma(4);
    const svc = new ModuleConfigService(prisma, fakeMqtt());
    const preview = await svc.build('m1');
    expect(preview.config_version).toBe(5);
    expect(prisma.fila.desiredConfigVersion).toBe(4); // intacta
    expect(prisma.module.update).not.toHaveBeenCalled();
  });

  it('empujar deja el módulo en `pending`, NUNCA en `applied`', async () => {
    // Publicar no es aplicar. El estado sólo llega a `applied` con un
    // config/reported real del dispositivo.
    const prisma = fakePrisma(0);
    const r = await new ModuleConfigService(prisma, fakeMqtt()).push('m1');
    expect(r.configState).toBe('pending');
    expect(prisma.fila.configState).toBe('pending');
    expect(prisma.updates.some((d: any) => d.configState === 'applied')).toBe(false);
  });

  it('una denegación de ACL deja `failed` y NO devuelve el número', async () => {
    const prisma = fakePrisma(3);
    const r = await new ModuleConfigService(prisma, fakeMqtt(true)).push('m1');
    expect(r.denied).toBe(true);
    expect(r.configState).toBe('failed');
    expect(prisma.fila.configState).toBe('failed');
    // La deseada NO retrocede: un hueco en la secuencia es preferible a dos
    // payloads distintos con el mismo número.
    expect(prisma.fila.desiredConfigVersion).toBe(4);
  });

  it('un módulo inexistente no quema número', async () => {
    const prisma = fakePrisma(5);
    prisma.module.findUnique = jest.fn().mockResolvedValue(null);
    await expect(new ModuleConfigService(prisma, fakeMqtt()).push('nadie')).rejects.toThrow();
    expect(prisma.module.update).not.toHaveBeenCalled();
    expect(prisma.fila.desiredConfigVersion).toBe(5);
  });

  it('una red estática sin IP se rechaza ANTES de reservar', async () => {
    const prisma = fakePrisma(5);
    await expect(
      new ModuleConfigService(prisma, fakeMqtt()).push('m1', { mode: 'static' }),
    ).rejects.toThrow(/IP/i);
    expect(prisma.fila.desiredConfigVersion).toBe(5);
  });
});
