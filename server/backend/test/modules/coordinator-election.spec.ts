import {
  CoordinatorElectionService,
  FRESCURA_SELECTOR_MS,
} from '../../src/modules/modules/coordinator-election.service';

const AHORA = new Date('2026-09-12T18:00:00.000Z');
const reciente = new Date(AHORA.getTime() - 2_000);

function build(modulos: Array<Record<string, unknown>>, coordinatorModuleId: string | null) {
  const update = jest.fn().mockResolvedValue({});
  const incidents = { record: jest.fn().mockResolvedValue(undefined) };
  const prisma = {
    module: {
      findUnique: jest.fn().mockResolvedValue({ targetSystemId: 'sys-1' }),
      findMany: jest.fn().mockResolvedValue(modulos),
    },
    targetSystem: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'sys-1',
        slug: 'banco-01',
        coordinatorModuleId,
      }),
      update,
    },
  };
  const service = new CoordinatorElectionService(prisma as never, incidents as never);
  return { service, update, incidents };
}

describe('aplicación de la elección · 3.2/3.3', () => {
  it('un PRINCIPAL observado se persiste como coordinador del sistema', async () => {
    const { service, update } = build(
      [
        { id: 'm1', slug: 'module-01', selector: 'PRINCIPAL', selectorObservedAt: reciente, online: true },
        { id: 'm2', slug: 'module-02', selector: 'SATELITE', selectorObservedAt: reciente, online: true },
      ],
      null,
    );
    await service.reevaluar('module-01', AHORA);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'sys-1' },
      data: { coordinatorModuleId: 'm1' },
    });
  });

  it('si no cambia nada, NO se escribe', async () => {
    // Escribir en cada status retenido movería el sistema sin motivo.
    const { service, update } = build(
      [{ id: 'm1', slug: 'module-01', selector: 'PRINCIPAL', selectorObservedAt: reciente, online: true }],
      'm1',
    );
    await service.reevaluar('module-01', AHORA);
    expect(update).not.toHaveBeenCalled();
  });

  it('al pasar a SATÉLITE el sistema se queda SIN coordinador', async () => {
    const { service, update } = build(
      [{ id: 'm1', slug: 'module-01', selector: 'SATELITE', selectorObservedAt: reciente, online: true }],
      'm1',
    );
    await service.reevaluar('module-01', AHORA);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'sys-1' },
      data: { coordinatorModuleId: null },
    });
  });

  it('dos PRINCIPAL: avisa con una incidencia y deja UN solo coordinador', async () => {
    const { service, update, incidents } = build(
      [
        { id: 'm2', slug: 'module-02', selector: 'PRINCIPAL', selectorObservedAt: reciente, online: true },
        { id: 'm3', slug: 'module-03', selector: 'PRINCIPAL', selectorObservedAt: reciente, online: true },
      ],
      null,
    );
    await service.reevaluar('module-02', AHORA);
    expect(incidents.record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'coordinator_conflict', severity: 'warning' }),
    );
    expect(update).toHaveBeenCalledWith({
      where: { id: 'sys-1' },
      data: { coordinatorModuleId: 'm2' },
    });
  });

  it('una observación caducada no elige coordinador', async () => {
    const viejo = new Date(AHORA.getTime() - FRESCURA_SELECTOR_MS - 1);
    const { service, update } = build(
      [{ id: 'm1', slug: 'module-01', selector: 'PRINCIPAL', selectorObservedAt: viejo, online: true }],
      null,
    );
    await service.reevaluar('module-01', AHORA);
    expect(update).not.toHaveBeenCalled();
  });

  it('un módulo sin sistema no provoca ninguna escritura', async () => {
    const update = jest.fn();
    const prisma = {
      module: { findUnique: jest.fn().mockResolvedValue({ targetSystemId: null }), findMany: jest.fn() },
      targetSystem: { findUnique: jest.fn(), update },
    };
    const service = new CoordinatorElectionService(prisma as never);
    await service.reevaluar('module-99', AHORA);
    expect(update).not.toHaveBeenCalled();
  });
});

import { ModuleObservationRepository } from '../../src/modules/modules/module-observation.repository';

/**
 * La UNIÓN de la cadena: observar un cambio de selector tiene que disparar la
 * reevaluación del coordinador.
 *
 * Sin esta prueba, quitar esa llamada dejaba toda la suite en verde —
 * comprobado— y la cadena selector → status → DB → elección quedaba cortada en
 * el último eslabón sin que nada lo dijera.
 */
describe('observar un selector dispara la elección', () => {
  const base = (selectorActual: string | null) => {
    const update = jest.fn().mockResolvedValue({});
    const prisma = {
      module: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'm1',
          selector: selectorActual,
          role: selectorActual === 'PRINCIPAL' ? 'principal' : 'satellite',
        }),
        update,
      },
    };
    const eleccion = { reevaluar: jest.fn().mockResolvedValue(undefined) };
    const repo = new ModuleObservationRepository(prisma as never, eleccion as never);
    return { repo, eleccion, update };
  };

  const obs = {
    moduleSlug: 'module-01',
    selector: 'PRINCIPAL' as const,
    role: 'principal' as const,
    observedAt: AHORA,
  };

  it('un cambio de selector reevalúa el coordinador', async () => {
    const { repo, eleccion, update } = base('SATELITE');
    await repo.observeSelector(obs);
    expect(update).toHaveBeenCalled();
    expect(eleccion.reevaluar).toHaveBeenCalledWith('module-01', AHORA);
  });

  it('una observación repetida no reescribe ni reevalúa', async () => {
    // `module-status` es RETENIDO: el broker lo reentrega en cada reconexión.
    const { repo, eleccion, update } = base('PRINCIPAL');
    await repo.observeSelector(obs);
    expect(update).not.toHaveBeenCalled();
    expect(eleccion.reevaluar).not.toHaveBeenCalled();
  });

  it('un fallo en la elección no invalida la observación ya persistida', async () => {
    const { repo, eleccion, update } = base('SATELITE');
    eleccion.reevaluar.mockRejectedValueOnce(new Error('base caída'));
    await expect(repo.observeSelector(obs)).resolves.toBeUndefined();
    expect(update).toHaveBeenCalled();
  });
});
