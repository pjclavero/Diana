# Auditoría de las once pantallas que siguen colgando de `realAdapter`/`mockAdapter`

- Fecha: 2026-08-05
- Rama y punto de partida: `develop` @ `4257ba8` (`git log --oneline -3` → `4257ba8 docs: despliegue del 2026-08-05 en la VM 109`)
- Alcance: **sólo auditoría**. No se ha modificado código de producción, no se ha tocado la VM 109 (192.168.1.209), no se ha hecho commit ni push, y no se han tocado `simulators/**` ni `server/backend/**` (sólo lectura).
- Método: lectura del código de ambos lados y ejecución de comandos citados. Todo lo que no se ha podido verificar se dice expresamente.

---

## 0. Punto de partida verificado

**El panel de producción se compila en modo demostración.** Único origen del valor:

```
$ grep -rn "VITE_API_MODE" . | grep -v node_modules | grep -v "\.git/"
compose.yml:83:        VITE_API_MODE: ${VITE_API_MODE:-mock}
server/frontend/Dockerfile:19:ARG VITE_API_MODE=mock
server/frontend/.env.example:3:VITE_API_MODE=mock
server/frontend/src/api/index.ts:13:const API_MODE = (import.meta.env.VITE_API_MODE ?? "mock") as "mock" | "real";
...
```

No existe en el repositorio ningún fichero que ponga `VITE_API_MODE=real`. **No he comprobado el valor efectivo en la VM 109** (límite del encargo); lo que afirmo es lo que dice el repositorio: el valor por defecto de la imagen es `mock`.

El aviso que ve el operador es global, no por pantalla (`server/frontend/src/components/layout/AppShell.tsx:123-128`):

> «La sesión, los roles y la propiedad de módulos son reales; algunas pantallas aún muestran datos de demostración y se conectan al backend por fases.»

No dice **cuáles**. Ver §4.

**Superficie real del backend.** Inventario obtenido de los propios decoradores (incluida la fábrica CRUD, cuyos `@Controller` sólo aparecen por el `path:` de cada `*.module.ts`):

```
$ grep -rn "@Controller" --include=*.ts src/ | grep -v spec        # 30 controladores
$ grep -n "path:" src/modules/*/[a-z-]*.module.ts                  # 11 rutas CRUD generadas
  game-modes, firmware, modules, teams, calibration, topology, targets, penalties, rounds, players, systems
```

Rutas explícitas relevantes (extracto verificado de la ejecución completa, recogido en §1 pantalla a pantalla):

| Existe | No existe |
|---|---|
| `GET /modules`, `GET /modules/:id` (CRUD), `/modules/mine`, `/modules/overview`, `/modules/:id/diagnostics`, `/modules/:id/commands/identify`, `/modules/:id/targets/:i/{calibrate,test-sensor,test-led}`, `/modules/:id/config/desired`, `/modules/:id/config/push` | `/modules/:id/telemetry`, `/modules/:id/config` (GET/PATCH tal cual lo pide el panel) |
| `GET /systems`, `GET /systems/:id` (CRUD crudo) | `/systems/:id/modules`, `/systems/:id/topology` |
| `GET /topology` (CRUD), `/topology/panels`, `/topology/panels/:idOrSlug` (GET/PUT) | — |
| `GET /presets` (+ POST/PATCH/DELETE) | `/game-presets` |
| `GET /maintenance/incidents`, `PATCH /maintenance/incidents/:id/resolve` | `/incidents`, `POST /incidents/:id/resolve` |
| `POST /games`, `GET /games`, `GET /games/:id`, `POST /games/:id/rounds`, `POST /games/:id/rounds/:roundId/start`, `POST /games/:id/control/:action` | `/games/:id/start`, `/pause`, `/cancel`, `/games/:id/state`, `/games/:id/result`, `GET /games?phase=finished` |
| `GET /users` (`{items,total}`) | — |
| `GET /statistics/rounds/:roundId`, `GET /statistics/players/:playerId`, `POST /statistics/games/:gameId/participants/:participantId/reset` | agregado global de estadísticas |
| `GET /scoreboard/games/:gameId`, `GET /scoreboard/participants/:participantId` | — |
| — | **`/backups` (no existe absolutamente nada de copias en el backend)** |
| — | `/diagnostics` global sin módulo |

**Tres clases de divergencia, más una cuarta que no estaba en el encargo:**

