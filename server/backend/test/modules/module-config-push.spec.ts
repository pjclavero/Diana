import {
  DIANAS_POR_MODULO,
  ModuleConfigService,
} from '../../src/modules/modules/module-config.service';
import { getContractValidator } from '../../src/contracts/contract-validator';
import { TOPIC_SCHEMA } from '../../src/contracts/topics';

/** El mismo nombre que usa `MqttService.publish`, leído del mapa real: si
 *  alguien renombra el esquema, esta prueba se entera. */
const ESQUEMA_CONFIG = TOPIC_SCHEMA['module-config-desired'];

/**
 * T2 · `config/push` sube la versión deseada EXACTAMENTE UNA VEZ por empujón.
 *
 * El doble de Prisma lleva un contador de verdad, no un `jest.fn()` que
 * devuelva siempre lo mismo: la propiedad que se quiere probar es que dos
 * empujones concurrentes se llevan números DISTINTOS, y con un doble que
 * devuelva un valor fijo eso pasaría siempre.
 */
/**
 * Nueve dianas calibradas, que es lo que el contrato exige.
 *
 * Antes este doble devolvía `targets: []` —un módulo VIRGEN— y las pruebas
 * pasaban igual, porque el doble de MQTT no miraba el mensaje. En el
 * despliegue real ese mismo caso reventaba: el esquema declara `calibration`
 * con `minItems: 9`, `MqttService.publish` lanzaba un `Error` genérico y el
 * operador recibía un 500. El doble no mentía sobre la versión; era ciego al
 * contrato, que es la parte que fallaba.
 */
function dianasCalibradas(n = DIANAS_POR_MODULO) {
  return Array.from({ length: n }, (_, i) => ({
    targetIndex: i + 1,
    calibrations: [
      {
        threshold: 1000,
        hysteresis: 100,
        noiseFloor: 50,
        blankingUs: 2000,
        groupWindowUs: 1500,
        neighbourRatio: 0.5,
        enabled: true,
        calibratedAt: new Date('2026-09-11T00:00:00.000Z'),
      },
    ],
  }));
}

function fakePrisma(inicial = 0, dianas = DIANAS_POR_MODULO) {
  const fila = {
    id: 'm1',
    slug: 'module-01',
    desiredConfigVersion: inicial,
    configState: 'pending' as string,
    friendlyName: null,
    position: null,
    targetSystem: null,
    targets: dianasCalibradas(dianas) as unknown[],
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
    // El servicio cuenta las dianas CALIBRADAS antes de reservar. El doble
    // cuenta las que realmente tiene la fila, no un número inventado: si
    // alguien deja `dianas` en 0, esto devuelve 0 de verdad.
    target: {
      count: jest.fn().mockImplementation(async () =>
        (fila.targets as any[]).filter((t) => t.calibrations.length > 0).length,
      ),
    },
  } as any;
}

/**
 * Doble de MQTT que VALIDA contra el esquema congelado de verdad.
 *
 * Es la diferencia entre un doble y un decorado. `publishModuleConfig` del
 * servicio real valida antes de enviar; si el doble no lo hace, cualquier
 * payload mal formado pasa la suite y sólo aparece contra el broker.
 */
function fakeMqtt(denied = false) {
  const validator = getContractValidator();
  const publicados: Record<string, unknown>[] = [];
  const mqtt = {
    publicados,
    publishModuleConfig: jest.fn().mockImplementation(async (_id: string, payload: any) => {
      const resultado = validator.validate(ESQUEMA_CONFIG, payload);
      if (!resultado.ok) {
        // El `message` va SIEMPRE, no sólo los `errors`: un `unknown_schema`
        // trae la lista vacía, y sin el mensaje el fallo no dice en qué capa
        // ocurrió — parece un payload malo cuando es el validador desconectado.
        throw new Error(
          `payload invalido contra ${ESQUEMA_CONFIG} [${resultado.code}]: ` +
            `${resultado.message} ${resultado.errors.join('; ')}`,
        );
      }
      publicados.push(payload);
      // Cede el control: es lo que hace que dos empujones se solapen de verdad
      // y no se ejecuten uno detrás de otro por accidente.
      await new Promise((r) => setImmediate(r));
      return { delivered: !denied, denied };
    }),
  };
  return mqtt as any;
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

  // ── Módulo VIRGEN: 400, no 500 ────────────────────────────────────────────
  describe('módulo sin las nueve dianas calibradas', () => {
    it('un módulo recién dado de alta se rechaza con 400, no con 500', async () => {
      const prisma = fakePrisma(0, 0);
      const svc = new ModuleConfigService(prisma, fakeMqtt());

      // `BadRequestException` y no un `Error` genérico: lo que distingue «has
      // pedido algo imposible» de «el servidor se ha roto».
      await expect(svc.push('m1')).rejects.toMatchObject({ status: 400 });
    });

    it('el mensaje dice cuántas faltan, para que el operador sepa qué hacer', async () => {
      const prisma = fakePrisma(0, 4);
      const svc = new ModuleConfigService(prisma, fakeMqtt());
      await expect(svc.push('m1')).rejects.toThrow(/4 de 9 dianas/);
    });

    it('rechazar NO quema versión deseada ni publica nada', async () => {
      const prisma = fakePrisma(7, 0);
      const mqtt = fakeMqtt();
      await expect(new ModuleConfigService(prisma, mqtt).push('m1')).rejects.toThrow();

      expect(prisma.fila.desiredConfigVersion).toBe(7); // intacta
      expect(prisma.module.update).not.toHaveBeenCalled();
      expect(mqtt.publishModuleConfig).not.toHaveBeenCalled();
    });

    it('ocho dianas tampoco valen: el contrato pide exactamente nueve', async () => {
      const prisma = fakePrisma(0, DIANAS_POR_MODULO - 1);
      await expect(
        new ModuleConfigService(prisma, fakeMqtt()).push('m1'),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  // ── Control de calibración del propio doble ───────────────────────────────
  // Sin esto, las pruebas de arriba sólo demuestran que el servicio rechaza
  // antes de llegar a MQTT; no demuestran que el doble sea capaz de detectar
  // un payload inválido. Si el validador estuviera desconectado, esta prueba
  // pasaría a verde por la razón equivocada y el resto seguiría igual.
  it('CONTROL: el doble de MQTT rechaza de verdad un payload fuera de contrato', async () => {
    const mqtt = fakeMqtt();
    await expect(
      mqtt.publishModuleConfig('module-01', { schema_version: 1, module_id: 'module-01' }),
    ).rejects.toThrow(/schema_violation/);
  });

  it('lo que se publica en el camino feliz SÍ cumple el esquema congelado', async () => {
    const mqtt = fakeMqtt();
    await new ModuleConfigService(fakePrisma(0), mqtt).push('m1');
    expect(mqtt.publicados).toHaveLength(1);
    expect((mqtt.publicados[0] as any).calibration).toHaveLength(DIANAS_POR_MODULO);
  });
});
