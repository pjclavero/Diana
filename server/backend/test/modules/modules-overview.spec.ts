import { ModulesOverviewService } from '../../src/modules/modules/modules-overview.service';
import { ROLE } from '../../src/domain/rbac/permissions';

function buildPrisma(modules: any[], latestSigned: any) {
  return {
    module: { findMany: jest.fn().mockResolvedValue(modules) },
    firmwareVersion: { findFirst: jest.fn().mockResolvedValue(latestSigned) },
  } as any;
}

const mod = (over: Partial<any> = {}) => ({
  id: 'm1', slug: 'diana-01', friendlyName: null, online: true, state: 'ready', role: 'principal',
  firmwareVersion: '1.0.0', maintenance: false, lastSeenAt: null, ownerId: 'g1', owner: null, position: null,
  targetBoard: 'esp32-s3',
  desiredConfigVersion: 0, reportedConfigVersion: null, configState: 'pending', configAppliedAt: null,
  ...over,
});

describe('ModulesOverviewService', () => {
  const admin = { userId: 'a1', role: ROLE.ADMINISTRADOR };
  const gestor = { userId: 'g1', role: ROLE.GESTOR };

  it('el admin consulta todos los módulos (where vacío)', async () => {
    const prisma = buildPrisma([mod()], { version: '1.2.0', targetBoard: 'esp32-s3' });
    await new ModulesOverviewService(prisma).overview(admin);
    expect(prisma.module.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it('un gestor sólo consulta sus módulos (where ownerId)', async () => {
    const prisma = buildPrisma([mod()], null);
    await new ModulesOverviewService(prisma).overview(gestor);
    expect(prisma.module.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerId: 'g1' } }));
  });

  it('marca updateAvailable cuando hay una versión firmada más reciente distinta a la vigente', async () => {
    const prisma = buildPrisma([mod({ firmwareVersion: '1.0.0' })], { version: '1.2.0', targetBoard: 'esp32-s3' });
    const res = await new ModulesOverviewService(prisma).overview(admin);
    expect(res.items[0].updateAvailable).toBe(true);
    expect(res.items[0].latestSignedVersion).toBe('1.2.0');
    expect(res.summary.updatesPending).toBe(1);
  });

  it('NO marca updateAvailable si el módulo ya corre la última firmada', async () => {
    const prisma = buildPrisma([mod({ firmwareVersion: '1.2.0' })], { version: '1.2.0', targetBoard: 'esp32-s3' });
    const res = await new ModulesOverviewService(prisma).overview(admin);
    expect(res.items[0].updateAvailable).toBe(false);
    expect(res.summary.updatesPending).toBe(0);
  });

  it('sin versiones firmadas, no hay actualizaciones pendientes', async () => {
    const prisma = buildPrisma(
      [mod(), mod({ id: 'm2', slug: 'diana-02', online: false })],
      null,
    );
    const res = await new ModulesOverviewService(prisma).overview(admin);
    expect(res.summary.total).toBe(2);
    expect(res.summary.updatesPending).toBe(0);
  });

  // ── T3 ─────────────────────────────────────────────────────────────────────
  // Este bloque cambió de expectativa a propósito. Antes se afirmaba
  // `online: 1` para un módulo con `online: true` y `lastSeenAt: null`, es
  // decir, una bandera que no respaldaba ninguna señal de vida. El panel
  // contaba ese módulo como conectado. Ahora no: sin señal, no hay ONLINE.
  it('la bandera `online` sin ninguna señal de vida NO cuenta como conectado', async () => {
    const prisma = buildPrisma([mod({ online: true, lastSeenAt: null })], null);
    const res = await new ModulesOverviewService(prisma).overview(admin);
    expect(res.items[0].online).toBe(true); // la bandera cruda se conserva
    expect(res.items[0].connectivity).toBe('STALE'); // y el veredicto la desmiente
    expect(res.summary.online).toBe(0);
  });

  it('un módulo dado de alta que nunca se conectó sale PENDING, no OFFLINE', async () => {
    const prisma = buildPrisma([mod({ online: false, lastSeenAt: null })], null);
    const res = await new ModulesOverviewService(prisma).overview(admin);
    expect(res.items[0].connectivity).toBe('PENDING');
    expect(res.summary).toMatchObject({ online: 0, pending: 1, offline: 0, stale: 0 });
  });

  it('con señal de vida reciente sí sale ONLINE', async () => {
    const prisma = buildPrisma([mod({ online: true, lastSeenAt: new Date() })], null);
    const res = await new ModulesOverviewService(prisma).overview(admin);
    expect(res.items[0].connectivity).toBe('ONLINE');
    expect(res.summary.online).toBe(1);
  });

  // La garantía del encargo, dicha como prueba: con CERO dispositivos
  // conectados no puede salir ni un ONLINE, y no depende de que nadie se
  // acuerde de no fabricarlos — sale de que `lastSeenAt` es NULL.
  it('con 0 dispositivos conectados, 0 módulos ONLINE', async () => {
    const nunca = Array.from({ length: 9 }, (_, i) =>
      mod({ id: `m${i}`, slug: `diana-0${i}`, online: false, lastSeenAt: null }),
    );
    const res = await new ModulesOverviewService(buildPrisma(nunca, null)).overview(admin);
    expect(res.summary.total).toBe(9);
    expect(res.summary.online).toBe(0);
    expect(res.summary.pending).toBe(9);
    expect(res.items.every((i: any) => i.connectivity === 'PENDING')).toBe(true);
  });

  // El defecto que encontró esta suite al escribirla: los veredictos se casaban
  // con las filas por `slug`, y dos filas con el mismo slug se colapsaban en
  // una. El resumen decía «1» donde había 2.
  it('el resumen cuenta FILAS, aunque dos compartan slug', async () => {
    const prisma = buildPrisma([mod({ id: 'm1' }), mod({ id: 'm2' })], null);
    const res = await new ModulesOverviewService(prisma).overview(admin);
    expect(res.summary.total).toBe(2);
    expect(res.summary.stale + res.summary.online + res.summary.offline + res.summary.pending).toBe(2);
  });

  it('no ofrece firmware de OTRA placa (F3/D3)', async () => {
    const prisma = buildPrisma([mod({ targetBoard: 'esp32-c3' })], null);
    // La consulta se acota por placa: para 'esp32-c3' no hay firmada.
    const res = await new ModulesOverviewService(prisma).overview(admin);
    expect(prisma.firmwareVersion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { signed: true, targetBoard: 'esp32-c3' } }),
    );
    expect(res.items[0].updateAvailable).toBe(false);
  });

  it('sin placa declarada no afirma que haya actualización: lo dice', async () => {
    const prisma = buildPrisma([mod({ targetBoard: null })], { version: '1.2.0', targetBoard: 'esp32-s3' });
    const res = await new ModulesOverviewService(prisma).overview(admin);
    expect(res.items[0].updateAvailable).toBe(false);
    expect(res.items[0].updateUnknownReason).toMatch(/No consta la placa/);
    expect(res.summary.updatesPending).toBe(0);
  });
});