- (i) rutas inexistentes;
- (ii) rutas con otro nombre o **otro método** (el panel hace `POST /incidents/:id/resolve`, el backend `PATCH /maintenance/incidents/:id/resolve`);
- (iii) rutas que responden 200 con otra forma;
- (iv) **paginación**: todo lo que sale de la fábrica CRUD y varios controladores propios devuelven `{items, total, skip, take}` (`server/backend/src/common/crud/crud.service.ts:58-67`; también `users`, `maintenance/incidents`, `games`), mientras `realAdapter` tipa **arrays**. Un `data?.map(...)` sobre `{items:[…]}` no revienta: **pinta tabla vacía**. Es el fallo silencioso descrito en el encargo, y es sistemático, no anecdótico. Los clientes nuevos ya lo desenvuelven a mano (`server/frontend/src/api/modulesApi.ts:61`, `:84`).

---

## 1. Inventario pantalla por pantalla

### 1.1 `topology` — `server/frontend/src/pages/topology/TopologyPage.tsx` (523 líneas)

- **Qué muestra**: editor de matriz 3×3 de un panel, matrices favoritas, mover/rotar módulos.
- **Llamadas**: ya usa `api/topologyApi.ts` (real) para todo **salvo una**:
  - `apiClient.identifyModule(moduleId, 4000)` (`TopologyPage.tsx:177`) → `POST /modules/:id/commands/identify` en `realAdapter.ts:79-83`.
- **Backend**: `POST /modules/:idOrSlug/commands/identify` **existe** (`server/backend/src/modules/modules/module-diagnostics.controller.ts:54`). Y ya hay cliente real hecho: `server/frontend/src/api/diagnosticsApi.ts`.
- **Clasificación: (A) cableable ya.** Es literalmente sustituir una llamada. Es la única de las once que hoy sólo simula **una acción**, no la pantalla entera.

### 1.2 `users` — `pages/users/UsersPage.tsx` (40 líneas)

- **Qué muestra**: tabla usuario / rol / estado. Sólo lectura, sin altas ni edición.
- **Llamada**: `apiClient.listUsers()` → `GET /users` (`realAdapter.ts:121`).
- **Backend**: `GET /users` **existe** (`server/backend/src/modules/users/users.module.ts:126`), pero devuelve `{items,total}` y el rol es un objeto: `role: { select: { id, name, permissions } }` (`users.module.ts:45-55`). El panel espera `u.role` como cadena y `data` como array.
- **Clasificación: (A) cableable ya**, con adaptación de forma (desenvolver `items`, `role.name`). Precedente exacto ya escrito: `modulesApi.ts:83-86` hace justo eso contra `/users?take=500`.

### 1.3 `incidents` — `pages/incidents/IncidentsPage.tsx` (65 líneas)

- **Qué muestra**: registro de incidencias con fecha/severidad/origen/mensaje/estado y botón «Marcar resuelta».
- **Llamadas**: `listIncidents()` → `GET /incidents`; `resolveIncident(id)` → `POST /incidents/:id/resolve` (`realAdapter.ts:117-118`).
- **Backend**: **ninguna de las dos existe con ese nombre**. Existen `GET /maintenance/incidents` y `PATCH /maintenance/incidents/:id/resolve` (`server/backend/src/modules/maintenance/maintenance.module.ts:23,35`). Divergencias además de la ruta: método (`POST`→`PATCH`), envoltorio (`{items,total}`, `maintenance.module.ts:33`) y **nombres de campo**: el modelo tiene `occurredAt`/`resolvedAt`/`kind` (`prisma/schema.prisma`, `model Incident`), el panel espera `created_at` y un booleano `resolved`.
- **Clasificación: (A) cableable ya**, con cliente propio que traduzca ruta, método y forma (`resolved = resolvedAt !== null`).

### 1.4 `module-detail` — `pages/module-detail/ModuleDetailPage.tsx` (117 líneas)

- **Qué muestra**: rejilla de las 9 dianas con su estado, botón «Identificar módulo», enlaces a calibración/sensores/LED y una tarjeta «Diagnóstico rápido» con uptime, heap, CPU, 5V/12V, reconexiones MQTT, cola y cadenas LED.
- **Llamadas**: `getModule(id)` → `GET /modules/:id`; `getModuleTelemetry(id)` → `GET /modules/:id/telemetry`; `identifyModule`.
- **Backend**:
  - `GET /modules/:id` **existe** (CRUD) y su `include` ya trae lo necesario: `{ position: true, targets: true, owner: {...} }` (`server/backend/src/modules/modules/modules.service.ts:12-16`). Faltan sólo renombrados (`targetIndex`→`target_index`, `position.rotation`).
  - `identify` **existe** (§1.1).
  - **`/modules/:id/telemetry` NO existe, y no hay dónde sacarlo**: no hay modelo de telemetría en la base (`grep -n "^model" prisma/schema.prisma` → 29 modelos, ninguno de telemetría) y la telemetría MQTT sólo se usa para presencia, no se persiste (`server/backend/src/modules/mqtt/ingest.service.ts:197-203`).
