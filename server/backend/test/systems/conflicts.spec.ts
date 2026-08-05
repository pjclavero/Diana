import { detectSystemConflicts, type ConflictModuleInput } from '../../src/domain/systems/conflicts';

function mod(over: Partial<ConflictModuleInput> = {}): ConflictModuleInput {
  return {
    slug: 'mod-a',
    role: 'satellite',
    online: true,
    position: null,
    ...over,
  };
}

describe('detectSystemConflicts (dosier 11/12 · dos módulos principales)', () => {
  it('sin módulos: ningún conflicto', () => {
    const report = detectSystemConflicts([]);
    expect(report.conflicts).toEqual([]);
  });

  it('un único principal en línea: sin conflicto', () => {
    const report = detectSystemConflicts([
      mod({ slug: 'a', role: 'principal', online: true }),
      mod({ slug: 'b', role: 'satellite', online: true }),
      mod({ slug: 'c', role: 'auto', online: true }),
    ]);
    expect(report.conflicts).toEqual([]);
  });

  it('dos módulos EN LÍNEA declaran principal: dual_principal, con evidencia de los slugs', () => {
    const report = detectSystemConflicts([
      mod({ slug: 'b', role: 'principal', online: true }),
      mod({ slug: 'a', role: 'principal', online: true }),
      mod({ slug: 'c', role: 'satellite', online: true }),
    ]);
    expect(report.conflicts).toEqual(['dual_principal']);
    expect(report.detail.dual_principal).toEqual(['a', 'b']);
  });

  it('dos módulos declaran principal pero uno está APAGADO: no hay conflicto ahora mismo', () => {
    const report = detectSystemConflicts([
      mod({ slug: 'a', role: 'principal', online: true }),
      mod({ slug: 'b', role: 'principal', online: false }),
    ]);
    expect(report.conflicts).toEqual([]);
  });

  it('tres principales en línea: los tres constan como evidencia', () => {
    const report = detectSystemConflicts([
      mod({ slug: 'a', role: 'principal', online: true }),
      mod({ slug: 'b', role: 'principal', online: true }),
      mod({ slug: 'c', role: 'principal', online: true }),
    ]);
    expect(report.conflicts).toEqual(['dual_principal']);
    expect(report.detail.dual_principal).toEqual(['a', 'b', 'c']);
  });

  it('módulos sin rol declarado (null) no cuentan como principal', () => {
    const report = detectSystemConflicts([
      mod({ slug: 'a', role: null, online: true }),
      mod({ slug: 'b', role: null, online: true }),
    ]);
    expect(report.conflicts).toEqual([]);
  });

  it('dos módulos comparten la misma posición de la matriz: duplicate_position', () => {
    const report = detectSystemConflicts([
      mod({ slug: 'a', position: { x: 1, y: 1 } }),
      mod({ slug: 'b', position: { x: 1, y: 1 } }),
      mod({ slug: 'c', position: { x: 2, y: 1 } }),
    ]);
    expect(report.conflicts).toEqual(['duplicate_position']);
    expect(report.detail.duplicate_position).toEqual(['a', 'b']);
  });

  it('módulos sin posición asignada (null) no generan duplicate_position', () => {
    const report = detectSystemConflicts([mod({ position: null }), mod({ position: null })]);
    expect(report.conflicts).toEqual([]);
  });

  it('ambos conflictos pueden coexistir', () => {
    const report = detectSystemConflicts([
      mod({ slug: 'a', role: 'principal', online: true, position: { x: 0, y: 0 } }),
      mod({ slug: 'b', role: 'principal', online: true, position: { x: 0, y: 0 } }),
    ]);
    expect(report.conflicts.sort()).toEqual(['dual_principal', 'duplicate_position']);
  });
});
