# MP0 · Congelación de evidencia de la recomposición

Estado congelado el **2026-08-25**, previo a supervisión independiente.

## Identidad del artefacto — dos identificadores, NO confundirlos

```
MP0_RECOMPOSITION_ARTIFACT = 5eedcb5    <-- lo que AUDITA el supervisor
MP0_EVIDENCE_HEAD          = (este commit y los que añadan sólo evidencia)

FIRMWARE_BASE              = 3c51847
```

**El dictamen técnico recae sobre `5eedcb5`, no sobre el commit documental.** Este
fichero y los que lo amplíen añaden únicamente congelación de evidencia: el árbol
de `firmware/`, `contracts/`, `server/`, `simulators/` e `infrastructure/` es
idéntico al de `5eedcb5`, verificable por hash de subárbol. Cualquier informe debe
decir explícitamente que **el código supervisado fue `5eedcb5`**, para que no
parezca que se auditó un commit distinto.

Al promover, la trazabilidad queda así:

```
MP0_INTEGRATION_PREVIOUS = 27652ed    <-- última cabeza sobre la base ANTERIOR (b883da0)
MP0_INTEGRATION_NEW_CODE = 5eedcb5    <-- código supervisado
MP0_INTEGRATION_NEW_HEAD = <evidencia>  <-- si se incluye la congelación documental
```

`27652ed` se conserva como referencia, **sin reescribir su historia**.

```
árbol           limpio · 28 commits sobre la base
```

`3c51847` es la base física canónica desde el 2026-08-24. La anterior,
`b883da0`, **se conserva como evidencia histórica**: documenta la primera prueba
sobre hardware y el fallo de montaje que permitió descubrir el problema de nivel
lógico. No se borra ni se declara incorrecta.

## Diferencia contra la base física

```
96 ficheros · +8677 / −281

firmware/         39 ·  +5496 /  −33
infrastructure/   10 ·  +1046 / −207
docs/             10 ·   +824 /    0
simulators/        9 ·   +680 /  −17
server/            7 ·   +246 /  −13
contracts/         7 ·   +193 /   −6
```

**Ficheros de la base física borrados: 0.** Ni uno.

De las 33 líneas eliminadas en `firmware/`, sólo **tres** tocan comportamiento
**verificado sobre hardware** —el bucle de lectura de `io_hc165.c`— y su
equivalencia está demostrada de forma exhaustiva (ver abajo).

**Precisión (O-2 del supervisor):** «verificado» significa aquí *verificado en
banco*, no *cualquier comportamiento del firmware*. Otras 2 líneas, en
`app_commands.c`, **sí cambian comportamiento del firmware**: la emisión de
`command_rejected` pasa a ir correlada con la orden que la causó. Es un cambio
deliberado de contrato, cubierto por la suite de host, y nunca fue comportamiento
validado en banco. Las 28 restantes son refactor de `verdict()` (15), Makefile
(5), tests (4), comentarios (2), amplitud de vecino por ADR-0007 (1) y
`messages.c` (1). Intactos por completo:
`net_w5500.c`, `sdkconfig.defaults`, `ota_esp.c`, `app_main.c`,
`idf_component.yml` y ambos `CMakeLists.txt`.

## Invariantes físicos, verificados en el árbol

```
DIANA_DO_POLARITY        DIANA_DO_ACTIVE_HIGH
DIANA_ETH_SPI_HZ         (5 * 1000 * 1000)
DIANA_HC165_POLL_MS      2
DIANA_DETECTION_PROFILE  DIANA_DETECT_DIGITAL_THRESHOLD
```

### Polaridad — anclada por prueba, no sólo documentada

La cadena completa: **medida física → constante en la cabecera → prueba
automática → mutación**. La prueba no compara una constante consigo misma:
comprueba la consecuencia. Con `ACTIVE_LOW`, el bus en reposo (`0x0000`) se
leería como **las nueve dianas golpeadas a la vez** — exactamente el síntoma del
montaje averiado del 2026-08-20.

Calibración: invertir el `#define` produce **4 comprobaciones rojas**.

### Equivalencia del bucle de lectura

`io_hc165.c` no se compila en las pruebas de host, así que su cambio no lo cubría
ninguna suite. El firmware de banco leía con `raw = (raw << 1) | bit`; ahora usa
`diana_shiftreg_pack()`. Las medidas `D1=0x0001`, `D2=0x0002`, `D3=0x0004` se
tomaron con el bucle **original**.

Verificado sobre **las 65 536 tramas posibles**: cero discrepancias. No es
muestreo, es exhaustivo. Convertido en regresión permanente y calibrado —
invertir el recorrido produce 13 rojas; quitar la comprobación de longitud, 1.

## Suites

