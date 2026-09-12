import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { PrismaClient } from '@prisma/client';

import { ContractValidator } from '../../src/contracts/contract-validator';
import { PrismaHitRepository } from '../../src/modules/hits/prisma-hit.repository';
import { PrismaHitAttributor } from '../../src/modules/hits/prisma-hit-attributor';
import { PrismaIncidentSink } from '../../src/modules/maintenance/incident.sink';
import { IngestService } from '../../src/modules/mqtt/ingest.service';
import { ResilienceService } from '../../src/modules/resilience/resilience.service';
import { AccuracyService } from '../../src/modules/accuracy/accuracy.service';
import { StatisticsService } from '../../src/modules/statistics/statistics.module';
import { ScoreboardService } from '../../src/modules/scoreboard/scoreboard.service';

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * CARRIL D · los impactos ENLAZADOS alimentan de verdad, y la ingesta no falla
 * en silencio. PostgreSQL REAL y efímero.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Por qué PostgreSQL de verdad y no un doble: aquí se afirma qué devuelve un
 * `groupBy` por CLAVE AJENA y qué devuelve el mismo recuento por SLUG cuando
 * las claves ajenas están vacías. Con un doble, ambas consultas devuelven lo
 * que se le haya enseñado y la diferencia —que es justo el hallazgo— no existe.
 *
 * Contenedor EFÍMERO creado y destruido por esta suite. NUNCA la VM 109 ni
 * `compose.yml`.
 *
 * ── Lo que esta suite NO puede afirmar ───────────────────────────────────────
 * Nada sobre el firmware ni sobre el recorrido por el broker: los mensajes se
 * entregan llamando a `IngestService.handleMessage(topic, raw)`, que es el
 * mismo punto de entrada que usa el cliente MQTT, pero sin transporte. Que el
 * ESP32 publique ESTOS bytes en ESTE tópico sólo lo prueba el banco físico.
 */

const POSTGRES_IMAGE = 'postgres:16-alpine';

function dockerDisponible(): boolean {
  return spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;
}

function puertoLibre(base: number): number {
  for (let i = 0; i < 40; i += 1) {
    const c = base + Math.floor(Math.random() * 900);
    const salida = execFileSync('sh', ['-c', `ss -ltn 2>/dev/null | grep -c ':${c} ' || true`], {
      encoding: 'utf8',
    }).trim();
    if (salida === '0') return c;
  }
  throw new Error('no se encontró puerto libre');
}

const hayDocker = dockerDisponible();
const suite = hayDocker ? describe : describe.skip;
if (!hayDocker) {
  // eslint-disable-next-line no-console
  console.warn(
    '[integración] NO HAY DOCKER: el bloque HIT-LINKAGE queda NO MEDIDO. ' +
      'Un salto no es un aprobado.',
  );
}

