/**
 * Semilla de REFERENCIA (apta para producción).
 *
 * Sólo inserta catálogo imprescindible: los cinco roles del dosier 23.2 y los
 * cuatro modos de juego de la Ola 1. No crea usuarios, jugadores ni partidas,
 * y no contiene ninguna credencial: la cuenta inicial la crea el backend en el
 * arranque (ver server/README.md).
 */
import { PrismaClient } from '@prisma/client';
import { createDefaultRegistry } from '../domain/game/registry';
import { ALL_ROLES, ROLE_DESCRIPTIONS, ROLE_PERMISSIONS } from '../domain/rbac/permissions';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  for (const name of ALL_ROLES) {
    await prisma.role.upsert({
      where: { name },
      update: { permissions: ROLE_PERMISSIONS[name], description: ROLE_DESCRIPTIONS[name] },
      create: {
        name,
        description: ROLE_DESCRIPTIONS[name],
        permissions: ROLE_PERMISSIONS[name],
        builtin: true,
      },
    });
  }
  process.stdout.write(`Roles asegurados: ${ALL_ROLES.join(', ')}\n`);

  for (const strategy of createDefaultRegistry().list()) {
    await prisma.gameMode.upsert({
      where: { key: strategy.key },
      update: { name: strategy.displayName, description: strategy.description },
      create: {
        key: strategy.key,
        name: strategy.displayName,
        description: strategy.description,
        enabled: true,
      },
    });
  }
  process.stdout.write('Modos de juego asegurados: random, sequence, all_against_clock, reaction\n');
}

void main()
  .catch((error) => {
    process.stderr.write(`${(error as Error).stack}\n`);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