- **Clasificación: (B) necesita backend** — y también **(C) candidata a recorte**. Concretamente: las 9 dianas y el identificar son cableables ya; **la tarjeta «Diagnóstico rápido» exige persistir telemetría** (nuevo modelo + escritura desde `ingest.service` + endpoint `GET /modules/:id/telemetry`). Solapamiento: la fila expandible de `modules` ya da rol, posición, dueño, firmware, última señal y los enlaces a calibración/sensores/LED (`pages/modules/ModulesPage.tsx:108-148`); lo único que `module-detail` aporta y `modules` no es la rejilla visual de las 9 dianas.

### 1.5 `results` — `pages/results/ResultsPage.tsx` (64 líneas)

- **Qué muestra**: por partida finalizada, tabla por jugador con aciertos, incorrectos, penalizaciones, tiempo, precisión total y válida.
- **Llamada**: `listResults()` → `GET /games?phase=finished` (`realAdapter.ts:113`).
- **Backend**: `GET /games` **existe** (`games.module.ts:33`) pero **ignora `phase`**: sólo acepta `take`, devuelve `{items,total}` y entidades `Game` crudas con `include: { gameMode: true }`. **No existe** `/games/:id/result`. Los resultados por participante viven en otro sitio: `GET /scoreboard/games/:gameId` (`scoreboard.module.ts:15`), que es lo que ya consume la pantalla de marcador (`api/scoreboardApi.ts:144`).
- **Clasificación: (B) necesita composición** y **(C) fuerte candidata a retirarse**. `marcador` (`/marcador`, `/marcador/:gameId`) ya sirve datos reales de resultados, con selector de partidas recientes (`scoreboardApi.ts:182-184`) y con el tratamiento correcto de «no calculable» (`ScoreboardPage.tsx:28-35`). `results` es la misma información con datos inventados. **Propuesta, no decisión**: retirar `results` y redirigir `/resultados` → `/marcador`; si el operador quiere conservar una vista histórica «de partidas cerradas», lo barato es un filtro dentro de marcador, no una segunda pantalla con su propio contrato.

### 1.6 `stats` — `pages/stats/StatisticsPage.tsx` (64 líneas)

- **Qué muestra**: agregado por jugador (partidas, aciertos, incorrectos, precisión media de las partidas calculables). Nota: la columna «Jugador» pinta `player_id`, no el nombre.
- **Llamada**: `listResults()` — la misma inexistente de §1.5. La pantalla **agrega en el navegador**.
- **Backend**: existe `GET /statistics/players/:playerId` (`statistics.module.ts:76`), que ya calcula exactamente la métrica honesta que la pantalla intenta (media sólo sobre calculables, `statistics.module.ts:46-58`), **pero es por jugador, y no hay listado agregado**.
- **Clasificación: (B) necesita backend**: falta `GET /statistics/players` (agregado, con `player_id` **y nombre**) o, alternativa barata, que el panel liste `/players` y haga N llamadas a `/statistics/players/:id` (correcto, pero N+1).

### 1.7 `home` — `pages/home/HomePage.tsx` (74 líneas)

- **Qué muestra**: estado general del sistema (estado, módulos en línea/esperados, partida activa, conflictos), recuento de módulos, alertas abiertas y accesos rápidos.
- **Llamadas**: `getSystemStatus(DEFAULT_SYSTEM_ID)` → `GET /systems/:id`; `listModules(systemId)` → `GET /systems/:id/modules`; `listIncidents()` → `GET /incidents`.
- **Backend**: `GET /systems/:id` existe pero es **CRUD crudo sobre `TargetSystem`**: tiene `slug,name,description,state,coordinatorModuleId,modulesExpected` y **no tiene** `modules_online`, `conflicts`, `active_game_id` ni `backend_time_ms`. Además el enum del servidor es `idle|configuring|ready|game_running|degraded|maintenance` (`prisma/schema.prisma`, `enum SystemState`) y el del panel es `boot|ready|degraded|conflict|game_active|maintenance|error` (`src/types/domain.ts:209-216`): **no coinciden**. `/systems/:id/modules` **no existe**. `/incidents` **no existe** (§1.3).
- **Clasificación: (B) necesita composición.** Falta un `GET /systems/:id/status` que componga estado, `modules_online/expected`, partida activa y conflictos —**y «conflictos» no existe como concepto en el backend**: `grep -rni "conflict" src/` sólo devuelve `ConflictException` de HTTP, nada de detección de conflictos de sistema. Variante barata sin backend nuevo: reconstruir Inicio sobre `GET /modules/overview` (que ya da `summary {total, online, offline, updatesPending}`, `modulesApi.ts:106-112`) + `GET /maintenance/incidents` + `GET /games?take=1`; se pierde «conflictos», que hoy es humo.

### 1.8 `system` — `pages/system/SystemStatusPage.tsx` (72 líneas)