suite('HIT-LINKAGE · impactos enlazados y ingesta endurecida (PostgreSQL real)', () => {
  jest.setTimeout(300_000);

  let pgContainer: string;
  let pgPort: number;
  let databaseUrl: string;
  let prisma: PrismaClient;

  // Entidades del escenario
  const SLUG_SIS_A = 'panel-a';
  const SLUG_SIS_B = 'panel-b';
  const SLUG_MOD_A1 = 'module-21';
  const SLUG_MOD_A2 = 'module-22';
  const SLUG_MOD_B1 = 'module-23';
  const SLUG_HUERFANO = 'module-90'; // existe como slug MQTT, NO como fila

  let sisA = '';
  let sisB = '';
  let modA1 = '';
  let modA2 = '';
  let modB1 = '';
  /** dianas 1..3 de cada módulo, por slug */
  const dianas: Record<string, Record<number, string>> = {};

  let gameId = '';
  let roundId = '';
  let participanteId = '';
  let playerId = '';

  async function esperar(que: () => boolean, queCosa: string, msMax = 90_000): Promise<void> {
    const t0 = Date.now();
    let intentos = 0;
    while (Date.now() - t0 < msMax) {
      intentos += 1;
      if (que()) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`Se agotó la espera de ${queCosa} tras ${intentos} intentos.`);
  }

  beforeAll(async () => {
    mkdtempSync(path.join(tmpdir(), 'diana-hit-linkage-'));

    pgPort = puertoLibre(26_000);
    pgContainer = `diana-linkage-pg-${pgPort}`;
    execFileSync('docker', [
      'run', '-d', '--rm',
      '--name', pgContainer,
      '-e', 'POSTGRES_PASSWORD=efimero',
      '-e', 'POSTGRES_DB=diana_linkage',
      '-p', `${pgPort}:5432`,
      POSTGRES_IMAGE,
    ]);
    await esperar(
      () =>
        spawnSync(
          'docker',
          ['exec', pgContainer, 'pg_isready', '-U', 'postgres', '-h', '127.0.0.1'],
          { stdio: 'ignore' },
        ).status === 0,
      'que PostgreSQL acepte conexiones',
    );
    databaseUrl = `postgresql://postgres:efimero@127.0.0.1:${pgPort}/diana_linkage`;

    // La migración se aplica de verdad. Si no aplica, la suite no arranca.
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      cwd: path.resolve(__dirname, '../..'),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'pipe',
    });
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await prisma.$connect();

    // ── Escenario: dos paneles, tres módulos, tres dianas cada uno ──────────
    sisA = (await prisma.targetSystem.create({ data: { slug: SLUG_SIS_A, name: 'Panel A' } })).id;
    sisB = (await prisma.targetSystem.create({ data: { slug: SLUG_SIS_B, name: 'Panel B' } })).id;
    modA1 = (await prisma.module.create({ data: { slug: SLUG_MOD_A1, targetSystemId: sisA } })).id;
    modA2 = (await prisma.module.create({ data: { slug: SLUG_MOD_A2, targetSystemId: sisA } })).id;
    modB1 = (await prisma.module.create({ data: { slug: SLUG_MOD_B1, targetSystemId: sisB } })).id;
    for (const [slug, id] of [
      [SLUG_MOD_A1, modA1],
      [SLUG_MOD_A2, modA2],
      [SLUG_MOD_B1, modB1],
    ] as const) {
      dianas[slug] = {};
      for (const idx of [1, 2, 3]) {
        const t = await prisma.target.create({ data: { moduleId: id, targetIndex: idx } });
        dianas[slug][idx] = t.id;
      }
    }

    const modo = await prisma.gameMode.create({
      data: { key: 'all_against_clock', name: 'Todos contra el reloj' },
    });
    const jugador = await prisma.player.create({ data: { displayName: 'Tirador D' } });
    playerId = jugador.id;
    const partida = await prisma.game.create({
      data: { targetSystemId: sisA, gameModeId: modo.id, config: {}, status: 'running' },
    });
    gameId = partida.id;
    const ronda = await prisma.round.create({
      data: { gameId, roundIndex: 1, mode: 'all_against_clock', phase: 'running' },
    });
    roundId = ronda.id;
    const participante = await prisma.participant.create({
      data: { gameId, roundId, playerId, targetSystemId: sisA, slot: 1 },
    });
    participanteId = participante.id;
  });

  afterAll(async () => {
    await prisma?.$disconnect().catch(() => undefined);
    if (pgContainer) spawnSync('docker', ['rm', '-f', pgContainer], { stdio: 'ignore' });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Fábricas
  // ═══════════════════════════════════════════════════════════════════════════

  let secuencia = 0;
  const BOOT = '00000000-0000-4000-8000-0000000000d1';

  /** Registro de impacto ya traducido, para hablar con el repositorio. */
  function registro(over: Record<string, unknown> = {}) {
    secuencia += 1;
    const n = secuencia;
    return {
      eventId: `d-${n}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      systemSlug: SLUG_SIS_A,
      moduleSlug: SLUG_MOD_A1,
      targetIndex: 1,
      gameId: null,
      roundId: null,
      participantId: null,
      modulePositionX: null,
      modulePositionY: null,
      moduleRotation: null,
      localSequence: BigInt(n * 1000 + Math.floor(Math.random() * 999)),
      deviceBootId: BOOT,
      deviceUptimeUs: BigInt(n),
      deviceEventUs: BigInt(n),
      deviceEpochMs: null,
      coordinatorRecvUs: null,
      coordinatorElapsedUs: BigInt(n * 1000),
      clockOffsetUs: null,
      offsetUncertaintyUs: null,
      receivedAt: new Date(),
      detectionMethod: 'digital_threshold',
      amplitude: null,
      threshold: null,
      noiseFloor: null,
      neighbours: null,
      targetStateBefore: 'active',
      classification: 'valid_hit',
      classificationReason: null,
      firmwareVersion: '0.1.0',
      replay: false,
      outOfWindow: false,
      outOfWindowReason: null,
      countsForScore: true,
      rawPayload: {},
      ...over,
    } as never;
  }

  /** Payload MQTT de impacto, conforme al contrato v1. */
  function payloadHit(over: Record<string, unknown> = {}): Record<string, unknown> {
    secuencia += 1;
    const n = secuencia;
    return {
      schema_version: 1,
      event_id: `11111111-2222-4333-8444-${String(n).padStart(12, '0')}`,
      system_id: SLUG_SIS_A,
      module_id: SLUG_MOD_A1,
      target_index: 1,
      local_sequence: n * 7 + 100000,
      device: { boot_id: BOOT, uptime_us: n * 10, event_us: n * 10 },
      coordinator: {
        recv_us: n * 10 + 5,
        elapsed_us: n * 1000,
        clock_offset_us: -300,
        offset_uncertainty_us: 90,
      },
      // El perfil por defecto es `analog_envelope`, y el contrato EXIGE
      // amplitud y umbral en ese perfil (ADR-0007).
      amplitude: 2710,
      threshold: 920,
      target_state_before: 'active',
      classification: 'valid_hit',
      firmware_version: '0.1.0',
      replay: false,
      ...over,
    };
  }

  function nuevaIngesta(opts: { presencia?: boolean; atribuir?: boolean } = {}) {
    const repo = new PrismaHitRepository(prisma as never);
    const sink = new PrismaIncidentSink(prisma as never);
    const presencia = opts.presencia
      ? new ResilienceService(prisma as never, { get: () => undefined } as never)
      : undefined;
    const atribuidor = opts.atribuir ? new PrismaHitAttributor(prisma as never) : undefined;
    return new IngestService(
      new ContractValidator(),
      repo,
      sink,
      presencia as never,
      atribuidor as never,
    );
  }

  const topicoHit = (slug: string) => `targets/v1/module/${slug}/hit`;

  // ═══════════════════════════════════════════════════════════════════════════
  // A · HIT_STATISTICS · los recuentos por entidad se sostienen sobre las FK
  // ═══════════════════════════════════════════════════════════════════════════
  describe('A · recuentos por módulo, sistema y diana sobre las CLAVES AJENAS', () => {
    beforeAll(async () => {
      const repo = new PrismaHitRepository(prisma as never);
      // Reparto deliberado y asimétrico: 3 en A1/diana1, 2 en A1/diana2,
      // 4 en A2/diana1, 1 en B1/diana3. Totales: panel A = 9, panel B = 1.
      const reparto: Array<[string, string, number, number]> = [
        [SLUG_SIS_A, SLUG_MOD_A1, 1, 3],
        [SLUG_SIS_A, SLUG_MOD_A1, 2, 2],
        [SLUG_SIS_A, SLUG_MOD_A2, 1, 4],
        [SLUG_SIS_B, SLUG_MOD_B1, 3, 1],
      ];
      for (const [sis, mod, idx, veces] of reparto) {
        for (let i = 0; i < veces; i += 1) {
          const r = await repo.insertIfAbsent(
            registro({ systemSlug: sis, moduleSlug: mod, targetIndex: idx }),
          );
          expect(r.inserted).toBe(true);
          expect(r.unresolved).toBeUndefined();
        }
      }
    });

    it('POR MÓDULO · el groupBy sobre module_id cuadra con lo insertado', async () => {
      const filas = await prisma.hitEvent.groupBy({
        by: ['moduleId'],
        where: { moduleId: { not: null } },
        _count: { _all: true },
      });
      const porId = Object.fromEntries(filas.map((f) => [f.moduleId, f._count._all]));
      expect(porId[modA1]).toBe(5);
      expect(porId[modA2]).toBe(4);
      expect(porId[modB1]).toBe(1);
    });

    it('POR SISTEMA · el panel agrega sus módulos, y el panel lo decide el SERVIDOR', async () => {
      const filas = await prisma.hitEvent.groupBy({
        by: ['targetSystemId'],
        where: { targetSystemId: { not: null } },
        _count: { _all: true },
      });
      const porId = Object.fromEntries(filas.map((f) => [f.targetSystemId, f._count._all]));
      expect(porId[sisA]).toBe(9);
      expect(porId[sisB]).toBe(1);
    });

    it('POR DIANA · cada diana recibe exactamente los suyos', async () => {
      const filas = await prisma.hitEvent.groupBy({
        by: ['targetId'],
        where: { targetId: { not: null } },
        _count: { _all: true },
      });
      const porId = Object.fromEntries(filas.map((f) => [f.targetId, f._count._all]));
      expect(porId[dianas[SLUG_MOD_A1][1]]).toBe(3);
      expect(porId[dianas[SLUG_MOD_A1][2]]).toBe(2);
      expect(porId[dianas[SLUG_MOD_A2][1]]).toBe(4);
      expect(porId[dianas[SLUG_MOD_B1][3]]).toBe(1);
      // Y las dianas que nadie tocó NO aparecen inventadas con un cero.
      expect(porId[dianas[SLUG_MOD_A1][3]]).toBeUndefined();
    });

    it('EL JOIN ATRAVIESA · desde el impacto se llega al módulo, al panel y a la diana', async () => {
      // Esto es lo que el defecto impedía: con las FK en NULL, `include`
      // devolvía null y no había forma de saber de qué diana era el impacto.
      const uno = await prisma.hitEvent.findFirst({
        where: { moduleSlug: SLUG_MOD_A2, targetIndex: 1 },
        include: {
          module: { select: { slug: true } },
          targetSystem: { select: { slug: true } },
          target: { select: { targetIndex: true, moduleId: true } },
        },
      });
      expect(uno!.module!.slug).toBe(SLUG_MOD_A2);
      expect(uno!.targetSystem!.slug).toBe(SLUG_SIS_A);
      expect(uno!.target!.targetIndex).toBe(1);
      // La diana enlazada pertenece AL MÓDULO enlazado, no a otro con el mismo índice.
      expect(uno!.target!.moduleId).toBe(modA2);
    });

    it('INVARIANTE · ninguna fila enlaza una diana que no sea de su módulo', async () => {
      const cruzados = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT COUNT(*)::bigint AS n
           FROM hit_events h
           JOIN targets t ON t.id = h.target_id
          WHERE h.module_id IS NOT NULL AND t.module_id <> h.module_id`,
      );
      expect(Number(cruzados[0].n)).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // B · el hallazgo: filas HISTÓRICAS con las FK en NULL
  // ═══════════════════════════════════════════════════════════════════════════
  describe('B · impactos heredados sin enlazar: qué hacen los recuentos con ellos', () => {
    // En producción hay SEIS de estos. Aquí se reproduce la forma exacta —una
    // fila con slugs correctos y las tres FK vacías— para MEDIR qué pasa. No se
    // toca ninguna fila real: rellenarlas sería inventar datos.
    const LEGADO = 6;

    beforeAll(async () => {
      for (let i = 0; i < LEGADO; i += 1) {
        const r = registro({ moduleSlug: SLUG_MOD_A1, targetIndex: 1 }) as unknown as Record<
          string,
          unknown
        >;
        // Se escribe SIN pasar por el repositorio: así nace como nacían antes
        // del arreglo, con module_id / target_system_id / target_id en NULL.
        await prisma.hitEvent.create({ data: r as never });
      }
    });

    it('HALLAZGO · el recuento POR SLUG y el recuento POR FK NO coinciden', async () => {
      const porSlug = await prisma.hitEvent.count({
        where: { moduleSlug: SLUG_MOD_A1 },
      });
      const porFk = await prisma.hitEvent.count({ where: { moduleId: modA1 } });

      expect(porSlug).toBe(5 + LEGADO);
      expect(porFk).toBe(5);
      // La diferencia es EXACTAMENTE el legado. Un panel que mezcle las dos
      // consultas enseñará dos cifras distintas del mismo módulo.
      expect(porSlug - porFk).toBe(LEGADO);
    });

    it('los huérfanos son CONTABLES: se pueden enumerar sin tocarlos', async () => {
      const huerfanos = await prisma.hitEvent.count({
        where: { moduleId: null, targetSystemId: null, targetId: null },
      });
      expect(huerfanos).toBe(LEGADO);
      // Y siguen siendo impactos válidos: el dato físico no se ha perdido.
      const muestra = await prisma.hitEvent.findFirst({ where: { moduleId: null } });
      expect(muestra!.moduleSlug).toBe(SLUG_MOD_A1);
      expect(muestra!.classification).toBe('valid_hit');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // C · RESULTS_BACKEND · precisión, resultado y marcador sobre datos reales
  // ═══════════════════════════════════════════════════════════════════════════
  describe('C · precisión, resultado de ronda y marcador contra PostgreSQL real', () => {
    beforeAll(async () => {
      const repo = new PrismaHitRepository(prisma as never);
      // 4 válidos y 2 no válidos, TODOS de esta ronda y este participante.
      for (let i = 0; i < 4; i += 1) {
        await repo.insertIfAbsent(
          registro({
            gameId,
            roundId,
            participantId: participanteId,
            targetIndex: ((i % 3) + 1),
            classification: 'valid_hit',
            countsForScore: true,
          }),
        );
      }
      for (let i = 0; i < 2; i += 1) {
        await repo.insertIfAbsent(
          registro({
            gameId,
            roundId,
            participantId: participanteId,
            targetIndex: 2,
            // Detectado pero NO puntuable: cuenta como disparo, no como acierto.
            classification: 'hit_on_safe',
            countsForScore: false,
          }),
        );
      }
      await prisma.shotCount.create({
        data: {
          participantId: participanteId,
          initialAmmo: 10,
          remainingAmmo: 2,
          remainingKnown: true,
        },
      });
    });

    it('PRECISIÓN · los recuentos salen de los impactos REALMENTE persistidos', async () => {
      const accuracy = new AccuracyService(prisma as never);
      const r = await accuracy.forParticipant(roundId, participanteId);
      expect(r.detectedHits).toBe(6);
      expect(r.validHits).toBe(4);
      expect(r.invalidHits).toBe(2);
      expect(r.shotsFired).toBe(8); // 10 - 2
      expect(r.accuracyStatus).toBe('computed');
      // La precisión se expresa en PORCENTAJE, no en fracción: 4 válidos de 8
      // disparos = 50. Queda escrito aquí porque la unidad la consume el panel
      // y confundirla es la diferencia entre «50 %» y «5000 %».
      expect(r.accuracyValid).toBeCloseTo(50, 5);
      expect(r.accuracyTotal).toBeCloseTo(75, 5); // 6 detectados de 8
    });

    it('RESULTADO · se PERSISTE la fila de la ronda, y es idempotente', async () => {
      const accuracy = new AccuracyService(prisma as never);
      const primero = await accuracy.persistResult(roundId, participanteId);
      const segundo = await accuracy.persistResult(roundId, participanteId);
      expect(segundo.id).toBe(primero.id); // upsert, no fila nueva
      expect(segundo.validHits).toBe(4);
      expect(segundo.score).toBe(4);
      expect(segundo.firstHitUs).not.toBeNull();

      const filas = await prisma.result.count({ where: { roundId, participantId: participanteId } });
      expect(filas).toBe(1);
    });

    it('ESTADÍSTICA DE RONDA · agrupa por módulo y diana y cuadra con la base', async () => {
      const stats = new StatisticsService(prisma as never);
      const s = await stats.forRound(roundId);
      expect(s.round_id).toBe(roundId);
      expect(s.detectedHits).toBe(6);
      expect(s.validHits).toBe(4);
      expect(s.invalidHits).toBe(2);
      const enBase = await prisma.hitEvent.count({ where: { roundId } });
      expect(s.detectedHits).toBe(enBase);

      // DECISIÓN MEDIDA: `hitsPerTarget` se agrupa por `moduleSlug#targetIndex`
      // y NO por las claves ajenas. Es correcto para lo que hace —es una
      // etiqueta legible de una sola ronda, y el slug es el dato crudo que
      // mandó el dispositivo—, pero se deja escrito que NO es un recuento por
      // entidad: si un módulo se renombra, las rondas viejas no lo siguen.
      const porDiana = s.hitsPerTarget;
      const total = Object.values(porDiana).reduce((a, b) => a + b, 0);
      expect(total).toBe(4); // sólo los válidos
      expect(Object.keys(porDiana).every((k) => k.startsWith(`${SLUG_MOD_A1}#`))).toBe(true);
    });

    it('HISTÓRICO DEL JUGADOR · se apoya en los resultados persistidos', async () => {
      const stats = new StatisticsService(prisma as never);
      const h = await stats.forPlayer(playerId);
      expect(h.rounds).toBe(1);
      expect(h.total_valid_hits).toBe(4);
      expect(h.average_accuracy_valid).toBeCloseTo(50, 5);
      expect(h.rounds_without_accuracy).toBe(0);
    });

    it('MARCADOR · el panel ve el ranking y la rejilla de dianas', async () => {
      const board = new ScoreboardService(prisma as never);
      const m = (await board.forGame(gameId)) as {
        totals: { detected: number; valid: number; invalid: number };
        ranking: Array<{ participantId: string; validHits?: number }>;
        board: Array<{ moduleSlug: string; targets: Array<{ targetIndex: number; hits: number }> }>;
      };
      expect(m.totals.detected).toBe(6);
      expect(m.totals.valid).toBe(4);
      expect(m.totals.invalid).toBe(2);
      expect(m.ranking.map((e) => e.participantId)).toContain(participanteId);

      // La rejilla cubre los módulos del panel de la partida.
      const slugs = m.board.map((b) => b.moduleSlug).sort();
      expect(slugs).toEqual([SLUG_MOD_A1, SLUG_MOD_A2]);
      const total = m.board.reduce(
        (acc, b) => acc + b.targets.reduce((a, t) => a + t.hits, 0),
        0,
      );
      expect(total).toBe(6);
    });

    it('HALLAZGO · la rejilla casa por SLUG: un impacto sin enlazar se cuenta y no se dibuja', async () => {
      // Un impacto de esta ronda cuyo módulo no existe: entra en `totals`
      // (es un estímulo físico real) pero ninguna celda de la rejilla lo
      // recoge, porque la rejilla se construye desde los módulos del panel.
      const repo = new PrismaHitRepository(prisma as never);
      const r = await repo.insertIfAbsent(
        registro({ gameId, roundId, participantId: participanteId, moduleSlug: SLUG_HUERFANO }),
      );
      expect(r.unresolved).toBeDefined();

      const board = new ScoreboardService(prisma as never);
      const m = (await board.forGame(gameId)) as {
        totals: { detected: number };
        board: Array<{ targets: Array<{ hits: number }> }>;
      };
      expect(m.totals.detected).toBe(7);
      const enRejilla = m.board.reduce(
        (acc, b) => acc + b.targets.reduce((a, t) => a + t.hits, 0),
        0,
      );
      // 7 contados, 6 dibujados: la diferencia es el impacto sin enlazar.
      expect(enRejilla).toBe(6);
      expect(m.totals.detected - enRejilla).toBe(1);

      // Se deja la ronda como estaba para no arrastrar el desfase.
      await prisma.hitEvent.delete({ where: { id: r.id } });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // D · INGEST_HARDENING · ningún camino de fallo pasa en silencio
  // ═══════════════════════════════════════════════════════════════════════════
  describe('D · la ingesta deja rastro de todo lo que no puede resolver', () => {
    async function incidencias(kind: string, eventId?: string) {
      return prisma.incident.findMany({
        where: { kind, eventId: eventId ?? undefined },
        orderBy: { occurredAt: 'desc' },
      });
    }

    it('hit_unresolved_entity · MÓDULO DESCONOCIDO · se guarda, sin enlazar, y se DICE', async () => {
      const ingest = nuevaIngesta();
      const p = payloadHit({ module_id: SLUG_HUERFANO, system_id: SLUG_SIS_A });
      const res = await ingest.handleMessage(
        topicoHit(SLUG_HUERFANO),
        Buffer.from(JSON.stringify(p)),
      );
      expect(res.status).toBe('accepted');

      const fila = await prisma.hitEvent.findUnique({ where: { eventId: p.event_id as string } });
      expect(fila).not.toBeNull();
      expect(fila!.moduleId).toBeNull();
      expect(fila!.targetSystemId).toBeNull();
      expect(fila!.targetId).toBeNull();

      const inc = await incidencias('hit_unresolved_entity', p.event_id as string);
      expect(inc).toHaveLength(1);
      expect(inc[0].severity).toBe('warning');
      expect(inc[0].moduleSlug).toBe(SLUG_HUERFANO);
      expect(inc[0].message).toContain(SLUG_HUERFANO);
      expect((inc[0].detail as { unresolved: string[] }).unresolved.join(' ')).toContain(
        SLUG_HUERFANO,
      );
    });

    it('hit_unresolved_entity · DIANA FUERA DEL MÓDULO · módulo y panel sí, diana no', async () => {
      const ingest = nuevaIngesta();
      const p = payloadHit({ target_index: 9 }); // el módulo sólo tiene 1..3
      const res = await ingest.handleMessage(
        topicoHit(SLUG_MOD_A1),
        Buffer.from(JSON.stringify(p)),
      );
      expect(res.status).toBe('accepted');

      const fila = await prisma.hitEvent.findUnique({ where: { eventId: p.event_id as string } });
      expect(fila!.moduleId).toBe(modA1);
      expect(fila!.targetSystemId).toBe(sisA);
      expect(fila!.targetId).toBeNull();

      const inc = await incidencias('hit_unresolved_entity', p.event_id as string);
      expect(inc).toHaveLength(1);
      expect(inc[0].message).toContain('diana 9');
      expect((inc[0].detail as { target_index: number }).target_index).toBe(9);
    });

    it('hit_unresolved_entity · SISTEMA DISCREPANTE · manda el servidor y queda escrito', async () => {
      const ingest = nuevaIngesta();
      // El módulo A1 está en el panel A; el mensaje dice que está en el B.
      const p = payloadHit({ system_id: SLUG_SIS_B });
      await ingest.handleMessage(topicoHit(SLUG_MOD_A1), Buffer.from(JSON.stringify(p)));

      const fila = await prisma.hitEvent.findUnique({ where: { eventId: p.event_id as string } });
      // El SLUG se conserva tal cual lo dijo el dispositivo (es el dato crudo)…
      expect(fila!.systemSlug).toBe(SLUG_SIS_B);
      // …pero la CLAVE AJENA es la del módulo. Si mandara el dispositivo, un
      // módulo podría atribuir sus impactos al panel del vecino.
      expect(fila!.targetSystemId).toBe(sisA);

      const inc = await incidencias('hit_unresolved_entity', p.event_id as string);
      expect(inc).toHaveLength(1);
      expect(inc[0].message).toContain('manda el servidor');
    });

    it('hit_unresolved_entity · un impacto ENLAZABLE no genera incidencia (control negativo)', async () => {
      const ingest = nuevaIngesta();
      const p = payloadHit();
      await ingest.handleMessage(topicoHit(SLUG_MOD_A1), Buffer.from(JSON.stringify(p)));
      const inc = await incidencias('hit_unresolved_entity', p.event_id as string);
      expect(inc).toHaveLength(0);
      const fila = await prisma.hitEvent.findUnique({ where: { eventId: p.event_id as string } });
      expect([fila!.moduleId, fila!.targetSystemId, fila!.targetId]).not.toContain(null);
    });

    it('ingest_schema_violation · payload fuera de contrato · 5 campos de AJV y payload REDACTADO', async () => {
      const ingest = nuevaIngesta();
      const malo = payloadHit({
        classification: 'clasificacion-que-no-existe',
        // Y un campo sensible, para comprobar que NO se copia a la incidencia.
        mqtt_password: 'secreto-que-no-debe-quedar-escrito',
      });
      const res = await ingest.handleMessage(
        topicoHit(SLUG_MOD_A1),
        Buffer.from(JSON.stringify(malo)),
      );
      expect(res.status).toBe('rejected');
      expect(res.code).toBe('schema_violation');

      const inc = await prisma.incident.findFirst({
        where: { kind: 'ingest_schema_violation' },
        orderBy: { occurredAt: 'desc' },
      });
      expect(inc).not.toBeNull();
      expect(inc!.moduleSlug).toBe(SLUG_MOD_A1);

      const detalle = inc!.detail as {
        errors: string[];
        error_details: Array<Record<string, unknown>>;
        rejection_code: string;
        payload: Record<string, unknown>;
      };
      expect(detalle.rejection_code).toBe('schema_violation');
      expect(detalle.error_details.length).toBeGreaterThan(0);
      // Los CINCO campos de AJV, no una frase suelta.
      for (const campo of ['instancePath', 'schemaPath', 'keyword', 'message', 'params']) {
        expect(Object.keys(detalle.error_details[0])).toContain(campo);
      }
      // El payload viaja para poder diagnosticar…
      expect(detalle.payload.event_id).toBe(malo.event_id);
      // …pero el campo sensible NO.
      expect(detalle.payload.mqtt_password).toBe('[redactado]');
      expect(JSON.stringify(detalle)).not.toContain('secreto-que-no-debe-quedar-escrito');

      // Y NADA se persistió como impacto.
      const fila = await prisma.hitEvent.findUnique({ where: { eventId: malo.event_id as string } });
      expect(fila).toBeNull();
    });

    it('ingest_schema_violation · el mensaje ilegible tampoco pasa en silencio', async () => {
      const ingest = nuevaIngesta();
      const antes = await prisma.incident.count({ where: { kind: { startsWith: 'ingest_' } } });
      const res = await ingest.handleMessage(topicoHit(SLUG_MOD_A1), Buffer.from('{esto no es json'));
      expect(res.status).toBe('rejected');
      const despues = await prisma.incident.count({ where: { kind: { startsWith: 'ingest_' } } });
      expect(despues).toBe(antes + 1);
    });

    it('event_id DUPLICADO · lo corta el ÍNDICE ÚNICO de la base, no una caché', async () => {
      // Dos servicios DISTINTOS, sin estado compartido: si la idempotencia
      // viviera en memoria, el segundo no vería nada y habría dos filas. Esto
      // es exactamente lo que exige ADR-0003 y lo que un doble no puede probar.
      const a = nuevaIngesta();
      const b = nuevaIngesta();
      const p = payloadHit();
      const raw = Buffer.from(JSON.stringify(p));

      const primero = await a.handleMessage(topicoHit(SLUG_MOD_A1), raw);
      const segundo = await b.handleMessage(topicoHit(SLUG_MOD_A1), raw);

      expect(primero.status).toBe('accepted');
      expect(segundo.status).toBe('duplicate');
      expect(segundo.duplicateBy).toBe('event_id');
      expect(segundo.id).toBe(primero.id);

      const filas = await prisma.hitEvent.count({ where: { eventId: p.event_id as string } });
      expect(filas).toBe(1);
      // Y es métrica, no error.
      expect(b.getMetrics().rejected).toBe(0);
      expect(b.getMetrics().duplicates).toBe(1);
    });

    it('DUPLICADO POR (módulo, boot, secuencia) · aunque cambie el event_id', async () => {
      const ingest = nuevaIngesta();
      const p1 = payloadHit();
      await ingest.handleMessage(topicoHit(SLUG_MOD_A1), Buffer.from(JSON.stringify(p1)));
      // Mismo módulo, mismo boot y misma secuencia local; otro event_id.
      const p2 = payloadHit({
        local_sequence: p1.local_sequence,
        device: p1.device,
      });
      const res = await ingest.handleMessage(topicoHit(SLUG_MOD_A1), Buffer.from(JSON.stringify(p2)));
      expect(res.status).toBe('duplicate');
      expect(res.duplicateBy).toBe('module_boot_sequence');
      const fila = await prisma.hitEvent.findUnique({ where: { eventId: p2.event_id as string } });
      expect(fila).toBeNull();
    });

    it('SUPLANTACIÓN · el módulo del payload no puede diferir del del tópico', async () => {
      const ingest = nuevaIngesta();
      // A2 publica en su propio tópico, pero el payload dice que es A1.
      const p = payloadHit({ module_id: SLUG_MOD_A1 });
      const res = await ingest.handleMessage(
        topicoHit(SLUG_MOD_A2),
        Buffer.from(JSON.stringify(p)),
      );
      expect(res.status).toBe('rejected');
      expect(res.code).toBe('schema_violation');
      expect(res.message).toContain(SLUG_MOD_A1);
      expect(res.message).toContain(SLUG_MOD_A2);

      // NADA se ha escrito: ni a nombre de A1, ni a nombre de A2.
      const fila = await prisma.hitEvent.findUnique({ where: { eventId: p.event_id as string } });
      expect(fila).toBeNull();

      // Y la suplantación queda registrada como incidencia, atribuida al
      // módulo que DE VERDAD publicó (el del tópico), no al suplantado.
      const inc = await prisma.incident.findFirst({
        where: { kind: 'ingest_schema_violation', moduleSlug: SLUG_MOD_A2 },
        orderBy: { occurredAt: 'desc' },
      });
      expect(inc).not.toBeNull();
      expect(inc!.message).toContain('no coincide con el del tópico');
    });

    it('presence_unknown_module · una presencia de un módulo no dado de alta se registra', async () => {
      const ingest = nuevaIngesta({ presencia: true });
      const p = {
        schema_version: 1,
        module_id: SLUG_HUERFANO,
        online: true,
        reason: 'connect',
      };
      const res = await ingest.handleMessage(
        `targets/v1/module/${SLUG_HUERFANO}/presence`,
        Buffer.from(JSON.stringify(p)),
      );
      expect(res.status).toBe('accepted');

      const inc = await prisma.incident.findFirst({
        where: { kind: 'presence_unknown_module' },
        orderBy: { occurredAt: 'desc' },
      });
      expect(inc).not.toBeNull();
      expect(inc!.severity).toBe('warning');
      expect(inc!.message).toContain(SLUG_HUERFANO);
      expect(inc!.source).toBe('resilience');
      // Y NO se ha fabricado el módulo: la ingesta no da de alta nada.
      const mod = await prisma.module.findUnique({ where: { slug: SLUG_HUERFANO } });
      expect(mod).toBeNull();
    });

    it('presence · un módulo REAL sí cambia su presencia (control positivo)', async () => {
      const ingest = nuevaIngesta({ presencia: true });
      await ingest.handleMessage(
        `targets/v1/module/${SLUG_MOD_B1}/presence`,
        Buffer.from(
          JSON.stringify({
            schema_version: 1,
            module_id: SLUG_MOD_B1,
            online: true,
            reason: 'connect',
          }),
        ),
      );
      const mod = await prisma.module.findUnique({ where: { slug: SLUG_MOD_B1 } });
      expect(mod!.online).toBe(true);
      expect(mod!.lastSeenAt).not.toBeNull();
    });

    it('MÉTRICAS · cada camino cuenta en su casilla y ninguno se pierde', async () => {
      const ingest = nuevaIngesta();
      const bueno = payloadHit();
      const raw = Buffer.from(JSON.stringify(bueno));
      await ingest.handleMessage(topicoHit(SLUG_MOD_A1), raw); // accepted
      await ingest.handleMessage(topicoHit(SLUG_MOD_A1), raw); // duplicate
      await ingest.handleMessage(
        topicoHit(SLUG_MOD_A1),
        Buffer.from(JSON.stringify(payloadHit({ classification: 'no-existe' }))),
      ); // rejected
      await ingest.handleMessage('targets/v1/cualquier/cosa', Buffer.from('{}')); // ignored

      const m = ingest.getMetrics();
      expect(m.received).toBe(4);
      expect(m.accepted).toBe(1);
      expect(m.duplicates).toBe(1);
      expect(m.rejected).toBe(1);
      expect(m.ignored).toBe(1);
      expect(m.accepted + m.duplicates + m.rejected + m.ignored).toBe(m.received);
      expect(m.byRejectionCode.schema_violation).toBe(1);
    });
  });
});
