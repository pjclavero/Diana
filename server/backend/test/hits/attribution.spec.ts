import { attributeHit } from '../../src/domain/hits/attribution';
import { PrismaHitAttributor } from '../../src/modules/hits/prisma-hit-attributor';

const ana = { id: 'p1', targetSystemId: 's1', slot: 1 };
const bea = { id: 'p2', targetSystemId: 's2', slot: 2 };

describe('Atribución de impactos (deuda declarada) · regla', () => {
  it('un único participante: el impacto es suyo, forzosamente', () => {
    const a = attributeHit({ moduleTargetSystemId: 's1', participants: [ana] });
    expect(a).toMatchObject({ participantId: 'p1', basis: 'sole_participant' });
  });

  it('un único participante SIN panel asignado también es atribuible', () => {
    const a = attributeHit({
      moduleTargetSystemId: null,
      participants: [{ ...ana, targetSystemId: null }],
    });
    expect(a.participantId).toBe('p1');
  });

  it('duelo con un panel por jugador: cada impacto va a su dueño', () => {
    expect(attributeHit({ moduleTargetSystemId: 's1', participants: [ana, bea] })).toMatchObject({
      participantId: 'p1',
      basis: 'panel',
    });
    expect(attributeHit({ moduleTargetSystemId: 's2', participants: [ana, bea] })).toMatchObject({
      participantId: 'p2',
      basis: 'panel',
    });
  });

  it('varios jugadores en el MISMO panel: no se puede saber quién disparó', () => {
    const a = attributeHit({
      moduleTargetSystemId: 's1',
      participants: [ana, { ...bea, targetSystemId: 's1' }],
    });
    expect(a.participantId).toBeNull();
    expect(a.basis).toBe('unknown');
    expect(a.reason).toMatch(/comparten ese panel/);
  });

  it('el módulo no está en ningún panel: sin atribuir', () => {
    const a = attributeHit({ moduleTargetSystemId: null, participants: [ana, bea] });
    expect(a.participantId).toBeNull();
    expect(a.reason).toMatch(/no está asignado a ningún panel/);
  });

  it('nadie juega en el panel del módulo: sin atribuir', () => {
    const a = attributeHit({ moduleTargetSystemId: 's9', participants: [ana, bea] });
    expect(a.participantId).toBeNull();
    expect(a.reason).toMatch(/Ningún participante/);
  });

  it('ronda sin participantes: sin atribuir', () => {
    expect(attributeHit({ moduleTargetSystemId: 's1', participants: [] }).participantId).toBeNull();
  });
});

function buildPrisma(over: any = {}) {
  return {
    module: {
      findUnique: jest.fn().mockResolvedValue({ targetSystemId: 's1' }),
      ...over.module,
    },
    participant: {
      findMany: jest.fn().mockResolvedValue([ana, bea]),
      ...over.participant,
    },
  } as any;
}

describe('Atribución de impactos · lectura del estado real', () => {
  it('un impacto fuera de partida no se atribuye y no consulta nada', async () => {
    const prisma = buildPrisma();
    const a = await new PrismaHitAttributor(prisma).resolve({
      gameId: null,
      roundId: null,
      moduleSlug: 'mod-a',
    });
    expect(a.participantId).toBeNull();
    expect(prisma.participant.findMany).not.toHaveBeenCalled();
  });

  it('usa el panel del módulo que detectó el impacto', async () => {
    const prisma = buildPrisma();
    const a = await new PrismaHitAttributor(prisma).resolve({
      gameId: 'g1',
      roundId: 'r1',
      moduleSlug: 'mod-a',
    });
    expect(prisma.module.findUnique.mock.calls[0][0].where).toEqual({ slug: 'mod-a' });
    expect(a.participantId).toBe('p1');
  });

  it('si la consulta falla, el impacto se guarda SIN atribuir (no se pierde)', async () => {
    const prisma = buildPrisma({
      participant: { findMany: jest.fn().mockRejectedValue(new Error('BD caída')) },
    });
    const a = await new PrismaHitAttributor(prisma).resolve({
      gameId: 'g1',
      roundId: 'r1',
      moduleSlug: 'mod-a',
    });
    expect(a.participantId).toBeNull();
    expect(a.reason).toMatch(/sin atribuir/);
  });

  it('un módulo desconocido no rompe: queda sin atribuir', async () => {
    const prisma = buildPrisma({ module: { findUnique: jest.fn().mockResolvedValue(null) } });
    const a = await new PrismaHitAttributor(prisma).resolve({
      gameId: 'g1',
      roundId: 'r1',
      moduleSlug: 'mod-x',
    });
    expect(a.participantId).toBeNull();
  });
});
