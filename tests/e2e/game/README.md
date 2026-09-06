# E2E-1 · GAME — un escenario real de partida, impacto y puntuación

Este directorio contiene **un** escenario E2E que se ejecuta de verdad, con su
arnés. No sustituye a `tests/e2e/scenarios.spec.ts` (los 16 `test.fixme` del
encargo) ni lo toca: vive aparte, a propósito.

## Qué ejerce

```
crear partida → añadir ronda → iniciar → hit por MQTT → ingesta → puntuación
```

- **PostgreSQL real** (`postgres:16.4-alpine`), migrado con las migraciones
  Prisma reales (`prisma migrate deploy`).
- **Mosquitto real** (`eclipse-mosquitto:2.0.18`) con TLS en el 8883,
  `allow_anonymous false`, contraseñas de verdad y **la ACL real del
  repositorio** (`infrastructure/mosquitto/acl`) montada tal cual, en solo
  lectura.
- **Backend real**, con `NODE_ENV=production` — que es el único modo en que el
  backend **exige** TLS contra el broker y un `JWT_SECRET` explícito. Probarlo
  en `development` sería probar otro producto.

  > **Desviación declarada.** La imagen se construye con
  > `harness/Dockerfile.e2e`, que es `server/backend/Dockerfile` copiado con
  > **una** diferencia: el `chown -R diana:diana /app` final pasa a ser un
  > `chown` acotado a `/app/exports` y `/app/firmware`. Motivo MEDIDO en esta
  > máquina: con Docker **rootless** sobre fuse-overlayfs, ese `chown`
  > recursivo copia al alza los ~50.000 ficheros de `node_modules` y no
  > termina (374 MB escritos en 18 min, y 0,6 MB en los 2 min siguientes). Se
  > conservan el mismo `FROM`, el mismo `npm ci`, el mismo `prisma generate`,
  > el mismo `nest build`, el mismo `dist`, los contratos congelados, el
  > usuario **no root** `diana` y el mismo `CMD`. Lo único que se pierde es la
  > propiedad nominal de ficheros que el proceso sólo lee. Está razonado en la
  > cabecera del propio `Dockerfile.e2e`.
- **Firmware simulado**: no hay banco de módulos. El `hit` lo publica un cliente
  MQTT autenticado como `module-01` en `targets/v1/module/module-01/hit`, con un
  payload conforme al esquema congelado `contracts/mqtt/hit-event.schema.json`.
  Es exactamente lo que hace un módulo; lo que no se ejerce es el silicio.

No hay ni un mock del dominio principal.

## Cómo se levanta (orden exacto, reproducible)

Desde la raíz del repositorio:

```bash
# 1. Construir la imagen del backend (contexto = raíz, necesita contracts/)
docker build -f tests/e2e/game/harness/Dockerfile.e2e -t diana/backend:e2egame .

# 2. Levantar el escenario efímero (red, postgres, mosquitto, migraciones,
#    semillas y backend). Idempotente: derriba lo anterior primero.
./tests/e2e/game/harness/up.sh

# 3. Dependencias de la suite (no toca package-lock.json)
cd tests/e2e && npm install --no-save --no-package-lock

# 4. Ejecutar el escenario
npm run test:game

# 5. Derribarlo
./harness/down.sh
```

`up.sh` deja en `tests/e2e/game/.tmp/env.json` (0600) las URL, la CA y las
credenciales efímeras que la prueba necesita. Ese directorio muere con
`down.sh`. Si `env.json` no existe, la prueba **falla** con un mensaje que lo
explica: no se salta en silencio, porque un salto no es un aprobado.

Puertos de host, todos en `127.0.0.1` y configurables por entorno:
API `13077` (`DIANA_E2E_API_PORT`), Mosquitto TLS `18877`
(`DIANA_E2E_MQTT_PORT`), PostgreSQL `15477` (`DIANA_E2E_PG_PORT`). Son altos y
poco redondos a propósito: en una máquina compartida, el `13000` ya estaba
ocupado por otro proceso ajeno a este carril.

También se puede señalar otra imagen con `DIANA_E2E_BACKEND_IMAGE`, que es lo
que usa la calibración para arrancar el escenario contra un backend mutado.

## Qué se mide, y por qué efecto

Ninguna aserción mira un log. Cada una lee un efecto observable:

| Paso | Efecto medido | Dónde |
|---|---|---|
| Partida creada | fila en `games` | `psql` |
| Participantes y su panel | filas en `participants`, `target_system_id` | `psql` |
| Ronda con plan | `rounds.plan is not null` | `psql` |
| Ronda iniciada | `delivered === true` (PUBACK del broker), `games.status='running'`, `rounds.phase='countdown'` | API + `psql` |
| Hit ingerido | fila en `hit_events` por `event_id` | `psql` |
| Hit atribuido y válido | `counts_for_score`, `participant_id`, `round_id` | `psql` |
| **Puntuación** | `validHits` del jugador en `GET /api/scoreboard/games/:id` | API |

El `delivered: true` del inicio es una medida real y no un adorno: es el PUBACK
del broker. Si el backend no estuviera conectado por TLS sería `false`; si la
ACL le negara `targets/v1/system/#` sería `denied: true`.

## Controles negativos

Las reglas no se han inventado: se han leído del código antes de escribirlas.

