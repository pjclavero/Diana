# Servidor Diana · backend, base de datos y motor de partidas (WP-02)

> Nota de propiedad: `docs/coordination/OWNERSHIP.md` reserva este fichero al
> organizador. Se redacta aquí porque el encargo de WP-02 lo pide de forma
> explícita como entregable. Si hay conflicto, manda el organizador.

## Qué hay aquí

```
server/
├── backend/     API REST + WebSocket + ingesta MQTT + motor de partidas (NestJS)
├── worker/      proceso separado de tareas diferidas (estadísticas, retención)
├── database/    documentación del esquema y utilidades SQL de operación
└── frontend/    WP-03 (no es de este paquete)
```

## Arquitectura

**Monolito modular** (ADR-0001), no microservicios: un proceso, módulos con
frontera explícita. Tres capas:

```
   MQTT (Mosquitto)                       HTTP / WebSocket
          │                                       │
   ┌──────▼───────────────┐              ┌────────▼─────────┐
   │ modules/mqtt         │              │ modules/*        │  controladores
   │  · MqttService       │              │  · REST + guards │  y servicios
   │  · IngestService     │              └────────┬─────────┘
   └──────┬───────────────┘                       │
          │      ┌────────────────────────────────▼──────────────┐
          └─────►│ domain/   LÓGICA PURA, SIN E/S                │
                 │  · game/       motor y estrategias de modo    │
                 │  · accuracy/   munición y precisión           │
                 │  · hits/       traducción de payloads, T1..T4 │
                 │  · statistics/ métricas de ronda              │
                 │  · rbac/       roles y permisos               │
                 └────────────────┬──────────────────────────────┘
                                  │ puertos (interfaces)
                 ┌────────────────▼──────────────────────────────┐
                 │ Prisma · PostgreSQL                           │
                 └───────────────────────────────────────────────┘
```

`domain/` no importa NestJS, ni Prisma, ni MQTT. Esa es la razón de que todas
las reglas críticas (idempotencia, tiempos, precisión, modos de juego) puedan
probarse sin base de datos ni broker.

### Módulos (encargo §9 / dosier 20.1)

`auth`, `users`, `roles`, `players`, `teams`, `systems`, `modules`, `targets`,
`topology`, `calibration`, `game-modes`, `presets`, `games`, `rounds`,
`participants`, `hits`, `penalties`, `ammo`, `accuracy`, `statistics`, `mqtt`,
`websocket`, `firmware`, `maintenance`, `audit`, `exports` (más `health`).

Los módulos de datos de referencia usan un CRUD genérico
(`common/crud/`) con lista blanca de campos escribibles; los que tienen reglas
propias (`hits`, `games`, `ammo`, `accuracy`, `mqtt`) tienen servicio propio.

## Decisiones tomadas

### 1. El backend no es la autoridad temporal (ADR-0002)

Es el requisito más delicado del proyecto y condiciona el diseño entero.

- `hit_events` guarda **cuatro** marcas en columnas separadas: T1 (`device_*`,
  del ESP32), T2 (`coordinator_*`, del módulo principal), T3 (`received_at`) y
  T4 (`persisted_at`).
- El mapeador `domain/hits/hit-record.ts` **copia** T1 y T2 y no los deriva de
  nada. No existe en el código ningún camino que escriba en esas columnas un
  valor calculado por el servidor.
- Si un evento llega tarde, `markIfOutOfWindow()` devuelve una copia **marcada**
  (`out_of_window` + motivo) con T1 y T2 idénticos. Marcar no es corregir.
- El esquema MQTT tiene `additionalProperties: false`, de modo que un payload
  que traiga `received_at` se rechaza. Hay prueba dedicada.

### 2. La idempotencia la garantiza la base de datos (ADR-0003)

Un duplicado con QoS 1 es normal, no un error: se cuenta como métrica
(`metrics.duplicates`) y se descarta. La deduplicación se apoya en dos
restricciones de PostgreSQL —`event_id` único y `(module_slug, boot_id,
local_sequence)` único— y **no** en una caché de proceso, que no sobreviviría a
un reinicio ni cubriría dos instancias. `replay: true` no implica duplicado.

### 3. La precisión puede no existir (ADR-0006)

Si no se conoce la munición restante, `shots_fired`, `accuracy_total` y
`accuracy_valid` son `null` y la API responde
`accuracy_status: "not_computable"` con el motivo. No se sustituyen los
disparos desconocidos por la munición inicial ni se derivan fallos de la
diferencia con los impactos. En los CSV, `null` se escribe como celda vacía,
nunca como `0`.

### 4. Añadir un modo de juego no toca el núcleo

`domain/game/` implanta un **registro de estrategias**. Un modo es una clase que
implementa `GameModeStrategy` (`plan`, `resolveHit`, `isComplete` y, si lo
necesita, `shouldSkipActivation`) y se registra con
`registry.register(...)`. `GameEngine` no conoce ningún modo concreto. Hay una
prueba que añade un quinto modo sin modificar el motor.

