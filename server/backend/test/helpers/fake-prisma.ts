/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Prisma falso EN MEMORIA para probar operaciones que tocan varias tablas a la
 * vez (borrados en cascada lógica, recálculos, idempotencia).
 *
 * Existe porque un `jest.fn()` por método demuestra sólo que «se llamó al
 * método»: no demuestra que el estado resultante sea el correcto, ni que un
 * recálculo posterior no resucite lo borrado. Aquí las filas viven de verdad,
 * así que se puede reiniciar y volver a calcular sobre el MISMO almacén.
 *
 * No pretende imitar a Prisma entero: sólo las formas de `where`/`orderBy` que
 * usa el código bajo prueba. Si aparece una forma no soportada, revienta con un
 * mensaje claro en vez de devolver un resultado silenciosamente falso.
 */

export interface FakeTables {
  players?: any[];
  games?: any[];
  rounds?: any[];
  participants?: any[];
  results?: any[];
  penalties?: any[];
  shotCounts?: any[];
  hitEvents?: any[];
  statistics?: any[];
  modules?: any[];
  viewPanels?: any[];
}

const RELATIONS: Record<string, { table: keyof FakeTables; foreignKey: string }> = {
  participant: { table: 'participants', foreignKey: 'participantId' },
  player: { table: 'players', foreignKey: 'playerId' },
  game: { table: 'games', foreignKey: 'gameId' },
  round: { table: 'rounds', foreignKey: 'roundId' },
};

function matchScalar(value: any, condition: any): boolean {
  if (condition === undefined) return true;
  if (condition !== null && typeof condition === 'object' && !(condition instanceof Date)) {
    if ('in' in condition) return (condition.in as any[]).includes(value);
    if ('not' in condition) return value !== condition.not;
    throw new Error(`fake-prisma: condición no soportada ${JSON.stringify(condition)}`);
  }
  return value === condition;
}

export class FakePrisma {
  readonly db: Required<FakeTables>;

  constructor(tables: FakeTables = {}) {
    this.db = {
      players: tables.players ?? [],
      games: tables.games ?? [],
      rounds: tables.rounds ?? [],
      participants: tables.participants ?? [],
      results: tables.results ?? [],
      penalties: tables.penalties ?? [],
      shotCounts: tables.shotCounts ?? [],
      hitEvents: tables.hitEvents ?? [],
      statistics: tables.statistics ?? [],
      modules: tables.modules ?? [],
      viewPanels: tables.viewPanels ?? [],
    };
  }

  private matches(row: any, where: any): boolean {
    if (!where) return true;
    for (const [key, condition] of Object.entries(where)) {
      if (key === 'OR') {
        if (!(condition as any[]).some((sub) => this.matches(row, sub))) return false;
        continue;
      }
      if (key === 'AND') {
        if (!(condition as any[]).every((sub) => this.matches(row, sub))) return false;
        continue;
      }
      // Clave única compuesta de Prisma (`roundId_participantId: {…}`): se
      // resuelve como un AND de sus componentes.
      if (key.includes('_') && condition !== null && typeof condition === 'object' && !(key in row)) {
        if (!this.matches(row, condition)) return false;
        continue;
      }
      const relation = RELATIONS[key];
      if (relation && condition !== null && typeof condition === 'object') {
        const parent = this.db[relation.table].find((r: any) => r.id === row[relation.foreignKey]);
        if (!parent || !this.matches(parent, condition)) return false;
        continue;
      }
      if (!matchScalar(row[key], condition)) return false;
    }
    return true;
  }

  private sort(rows: any[], orderBy: any): any[] {
    if (!orderBy) return rows;
    const [key, direction] = Object.entries(orderBy)[0] as [string, 'asc' | 'desc'];
    return [...rows].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (av === bv) return 0;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      return (av < bv ? -1 : 1) * (direction === 'desc' ? -1 : 1);
    });
  }

  private hydrate(row: any, include: any): any {
    if (!row || !include) return row;
    const out = { ...row };
    for (const [key, spec] of Object.entries(include)) {
      if (spec === false) continue;
      const relation = RELATIONS[key];
      if (!relation) throw new Error(`fake-prisma: include no soportado «${key}»`);
      out[key] = this.db[relation.table].find((r: any) => r.id === row[relation.foreignKey]) ?? null;
    }
    return out;
  }

  private table(name: keyof FakeTables) {
    const rows = () => this.db[name] as any[];
    const find = (args: any = {}) => {
      const filtered = rows().filter((r) => this.matches(r, args.where));
      const sorted = this.sort(filtered, args.orderBy);
      return typeof args.take === 'number' ? sorted.slice(0, args.take) : sorted;
    };
    return {
      findMany: async (args: any = {}) => find(args).map((r) => this.hydrate(r, args.include)),
      findFirst: async (args: any = {}) => this.hydrate(find(args)[0] ?? null, args.include),
      findUnique: async (args: any = {}) => {
        const row = rows().find((r) => this.matches(r, args.where)) ?? null;
        return this.hydrate(row, args.include);
      },
      count: async (args: any = {}) => find(args).length,
      create: async (args: any) => {
        rows().push({ ...args.data });
        return { ...args.data };
      },
      deleteMany: async (args: any = {}) => {
        const survivors = rows().filter((r) => !this.matches(r, args.where));
        const removed = rows().length - survivors.length;
        this.db[name] = survivors as any;
        return { count: removed };
      },
      updateMany: async (args: any) => {
        const affected = find({ where: args.where });
        for (const row of affected) Object.assign(row, args.data);
        return { count: affected.length };
      },
      upsert: async (args: any) => {
        const existing = rows().find((r) => this.matches(r, args.where));
        if (existing) {
          Object.assign(existing, args.update);
          return existing;
        }
        const created = { id: `${String(name)}-${rows().length + 1}`, ...args.create };
        rows().push(created);
        return created;
      },
      aggregate: async (args: any) => {
        const matched = find({ where: args.where });
        const out: any = {};
        if (args._sum) {
          out._sum = {};
          for (const key of Object.keys(args._sum)) {
            out._sum[key] = matched.reduce((acc, r) => acc + (r[key] ?? 0), 0);
          }
        }
        if (args._count) out._count = { _all: matched.length };
        return out;
      },
      groupBy: async (args: any) => {
        const matched = find({ where: args.where });
        const key = args.by[0];
        const buckets = new Map<any, number>();
        for (const row of matched) buckets.set(row[key], (buckets.get(row[key]) ?? 0) + 1);
        return [...buckets.entries()].map(([value, count]) => ({
          [key]: value,
          _count: { _all: count },
        }));
      },
    };
  }

  // Nombres tal y como los usa el cliente de Prisma.
  get player() { return this.table('players'); }
  get game() { return this.table('games'); }
  get round() { return this.table('rounds'); }
  get participant() { return this.table('participants'); }
  get result() { return this.table('results'); }
  get penalty() { return this.table('penalties'); }
  get shotCount() { return this.table('shotCounts'); }
  get hitEvent() { return this.table('hitEvents'); }
  get statistic() { return this.table('statistics'); }
  get module() { return this.table('modules'); }
  get viewPanel() { return this.table('viewPanels'); }

  /** Transacción sin aislamiento: basta para comprobar el efecto conjunto. */
  async $transaction<T>(callback: (tx: FakePrisma) => Promise<T>): Promise<T> {
    return callback(this);
  }
}