- **Qué muestra**: ficha del sistema (estado, coordinador, módulos en línea, partida activa, hora del backend) y tarjeta «Conflictos».
- **Llamada**: `getSystemStatus(DEFAULT_SYSTEM_ID)` — misma que §1.7.
- **Clasificación: (B) necesita el mismo endpoint compuesto que `home`**, y además **(C) candidata a fusión**: es un superconjunto de la tarjeta «Estado general» de Inicio y un subconjunto informativo de lo que ya enseña `modules` (que sí tiene datos reales de en línea/desconectado por módulo). **Propuesta**: un solo endpoint `GET /systems/:id/status` sirve a Inicio y a Estado del sistema; si sólo se va a implementar una, que sea Inicio, y `/sistema` pase a ser una sección dentro de `modules`.

### 1.9 `countdown` — `pages/countdown/CountdownPage.tsx` (45 líneas)

- **Qué muestra**: pantalla de cuenta atrás tras crear la partida; lanza el inicio y navega a «directo».
- **Llamada**: `startGame(gameId)` → `POST /games/:id/start` (`realAdapter.ts:109`).
- **Backend**: **no existe**. El arranque real es **por ronda**: `POST /games/:id/rounds/:roundId/start` (`games.module.ts:79`), y el control es `POST /games/:id/control/:action` con `pause_game|resume_game|abort_game|end_game` (`games.module.ts:100-103`). Es decir, el panel no tiene el `roundId` que el backend exige.
- **Clasificación: (B) necesita backend o rediseño de flujo.** Depende enteramente de §1.10.

### 1.10 `new-game` — `pages/new-game/NewGamePage.tsx` (211 líneas)

- **Qué muestra**: formulario completo (modo, preset, selección de dianas por módulo, jugadores, equipos, munición, penalización, orden estricto, cuenta atrás, tiempo límite) y un único botón que crea la partida y navega a la cuenta atrás.
- **Llamadas**: `listPresets()` → `GET /game-presets`; `listPlayers()` → `GET /players`; `listTeams()` → `GET /teams`; `listModules(systemId)` → `GET /systems/:id/modules`; `createGame(config)` → `POST /games`.
- **Backend**:
  - `/game-presets` **no existe**; es `GET /presets` (`presets.controller.ts:63`).
  - `/players` y `/teams` existen (CRUD) pero devuelven `{items,total}`.
  - `/systems/:id/modules` **no existe**.
  - `POST /games` existe pero **su cuerpo es otro**: `CreateGameInput = { target_system_id, mode, name?, seed?, preset_id?, config?, created_by? }` (`server/backend/src/modules/games/games.service.ts:13-21`). **No acepta** `targets`, `player_ids`, `team_ids`, `ammo_initial`, `countdown_ms`, `time_limit_ms`, `penalty_ms`, `strict_order`. Todo eso vive en **`POST /games/:id/rounds`** (`CreateRoundInput`, `games.service.ts:23-35`) y en `POST /participants` / `POST /ammo/participants/:id`.
  - **`target_system_id` es obligatorio y el panel no lo manda**: usa `DEFAULT_SYSTEM_ID` (`src/config.ts`), que por defecto es la cadena `"system-a"`, no un UUID.
- **Clasificación: (B) necesita backend o una orquestación explícita en el cliente.** Es la pantalla más cara con diferencia: crear partida deja de ser un POST y pasa a ser una secuencia (crear partida → crear participantes → crear ronda → arrancar ronda). Recomendable un endpoint de composición `POST /games/full` en el backend, para que el panel no cargue con una transacción de cuatro pasos sin rollback.

### 1.11 `backups` — `pages/backups/BackupsPage.tsx` (60 líneas)

- **Qué muestra**: «Copias y estado del sistema», tabla de copias (fecha, tipo automática/manual, tamaño en MiB) y botón **«Crear copia ahora»** que responde «Copia de seguridad iniciada.»
- **Llamadas**: `listBackups()` → `GET /backups`; `triggerBackup()` → `POST /backups`.
- **Backend**:

```
$ grep -rniE "backup|copia de seguridad" --include=*.ts --include=*.tsx --include=*.yml --include=*.sh --include=Makefile server infrastructure scripts Makefile | grep -v node_modules
server/frontend/src/App.tsx:26 …  (frontend)
server/frontend/src/api/mockAdapter.ts:225 …  (mock)
server/frontend/src/api/mockData.ts:229 …  (mock)
server/frontend/src/api/realAdapter.ts:125-126 … (cliente sin servidor)
server/frontend/src/pages/backups/BackupsPage.tsx …
```

  **Cero coincidencias en `server/backend`, `infrastructure`, `scripts` y `Makefile`.** No existe ni el endpoint ni el mecanismo de copia.