**A · impacto de un módulo que no es de nadie.** `module-09` está en
`e2e-panel-c`, donde no juega ningún participante. Regla real en
`server/backend/src/domain/hits/attribution.ts`: *«Ningún participante está
asignado al panel de ese módulo»* ⇒ sin atribuir. El impacto **se ingiere** (la
prueba lo comprueba: un control negativo que no llega a ocurrir no demuestra
nada), queda con `participant_id NULL`, y **ninguna** puntuación se mueve: el
jugador 1 sigue en 1 y el jugador 2 no sube. El marcador además lo declara —
`warnings` menciona los impactos «no están atribuidos», `totals.unattributed`
vale 1 y `totals.inferred` vale 0 — en vez de repartirlo a ojo.

Nótese que al jugador 2 el marcador le devuelve `null`, no `0` (ver
§Hallazgos): lo que este control exige, y comprueba, es que **no haya subido a
1**.

> Se usan **dos** participantes justamente por esto: con uno solo, el marcador
> adjudica los impactos sin dueño al único jugador (`inferred`,
> `domain/scoreboard/scoreboard.ts`) y el control no distinguiría nada.

**B · impacto que el módulo no clasifica como válido.** `classification:
"hit_on_safe"`. Regla real en `server/backend/src/domain/hits/hit-record.ts`:
`countsForScore(c) === (c === 'valid_hit')`. Se ingiere, queda atribuido al
jugador 1, `counts_for_score = false`, `validHits` no se mueve e `invalidHits`
sube a 1.

**Lo que NO es la regla, y por eso no se probó como tal:** la ingesta MQTT *no*
comprueba el estado de la partida. Un `hit` con el `game_id` de una partida en
`draft` o `finished` se acepta e inserta igual — la autoridad sobre la ventana
de juego es del coordinador (dosier 14.1, y el comentario de
`games.service.ts`). Inventar aquí un control negativo de «partida no iniciada»
habría sido probar una regla que el producto no tiene.

## Hallazgos medidos al montar esto

1. **`_schema` no se puede publicar.** Los ejemplos de
   `contracts/examples/valid/hit-event/valid-hit.json` llevan `"_schema":
   "hit-event.schema.json"`, pero `contracts/mqtt/hit-event.schema.json`
   declara `additionalProperties: false` y **no** lista esa propiedad. El
   `ContractValidator` del backend rechaza el mensaje con `schema_violation`.
   Es decir: **el fichero de ejemplo canónico no es publicable tal cual**; es
   una anotación que despoja `contracts/validate.py`. Un productor nuevo que
   copie el ejemplo se estrella, y el rechazo sólo se ve en el log del backend
   (el broker ya ha confirmado el PUBACK). Medido, no deducido.

2. **El marcador devuelve `null`, no `0`, para un jugador sin impactos
   propios mientras haya impactos sin atribuir.** Es deliberado y está bien
   (`domain/scoreboard/scoreboard.ts`: «Cero sería mentira»), pero conviene
   saberlo antes de escribir un cliente que asuma números.

## Calibración — la prueba sabe ponerse roja

Ver `CALIBRACION.md` en este mismo directorio: mutación aplicada, `grep` que
demuestra que entró, y el rojo resultante.

## ¿Atraviesa `infrastructure/mosquitto/set-coordinator.sh`?

**NO.** Registrado explícitamente para el operador.

El escenario no lo ejecuta, ni directa ni indirectamente, y no lo necesita:

- publicar en `targets/v1/module/module-01/hit` **ya está autorizado de serie**
  por la ACL del repositorio para el usuario `module-01` (el bloque
  `COORDINATOR-BLOCK` sigue en su estado inactivo, el de git);
- la orden `start_game` la publica el **backend** en
  `targets/v1/system/<panel>/command`, donde su propia regla `topic write
  targets/v1/system/#` ya le da permiso.

Por tanto este E2E **no** convierte la decisión **D6** (el script deja la ACL en
0600 y el broker sale con `Exited (13)`) en un bloqueante operativo. La ACL se
monta **en solo lectura** y no se modifica.

## NO MEDIDO

- **WebSocket.** El escenario no comprueba el `live` de `LiveGateway`. Dos
  motivos independientes, ambos reales:
  1. el evento `live` de una partida sólo se emite cuando llega un `game-state`
     o un `game-event` por MQTT, y esos tópicos sólo los puede escribir el
     **coordinador** — activarlo exige `set-coordinator.sh`, es decir, la
     decisión D6, que este carril deja intacta a propósito;
  2. el cliente es socket.io, y `socket.io-client` no está declarado en
     `tests/e2e/package.json`, que este carril sólo puede tocar para añadir un
     script.
- **Consolidación del resultado de ronda** (`Result`, penalizaciones, precisión,
  tiempo total): la produce el cierre de ronda / el worker, fuera de este
  escenario. Lo que se mide aquí es la puntuación **en vivo** del marcador.
- **Firmware físico**: no hay banco de módulos. El productor del `hit` es
  simulado; el transporte, el broker, la ACL, la validación de contrato, la
  ingesta, la base y el marcador son reales.
- **El listener 1883 en claro y el 9001 de WebSockets** del broker de
  producción: este escenario levanta sólo el 8883 con TLS, así que no dice nada
  sobre ellos.
