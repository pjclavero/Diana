import {
  decideConfigVersion,
  deriveConfigState,
} from '../../src/domain/modules/config-version';
import { ModuleConfigReportedService } from '../../src/modules/modules/module-config-reported.service';

describe('T2 · precedencia de config_version (dominio puro)', () => {
  it('remota > local → aplicar', () => {
    expect(decideConfigVersion(8, 7).decision).toBe('apply');
    expect(decideConfigVersion(1, 0).decision).toBe('apply');
    expect(decideConfigVersion(1000, 3).decision).toBe('apply');
  });

  it('remota = local → noop', () => {
    expect(decideConfigVersion(7, 7).decision).toBe('noop');
    expect(decideConfigVersion(0, 0).decision).toBe('noop');
  });

  it('remota < local → rechazar', () => {
    expect(decideConfigVersion(6, 7).decision).toBe('reject');
    expect(decideConfigVersion(0, 1).decision).toBe('reject');
  });

  it('el rechazo DICE por qué (monotonía), no sólo que no', () => {
    expect(decideConfigVersion(6, 7).reason).toMatch(/monot/i);
  });

  it('una versión no entera o negativa se rechaza', () => {
    expect(decideConfigVersion(-1, 0).decision).toBe('reject');
    expect(decideConfigVersion(1.5, 0).decision).toBe('reject');
    expect(decideConfigVersion(Number.NaN, 0).decision).toBe('reject');
  });

  // EL RELOJ NO ORDENA. Esta prueba no puede escribirse sobre la firma actual
  // porque la firma no admite ninguna marca de tiempo, y eso es precisamente
  // lo que se quiere dejar dicho: la función no tiene por dónde recibir un
  // reloj, así que no hay forma de que un módulo con la hora cambiada altere
  // el veredicto.
  it('la decisión no admite ninguna marca de tiempo (aridad 2)', () => {
    expect(decideConfigVersion.length).toBe(2);
  });

  describe('estado derivado', () => {
    it('sin reporte → pending, aunque la deseada sea 0', () => {
      expect(deriveConfigState({ desired: 0, reported: null })).toBe('pending');
      expect(deriveConfigState({ desired: 7, reported: null })).toBe('pending');
    });
    it('reportada == deseada → applied', () => {
      expect(deriveConfigState({ desired: 7, reported: 7 })).toBe('applied');
    });
    it('reportada por detrás → pending', () => {
      expect(deriveConfigState({ desired: 7, reported: 5 })).toBe('pending');
    });
    it('un envío fallido manda sobre todo lo demás', () => {
      expect(deriveConfigState({ desired: 7, reported: 7, failed: true })).toBe('failed');
    });
    it('nunca se llega a `applied` sin un reporte real del módulo', () => {
      // Exhaustivo sobre el único camino que produce 'applied'.
      for (let d = 0; d < 20; d += 1) {
        expect(deriveConfigState({ desired: d, reported: null })).not.toBe('applied');
      }
    });
  });
});

describe('T2 · ingesta de config/reported', () => {
  function prismaCon(module: any, updated = 1) {
    return {
      module: {
        findUnique: jest.fn().mockResolvedValue(module),
        updateMany: jest.fn().mockResolvedValue({ count: updated }),
      },
    } as any;
  }
  const ahora = new Date('2026-09-10T10:00:00Z');

  it('el primer reporte se acepta aunque la versión sea 0', async () => {
    const prisma = prismaCon({
      id: 'm1',
      desiredConfigVersion: 0,
      reportedConfigVersion: null,
      configState: 'pending',
    });
    const r = await new ModuleConfigReportedService(prisma).record('module-01', 0, null, ahora);
    expect(r.outcome).toBe('applied');
    expect(prisma.module.updateMany).toHaveBeenCalled();
    expect(prisma.module.updateMany.mock.calls[0][0].data.reportedConfigVersion).toBe(0);
  });

  it('confirmar la deseada deja el módulo en `applied` y anota applied_at', async () => {
    const prisma = prismaCon({
      id: 'm1',
      desiredConfigVersion: 7,
      reportedConfigVersion: 6,
      configState: 'pending',
    });
    const r = await new ModuleConfigReportedService(prisma).record('module-01', 7, null, ahora);
    expect(r.outcome).toBe('applied');
    expect(r.configState).toBe('applied');
    const data = prisma.module.updateMany.mock.calls[0][0].data;
    expect(data.configState).toBe('applied');
    expect(data.configAppliedAt).toEqual(ahora);
  });

  it('reportar por detrás de la deseada deja `pending` y SIN applied_at', async () => {
    const prisma = prismaCon({
      id: 'm1',
      desiredConfigVersion: 7,
      reportedConfigVersion: 4,
      configState: 'pending',
    });
    const r = await new ModuleConfigReportedService(prisma).record('module-01', 5, null, ahora);
    expect(r.configState).toBe('pending');
    expect(prisma.module.updateMany.mock.calls[0][0].data.configAppliedAt).toBeNull();
  });

  it('una versión ANTERIOR se rechaza y NO se escribe (monotonía)', async () => {
    const prisma = prismaCon({
      id: 'm1',
      desiredConfigVersion: 7,
      reportedConfigVersion: 7,
      configState: 'applied',
    });
    const r = await new ModuleConfigReportedService(prisma).record('module-01', 3, null, ahora);
    expect(r.outcome).toBe('rejected');
    expect(prisma.module.updateMany).not.toHaveBeenCalled();
  });

  it('repetir la misma versión es noop y no escribe', async () => {
    const prisma = prismaCon({
      id: 'm1',
      desiredConfigVersion: 7,
      reportedConfigVersion: 7,
      configState: 'applied',
    });
    const r = await new ModuleConfigReportedService(prisma).record('module-01', 7, null, ahora);
    expect(r.outcome).toBe('noop');
    expect(prisma.module.updateMany).not.toHaveBeenCalled();
  });

  it('reportar MÁS de lo que el servidor emitió se rechaza', async () => {
    // Ese módulo dice correr una configuración que este backend nunca publicó:
    // o hay otro emisor en el broker, o se la ha inventado. En ningún caso se
    // acepta como verdad.
    const prisma = prismaCon({
      id: 'm1',
      desiredConfigVersion: 7,
      reportedConfigVersion: 7,
      configState: 'applied',
    });
    const r = await new ModuleConfigReportedService(prisma).record('module-01', 99, null, ahora);
    expect(r.outcome).toBe('rejected');
    expect(r.reason).toMatch(/emisor|fabricad/i);
    expect(prisma.module.updateMany).not.toHaveBeenCalled();
  });

  it('un módulo desconocido no crea filas', async () => {
    const prisma = prismaCon(null);
    const r = await new ModuleConfigReportedService(prisma).record('fantasma', 1, null, ahora);
    expect(r.outcome).toBe('unknown_module');
    expect(prisma.module.updateMany).not.toHaveBeenCalled();
  });

  it('la escritura es CONDICIONAL: si otro mensaje adelantó, no retrocede', async () => {
    const prisma = prismaCon(
      { id: 'm1', desiredConfigVersion: 9, reportedConfigVersion: 4, configState: 'pending' },
      0, // updateMany no afectó a ninguna fila
    );
    const r = await new ModuleConfigReportedService(prisma).record('module-01', 5, null, ahora);
    expect(r.outcome).toBe('rejected');
    expect(prisma.module.updateMany.mock.calls[0][0].where.reportedConfigVersion).toEqual({ lt: 5 });
  });
});