- **Clasificación: (B) necesita backend entero** —y es, además, el hallazgo más grave de §4.

---

## 2. Clasificación, esfuerzo y orden propuesto

Unidad: jornada de una persona (dev+pruebas+revisión). Estimaciones mías, no medidas.

| # | Pantalla | Clase | Qué falta exactamente | Esfuerzo |
|---|---|---|---|---|
| 1 | `topology` | **A** | Sustituir `apiClient.identifyModule` por `diagnosticsApi.identify` | 0,25 j |
| 2 | `users` | **A** | Cliente propio `usersApi`: `GET /users?take=500`, desenvolver `items`, `role.name` | 0,5 j |
| 3 | `incidents` | **A** | Cliente propio: `GET /maintenance/incidents`, `PATCH …/:id/resolve`, mapear `occurredAt`/`resolvedAt` | 0,75 j |
| 4 | `module-detail` | **B** (+C) | Cableable: 9 dianas + identificar vía `GET /modules/:id`. Falta: persistir telemetría (modelo + ingesta + `GET /modules/:id/telemetry`) | 0,75 j panel / **2,5 j backend** |
| 5 | `home` | **B** | `GET /systems/:id/status` compuesto (o rediseño sobre `/modules/overview` + `/maintenance/incidents`) | 1 j variante barata / 2 j con endpoint nuevo |
| 6 | `system` | **B** (+C) | El mismo endpoint que `home`; decidir antes si sobrevive | 0,5 j si sobrevive tras `home` |
| 7 | `stats` | **B** (+C) | `GET /statistics/players` agregado con nombre de jugador | 1 j backend + 0,5 j panel |
| 8 | `results` | **B** (+C) | Nada nuevo si se retira en favor de `marcador`; si se conserva, endpoint de partidas finalizadas + composición con `/scoreboard` | 0,25 j (retirar) / 2 j (conservar) |
| 9 | `new-game` | **B** | Orquestación partida+participantes+ronda, o `POST /games/full`; corregir claves de modo; `target_system_id` real | **4 j** |
| 10 | `countdown` | **B** | Depende de 9: arrancar con `POST /games/:id/rounds/:roundId/start` | 0,75 j (después de 9) |
| 11 | `backups` | **B** | **Todo**: mecanismo de copia (`pg_dump` + retención), `GET/POST /backups`, permisos, auditoría | **5 j** (o 0,25 j si se retira) |

**Orden propuesto** (valor pronto, riesgo bajo primero, dependencias respetadas):

1. **Bloque 0 — decisión de producto del operador (bloqueante, 0 j de código)**: ¿se retiran `results` y `system`? ¿se conserva `backups` o se retira la pantalla hasta que exista el mecanismo? Sin esta decisión se paga trabajo que quizá se tire.
2. **Bloque 1 — barrido barato (1,5 j)**: `topology`, `users`, `incidents`. Tres pantallas dejan de mentir en dos días, sin tocar backend, con el patrón ya probado de `diagnosticsApi.ts`.
3. **Bloque 2 — `module-detail` parcial (0,75 j)**: cablear las 9 dianas e identificar contra `GET /modules/:id`; **retirar la tarjeta «Diagnóstico rápido»** hasta que exista telemetría persistida (no dejarla con datos inventados).
4. **Bloque 3 — `home` (1 j)** en su variante barata sobre `/modules/overview` + `/maintenance/incidents`, sin la tarjeta «Conflictos» (concepto inexistente en el backend). Después, `system` (0,5 j) o su retirada.
5. **Bloque 4 — `stats` (1,5 j)**, que exige el primer endpoint nuevo pequeño y bien acotado.
6. **Bloque 5 — telemetría de módulo (2,5 j backend)**, que devuelve la tarjeta a `module-detail`.
7. **Bloque 6 — `new-game` + `countdown` (4,75 j)**, lo último de esta lista porque es lo único que escribe en el motor de juego y lo que más puede romper.
8. **`backups`**: fuera de este orden. Es un proyecto propio (§4). Hasta entonces, retirar la pantalla o dejarla explícitamente inoperativa.

**Regla de no-rotura, verificada como practicable**: ninguna de las pantallas de los bloques 1–4 necesita `VITE_API_MODE=real`. Los clientes nuevos leen `VITE_API_BASE_URL` directamente (`diagnosticsApi.ts:17`, `topologyApi.ts:8`, `modulesApi.ts`), igual que ya se hizo con las trece pantallas cerradas. El interruptor global se apaga **al final**, cuando `realAdapter.ts` se quede vacío; ése debe ser el criterio de cierre de X-21, no una fecha.

---

## 3. La causa de fondo: el contrato REST no tiene guardián

### 3.1 Lo que está comprobado

El contrato MQTT sí tiene guardián y se ejecuta:

