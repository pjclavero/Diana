# Simulador de módulos y dianas (WP-05)

Sustituto contractual del firmware ESP32-S3 para toda la cadena del servidor:
permite jugar partidas completas y correr E2E **sin hardware físico**. Habla
exclusivamente el contrato MQTT congelado de `contracts/mqtt/` — todo mensaje
que emite valida contra su JSON Schema (ver `test/contracts-conformance.test.ts`).

No sustituye ni modifica nada fuera de `simulators/**`.

## Requisitos

- Node.js 20+.
- Nada más para correr en memoria (sin broker MQTT real): los tests y los
  escenarios declarativos usan un broker en memoria propio
  (`src/transport/memoryBroker.ts`), porque en este entorno de desarrollo
  **no hay ningún Mosquitto disponible**.
- Para correr contra un Mosquitto real (WP-08, VM `diana-server`): añade
  `--broker mqtt://host:1883 --username ... --password ...` al CLI. Esa ruta
  usa `mqtt.js` (`src/transport/mqttjsTransport.ts`) y **no se ha ejecutado
  en este entorno** por no haber broker disponible; queda documentada aquí y
  cubierta por el mismo código que ya pasa los tests en memoria (la única
  pieza distinta es el transporte).

## Instalación

```bash
cd simulators
npm install
```

## Pruebas

```bash
npm test          # vitest run — suite completa (28 tests)
npm run typecheck # tsc --noEmit sobre src/ y test/
npm run build     # compila a dist/ (usado también por el Dockerfile)
```

La suite cubre:

- **Conformidad de contratos** (`test/contracts-conformance.test.ts`): corre
  un escenario rico (9 módulos, partida, comandos, telemetría, diagnóstico,
  duplicados, reconexión) y valida **cada mensaje publicado** contra el
  esquema que le corresponde por tópico.
- **Determinismo** (`test/determinism.test.ts`): la misma semilla produce
  byte a byte la misma secuencia de mensajes; una semilla distinta produce
  una secuencia distinta.
- **Los 6 escenarios declarativos obligatorios** (`test/scenarios.test.ts`),
  ver más abajo.
- **Vibración cruzada, baja tensión, reinicio, firmwares distintos**
  (`test/module-lifecycle.test.ts`).
- **Clasificación de impactos** (`test/classify.test.ts`) y **adyacencia
  3×3** (`test/topology.test.ts`).

## CLI

```bash
npx tsx src/cli.ts run --modules 9
# o, tras `npm run build`:
node dist/cli.js run --modules 9
```

Ejemplos:

```bash
# 9 módulos (81 dianas), un principal y el autojugador, en memoria:
node dist/cli.js run --modules 9 --principal module-05 --autoplayer --seed 42

# Un escenario declarativo concreto:
node dist/cli.js run --scenario scenarios/02-partida-aleatoria-completa.json

# Contra un Mosquitto real (WP-08, no probado aquí por falta de broker):
node dist/cli.js run --scenario scenarios/02-partida-aleatoria-completa.json \
  --broker mqtt://192.168.1.209:1883 \
  --username module-01 --password *** \
  --speed 1 --keep-alive
```

`diana-sim run --help` lista todas las opciones (número de módulos, broker,
credenciales, escenario, semilla, velocidad — ver encargo, entregable 1).

## Arquitectura

```
src/
├── clock.ts              Reloj virtual (tests, instantáneo) y reloj real con --speed.
├── rng.ts                 PRNG determinista (mulberry32) — toda la aleatoriedad pasa por aquí.
├── ids.ts                  UUIDs deterministas derivados del Rng.
├── contracts/ajv.ts        Carga contracts/mqtt/*.schema.json y valida payloads.
├── transport/
│   ├── memoryBroker.ts      Broker MQTT mínimo en memoria (retención, +, #, LWT).
│   ├── memoryTransport.ts    Transporte para tests/escenarios sin red real.
│   └── mqttjsTransport.ts     Transporte contra Mosquitto real (mqtt.js). No probado aquí.
├── domain/
│   ├── moduleSimulator.ts    Un módulo ESP32 (satélite o principal): presence, status,
│   │                          telemetry, hit, diagnostic, comandos, cola/replay, reboot.
│   ├── coordinator.ts         El módulo PRINCIPAL como autoridad de partida: consolida
│   │                          hits (rellena `coordinator`), calcula elapsed_us, publica
│   │                          game/state y game/event.
│   ├── classify.ts             Clasificación de impactos (dosier §17.1).
│   └── topology.ts             Adyacencia 3×3 para vibración cruzada (dosier §9.6).
├── autoplayer/autoplayer.ts   Golpea las dianas activas con tiempo de reacción configurable.
├── scenarios/                  Formato declarativo, loader (JSON/YAML) y runner.
└── simulation.ts                Orquesta N módulos + coordinador + autojugador.
```

### Modelo temporal (ADR-0002)

El simulador respeta la separación de las cuatro marcas: `device.event_us`
(T1) lo pone el módulo que detecta; `coordinator.elapsed_us` (T2) lo calcula
**el principal**, nunca el backend; T3/T4 no existen en este paquete (son del
backend). El campo `seed` de `system-command.game` fija además la semilla de
la ronda para que el orden de activación en modo `random` sea reproducible.

