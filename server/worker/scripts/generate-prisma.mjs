#!/usr/bin/env node
/**
 * Genera el cliente Prisma DEL WORKER a partir del esquema del backend.
 *
 * DEFECTO MEDIDO QUE ESTO CORRIGE (no supuesto). El script anterior era
 * `prisma generate --schema ../backend/prisma/schema.prisma`. Prisma resuelve
 * el directorio de salida por defecto contra el `node_modules` MÁS CERCANO AL
 * ESQUEMA, que es `server/backend/node_modules`. Es decir: ejecutado desde
 * `server/worker`, escribía el cliente en el backend y dejaba al worker con el
 * *stub* de 110 líneas que instala el `postinstall` de `@prisma/client`.
 *
 * Con ese stub, `npm run typecheck` del worker sale en VERDE sin comprobar
 * absolutamente nada de los modelos: se verificó compilando
 * `p.statistic.findFirst({ where: { campoInventado: 1 } })`, que pasa. La misma
 * familia de defecto que el resto de este carril — el artefacto que se
 * verifica no es el que se usa —, sólo que aquí el resultado es un typecheck
 * que no puede ponerse rojo.
 *
 * La corrección copia el esquema a `server/worker/prisma/` antes de generar,
 * que es EXACTAMENTE lo que ya hacía el Dockerfile (`COPY server/backend/prisma
 * ./prisma`) y por eso la imagen sí llevaba el cliente correcto mientras el
 * árbol de desarrollo no. Ahora imagen y repositorio hacen lo mismo.
 *
 * El esquema NO se edita aquí: es propiedad del backend y se copia tal cual.
 */
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const AQUI = dirname(fileURLToPath(import.meta.url));
const WORKER = resolve(AQUI, '..');
const ORIGEN = resolve(WORKER, '..', 'backend', 'prisma');
const DESTINO = join(WORKER, 'prisma');

rmSync(DESTINO, { recursive: true, force: true });
mkdirSync(DESTINO, { recursive: true });
cpSync(ORIGEN, DESTINO, { recursive: true });

execFileSync('npx', ['prisma', 'generate', '--schema', './prisma/schema.prisma'], {
  cwd: WORKER,
  stdio: 'inherit',
});