```
$ python3 contracts/validate.py
contratos: 43 comprobaciones, 0 fallos
$ grep -n "validate.py" .github/workflows/ci.yml Makefile
.github/workflows/ci.yml:37:        run: python3 contracts/validate.py
Makefile:105:	python3 contracts/validate.py
```

Pero `contracts/validate.py` **sólo mira `contracts/mqtt/`, `contracts/schemas/` y `contracts/examples/`** (leído íntegro: `MQTT = ROOT / "mqtt"`, `SCHEMAS`, `EXAMPLES`; no hay una sola referencia a `contracts/api`). Por eso da 43/0 con un OpenAPI podrido: **no lo lee**.

Y el OpenAPI está podrido:

```
$ python3 -c "import json;d=json.load(open('contracts/api/openapi.json'));print(len(d['paths']))"
61
```

Esas 61 rutas **no incluyen** `views`, `invitations`, `smtp-settings`, `scoreboard`, `resilience`, `matrix-layouts`, `topology/panels`, `manager-activations`, `modules/mine`, `modules/overview`, `modules/:id/diagnostics`, `modules/:id/commands/identify`, `modules/:id/targets/:i/*`, `modules/:id/config/*`, `games/panel-occupancy`, `games/join/*`, `participants/:id/panel`, `participants/:id/team`, `players/search`, `firmware/upload`, `firmware/:id/binary`, `modules/:id/firmware/*` ni **`POST /statistics/games/:gameId/participants/:participantId/reset`** (que sí existe: `server/backend/src/modules/statistics/stats-reset.controller.ts:24`). Es decir: el fichero es un fósil de una versión anterior del backend.

**Lo llamativo es que el generador ya existe y funciona por diseño**: `server/backend/src/scripts/export-openapi.ts` construye el documento desde la propia aplicación Nest (sin base de datos ni broker: `DIANA_SKIP_DB=1`, `MQTT_ENABLED=false`), y hay script npm: `server/backend/package.json:22` → `"openapi": "ts-node -T src/scripts/export-openapi.ts"`.

**No existe nada que lo ejecute**: `grep -rn "openapi" .github/workflows Makefile` no devuelve **ninguna** coincidencia (sólo aparece en el propio script y en `package.json`). No lo he ejecutado yo porque hay otro agente trabajando en `server/backend/**` y ejecutarlo reescribiría `contracts/api/openapi.json`.

**Diagnóstico**: no falta herramienta. Falta **puerta**. El artefacto se genera a mano, cuando alguien se acuerda, y nadie compara nunca lo que el panel pide con lo que el servidor da.

### 3.2 Opciones evaluadas

**Opción A — Puerta de deriva del productor.** CI ejecuta `npm run openapi` y falla si el fichero cambia (`git diff --exit-code contracts/api/openapi.json`).
- Cubre: que el artefacto refleje siempre el backend real.
- **No cubre nada del consumidor**: con esta puerta sola, `realAdapter` podría seguir pidiendo `/backups` eternamente y CI seguiría verde. Coste: ~0,25 j. Es necesaria pero **insuficiente**.

**Opción B — Tipos compartidos generados del OpenAPI (`openapi-typescript`) usados por los clientes del panel.** Se genera `server/frontend/src/api/generated/schema.d.ts` desde `contracts/api/openapi.json`, y el helper `req<T>(path)` de cada cliente pasa a tipar `path` contra `keyof paths` y la respuesta contra el `responses` correspondiente.
- Cubre: ruta inexistente → **error de compilación**; ruta renombrada → error de compilación; **forma distinta → error de compilación** (incluido el `{items,total}` frente a array, que es exactamente el fallo silencioso que hoy pinta pantallas vacías).
- No cubre: comportamiento (que un 200 traiga los datos correctos), ni parámetros de consulta que el controlador ignora (`?phase=finished` en `/games` seguiría compilando si el esquema lo declarase; hoy no lo declara, luego fallaría, que es lo que queremos).
- Coste: ~1,5 j de montaje (dependencia de desarrollo + script + adaptar el helper de cada cliente, que hoy son 12 ficheros con el mismo `req<T>`), más una fricción real: **exige que los DTO de respuesta estén anotados**. Buena parte de los controladores devuelven objetos anónimos sin `@ApiResponse({ type })`, así que el esquema generado sería `{}` para ellos y no atraparía divergencias de forma hasta anotarlos. Ese trabajo de anotación es el coste verdadero, y es incremental: se puede exigir sólo a los endpoints que el panel consume.

**Opción C — Pruebas de contrato (supertest) por endpoint consumido.**
- Cubre: existencia, método, código y forma **real** de la respuesta, con la aplicación levantada.
- No cubre: no impide que el panel invente una ruta nueva mañana; hay que acordarse de escribir la prueba. Y necesita base de datos en CI (hay `integration.yml`, no lo he auditado en detalle).
- Coste: ~0,15 j por endpoint, y mantenimiento permanente.