Toda la aleatoriedad pasa por `DeterministicRng` (mulberry32) sembrado con el
`seed` de la ronda: la misma semilla produce el mismo plan y el mismo resultado.
`Math.random()` no aparece en el motor.

### 5. Sin contraseñas por defecto en el código

No hay ninguna credencial embebida. En el primer arranque, si no existe ningún
usuario, se crea la cuenta de `DIANA_ADMIN_USERNAME` con la contraseña de
`DIANA_ADMIN_PASSWORD` o, si no se define, con una **generada aleatoriamente**
que se escribe una sola vez en el log de arranque. En ambos casos queda marcada
`must_change_password`. Los hashes son bcrypt con coste 12 y nunca se exponen
por la API. La auditoría redacta cualquier campo sensible antes de escribir.

### 6. Autoridad administrativa frente a autoridad local (dosier 14.1)

El backend crea la partida, asigna jugadores, valida reglas, **autoriza** el
comienzo y guarda el resultado. El cronómetro, la secuencia efectiva y la
validación de impactos son del módulo principal. `GamesService.start()` publica
`start_game` y actualiza el estado; no arranca ningún reloj.

## Cómo ejecutar

### Requisitos

Node 20, PostgreSQL 15+ y Mosquitto. En despliegue todo eso lo aporta el
Compose de WP-01.

### Desarrollo

```bash
cd server/backend
cp .env.example .env          # y rellenar DATABASE_URL y JWT_SECRET
npm install
npm run prisma:generate
npm run prisma:migrate        # aplica las migraciones versionadas
npm run seed:reference        # roles + modos de juego (apto para producción)
npm run seed:dev              # OPCIONAL, datos DEV- no productivos
npm run start:dev
```

- API: `http://localhost:3000/api`
- OpenAPI navegable: `http://localhost:3000/docs`
- WebSocket en directo: `ws://localhost:3000/live`

### Worker

```bash
cd server/worker
npm install
npm run start:dev     # WORKER_DRY_RUN=1 para no borrar nada
```

### Regenerar el contrato OpenAPI

```bash
cd server/backend
npm run openapi       # escribe contracts/api/openapi.json
```

Es la única ruta de `contracts/` que este paquete escribe, y como artefacto
generado: no se edita a mano.

## Cómo probar

```bash
cd server/backend
npm test                  # todo lo que no necesita servicios externos
npm run test:integration  # requiere DATABASE_URL (ver test/integration/README.md)
npm run typecheck
```

Las pruebas se organizan por requisito, no por fichero:

| Carpeta | Qué demuestra |
|---|---|
| `test/contracts/` | Todo ejemplo `valid/` es aceptado y todo `invalid/` rechazado **por la capa de ingesta**, no sólo por un validador suelto. |
| `test/ingest/idempotency.spec.ts` | El mismo `event_id` dos veces produce un solo impacto y no altera la puntuación. `replay` no es duplicado. |
| `test/ingest/temporal-authority.spec.ts` | T1 y T2 se copian literalmente; marcar fuera de ventana no los altera; un payload con `received_at` se rechaza. |
| `test/accuracy/` | Los tres casos del dosier 17.3, incluido el **no calculable**. |
| `test/engine/` | Los cuatro modos con semilla fija y resultados reproducibles, más la extensión con un modo nuevo. |
| `test/rbac/` | Matriz de permisos por rol y guardia de autorización. |
| `test/misc/` | Tópicos MQTT, caducidad y nonce de comandos, CSV, estadísticas, redacción de la auditoría. |
| `test/app/` | El grafo de dependencias completo se resuelve y OpenAPI se genera. |
| `test/integration/` | Idempotencia y precisión temporal **contra PostgreSQL real**. Se saltan sin `DATABASE_URL`. |

### Lo que NO se ha podido probar aquí

En el entorno de desarrollo de este paquete no hay demonio Docker, ni `sudo`,
ni PostgreSQL, ni Mosquitto. Por tanto **no se han ejecutado**:

- Las pruebas de `test/integration/` (PostgreSQL real).
- El recorrido MQTT extremo a extremo con un broker real.
- La aplicación de las migraciones sobre una base de datos viva.

Están escritas y documentadas para que WP-08/WP-11 las ejecuten en la VM. Un
`describe.skip` aparece como *skipped* en la salida de Jest: no cuenta como
aprobado.

## Puntos de atención para quien revise

- `IngestService.handleMessage` es el único punto de entrada de datos de
  módulo. Cualquier atajo que persista un impacto sin pasar por ahí se salta la
  validación de contrato y la idempotencia.
- `PrismaHitRepository.insertIfAbsent` interpreta `P2002` como duplicado. Si se
  añaden más restricciones únicas a `hit_events`, hay que revisarlo.
- Los `BigInt` se serializan como cadena en JSON (`main.ts`). Un cliente que
  haga `Number(...)` sobre microsegundos perderá precisión por encima de 2^53.
- El CRUD genérico usa lista blanca de campos: añadir una columna al esquema no
  la hace escribible por la API hasta que se declare.
