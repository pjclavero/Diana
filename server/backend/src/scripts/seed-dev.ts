/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  DATOS DE DESARROLLO · NO PRODUCTIVOS                                    ║
 * ║  Todo lo que crea este script lleva el prefijo `DEV-` o el marcador      ║
 * ║  `isSample: true`. NO ejecutar contra una instalación real: se niega a   ║
 * ║  arrancar si NODE_ENV=production o si no se pasa --force.                ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DEV_PREFIX = 'DEV-';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production' && !process.argv.includes('--force')) {
    throw new Error(
      'Semilla de desarrollo bloqueada en producción. Use --force sólo si sabe lo que hace.',
    );
  }

  const system = await prisma.targetSystem.upsert({
    where: { slug: 'system-dev' },
    update: {},
    create: {
      slug: 'system-dev',
      name: `${DEV_PREFIX}Sistema de pruebas`,
      description: 'DATOS DE DESARROLLO. No usar en producción.',
      modulesExpected: 2,
    },
  });

  for (const [index, slug] of ['module-dev-01', 'module-dev-02'].entries()) {
    const module = await prisma.module.upsert({
      where: { slug },
      update: {},
      create: {
        slug,
        targetSystemId: system.id,
        friendlyName: `${DEV_PREFIX}Módulo ${index + 1}`,
        role: index === 0 ? 'principal' : 'satellite',
        selector: index === 0 ? 'PRINCIPAL' : 'SATELITE',
        firmwareVersion: '0.1.0',
        hardwareRevision: 'protoA',
      },
    });

    await prisma.modulePosition.upsert({
      where: { moduleId: module.id },
      update: {},
      create: { moduleId: module.id, targetSystemId: system.id, x: index === 0 ? 0 : -1, y: 0, rotation: 0 },
    });

    for (let targetIndex = 1; targetIndex <= 9; targetIndex += 1) {
      await prisma.target.upsert({
        where: { moduleId_targetIndex: { moduleId: module.id, targetIndex } },
        update: {},
        create: { moduleId: module.id, targetIndex, label: `${DEV_PREFIX}D${targetIndex}` },
      });
    }
  }

  const team = await prisma.team.upsert({
    where: { name: `${DEV_PREFIX}Equipo de pruebas` },
    update: {},
    create: { name: `${DEV_PREFIX}Equipo de pruebas`, description: 'DATOS DE DESARROLLO' },
  });

  for (const name of ['Ana', 'Bruno', 'Carla']) {
    await prisma.player.upsert({
      where: { licence: `${DEV_PREFIX}${name}` },
      update: {},
      create: {
        displayName: `${DEV_PREFIX}${name}`,
        licence: `${DEV_PREFIX}${name}`,
        teamId: team.id,
        notes: 'DATOS DE DESARROLLO. No corresponde a ninguna persona real.',
      },
    });
  }

  const randomMode = await prisma.gameMode.findUnique({ where: { key: 'random' } });
  if (randomMode) {
    await prisma.gamePreset.upsert({
      where: { name: `${DEV_PREFIX}Aleatorio rápido` },
      update: {},
      create: {
        name: `${DEV_PREFIX}Aleatorio rápido`,
        description: 'DATOS DE DESARROLLO',
        gameModeId: randomMode.id,
        isSample: true,
        config: { repetitions: 9, penalty_ms: 2000, seed: 20260720 },
      },
    });
  }

  process.stdout.write('Semilla de DESARROLLO aplicada. Todos los registros llevan el prefijo DEV-.\n');
}

void main()
  .catch((error) => {
    process.stderr.write(`${(error as Error).stack}\n`);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
