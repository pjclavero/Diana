# Cierre de D1b software-core y MP0

**Commit de cierre:** `3527a917ed0b382099514570f07883fb0f1e8276` (`mp0/integration`)
**Fecha:** 2026-09-04
**Suite:** 853 comprobaciones, 0 fallos · guardián de camino único 3,2 s

## Declaración

```
D1B_SOFTWARE_CORE = CONFORME
D1B               = CLOSED
MP0               = CLOSED
```

Deliberadamente **NO** se declara `DEVICE_MANAGEMENT = COMPLETE` ni
`D1B_END_TO_END = PASS`. Lo que cierra es el núcleo software; el transporte no.

```
D1B_TRANSPORT_E2E = BLOCKED_BY_CONTRACT_GAP
```

## Estado verificado

| Propiedad | Estado |
|---|---|
| `D1B_COMMAND_RUNTIME_CONNECTED` | PASS |
| `D1B_CANONICALIZATION_CROSSCHECK` | PASS (21/21, C == Python byte a byte) |
| `D1B_PROVISIONING_REPLAY_GUARD` | PASS (calibrado) |
| `NO_ROOT_KEY_FAIL_CLOSED` | PASS |
| `NO_ROOT_KEY_EARLY_GUARD` | PASS (0 invocaciones P-256 sin raíz, >0 con raíz) |
| `D1B_XTENSA_BUILD` | PASS (`espressif/idf:v5.5`, 6/6 objetos en disco) |
| `D1B_SYMBOLS_IN_ELF` | PASS (23 símbolos tras `--gc-sections`) |
| `DEVICE_MANAGEMENT_COMMAND_PATH_CURRENT_TREE` | UNIQUE |
| `D1B_PATH_REGRESSION_GUARD` | PASS_WITH_DECLARED_DYNAMIC_RESIDUAL |
| `DEVICE_MANAGEMENT_COMMAND_TRANSPORT` | NOT_REACHABLE |
| `DEVICE_MANAGEMENT_STATE_PATH` | NOT_IMPLEMENTED |

### Nomenclatura, regla permanente

**Nunca** escribir `DEVICE_MANAGEMENT_COMMAND_PATH = UNIQUE` sin `CURRENT_TREE`.

`CURRENT_TREE = UNIQUE` significa: *en el árbol que realmente compilamos no existe
un segundo camino conocido de escritura o ejecución*. **No** significa que sea
formalmente imposible añadir uno en C. Esa palabra suelta costó cinco rondas de
supervisión.

```
D1B_PATH_STATIC_ANALYSIS_RESIDUAL = namespace construido dinámicamente en runtime
```

## Pendientes HEREDADOS — no desaparecen al cerrar MP0

```
MP0_ACCEPTED_BLOCKER:
    CONTRACT_GAP-PROVISION-COMMAND-TOPIC   -> MP0-F.0
    CONTRACT_GAP-PROVISION-STATE-TOPIC     -> MP0-F.0

MULTIPLANE_SEQ_GUARDS    = NOT_WIRED, DEFERRED_TO_A3_B5
D1B_PHYSICAL_CRYPTO_COST = PENDING_PHYSICAL_VALIDATION
```

## Qué está de verdad dentro del firmware

Parse, canonicalización, firma P-256, raíz y delegación, direccionamiento, epoch,
secuencia/replay, runtime, persistencia y fallo cerrado. Todo ello compilado con
el toolchain xtensa y presente en el ELF.

Lo que falta es el **puente**, no el motor:

```
MQTT   X   D1b
```

D1b puede validar y aplicar una orden que llegue a su entrypoint, pero el
firmware no dispone hoy de un tópico MQTT contractual suscrito que pueda
entregársela.

## Siguiente bloque

```
MP0-F.0 — PROVISIONING CONTRACT GATE
    ADR · evolución contractual · command topic · state/reporting ·
    schemas · suscripción MQTT real · E2E MQTT -> D1b
MP0-F.1 — identidad de fábrica / root_key / almacenamiento protegido
MP0-F.2 — transporte D1b real
```

El primer trabajo de MP0-F **no** es escribir `root_key`. Se movió al descubrirse
que faltaba también el camino de ENTRADA, no sólo el de salida: antes se creía
que sólo faltaba `provision/state` y podía aplazarse a MP1.

Cuando se abra el contrato debe hacerse deliberadamente y completo — ADR, versión
contractual, comando, estado, `desired/reported` si corresponde — **nunca** un
tópico huérfano añadido para poner verde un gate.

## Cómo se llegó aquí

Seis rondas de supervisión independiente sobre commits congelados, ninguna
autovalidada. Los hallazgos que cambiaron el resultado:

- el motor antirreplay `diana_seq_guard_check` no se invocaba en NINGUNA prueba;
- el único caso de replay del gate era degenerado: lo paraba el estado de dominio,
  no la barrera;
- la comprobación de `system_id` de la ORDEN no la mataba ninguna prueba, y había
  un comentario afirmando lo contrario;
- la marca de traza `missing-root-key` no demostraba "cero verificaciones";
- el guardián de camino único fue evadido 24 veces en cuatro rondas antes de
  sostenerse;
- y el firmware nunca se suscribió a un tópico de provisioning, lo que nadie vio
  hasta la quinta ronda.

Ninguno era un fallo del producto. Todos eran propiedades que creíamos protegidas
cuyas pruebas no mordían donde decíamos.