```
HOST TESTS   748 / 748     0 fallidas · dos pases de contrato conformes
SIMULATOR    103 / 103     17 ficheros
```

El `diagnostic-ingest.e2e.test.js` que fallaba **era entorno incompleto**, no la
recomposición: cruza a `server/backend/src` y exige sus dependencias. Con ellas
presentes pasa, sobre el mismo árbol.

## ESP-IDF

```
BUILD = PASS · ESP-IDF v5.5 · imagen oficial espressif/idf:v5.5 · Docker rootless

diana_firmware.bin                     639 216 B   3df25068301f7f0f40452182d652d9532d1ce39698967f78e0482f0520a62b4c
bootloader/bootloader.bin               21 184 B   72bef9f0b1e9221470926f85a33acdf916164525177635ca3186ab1b683172f8
partition_table/partition-table.bin      3 072 B   552bb58f7ba97390bcac984a9d7e698accac3d3d76cdad4c5166591ee2d18a1c
ota_data_initial.bin                     8 192 B   7d2c7ac4888bfd75cd5f56e8d61f69595121183afc81556c876732fd3782c62f
```

`partition-table.bin` y `ota_data_initial.bin` son **idénticos** al build previo:
el layout de flash no se ha tocado. Los otros dos cambian, como debe ser.

**Límite declarado:** demuestra que el árbol compila y enlaza, de forma
reproducible. **No reconstruye el binario flasheado físicamente** ni sustituye a
la validación de banco. Nada se ha flasheado desde este entorno.

## F-02 e identidad

```
IDENTITY_GENERATOR = UNIQUE     11 identidades en la fuente única
F02_BROKER_REAL    = PASS       observación real del mensaje, no código de salida
ACL_BROKER_REAL    = PASS
CLIENTID_BINDING_1883 / 9001    2 directivas / 2 listeners
ACL sin %c ni %u                0 líneas de REGLA (las 2 apariciones son comentarios
                                que explican justamente que no se usan)
```

Dos barreras independientes, ambas medidas contra un Mosquitto real: con la
directiva y **sin ella** —reproduciendo la condición del listener 9001— la ACL
deniega la suplantación por sí sola. Calibrado: una ACL permisiva pone rojos
exactamente los dos casos afectados y deja denegado el tercero.

## Contrato DO-only

ADR-0007: discriminador `detection_method` (`analog_envelope` |
`digital_threshold`), `schema_version` sigue en 1, el perfil analógico **no emite
el campo** — los payloads v1 anteriores no cambian ni un byte. Migración
PostgreSQL ejercida sobre base limpia y sobre esquema anterior **con filas**, y
`CHECK` ejercido con seis escrituras. `convalidated = t`.

## Gaps físicos residuales — NO bloquean esta promoción

Bloquean cualquier futura declaración `PHYSICAL_FIRMWARE = PRODUCTION_READY`.

| # | hallazgo | gate | estado |
|---|---|---|---|
| 1 | Valores del divisor | `HW-GAP` | **CERRADO 2026-08-24**: 10k + 18k E12 |
| 2 | D4-D9 sin sensores reales | `PHYSICAL-VALIDATION-GAP` | abierto; faltan 6 divisores |
| 3 | Endurance 1 h / registros fríos con 9 canales | `ENDURANCE-GAP` | abierto |
| 4 | `StoreProhibited` en timer de FreeRTOS | `FIRMWARE-GAP` importante | abierto, **sin causa** |
| 5 | `VERSIONR=0x00` intermitente | `NETWORK/HW-GAP` importante | abierto, **sin causa** |
| 6 | Adaptación de nivel ausente en KiCad | `HW-GAP` bloqueante PCB | abierto |

El #1 se cerró con la confirmación del operador y quedó registrado en
`docs/hardware/current/`. La causa raíz del sobrecalentamiento está **confirmada**:
`DO` de 5 V contra lógica de 3,3 V.

## Defecto de UTILLAJE registrado — no del producto

**`HARNESS-PGREP-AUTOCOINCIDENCIA`.** Un bucle de espera usaba
`pgrep -f "cp -a …"` para saber si una copia había terminado. Ese `pgrep`
**se encuentra a sí mismo**: la cadena buscada está en la línea de comandos del
propio shell que la ejecuta, así que la condición no puede cumplirse nunca. El
resultado fue una espera indefinida sobre una copia **ya terminada**, y el intento
de matarla con `pkill -f` repitió el error y se llevó por delante la propia orden.

No afecta a ningún artefacto ni medición: sólo retrasó una ejecución. Se registra
porque la corrección es reutilizable.

