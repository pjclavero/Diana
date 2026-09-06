/**
 * Diana · E2E-1 GAME — topología fija del escenario.
 *
 * Se ejecuta DENTRO de la imagen real del backend (`node /app/seed-fixture.js`),
 * de modo que usa el cliente Prisma generado del esquema real: si el esquema
 * cambia y estos campos dejan de existir, esto revienta en vez de mentir.
 *
 * NO es un mock del dominio: son las filas que en un despliegue de verdad deja
 * el aprovisionamiento (paneles y módulos dados de alta). El escenario no puede
 * inventarlas por MQTT porque la ingesta no crea módulos ni paneles.
 *
 * Tres paneles, a propósito:
 *   e2e-panel-a  módulo module-01  → panel del jugador 1 (camino feliz)
 *   e2e-panel-b  módulo module-02  → panel del jugador 2
 *   e2e-panel-c  módulo module-09  → panel de NADIE (control negativo:
 *                                    `attributeHit` no puede atribuir el
 *                                    impacto, domain/hits/attribution.ts)
 *
 * Los slugs son module-01/02/09 y no otros PORQUE la ACL real del repo
 * (infrastructure/mosquitto/acl) sólo autoriza a escribir en
 * `targets/v1/module/<id>/hit` a los usuarios module-01..module-09, y el
 * usuario MQTT de un módulo es exactamente su module_id.
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const PANELS = [
  { id: '00000000-0000-4000-8000-00000000e2a1', slug: 'e2e-panel-a', name: 'E2E panel A' },
  { id: '00000000-0000-4000-8000-00000000e2a2', slug: 'e2e-panel-b', name: 'E2E panel B' },
  { id: '00000000-0000-4000-8000-00000000e2a3', slug: 'e2e-panel-c', name: 'E2E panel C' },
];

const MODULES = [
  { id: '00000000-0000-4000-8000-00000000e2b1', slug: 'module-01', panel: 0 },
  { id: '00000000-0000-4000-8000-00000000e2b2', slug: 'module-02', panel: 1 },
  { id: '00000000-0000-4000-8000-00000000e2b3', slug: 'module-09', panel: 2 },
];

async function main() {
  for (const panel of PANELS) {
    await prisma.targetSystem.upsert({
      where: { slug: panel.slug },
      update: { id: undefined, name: panel.name },
      create: { id: panel.id, slug: panel.slug, name: panel.name, modulesExpected: 1 },
    });
  }

  for (const mod of MODULES) {
    const panelId = PANELS[mod.panel].id;
    const created = await prisma.module.upsert({
      where: { slug: mod.slug },
      update: { targetSystemId: panelId, online: true, role: 'satellite', state: 'ready' },
      create: {
        id: mod.id,
        slug: mod.slug,
        targetSystemId: panelId,
        friendlyName: `E2E ${mod.slug}`,
        online: true,
        role: 'satellite',
        state: 'ready',
      },
    });

    // Posición en la matriz del panel: el motor y el marcador la usan para
    // dibujar la rejilla. Cada módulo va solo en su panel, así que (0,0).
    await prisma.modulePosition.upsert({
      where: { moduleId: created.id },
      update: { targetSystemId: panelId, x: 0, y: 0, rotation: 0 },
      create: { moduleId: created.id, targetSystemId: panelId, x: 0, y: 0, rotation: 0 },
    });

    // Las nueve dianas del módulo (dosier 6.2).
    for (let targetIndex = 1; targetIndex <= 9; targetIndex += 1) {
      await prisma.target.upsert({
        where: { moduleId_targetIndex: { moduleId: created.id, targetIndex } },
        update: {},
        create: { moduleId: created.id, targetIndex, label: `${mod.slug}-D${targetIndex}` },
      });
    }
  }

  process.stdout.write(
    `Topología E2E sembrada: ${PANELS.map((p) => p.slug).join(', ')} · ` +
      `${MODULES.map((m) => m.slug).join(', ')}\n`,
  );
}

void main()
  .catch((error) => {
    process.stderr.write(`${error.stack}\n`);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
