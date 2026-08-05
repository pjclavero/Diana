# Simulador de módulo contra un Mosquitto real

> **Estado:** verificado de extremo a extremo el **2026-08-05** en un laboratorio
> local montado a propósito (Mosquitto 2.0.21 + PostgreSQL 17.10 + backend del
> repositorio). **Nada de esto se ha ejecutado contra la VM 109.**
>
> Cierra la parte de laboratorio de **X-18-INGESTA** («la ingesta e2e nunca se ha
> verificado»): la cadena presencia → impacto → diagnóstico ya se ha recorrido
> entera con un broker de verdad delante, y las causas del fallo del 2026-07-21
> están demostradas con la salida de los mandatos, no deducidas.

---

## 1. Por qué falló el intento del 2026-07-21

El intento de julio se resumió como «el simulador conecta y completa el escenario,
pero `hit_events = 0` y sin trazas de ingesta». Reproducido tal cual en el
laboratorio, con el escenario 02 y el ACL del repositorio, da exactamente el
mismo resultado:

```
$ node dist/cli.js run --scenario scenarios/02-partida-aleatoria-completa.json \
    --broker mqtt://127.0.0.1:1883 --username module-module-01 --password ***
[diana-sim] escenario "partida-aleatoria-completa" · seed=2002
[diana-sim] escenario completado.        # ← "éxito" aparente

# mensajes que llegaron realmente al broker:
      6 targets/v1/module/{mod}/presence
      6 targets/v1/module/{mod}/status
#     ...ni un solo hit, ni game/state, ni telemetría
```

Son **tres causas encadenadas**, todas reales y todas invisibles desde el
simulador:

### Causa 1 · El ACL prohíbe al coordinador arrancar la partida (y nadie se entera)

`infrastructure/mosquitto/acl` deja el bloque del coordinador **comentado**
(«duplica y descomenta este bloque…»), así que el módulo PRINCIPAL no puede
publicar ni el estado de partida ni las órdenes a los satélites. Log del broker
durante la reproducción:

```
Denied PUBLISH from module-01 (... 'targets/v1/system/system-a/game/state', ...)
Denied PUBLISH from module-01 (... 'targets/v1/system/system-a/game/event', ...)
Denied PUBLISH from module-01 (... 'targets/v1/module/module-02/command', ...)
```

Sin `game/state` la partida no arranca, los satélites no se arman y el
autojugador no dispara: **cero impactos**. Y en MQTT una denegación de ACL es
**silenciosa** — el broker responde `PUBACK` igual —, así que el simulador
imprime «escenario completado» con toda naturalidad. Ésa es la razón por la que
en julio se anotó «conecta y completa escenario» como si fuera un éxito.

Comprobado en la VM 109 el 2026-08-05 (sólo lectura): el bloque sigue comentado.

```
$ docker exec diana-mosquitto-1 grep -n 'topic write targets/v1/module/+/command' /mosquitto/config/acl
84:# topic write targets/v1/module/+/command
```

### Causa 2 · El transporte MQTT real entregaba cada mensaje a TODOS los manejadores

`simulators/src/transport/mqttjsTransport.ts` recorría el mapa de manejadores
**ignorando el filtro de suscripción**: mqtt.js entrega todo por un único evento
`message` y el encaminamiento por filtro es responsabilidad del transporte. El
broker en memoria sí filtraba (`topicMatches`), así que las 34 pruebas del
paquete pasaban y el defecto **sólo existía contra un broker de verdad**.

Efecto: al desbloquear la causa 1, el `system/…/game/state` entró por el
manejador de `module/{id}/command`, el módulo leyó un `command_id` inexistente y
el proceso murió publicando un `status` que incumple el contrato congelado:

```
Error: Payload inválido contra module-status.schema.json:
  /last_command must have required property 'command_id'
```

Es decir: incluso con el ACL correcto, el simulador se habría caído en el primer
mensaje de partida.

**Corregido** (`dispatchByFilter`), con prueba de regresión propia
(`simulators/test/mqttjs-transport-routing.test.ts`) verificada por mutación:
al quitar el filtro, las 3 pruebas fallan.

### Causa 3 · Los escenarios usan tiempo virtual; contra un broker real duran segundos

