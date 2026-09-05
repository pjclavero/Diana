# Evidencia de ejecución de suites (WP-11)

Revisión independiente de calidad. Todas las cifras de este documento salen de
ejecutar los comandos en `develop` (commit `HEAD` a 2026-07-21), no del STATUS.
Cada bloque reproduce lo que el proyecto declara verde y pega la salida real.

Entorno: `/home/ia02/Diana`, rama `develop`, sin demonio Docker, sin
`DATABASE_URL`, sin KiCad. Node 20.

## Resumen

| Suite | Comando | Declarado | Ejecutado | Veredicto |
|---|---|---|---|---|
| Contratos | `python3 contracts/validate.py` | 43/0 | 43 comprobaciones, 0 fallos, exit 0 | COINCIDE |
| Firmware (host) | `make -C firmware test` | 389/389 | TOTAL 389/389, 0 fallidas, `CONTRATO: conforme`, exit 0 | COINCIDE **en su fecha** · CADUCADO: hoy `TOTAL: 853` en `mp0/integration@ae69357` (medido 2026-09-05) |
| Simulador | `npm run test` (vitest) | 33/33 | 10 ficheros, 33 pasados, exit 0 | COINCIDE |
| Backend unit | `npm run test:unit` | 157 + 5 saltados | 157 pasados (unit); suite completa 157 pasados + 5 saltados / 162, exit 0 | COINCIDE |
| Frontend | build + typecheck + lint + unit | 30/30 | typecheck 0, build OK, lint 0, 30 pasados | COINCIDE (tras `npm ci`) |

Ninguna suite declarada verde salió roja. No hay fallos preexistentes ocultos.

## Contratos

```
$ python3 contracts/validate.py
contratos: 43 comprobaciones, 0 fallos
EXIT=0
```

Coincide con lo declarado (43/0).

## Firmware (host)

```
$ make -C firmware test
... (18 mensajes generados por el firmware comprobados)
... (12 enumerados conformes con el contrato)
 TOTAL: 389 comprobaciones, 389 correctas, 0 fallidas
CONTRATO: conforme
EXIT=0
```

Coincide con lo declarado (389/389). El STATUS mostraba 338/338 en la fila WP-04
(`CHANGES_REQUESTED`); en `develop` ya son 389/389: el STATUS de esa fila está
desactualizado por debajo, no por encima.

## Simulador

```
$ cd simulators && npm run test        # vitest run v2.1.9
 Test Files  10 passed (10)
      Tests  33 passed (33)
EXIT=0
```

Coincide con lo declarado (33/33). El STATUS mostraba 28/28 en la fila WP-05; en
`develop` son 33/33.

## Backend

```
$ cd server/backend && npx prisma generate
✔ Generated Prisma Client (v6.14.0)  (ok)

$ npm run test:unit                    # jest --testPathIgnorePatterns=integration
Test Suites: 9 passed, 9 total
Tests:       157 passed, 157 total
EXIT=0

$ npm test                             # suite completa, incluye integración
Test Suites: 2 skipped, 9 passed, 9 of 11 total
Tests:       5 skipped, 157 passed, 162 total
EXIT=0
```

Coincide con lo declarado (157 + 5). Verificado el motivo del salto: los 5
saltados son las dos suites de `test/integration/` (`idempotency.integration.spec.ts`,
`temporal.integration.spec.ts`). El salto es explícito y condicionado:

```ts
const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;
```

Se saltan por ausencia de `DATABASE_URL` (no hay PostgreSQL vivo), no por estar
rotas. El propio código avisa por consola y su `README.md` deja escrito "Un
salto no es un aprobado". Correcto: NO se contabilizan como fallo ni como
aprobado.

## Frontend

Los `node_modules` NO estaban presentes: hubo que ejecutar `npm ci` (128
paquetes, 0 vulnerabilidades) antes de poder correr nada. La línea base no es
reproducible sin ese paso previo.

```
$ cd server/frontend && npm run typecheck   # tsc -b --noEmit
EXIT=0
$ npm run build                             # tsc -b && vite build
✓ built in 253ms
EXIT=0
$ npm run lint                              # oxlint (sin salida = limpio)
EXIT=0
$ npm run test                              # vitest run v4.1.10
 Test Files  5 passed (5)
      Tests  30 passed (30)
EXIT=0
```

Coincide con lo declarado (30/30 unit + build/typecheck/lint limpios). Los E2E
de `server/frontend/e2e/` (18/18 que declara X-07) no se re-ejecutaron aquí; se
auditó en su lugar la capa E2E independiente de WP-07 (ver dictamen §3).