### 3.3 Recomendación

**A + B, en ese orden, y C sólo como red para los cinco endpoints críticos del flujo de partida.**

Mecanismo concreto y ejecutable:

1. **Qué se compara con qué.** `contracts/api/openapi.json` es el **artefacto generado** desde los decoradores de NestJS (fuente de verdad: el código del backend). El panel no puede llamar a nada que no esté en ese fichero.
2. **Cómo se genera.** `cd server/backend && npm run openapi` (ya existe: `package.json:22`). Y `npx openapi-typescript contracts/api/openapi.json -o server/frontend/src/api/generated/schema.d.ts`, también committeado.
3. **Cuándo se ejecuta.**
   - Objetivo `make api-contract` local, junto al ya existente `contracts/validate.py` (`Makefile:105`).
   - En `.github/workflows/ci.yml`, paso nuevo inmediatamente después del actual paso 37, con dos comprobaciones: regenerar OpenAPI + `git diff --exit-code contracts/api/openapi.json`, y regenerar los tipos + `git diff --exit-code` sobre `schema.d.ts`.
   - El `tsc` del frontend, que ya corre en CI, se convierte automáticamente en el verificador del consumidor en cuanto los clientes usen los tipos generados.
4. **Qué falla cuando alguien diverge.**
   - Backend cambia una ruta y no regenera → **falla el diff de OpenAPI**, con el nombre de la ruta en la salida.
   - Backend borra o renombra una ruta que el panel usa → regenera bien, pero **falla `tsc` del frontend** señalando el fichero y la línea del cliente que la pide.
   - Panel inventa una ruta (el pecado original: `/backups`, `/game-presets`, `/incidents`) → **falla `tsc` del frontend en el momento de escribirla**, no seis meses después en producción.
   - Backend cambia la forma (envolver en `{items,total}`) → **falla `tsc`** en el punto donde se consume, siempre que el endpoint tenga DTO anotado.
5. **Coste total honesto**: ~2 j de montaje + una campaña incremental de anotación de DTO de respuesta en los endpoints que consume el panel (estimo 0,1 j por endpoint, ~30 endpoints → 3 j, repartibles). A cambio, la clase de fallo (iii) —«200 con otra forma», la peor porque es silenciosa— deja de ser detectable sólo por inspección humana.

**Lo que NO recomiendo**: extender `contracts/validate.py` para que valide también el OpenAPI. Ese validador es un validador de JSON Schema de mensajes MQTT; meter ahí la comparación REST mezcla dos contratos con ciclos de vida distintos y, sobre todo, **no atraparía la divergencia del consumidor**, que es la que ha causado las once pantallas de este informe.

---

## 4. Pantallas que prometen lo que el sistema no hace

Ordenadas por gravedad. Todas verificadas contra el comportamiento real, no sólo contra las rutas.

**G1 · `backups` promete copias de seguridad que no existen en ninguna parte.** El botón dice «Crear copia ahora» y la pantalla responde «Copia de seguridad iniciada.» (`BackupsPage.tsx:18`). No hay backend, ni script, ni cron, ni nada en `infrastructure/` (grep citado en §1.11). Un operador que confíe en esta pantalla creerá que tiene copias y **no las tiene**. Es la promesa más peligrosa del panel porque su fallo sólo se descubre el día que hay que restaurar. Recomendación: retirar la pantalla del menú **hoy**, con independencia del calendario de cableado.

**G2 · `new-game` ofrece modos de juego que el motor no implementa.** La pantalla lista siete (`NewGamePage.tsx:9-17`): `random`, `sequence`, `all_vs_clock`, `reaction`, `memory`, `no_shoot`, `duel`. El motor tiene cinco estrategias:

```
$ grep -rn "readonly key = " --include=*.ts src/domain
src/domain/game/strategies/random.strategy.ts:21:  readonly key = 'random';
src/domain/game/strategies/reaction.strategy.ts:19:  readonly key = 'reaction';
src/domain/game/strategies/sequence.strategy.ts:24:  readonly key = 'sequence';
src/domain/game/strategies/all-against-clock.strategy.ts:19:  readonly key = 'all_against_clock';
src/domain/game/strategies/duelo.strategy.ts:27:  readonly key = 'duelo';
```

**«Memoria» y «No disparar» no existen**. Y de los que sí existen, dos tienen **clave distinta**: `all_vs_clock`≠`all_against_clock`, `duel`≠`duelo`. Contra el backend real, `GamesService.create` rechazaría los cuatro con «Modo de juego desconocido» (`games.service.ts:194-198`); en modo mock los cuatro «funcionan». Es la misma familia de desalineación de vocabulario que ya se documentó para el WebSocket en `docs/coordination/STATUS.md` (X-06, `liveContract.ts`).