`settle(2000)` no espera 2000 ms: cede el bucle de eventos 2000 veces. Con
`--broker` el reloj es real, el escenario acaba en un par de segundos y el CLI
hace `process.exit(0)` sin `--keep-alive`. Aunque las causas 1 y 2 no existieran,
una «partida completa» de 27 dianas se cortaría a los pocos impactos. El CLI
ahora avisa de esto al arrancar un escenario con `--broker`.

### Lo que NO era la causa

- **Credenciales**: correctas; los módulos autentican y publican presencia y
  estado sin problema.
- **`client_id`**: correcto; es igual al `module_id`, como exige el ACL (`%c`).
- **Tópicos mal formados**: no; se validan contra el contrato antes de salir.
- **El backend no estaba suscrito**: sí lo estaba. Se suscribe a los 8 filtros de
  `BACKEND_SUBSCRIPTIONS` y, en el laboratorio, ingiere presencia, estado,
  telemetría, impactos y diagnósticos sin tocar una línea.
- **Módulo no dado de alta**: influye, pero **no** en `hit_events`. Un impacto de
  un módulo no registrado **sí** se persiste (la tabla guarda `module_slug`, no
  exige la fila `modules`); lo que se pierde es la presencia, que queda como
  incidencia `presence_unknown_module`.

---

## 2. Hallazgo aparte: el backend no puede mandar órdenes a un módulo

No es causa del fallo de julio, pero se demostró al ejercer el bucle de
diagnóstico y **afecta hoy a la VM**.

El contrato §8 (congelado) dice: *«El backend es el único con permiso de
escritura sobre `system/#`, `…/config/desired` y `…/ota`. El coordinador puede
escribir `module/+/command`»*. El ACL lo implementa fielmente. Pero las rutas de
diagnóstico del backend (F6) publican **directamente** en
`targets/v1/module/{id}/command`. Resultado medido:

```
# API: "todo bien"
POST /api/modules/module-01/targets/3/test-sensor
{"action":"self_test","command_id":"...","delivered":true, ...}

# Broker, el mismo instante:
Denied PUBLISH from diana-backend-lab (... 'targets/v1/module/module-01/command', ...)
```

O sea: **el panel dice que la orden salió y el broker la tira**. `delivered:true`
sólo significa «mqtt.js tenía conexión», no «el broker la aceptó»; una denegación
de ACL no se notifica al publicador.

En la VM 109 el usuario `backend` tampoco tiene ese permiso (verificado por SSH,
sólo lectura), y el bloque del coordinador sigue comentado: **hoy, en producción,
nadie puede publicar una orden de módulo**. Ninguna prueba de LED, sensor,
calibración o `identify` puede funcionar.

**Requiere una decisión, no un parche silencioso.** Dos salidas:

1. Conceder al usuario `backend` escritura sobre `targets/v1/module/+/command`
   en `infrastructure/mosquitto/acl` **y** corregir §8 del contrato para que lo
   diga. Es un cambio de contrato congelado.
2. Que el backend enrute sus órdenes a través del módulo coordinador, como el
   contrato asume hoy. Es más trabajo y añade un salto que puede fallar.

Mientras tanto, `publish()` debería distinguir «aceptado por el broker» de
«enviado»: con MQTT 5 (que el backend ya usa, `protocolVersion: 5`) el broker
puede devolver un *reason code* de no autorizado en el `PUBACK`, y hoy se ignora.

**No se ha aplicado ningún cambio de ACL a la VM.** El laboratorio concedió el
permiso sólo en su copia local, para poder demostrar que el resto de la cadena
funciona.

---

## 3. El modo `live`: un módulo que habla con Mosquitto de verdad

Nuevo subcomando del simulador, pensado para ejercer el sistema desplegado sin
hardware. A diferencia de los escenarios, usa reloj real, se queda vivo hasta
`Ctrl+C` y se configura **entero por variables de entorno**.

```bash
cd simulators && npm run build
node dist/cli.js live
```