**Corrección:** esperar por **PID explícito** (`wait` sobre el hijo, o
`kill -0 $PID`), o verificar la **condición final** —tamaño y hash del destino
frente al origen, existencia del artefacto— en lugar de buscar la propia cadena
de comando. Si se usa `pgrep`/`pkill -f`, excluir el propio PID (`-v $$`) o
acotar por proceso padre.

Pertenece a la misma familia que los otros fallos mudos de esta ola —registro de
suite que no aplicó por un espacio, `INSERT` con errores redirigidos a
`/dev/null`, mutación que no compilaba y no mostró nada—: **confiar en que un
comando hizo lo esperado en vez de comprobar que lo hizo**.

## Regla permanente: parsear semántica, no contar coincidencias de texto

Durante esta congelación, un `grep` crudo de `%c|%u` sobre la ACL devolvió **2
coincidencias** y estuvo a punto de reportarse como incumplimiento. Las dos
estaban en **comentarios que explican precisamente que el fichero no las usa**.
Cero líneas de REGLA las contenían.

La regresión que vigila esa propiedad ya lo hacía bien —filtra las líneas
`topic`/`pattern` antes de mirar—, y por eso no se dejó engañar.

**Norma para todo el proyecto:** una comprobación de seguridad debe **parsear la
semántica de la configuración** siempre que sea posible, no contar apariciones de
una cadena. Un comentario que menciona `%c` no autoriza nada; una directiva
declarada una sola vez no aplica a todos los listeners; un `#define` presente no
significa que el runtime lo use. Contar texto produce **falsos positivos** —que
erosionan la confianza en el arnés— y **falsos negativos**, que son peores.

Precedentes en esta ola: la directiva `use_username_as_clientid` que existía en el
fichero pero faltaba en un listener, y el `#define` de polaridad que ninguna
prueba comprobaba pese a gobernar el runtime.

## Qué queda fuera de esta congelación

- `diana_prov_accepts_game()` existe y **nadie la llama**: un módulo sin autoridad
  sigue obedeciendo al plano GAME. `DEVICE_MANAGEMENT_PATH` es único **para las
  credenciales**, no cierra GAME. Se cablea en MP0-F, no antes.
- Sin `root_key` en NVS, D1b entra en **fallo cerrado permanente**. Integrarlo es
  correcto, pero **no aporta funcionalidad observable** hasta el carril de fábrica.
- **D1b NO SE COMPILA PARA EL OBJETIVO (O-3 del supervisor).** Los seis fuentes
  —`provisioning.c`, `prov_parse.c`, `prov_canonical.c`, `p256.c`, `seq_guard.c`,
  `base64url.c`, ~2 300 líneas— **están en el árbol pero NO en `SRCS` de
  `diana_core/CMakeLists.txt`**: sólo se añadió `shiftreg.c`. Se compilan y prueban
  únicamente con el gcc de host (x86-64); el toolchain xtensa **nunca los ha visto**.

  Es el estado esperado de una integración parada en el **paso 3 de 7** —el paso 4
  era precisamente el `CMakeLists`— pero no estaba declarado aquí, y tiene dos
  consecuencias que hay que decir:

  1. El `ESP_IDF_BUILD = PASS` de esta congelación **no incluye D1b**.
  2. **`DEVICE_MANAGEMENT_PATH = UNIQUE` NO está conseguido.** No puede afirmarse
     mientras el código de autoridad no forme parte del firmware.

  Riesgo medido, no supuesto: el supervisor añadió los seis fuentes al componente
  y recompiló con ESP-IDF v5.5 → **compila limpio para esp32s3, 0 errores y 0
  warnings**. El hueco es de integración, no de portabilidad.

- `SEQ_GUARD_FULL_ANTI_REPLAY = DEFERRED_TO_A3_B5`. Sólo se ejerce la superficie
  que D1b usa de verdad.
- **CORRECCIÓN (O-1 del supervisor).** Una versión anterior de este documento
  decía que «el broker sólo escucha en 8883 con TLS desde P0-2». Eso describe
  **producción y la rama `hotfix/p02-tls-6da16d4`, NO este árbol**. Medido:

  ```
  este árbol (5eedcb5)          listener 1883  ·  # listener 8883 comentado  ·  listener 9001
  hotfix/p02-tls-6da16d4        listener 8883  ·  listener 9001
  ```

  **Este árbol NO contiene el endurecimiento TLS de P0-2**, que sigue sin
  fusionar. Es deuda de integración declarada, no un defecto de la recomposición.

  Lo que sí es cierto en ambos sitios: el **firmware** sigue hablando
  `mqtt://…:1883` en claro, así que contra el broker de producción —que sólo
  escucha en 8883— hoy no puede conectar.

  Era el modo de fallo que este proyecto tiene registrado: leer una capacidad de
  otra rama y presentarla como propiedad del producto.