**G3 · `countdown` no es una cuenta atrás.** La pantalla se llama «Cuenta atrás», dice «Enviando orden de inicio a los módulos…» y luego «Preparados… la partida comienza», pero **no cuenta nada**: navega tras un `setTimeout` fijo de 1500 ms (`CountdownPage.tsx:32`), ignorando el `countdown_ms` que el operador acaba de configurar en el formulario anterior (`NewGamePage.tsx:74`). Y el mensaje «Enviando orden de inicio a los módulos» es falso incluso en el diseño previsto: la orden real la lleva el coordinador por ronda (`games.module.ts:79-83`, «el cronómetro lo lleva el coordinador»).

**G4 · `system` y `home` muestran «Conflictos», un concepto que el backend no tiene.** `SystemStatusPage.tsx:52-64` dedica una tarjeta entera a conflictos y afirma «Sin conflictos detectados» cuando la lista viene vacía. No hay detección de conflictos en el servidor (`grep -rni "conflict" src/` → sólo `ConflictException` HTTP). Afirmar «sin conflictos detectados» cuando **nadie detecta conflictos** es exactamente el defecto recurrente del proyecto: no es una laguna de datos, es una afirmación falsa. Mismo problema con `SystemState`: la pantalla traduce estados (`boot`, `conflict`, `game_active`, `error`) que el enum del servidor no contempla.

**G5 · `users` se titula «Usuarios y permisos» y no muestra permisos ni permite gestionar nada.** Es una tabla de tres columnas de sólo lectura (`UsersPage.tsx`). El backend **sí** devuelve `role.permissions` (`users.module.ts:54`) y **sí** tiene alta, modificación y baja lógica (`users.module.ts:139,154,174`). Aquí la promesa del título excede a la pantalla, no al sistema: se arregla renombrando o completando.

**G6 · `module-detail` presenta telemetría con aire de medida real.** «Diagnóstico rápido» pinta voltajes 5V/12V con dos decimales, corriente por cadena LED en mA y reconexiones MQTT. Nada de eso se almacena (§1.4). En producción hoy son números inventados por `mockData.ts` con formato de instrumento de medida, que es la peor combinación posible: falso y creíble.

**G7 · `home` afirma «N módulos respondiendo».** El texto (`HomePage.tsx:38`) describe **respuesta**, pero el dato sería la longitud de un listado de módulos dados de alta, esté o no en línea. El backend sí distingue (`/modules/overview` da `online`/`offline`, `modulesApi.ts:106`). Al cablear, usar el campo correcto y no la longitud de la lista.

**G8 · `stats` y `results` identifican al jugador por su UUID.** Ambas pintan `player_id` crudo en la columna «Jugador» (`StatisticsPage.tsx:44`, `ResultsPage.tsx:47`). Con datos reales serán UUID. No es una promesa falsa, pero sí una pantalla inservible tal cual: cualquier cableado debe traer el nombre.

**G9 · El aviso de datos de demostración no dice qué pantallas.** `AppShell.tsx:123-128` avisa en abstracto («algunas pantallas»). El operador no puede saber si lo que tiene delante es real. Mientras queden pantallas colgando de `realAdapter`, el aviso debería ser **por pantalla**, no global. Coste bajo, valor alto, y evita que G1–G8 se lean como hechos.

**Lo que sí está bien y conviene no perder al cablear**: el tratamiento de la precisión no calculable. `results` y `stats` respetan `ACCURACY_NOT_COMPUTABLE_TEXT` y no rellenan con 0 % (`ResultsPage.tsx:53-58`, `StatisticsPage.tsx:17-19`), igual que el backend (`statistics.module.ts:54-58`, «los `not_computable` no cuentan como cero») y que `marcador` (`ScoreboardPage.tsx:28-35`). Es la única parte del contrato de estas once pantallas que ambos lados cumplen de verdad.

---

## 5. Límites de esta auditoría

- **No he ejecutado el backend ni el generador de OpenAPI**: hay otro agente trabajando en `server/backend/**`, y `npm run openapi` reescribe `contracts/api/openapi.json`. La afirmación «el OpenAPI está desactualizado» se sostiene sobre la comparación estática entre las 61 rutas del fichero y el inventario de decoradores, ambos citados; no sobre una regeneración.
- **No he comprobado nada en la VM 109**, ni siquiera en lectura. Todo lo que digo sobre producción se deriva de los valores por defecto del repositorio (`Dockerfile:19`, `compose.yml:83`).
- **No he ejecutado la suite de pruebas del frontend ni `tsc`**. Las clasificaciones (A)/(B)/(C) son de contrato, no de compilación.
- Las estimaciones de esfuerzo son juicio profesional, no medición.
