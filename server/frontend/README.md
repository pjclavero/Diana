# Diana · Panel web (WP-03)

Panel de control del sistema modular de dianas electrónicas. React 19 + TypeScript + Vite 8, sin dependencias de UI de terceros. Ejecutable y probable **hoy**, sin backend, gracias al adaptador mock.

## Puesta en marcha

```bash
npm install
npm run dev          # http://localhost:5173, adaptador mock por defecto
```

```bash
npm run build         # tsc -b && vite build
npm run typecheck     # tsc -b
npm run test          # Vitest (unitarios + componentes)
npm run test:watch
npm run e2e           # Playwright contra `vite preview` (requiere navegadores instalados)
```

## Cómo pasar de mock a API real

Todo pasa por `src/api/index.ts`. Ninguna pantalla importa `fetch`, el mock ni el WebSocket directamente: todas usan `apiClient` (`src/api/client.ts`) y `createGameSocket()` (`src/api/gameSocket.ts`).

Variables de entorno (`.env`, `.env.production`, o `--build-arg` en el `Dockerfile`):

| Variable | Por defecto | Efecto |
|---|---|---|
| `VITE_API_MODE` | `mock` | `mock` usa `src/api/mockAdapter.ts` + `src/api/mockGameEngine.ts`. `real` usa `src/api/realAdapter.ts` (fetch) + `src/api/realGameSocket.ts` (WebSocket con reconexión). |
| `VITE_API_BASE_URL` | `/api/v1` | Prefijo de las peticiones REST cuando `VITE_API_MODE=real`. |
| `VITE_WS_URL` | `/ws` | Base del WebSocket de directo cuando `VITE_API_MODE=real`. Se conecta a `${VITE_WS_URL}/games/{gameId}/live`. |
| `VITE_DEFAULT_SYSTEM_ID` | `system-a` | `system_id` que muestra el panel mientras no exista un selector de sistemas en la UI. |

Cambiar de mock a real en la Ola 2 es **cuestión de variables de entorno**, no de tocar pantallas.

## Contrato de API que se espera del backend (WP-02)

El backend aún no ha publicado su OpenAPI (desarrollo en paralelo). Este es el contrato **esperado**, derivado de las pantallas exigidas y del contrato MQTT congelado (`contracts/mqtt/README.md`, `contracts/schemas/common.schema.json`). La integración de la Ola 2 debería ser mecánica: implementar estos endpoints con esta forma exacta y el panel funciona sin cambios de UI.

Base: `VITE_API_BASE_URL` (por defecto `/api/v1`).

### Sistema

- `GET /systems` → `SystemStatus[]`
- `GET /systems/{systemId}` → `SystemStatus`
- `GET /systems/{systemId}/topology` → `Topology`
- `PUT /systems/{systemId}/topology` (body `Topology`) → `Topology`

### Módulos

- `GET /systems/{systemId}/modules` → `ModuleStatus[]`
- `GET /modules/{moduleId}` → `ModuleStatus`
- `GET /modules/{moduleId}/telemetry` → `ModuleTelemetry`
- `GET /modules/{moduleId}/config` → `ModuleConfig`
- `PATCH /modules/{moduleId}/config` (body `Partial<ModuleConfig>`) → `ModuleConfig`
- `POST /modules/{moduleId}/commands/identify` (body `{duration_ms}`) → `{command_id}`
- `POST /modules/{moduleId}/targets/{targetIndex}/calibrate` → `{command_id}`
- `POST /modules/{moduleId}/targets/{targetIndex}/test-sensor` → `{ok, amplitude}`
- `POST /modules/{moduleId}/targets/{targetIndex}/test-led` (body `{pattern}`) → `{command_id}`
- `GET /modules/{moduleId}/diagnostics` → `ModuleDiagnosticEvent[]`
- `GET /diagnostics` → `ModuleDiagnosticEvent[]`

### Jugadores y equipos

- `GET /players` → `Player[]`
- `POST /players` (body `{name, team_id}`) → `Player`
- `GET /teams` → `Team[]`
- `POST /teams` (body `{name, color}`) → `Team`

### Partidas

- `GET /game-presets` → `GamePreset[]`
- `POST /games` (body `GameConfig`) → `GameSummary`
- `POST /games/{gameId}/start` → `GameState`
- `POST /games/{gameId}/pause` → `GameState`
- `POST /games/{gameId}/cancel` → `GameState`
- `GET /games/{gameId}/state` → `GameState`
- `GET /games/{gameId}/result` → `GameSummary`
- `GET /games?phase=finished` → `GameSummary[]`

**Precisión (ADR-0006, normativo):** `GameResultRow.accuracy` debe ser:

```jsonc
// Munición restante desconocida y no exigida:
{ "status": "not_computable", "shots_fired": null, "total_accuracy_pct": null, "valid_accuracy_pct": null, "reason": "..." }
// Munición conocida:
{ "status": "computable", "shots_fired": 9, "total_accuracy_pct": 88.9, "valid_accuracy_pct": 77.8 }
```

El panel **nunca** deriva `shots_fired` de la munición inicial cuando la restante es desconocida; si el backend lo hiciera estaría violando el ADR-0006.

### Directo (WebSocket)

`GET {VITE_WS_URL}/games/{gameId}/live` (upgrade a WebSocket). Cada mensaje es un JSON `GameSocketMessage`:

```ts
{ state: GameState, event?: GameEvent }
```

- Un mensaje sin `event` es una actualización de estado sin evento asociado (p. ej. al conectar).
- `state.phase` sigue el ciclo `idle → prepare → countdown → running → (paused ↔ running) → finished | cancelled`.
- El cliente reconecta solo con backoff exponencial (`src/api/realGameSocket.ts`) y expone `degraded` tras 2 reintentos fallidos; el backend no necesita reenviar el histórico salvo el `state` actual al reconectar.

### Sistema (fusionado con Inicio)

- `GET /systems/{id}/status` → `SystemStatus` (`id, slug, name, state, coordinator_module_id, modules_expected, modules_online, conflicts, active_game_id`; contrato `contracts/mqtt/system-status.schema.json` v1). `state` usa el enum real del servidor (`idle|configuring|ready|game_running|degraded|maintenance`); `conflicts` es una lista de claves (`dual_principal|duplicate_position|no_principal|schema_mismatch|firmware_mismatch`), no de texto. `src/api/systemStatusLabels.ts` traduce ambas cosas al lenguaje del operador **en la frontera**, igual que `liveContract.ts` hace para el WebSocket (X-06): sólo `dual_principal` y `duplicate_position` se detectan hoy; las otras tres claves están declaradas pero nadie las comprueba todavía, así que la tarjeta de Conflictos nunca dice «sin conflictos detectados» a secas — dice qué se comprueba de verdad (auditoría 2026-08-05 §4, G4).

### Diagnóstico, firmware, incidencias, usuarios

- `GET /firmware` → `FirmwareRelease[]`
- `GET /incidents` → `Incident[]`
- `POST /incidents/{id}/resolve` → `Incident`
- `GET /users` → `UserAccount[]`

Todos los tipos citados están en `src/types/domain.ts` (dominio, derivado de los esquemas MQTT) y `src/api/client.ts` (`Topology`, `Incident`, `GamePreset`, tipos propios de la API REST que no tienen equivalente MQTT).

### Copias de seguridad: NO hay pantalla, y es intencionado

La pantalla `backups` (`/copias`) se retiró del menú y de las rutas el 2026-08-05 (auditoría §4, G1): prometía «Copia de seguridad iniciada» sin que existiera ningún endpoint HTTP detrás, el riesgo más peligroso del panel porque sólo se descubre el día que hace falta restaurar.

**Matiz importante: las copias sí existen**, sólo que no expuestas por HTTP. El mecanismo real vive en `infrastructure/backups/` (`backup.sh`, `restore.sh`, contenedor `backup` con cron `BACKUP_CRON`, retención diaria/semanal/mensual — ver `infrastructure/backups/README.md`) y hay respaldos reales corriendo en la VM. Lo que falta para reponer la pantalla es exponer ese mecanismo por `GET/POST /backups` en el backend; hasta entonces, no hay nada que cablear en el frontend.

### Errores

Cualquier respuesta no-2xx debe incluir, si es posible, `{"message": "texto para el operador"}`. El adaptador real (`src/api/realAdapter.ts`) traduce automáticamente 401/403/404 a mensajes en español; para el resto usa `message` si existe o un mensaje genérico. Nunca se muestra una traza técnica al operador.

## Pantallas implementadas