| Variable | Por defecto | Qué hace |
|---|---|---|
| `DIANA_MQTT_URL` | `mqtt://127.0.0.1:1883` | Broker |
| `DIANA_MQTT_USERNAME` / `DIANA_MQTT_PASSWORD` | — | Usuario = `module_id` exacto, **sin prefijo** (post-F-02; ver §4 más abajo) |
| `DIANA_MODULE_ID` | `module-01` | `module_id` **y** `client_id` (el ACL lo exige igual; el broker además sobrescribe `client_id` con el usuario autenticado) |
| `DIANA_SYSTEM_ID` | `system-a` | Sistema |
| `DIANA_MODULE_SELECTOR` | `SATELITE` | `SATELITE` o `PRINCIPAL` |
| `DIANA_MODULE_POSITION` | — | `"x,y"` con x,y ∈ {-1,0,1} |
| `DIANA_MODULE_ROTATION` | `0` | 0/90/180/270 |
| `DIANA_FIRMWARE_VERSION` | del simulador | Versión anunciada |
| `DIANA_TELEMETRY_MS` | `1000` | Periodo de telemetría (0 = desactivada) |
| `DIANA_STATUS_MS` | `0` | Reemisión periódica de `status` |
| `DIANA_HIT_EVERY_MS` | `0` | Impactos automáticos (0 = ninguno) |
| `DIANA_HIT_TARGETS` | `1..9` | Dianas que recorre, en orden |
| `DIANA_SUPPRESS_CROSSTALK` | `false` | Suprime los eventos de vibración cruzada |
| `DIANA_SEED` | `1` | Semilla determinista |

Banderas equivalentes: `--broker`, `--username`, `--password`, `--module-id`,
`--system-id`, `--telemetry-ms`, `--hit-every-ms` (tienen prioridad sobre el
entorno).

Qué hace el módulo:

- **Presencia**: registra el *Last Will* (`online:false`, `reason:"lwt"`,
  retenido) **antes** de anunciarse, y publica `online:true` al arrancar.
- **`status`** al arrancar y tras cada evento; **telemetría** periódica (un
  módulo real habla cada segundo: de eso depende el barrido de obsolescencia del
  backend, `STALE_AFTER_MS`).
- **Impactos** periódicos si se piden, con su vibración cruzada.
- **Comandos**: responde a `identify`, `set_targets`, `set_all_targets`,
  `reboot`, `self_test`, `start_calibration` y `led_test`, publicando los
  diagnósticos que el contrato define.
- **Ctrl+C / SIGTERM**: presencia `online:false, reason:"shutdown"` y
  desconexión ordenada (sin disparar el LWT).

---

## 4. Evidencia ejecutada de la cadena completa (laboratorio local)

Montaje: Mosquitto 2.0.21 con **la configuración y el ACL del repositorio**,
PostgreSQL 17.10 con **las migraciones del repositorio** (`prisma migrate
deploy`), backend del repositorio compilado (`nest build`) escuchando en `:3111`.
Alta del sistema y del módulo por la **API real**.

### Tramo 1 · Presencia → persistida

```
$ node dist/cli.js live      # module-01 contra mqtt://127.0.0.1:1883
[diana-sim] live · módulo anunciado y en "ready".

$ GET /api/modules/0fc5a1be-…
{'slug':'module-01','online':True,'lastSeenAt':'2026-08-04T23:50:15.234Z',
 'bootId':'d1bb7ffb-24de-4b1d-a0d2-ed54834974d8','firmwareVersion':'0.1.0'}
```

Corte abrupto (`kill -9`) → el broker publica el LWT → `online=False`,
`offlineSince=2026-08-04T23:55:27.797Z`. Parada ordenada (`SIGTERM`) →
`online=False` sin disparar el LWT. Ambos casos ejecutados y comprobados.

### Tramo 2 · Impacto → `hit_events`

```
hit_events ANTES = 0
$ DIANA_HIT_EVERY_MS=1500 DIANA_HIT_TARGETS=1,5,9 node dist/cli.js live
hit_events DESPUÉS = 51

 module_slug | target_index |   classification   | counts_for_score | local_sequence
-------------+--------------+--------------------+------------------+----------------
 module-01   |            1 | hit_on_safe        | f                |              1
 module-01   |            2 | crosstalk_rejected | f                |              2
 module-01   |            5 | hit_on_safe        | f                |              4
 …
$ GET /api/hits?limit=3 → {"items":[{"eventId":"7cb8cb48-…","moduleSlug":"module-01", …
```