### Idempotencia (ADR-0003)

Cada `event_id` lo genera el módulo que detecta (determinista por semilla).
El coordinador deduplica por `event_id`; un duplicado se cuenta
(`Coordinator.getDuplicatesSeen()`) pero no se reprocesa. `replay: true`
marca lo que sale de la cola local tras una reconexión — no implica
duplicado, y de hecho el escenario 05 fuerza ambos casos por separado.

## Escenarios declarativos (`scenarios/*.json`)

Los 6 exigidos por el encargo, todos con `seed` fija y ejecutados en
`test/scenarios.test.ts`:

| Fichero | Qué prueba |
|---|---|
| `01-alta-9-modulos.json` | Arranque y registro de 9 módulos (81 dianas), presencia retenida, estado `ready`. |
| `02-partida-aleatoria-completa.json` | Partida completa modo `random` sobre 27 dianas (3 módulos) con autojugador, sin intervención humana. |
| `03-penalizacion-impacto-incorrecto.json` | Impacto sobre diana segura (azul) → `hit_on_safe` → `penalty_applied`, no puntúa. |
| `04-duplicados.json` | Mismo `event_id` reenviado 2 veces → el coordinador lo cuenta como duplicado, no como 3 impactos. |
| `05-desconexion-reconexion-cola.json` | Satélite pierde conexión (dispara el LWT), encola impactos, reconecta y los reenvía con `replay=true`. |
| `06-conflicto-doble-principal.json` | Dos módulos con selector forzado a PRINCIPAL: el simulador expone el conflicto en `module-status` (dos `role=principal`); resolverlo es responsabilidad del backend (WP-02). |

Formato (ver `src/scenarios/schema.ts`): `systemId`, `seed`, `modules` o
`moduleCount`, `principal` opcional, y una lista de `steps` (`boot_all`,
`arm_and_start`, `hit`, `kill_connection`, `reconnect`, `reboot`,
`low_voltage`, `duplicate_last_hit`, `settle`, …). Soporta JSON y YAML.

## Capacidades cubiertas frente al encargo

- 1, 9 módulos; hasta 81 dianas (`Simulation.addDefaultModules`, topología
  del dosier §6.1).
- Selector SATÉLITE/AUTO/PRINCIPAL (`ModuleSimulator.setSelector`,
  `setResolvedAutoRole` para AUTO).
- El coordinador consolida: rellena `coordinator` en los hits de los
  satélites (`coordinator=null` cuando el satélite publica el crudo);
  `elapsed_us` lo calcula siempre el principal.
- Estados LED de las dianas reflejados en `module-status.targets[].state`.
- Impactos válidos, sobre diana segura, ya alcanzada, fuera de orden
  (`strict_order`) y disparo anticipado (`countdown` → `early_shot`).
- Vibración cruzada con clasificación `crosstalk_rejected` y motivo.
- Eventos duplicados (`publishDuplicate`) para probar idempotencia.
- Retrasos configurables (`RealTimeClock` con `--speed`), desconexión y
  reconexión con Last Will, cola local y retransmisión con `replay=true`.
- Baja tensión (`lowVoltage`), reinicio (`reboot`: `boot_id` nuevo,
  `local_sequence` persistente), módulos con firmwares distintos.
- Telemetría periódica (`publishTelemetry`).
- Escenarios deterministas por semilla.

### Limitaciones conocidas (léase antes de dar esto por "completo")

- Los modos de juego `sequence` y `all_against_clock` están implementados
  (`Coordinator.activateNext`/`activateAll`) pero **sólo `random` tiene
  cobertura de test de extremo a extremo**; `reaction` sólo tiene el soporte
  de clasificación (`countdown` → `early_shot`), no un orquestador de
  cuenta atrás por diana todavía.
- `module-config` (desired/reported) y `ota-command` tienen esquema y el
  módulo se suscribe a `config/desired`, pero no hay lógica de aplicación de
  configuración ni de actualización OTA simulada; no están cubiertos por el
  test de conformidad de contratos (que sólo valida lo que el simulador
  realmente emite).
- El transporte contra Mosquitto real (`mqttjsTransport.ts`) no se ha
  ejecutado en este entorno: no hay broker disponible. Queda para WP-08.
- El Dockerfile (`target-module/Dockerfile`) no se ha construido ni
  ejecutado: no hay daemon Docker accesible en este entorno (`docker info`
  falla con `permission denied`). Se ha revisado a mano; el equivalente en
  local (`npm ci && npm run build && node dist/cli.js run ...`) sí está
  probado.

## Docker

```bash
# Desde la RAÍZ del repositorio (el Dockerfile necesita ver contracts/ y simulators/):
docker build -f simulators/target-module/Dockerfile -t diana-simulator .
docker run --rm diana-simulator run --modules 9 --seed 1
```

El `compose.yml` de WP-01 debe referenciarlo bajo el perfil `simulator` con
`context: .` y `dockerfile: simulators/target-module/Dockerfile`. No se ha
podido construir esta imagen en este entorno (ver limitaciones arriba).