| Pantalla | Ruta | Fichero |
|---|---|---|
| Inicio (estado general + estado del sistema + conflictos) | `/` (`/sistema` redirige aquí) | `src/pages/home/HomePage.tsx` |
| Módulos conectados | `/modulos` | `src/pages/modules/ModulesPage.tsx` |
| Editor de matriz 3×3 | `/topologia` | `src/pages/topology/TopologyPage.tsx` |
| Estado de las 9 dianas de un módulo | `/modulos/:id` | `src/pages/module-detail/ModuleDetailPage.tsx` |
| Calibración | `/modulos/:id/calibracion` | `src/pages/calibration/CalibrationPage.tsx` |
| Prueba de sensores | `/modulos/:id/prueba-sensores` | `src/pages/test-sensors/TestSensorsPage.tsx` |
| Prueba de LED | `/modulos/:id/prueba-leds` | `src/pages/test-leds/TestLedsPage.tsx` |
| Jugadores | `/jugadores` | `src/pages/players/PlayersPage.tsx` |
| Equipos | `/equipos` | `src/pages/teams/TeamsPage.tsx` |
| Creación de partida | `/partidas/nueva` | `src/pages/new-game/NewGamePage.tsx` |
| Cuenta atrás | `/partidas/:id/cuenta-atras` | `src/pages/countdown/CountdownPage.tsx` |
| Vista en directo | `/partidas/:id/directo` | `src/pages/live/LiveGamePage.tsx` |
| Marcador (resultados, con datos reales) | `/marcador`, `/marcador/:id` (`/resultados`, `/resultados/:id` redirigen aquí) | `src/pages/scoreboard/ScoreboardPage.tsx` |
| Estadísticas | `/estadisticas` | `src/pages/stats/StatisticsPage.tsx` |
| Firmware | `/firmware` | `src/pages/firmware/FirmwarePage.tsx` |
| Incidencias | `/incidencias` | `src/pages/incidents/IncidentsPage.tsx` |
| Usuarios y permisos | `/usuarios` | `src/pages/users/UsersPage.tsx` |

Retiradas el 2026-08-05 (auditoría §4): `backups` (`/copias`, G1 — ver arriba, el mecanismo real sigue en `infrastructure/backups/`) y `results` (`/resultados`, ahora redirige a `marcador`, que ya sirve lo mismo con datos reales). `system` (`/sistema`) no se retiró: se fusionó con Inicio (G4).

## Accesibilidad del estado de una diana (requisito duro)

`src/utils/targetStateMeta.ts` define, para cada uno de los 12 estados de `common.schema.json` (`off, safe, active, hit, countdown, penalty, error, calibration, locked, sensor_error, maintenance, disabled`), un color, un patrón de animación, un símbolo textual y una etiqueta visible. `src/components/target/TargetLight.tsx` los combina siempre: el color nunca es la única señal. Verificado en `src/components/target/TargetLight.test.tsx` y `src/utils/targetStateMeta.test.ts`.

## Precisión no calculable (ADR-0006)

`src/utils/accuracy.ts` implementa exactamente la regla del ADR: si la munición restante es desconocida y no se exige consumir toda la munición, `shots_fired` es `null` y el panel muestra el texto exacto `ACCURACY_NOT_COMPUTABLE_TEXT`. Nunca se sustituye por la munición inicial. Probado en `src/utils/accuracy.test.ts`.

## Estructura

```
src/
  types/domain.ts        Tipos de dominio derivados de los contratos MQTT v1
  api/
    client.ts             Interfaz DianaApiClient (contrato único, aislado)
    mockAdapter.ts         Implementación mock (datos deterministas)
    mockData.ts            Datos de ejemplo
    mockGameEngine.ts       Motor de partida en memoria para la demo/mocks
    mockGameSocket.ts       Adaptador mock del directo
    realAdapter.ts          Implementación fetch contra el backend real
    realGameSocket.ts        WebSocket real con reconexión y backoff
    gameSocket.ts             Contrato GameSocket
    index.ts                   Único punto que decide mock↔real
  components/
    target/TargetLight.tsx  Estado de diana accesible (color+patrón+texto)
    layout/AppShell.tsx      Navegación responsive (barra lateral / menú móvil)
    ui/                       Feedback (carga/error/vacío), ConnectionBadge
  pages/                    Una carpeta por pantalla
  utils/                    accuracy.ts, targetStateMeta.ts, gridRotation.ts
e2e/                       Playwright (game-flow.spec.ts, responsive.spec.ts)
```

## Estado de las pruebas (ver informe del agente para la salida completa)

- `npm run build` y `npm run typecheck`: sin errores.
- `npm run test` (Vitest + Testing Library): unitarios de utilidades (precisión, metadatos de accesibilidad, rotación de rejilla) y de componentes (`TargetLight`, `AppShell`).
- `npm run e2e` (Playwright): especificaciones escritas y ejecutables (`e2e/game-flow.spec.ts`, `e2e/responsive.spec.ts`) contra el panel con el adaptador mock. **No se ha podido ejecutar realmente en este entorno**: `npx playwright install` no puede completar la instalación de dependencias del sistema (requiere `sudo`, no disponible) y el binario de Chromium falla por bibliotecas compartidas ausentes (`libnspr4.so`). El comando funciona igual una vez el entorno de CI/desarrollador tenga los paquetes del sistema que instala `playwright install --with-deps`.