`hit_on_safe` y `counts_for_score=false` son lo correcto aquí: no había partida
armada, así que ningún impacto puntúa. Los duplicados de QoS 1 se descartaron por
`module_boot_sequence`, como manda el ADR-0003 (visto en el log del backend).

### Tramo 3 · Orden de diagnóstico → respuesta → persistencia → consulta

```
$ POST /api/modules/module-01/targets/3/test-sensor
{"action":"self_test","command_id":"37cbf328-…","delivered":true}
$ POST /api/modules/module-01/targets/3/calibrate
{"action":"start_calibration","command_id":"5e0e7d9d-…","delivered":true}

$ GET /api/modules/module-01/diagnostics
self_test_result   | info | Autodiagnóstico del módulo completado sin errores | 23:52:55.059Z
calibration_result | info | Calibración del módulo completada                 | 23:52:55.159Z
   detail.targets = [{target_index:1, threshold:900}, … 9 dianas]
```

Es **la primera vez** que este bucle se recorre entero en el proyecto (F6 estaba
declarado «sin ejercer en ninguna capa»). Sólo funciona con el permiso de ACL de
la sección 2 concedido; sin él, las dos órdenes se deniegan en silencio.

---

## 5. Cómo ponerlo contra la VM 109 (procedimiento, NO ejecutado)

> **Escribe datos reales en producción.** Ejecutarlo lo decide el operador.
> Nada de lo que sigue se ha ejecutado contra la VM.

Estado de la VM comprobado el 2026-08-05 **en sólo lectura**: 7 contenedores
sanos; usuarios MQTT `backend`, `healthcheck` y `module-01`…`module-09`; en la
base sólo existe el módulo `demo-diana-01` y `hit_events = 0`.

1. **Decidir el permiso de ACL de la sección 2.** Sin esa decisión, las órdenes
   de diagnóstico seguirán denegándose. Los tramos de presencia y de impacto
   funcionan sin tocar nada.
2. **Dar de alta el módulo simulado en la base**, con un `slug` que no se
   confunda con hardware real (p. ej. `sim-01`), por la API y con sesión de
   administrador:
   - `POST /api/systems` `{"slug":"sim-panel","name":"Panel de simulación"}`
   - `POST /api/modules` `{"slug":"sim-01","friendlyName":"Módulo simulado"}`
   - `PATCH /api/modules/{id}` `{"targetSystemId":"…"}`
   - Si va a usarse la marca `simulated` (trabajo en curso de otro carril),
     márquense sistema y módulo como simulados: es lo que impide que impactos
     inventados contaminen la estadística real.
3. **Crear las 9 dianas del módulo.** Ver limitación en la sección 6: hoy no hay
   ninguna ruta que las cree.
4. **Credenciales MQTT.** Debe existir un usuario para el módulo
   (`infrastructure/mosquitto/generate-users.sh`) y el usuario MQTT **debe ser
   exactamente igual al `module_id`, sin prefijo** (p. ej. `module_id=sim-01` →
   usuario `sim-01`, NO `module-sim-01`). Esto cambió con el cierre de F-02: el
   ACL autorizaba antes por `client_id`, que elegía el propio cliente, así que
   unas credenciales cualesquiera de módulo bastaban para suplantar a
   cualquier otro. El broker corregido tiene `use_username_as_clientid true`:
   **sobrescribe** el `client_id` que mande el cliente con el usuario ya
   autenticado antes de evaluar permisos, así que el `client_id` que pase el
   simulador es irrelevante para el ACL — sólo cuenta el usuario. Si alguien
   reintroduce un prefijo (`module-{module_id}`) aquí, vuelve a abrir el mismo
   agujero de suplantación que F-02 cerró, sin que nada lo avise en caliente.
   **Ojo con conexiones simultáneas**: dos clientes con el mismo usuario
   colisionan y el broker desconecta al primero («ya conectado, cierro la
   conexión anterior») — no publiques y observes con las mismas credenciales
   a la vez.
