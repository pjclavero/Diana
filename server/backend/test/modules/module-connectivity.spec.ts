import {
  classifyConnectivity,
  classifyConnectivityAll,
  summarizeConnectivity,
} from '../../src/domain/modules/connectivity';
import { STALE_AFTER_MS } from '../../src/domain/resilience/resilience';

const T0 = new Date('2026-09-10T12:00:00Z');
const hace = (ms: number) => new Date(T0.getTime() - ms);

describe('T3 · conectividad real del módulo', () => {
  it('nunca conectado → PENDING', () => {
    const v = classifyConnectivity({ slug: 'm1', online: false, lastSeenAt: null }, T0);
    expect(v.connectivity).toBe('PENDING');
    expect(v.reason).toMatch(/nunca/i);
  });

  it('heartbeat reciente → ONLINE', () => {
    const v = classifyConnectivity({ slug: 'm1', online: true, lastSeenAt: hace(1_000) }, T0);
    expect(v.connectivity).toBe('ONLINE');
  });

  it('justo en el límite del plazo sigue ONLINE', () => {
    const v = classifyConnectivity(
      { slug: 'm1', online: true, lastSeenAt: hace(STALE_AFTER_MS) },
      T0,
    );
    expect(v.connectivity).toBe('ONLINE');
  });

  it('vencido (más de 90 s callado) → STALE', () => {
    const v = classifyConnectivity(
      { slug: 'm1', online: true, lastSeenAt: hace(STALE_AFTER_MS + 1) },
      T0,
    );
    expect(v.connectivity).toBe('STALE');
    expect(v.silentForMs).toBe(STALE_AFTER_MS + 1);
  });

  it('el E2E de offline mide 92 s reales: a esa distancia sale STALE', () => {
    const v = classifyConnectivity({ slug: 'm1', online: true, lastSeenAt: hace(92_000) }, T0);
    expect(v.connectivity).toBe('STALE');
  });

  it('estuvo conectado y el broker lo da por caído → OFFLINE', () => {
    const v = classifyConnectivity({ slug: 'm1', online: false, lastSeenAt: hace(5_000) }, T0);
    expect(v.connectivity).toBe('OFFLINE');
  });

  it('reconexión: vuelve a ONLINE con la señal nueva', () => {
    const caido = classifyConnectivity({ slug: 'm1', online: false, lastSeenAt: hace(300_000) }, T0);
    expect(caido.connectivity).toBe('OFFLINE');
    // Llega presencia y una señal de vida: el MISMO módulo, clasificado otra vez.
    const vuelto = classifyConnectivity({ slug: 'm1', online: true, lastSeenAt: T0 }, T0);
    expect(vuelto.connectivity).toBe('ONLINE');
  });

  it('`online: true` sin ninguna señal registrada NO es ONLINE', () => {
    // El caso D9: el Last Will nunca llegó y la bandera se quedó pegada.
    const v = classifyConnectivity({ slug: 'm1', online: true, lastSeenAt: null }, T0);
    expect(v.connectivity).toBe('STALE');
    expect(v.connectivity).not.toBe('ONLINE');
  });

  it('`ModuleState` no interviene: la firma no lo admite', () => {
    // El ciclo de vida del firmware (ready, game_active…) sobrevive al apagado
    // del módulo en la base. Si entrase aquí, un `state: ready` de hace un mes
    // podría pesar en el veredicto. No entra: no hay por dónde.
    const v = classifyConnectivity(
      { slug: 'm1', online: false, lastSeenAt: null, state: 'ready' } as any,
      T0,
    );
    expect(v.connectivity).toBe('PENDING');
  });

  describe('LA GARANTÍA · con 0 módulos conectados, 0 ONLINE', () => {
    it('nueve módulos dados de alta y ninguno que haya publicado nunca', () => {
      const nueve = Array.from({ length: 9 }, (_, i) => ({
        slug: `module-0${i + 1}`,
        online: false,
        lastSeenAt: null,
      }));
      const resumen = summarizeConnectivity(classifyConnectivityAll(nueve, T0));
      expect(resumen).toEqual({ total: 9, online: 0, stale: 0, offline: 0, pending: 9 });
    });

    it('ni siquiera con la bandera `online` puesta a mano en las nueve filas', () => {
      // Alguien escribe `online: true` directamente en la base (o un LWT
      // retenido lo reentrega). Sin `lastSeenAt` no hay ONLINE.
      const nueve = Array.from({ length: 9 }, (_, i) => ({
        slug: `module-0${i + 1}`,
        online: true,
        lastSeenAt: null,
      }));
      const resumen = summarizeConnectivity(classifyConnectivityAll(nueve, T0));
      expect(resumen.online).toBe(0);
      expect(resumen.stale).toBe(9);
    });
  });

  it('el umbral es el del dominio de resiliencia, no una copia local', () => {
    // Si alguien cambiase STALE_AFTER_MS, esta clasificación cambia con él.
    // Es la comprobación de que no hay una segunda regla de caducidad.
    const justoDespues = classifyConnectivity(
      { slug: 'm1', online: true, lastSeenAt: hace(STALE_AFTER_MS + 1) },
      T0,
    );
    const conUmbralMayor = classifyConnectivity(
      { slug: 'm1', online: true, lastSeenAt: hace(STALE_AFTER_MS + 1) },
      T0,
      STALE_AFTER_MS * 10,
    );
    expect(justoDespues.connectivity).toBe('STALE');
    expect(conUmbralMayor.connectivity).toBe('ONLINE');
  });

  it('clasificar en bloque respeta el ORDEN de entrada', () => {
    const v = classifyConnectivityAll(
      [
        { slug: 'a', online: true, lastSeenAt: T0 },
        { slug: 'b', online: false, lastSeenAt: null },
        { slug: 'a', online: false, lastSeenAt: hace(1_000) },
      ],
      T0,
    );
    expect(v.map((x) => x.connectivity)).toEqual(['ONLINE', 'PENDING', 'OFFLINE']);
  });
});