5. **Lanzar el módulo** desde una máquina de la red (no hace falta que sea la VM):

   ```bash
   cd simulators && npm ci && npm run build
   DIANA_MQTT_URL=mqtt://192.168.1.209:1883 \
   DIANA_MQTT_USERNAME=sim-01 DIANA_MQTT_PASSWORD='…' \
   DIANA_MODULE_ID=sim-01 DIANA_SYSTEM_ID=sim-panel \
   DIANA_TELEMETRY_MS=1000 DIANA_HIT_EVERY_MS=0 \
   node dist/cli.js live
   ```

   Empezar **sin impactos** (`DIANA_HIT_EVERY_MS=0`): comprobar primero que el
   módulo aparece `online` en el panel. Sólo después subir a impactos.
6. **Verificar por tramos**, en este orden: presencia → telemetría → impacto →
   diagnóstico. Si un tramo no llega, mirar **el log del broker**, no el del
   simulador: las denegaciones de ACL sólo se ven ahí
   (`docker logs diana-mosquitto-1 | grep Denied`).
7. **Al terminar**: `Ctrl+C` (presencia `shutdown` limpia) y borrar del panel el
   sistema y el módulo de simulación si no van a reutilizarse.

---

## 6. Qué queda sin verificar, y por qué

- **Nada se ha ejecutado contra la VM 109.** Todo lo de arriba es un laboratorio
  local con el mismo software y la misma configuración, no el sistema
  desplegado. La diferencia que ya se sabe que existe es el permiso de ACL de la
  sección 2.
- **La partida completa (coordinador, `game/state`, impactos que puntúan) sigue
  sin verificarse contra un broker real.** Requiere habilitar el bloque del
  coordinador en el ACL, que hoy está comentado, y eso es una decisión de
  despliegue. Los impactos medidos aquí son `hit_on_safe`, sin partida armada:
  la cadena de ingesta está probada, la de **puntuación** no.
- **Nada crea las 9 dianas (`targets`) de un módulo.** Sólo lo hace
  `src/scripts/seed-dev.ts`, que es un sembrador de datos de **demostración**.
  Un módulo dado de alta por la API no tiene dianas, y por tanto
  `POST /api/modules/:id/targets/:i/{test-sensor,calibrate,test-led}` devuelve
  `404 El módulo no tiene la diana N` **siempre**. En el laboratorio se
  insertaron a mano por SQL para poder ejercer el tramo 3. Es un hueco real del
  backend, no del simulador.
- **`POST …/targets/:i/test-led` no llegó a ejecutarse:** rechaza la petición con
  `400` pidiendo un campo `state` que la ruta no documenta. No se ha investigado;
  queda anotado.
- **`GET /api/modules/:id` no acepta `slug`** (devuelve 500 al no poder convertir
  «module-01» a UUID), mientras que las rutas de diagnóstico sí aceptan
  `:idOrSlug`. Incoherencia menor, anotada, no corregida.
- **En `hit_events`, `module_id`, `target_id` y `target_system_id` quedan a
  `NULL`**: los impactos se guardan por `slug` y no se enlazan con las filas del
  módulo, la diana ni el panel, aunque existan. No se ha valorado el impacto en
  estadística.
- **El modo `live` sólo levanta UN módulo por proceso.** Para nueve hacen falta
  nueve procesos (cada uno con su `client_id`, que es lo que el ACL exige de
  todas formas).
- **No se ha probado la reconexión** del módulo `live` ante una caída del broker,
  ni el comportamiento con TLS (el listener 8883 está preparado y desactivado).

---

## 7. Cambios en el árbol de trabajo (sin commit)

- `simulators/src/transport/mqttjsTransport.ts` — encaminamiento por filtro
  (`dispatchByFilter`) y suscripciones pedidas antes de `connect()`, que antes se
  perdían en silencio.
- `simulators/src/live.ts` — modo «módulo vivo» (nuevo).
- `simulators/src/cli.ts` — subcomando `live`, ayuda y aviso del tiempo virtual.
- `simulators/src/domain/moduleSimulator.ts` — `publishStatus()` pasa a público.
- `simulators/test/mqttjs-transport-routing.test.ts` — regresión (nuevo).
- Suite del simulador: **37/37** (antes 34/34).
