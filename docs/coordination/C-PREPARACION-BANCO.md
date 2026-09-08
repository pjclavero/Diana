# C · Preparación del banco físico

> **Qué es este documento.** El banco es caro: hay una placa, un rato y una
> persona delante. Este documento existe para que esa sesión **no se gaste
> descubriendo problemas que se podían encontrar sin placa**.
>
> **Qué NO es.** No es un informe de validación. Nada de lo que aquí se describe
> como comportamiento del transporte MQTT contra el broker real está medido:
> esta preparación se hizo **sin ESP32, sin puerto serie, sin flasheo, sin GPIO
> y sin instrumentación**. Todo lo que dependa de placa aparece nominado como
> `PENDING_PHYSICAL_VALIDATION` en la §5.

Carril: **C · PHYSICAL TRANSPORT (preparación)** · rama `lane/phys-prep`.

---

## 0. Estado de partida, verificado sobre el HEAD (no supuesto)

Antes de planificar nada se comprobó el árbol, porque circulaba un informe
anterior que decía que el firmware seguía conectando en claro:

| Afirmación que circulaba | Estado real en este HEAD |
|---|---|
| «`mqtt://…:1883` está cableado en `app_main.c`» | **Falso hoy.** Fue cierto históricamente. `app_main.c` construye la URI con `diana_mqtt_uri(CONFIG_DIANA_BROKER_HOST, CONFIG_DIANA_BROKER_PORT, transport, …)`; el esquema por defecto es `mqtts://`, el puerto por defecto 8883 y configurable. |
| «no hay verificación del broker» | **Falso.** CA empotrada por `EMBED_TXTFILES`, `verification.certificate` explícito, `skip_cert_common_name_check` deliberadamente **no escrito** (queda en su valor por defecto, que deja la verificación de hostname **activa**). |
| «puede caer a texto en claro si falla el TLS» | **Falso.** Fallo cerrado en dos capas (`app_main.c` y `mqtt_client.c`) y **sin fallback**. `mqtt://` solo existe bajo `CONFIG_DIANA_MQTT_INSECURE_LAB`, desactivado por defecto. |

**No se abrió trabajo por esa supuesta carencia.** El trabajo de este carril
ataca lo que sí estaba abierto: que la CA pudiera degradarse en silencio (§1) y
que un fallo en el banco fuera indistinguible entre seis capas (§2).

---

## 1. Checklist de configuración del ESP32

Se rellena **antes** de encender. Cada fila dice de dónde sale el valor y qué
pasa si está mal, porque el modo de fallo es distinto en cada una.

### 1.1 Compilación (`idf.py menuconfig` → *Diana · configuracion del modulo*)

| # | Opción | Valor | De dónde sale | Si está mal |
|---|---|---|---|---|
| C1 | `DIANA_BROKER_HOST` | IP o nombre del Mosquitto | infraestructura | **Trampa:** tiene que coincidir con el **SAN del certificado del broker**. Si el broker se configura por IP y esa IP no está en el SAN, el handshake falla con `[HOSTNAME]`. Es el fallo más probable del banco. |
| C2 | `DIANA_BROKER_PORT` | `8883` | P0-2 | Puerto cerrado o equivocado ⇒ `[TCP]`, errno `ECONNREFUSED`. El puerto **no** decide el cifrado. |
| C3 | `DIANA_MQTT_INSECURE_LAB` | **`n`** | — | En `y` el arranque grita cinco líneas de aviso y conecta **en claro**. Ninguna imagen de operación puede llevarlo. Compruébese en el log de arranque, no en el `sdkconfig`. |
| C4 | `DIANA_NTP_HOST` | backend | — | Sin hora, el módulo **sigue operando** pero no verifica la caducidad de comandos (H-05); además un certificado válido puede verse `[CERT] caducado / aún no válido` por el reloj. |
| C5 | `DIANA_BENCH_HIT_LED_TEST` | `n` salvo prueba de impacto | — | Deja D1-D3 armadas. Es un modo de banco, no de operación. |

### 1.2 Material empotrado (`main/certs/`) — ver `main/certs/README.md`

| # | Qué | Estado hoy | Comprobación |
|---|---|---|---|
| C6 | `broker_ca.pem` | **marcador no-PEM** (deliberado) | `python3 firmware/esp32/tools/check_broker_ca.py` |
| C7 | `broker_ca.sha256` (la **declaración**) | **`NONE`** | idem |

**Los dos se cambian juntos o no se cambia ninguno.** Con `NONE` y un PEM
plantado, la guarda se pone roja; con una huella declarada que no corresponde al
PEM, también. Y en el módulo, con TLS activo, una CA **no declarada** no
conecta: fallo cerrado, igual que si no hubiera CA (§1.3).

Para ponerla:

```sh
openssl x509 -in ca.crt -out firmware/esp32/main/certs/broker_ca.pem -outform PEM
openssl x509 -in firmware/esp32/main/certs/broker_ca.pem -noout -fingerprint -sha256 \
  | sed 's/.*=//; s/://g' | tr 'A-Z' 'a-z' \
  > firmware/esp32/main/certs/broker_ca.sha256
python3 firmware/esp32/tools/check_broker_ca.py     # tiene que quedar verde
```

### 1.3 Por qué hay una declaración de CA y no solo el PEM

`diana_mqtt_ca_is_valid()` solo exige que **haya** un PEM. Eso impide el fallo
silencioso de `certificate = NULL`, pero no impide el otro: que alguien
sustituya el marcador por un certificado de ejemplo —el de un tutorial, un
autofirmado, el `snakeoil` de Debian— porque «hacía falta un PEM para que
arrancase». Ese certificado pasa la validez sintáctica igual de bien que el
bueno, y convierte un fallo **ruidoso** en uno **silencioso** que no aparece
hasta el handshake.

La defensa es una **declaración explícita**: `broker_ca.sha256` dice qué huella
se espera, viaja empotrada en el mismo binario que el PEM, y el módulo las
compara al arrancar. Sustituir el certificado sin tocar la declaración deja el
módulo sin conectar y lo dice con las dos huellas delante:

```
E (…) diana: CA empotrada NO DECLARADA: MQTT NO se arranca
E (…) diana:   huella empotrada : 701bc43c…
E (…) diana:   huella declarada : cfd97aa3…
```

La huella es la de `openssl x509 -noout -fingerprint -sha256` (sobre el DER),
para que el operador pueda recalcularla con herramientas normales y no sea un
número mágico. Una prueba de host ata las dos: `test_mqtt_endpoint.c` hashea un
certificado real y compara contra el valor que imprimió openssl.

**Lista negra**: existe (`snakeoil`, `Internet Widgits`, `example.com`,
`test.mosquitto.org`…), pero **no es la defensa**. Sirve para que el mensaje
nombre al culpable cuando es un sospechoso habitual. La defensa es la
declaración, que rechaza cualquier certificado no declarado, esté o no en la
lista — y así se calibró (§4, escenario E2).

### 1.4 Identidad — invariante F-02

El usuario MQTT es **exactamente el `module_id`, sin prefijo**. No se configura
en Kconfig: sale de la identidad aprovisionada en NVS (`diana_id`, clave
`module_id`), y `diana_mqtt_username()` lo copia **literal**.

| # | Comprobar |
|---|---|
| C8 | En NVS hay `diana_id/module_id` y `diana_id/mqtt_pass`. Sin `module_id` el módulo arranca en **error** y no intenta MQTT: `modulo SIN aprovisionar`. |
| C9 | Ese `module_id` figura tal cual en `identities.json` y en el ACL generado del broker. |
| C10 | **Trampa documentada:** NVS tiene también una clave `mqtt_user`, y el firmware **NO la usa** — el usuario se deriva siempre del `module_id`. Escribir ahí un valor distinto no cambia nada y confunde el diagnóstico. Decisión del operador: dejarla vacía o alinearla. |

---

## 2. Diagnóstico distinguible: qué significa cada mensaje

Este es el trabajo de la §2 del encargo. Sin él, **los seis fallos se ven igual
desde fuera**: el módulo no publica. Cada capa tiene ahora un mensaje propio en
`mqtt_client.c`.

| Etiqueta | Qué ha pasado | Dónde mirar |
|---|---|---|
| `[TCP]` | No hay socket. `errno` + `strerror`. El TLS **ni se ha intentado**. | Cable, enlace W5500, IP, ruta, puerto cerrado, cortafuegos |
| `[TLS]` | Hay socket, el handshake no cuaja **antes** de validar la cadena: versión, cifrados, alerta del servidor. Se imprime `stack_err`. | Configuración TLS del Mosquitto |
| `[CERT]` | El handshake llega a validar y la cadena **no encaja**: el broker presenta un certificado de otra autoridad, caducado, aún no válido o revocado. | La CA empotrada no es la del broker |
| `[HOSTNAME]` | La cadena valida pero **el nombre no está en el CN/SAN**. | C1: el host configurado vs el SAN del certificado |
| `[AUTH]` | CONNACK rechaza credenciales: **rc=4** (MQTT 3.1.1) o **rc=135** (MQTT 5). TCP y TLS están **bien**. | Usuario (= `module_id` literal) y contraseña en el fichero de passwords |
| `[ACL]` | Autenticado sí, **autorizado no**. | El ACL del broker para ese usuario y ese tópico |

### 2.1 El caso que obliga a todo esto: `rc=0` no significa que fue bien

Medido: en MQTT 5 un fallo de **autenticación** da `rc=135`, pero una
**denegación de ACL en publicación devuelve `rc=0`** con un
`Warning: … Not authorized` **que solo existe en el log del broker**. El código
de salida no las distingue.

Desde el cliente, un PUBLISH denegado y uno aceptado son idénticos. La única
señal observable es **el PUBACK que no llega**. Por eso el firmware ahora:

- atiende `MQTT_EVENT_PUBLISHED` (el PUBACK) y lleva **dos contadores
  separados**: publicaciones entregadas al cliente (`mqtt_pub_sent`, solo QoS>0)
  y confirmadas (`mqtt_pub_acked`);
- **avisa solo** cuando lleva 16 publicaciones QoS 1 sin un solo PUBACK estando
  conectado, nombrando el tópico:
  `[ACL] 16 publicaciones QoS1 SIN un solo PUBACK…`;
- imprime ambos contadores en cada desconexión.

Para la **suscripción** sí hay señal directa: el SUBACK devuelve `0x80` y
esp-mqtt lo marca como `MQTT_ERROR_TYPE_SUBSCRIBE_FAILED` ⇒
`[ACL] SUBACK 0x80: el broker DENIEGA la suscripcion`.

Y un mensaje que **acota muchísimo** cuando aparece:

```
I (…) diana.mqtt: [OK] CONNACK aceptado: TCP+TLS+cert+hostname+auth correctos (sesion #1)
```

Si sale, cinco capas están descartadas de golpe. Todo lo que falle después es
**ACL o lógica**.

### 2.2 Límite honesto

esp-mqtt no siempre rellena todos los campos del `error_handle`. Cuando el
handshake falla sin banderas de verificación, lo único que se puede afirmar es
`[TLS] el handshake no cuaja`, y así se dice: **no se adivina la causa**.

---

## 3. Orden exacto de la sesión de banco

Del arranque a `provision/state`. Cada paso: **qué observar** y **qué
significaría el fallo**. Nada de esto se ha ejecutado.

| # | Paso | Qué observar | Si falla |
|---|---|---|---|
| **B0** | *(previo, sin placa)* `make -C firmware test` y `check_broker_ca.py` en verde sobre el commit que se va a flashear | `TOTAL`, `MQTT/TLS`, `BROKER_CA` sin fallos | No se flashea. Un banco sobre un árbol rojo no mide nada |
| **B1** | Alimentar y abrir consola serie **antes** de que arranque | Cabecera `DIANA HARDWARE BRING-UP`, `board:` | Sin consola no hay diagnóstico: todo lo demás es adivinar |
| **B2** | Leer el bloque de bring-up | `selector`, `HC165 RAW`, `D1..Dn` | **`HW_GAP` conocido y bloqueante: el 74HC165 está quemado.** Ver §5. Un `HC165 RAW` constante lo confirma |
| **B3** | Ethernet | `W5500 SPI=OK`, `LINK=UP`, `IP=` no `0.0.0.0` | `SPI` mal ⇒ cableado/reset. `LINK=DOWN` ⇒ cable. Sin IP ⇒ DHCP. **No se continúa a B4** |
| **B4** | Comprobar que **no** aparece el aviso de laboratorio | Las cinco líneas `PERFIL DE LABORATORIO` **no** deben salir | Si salen, la imagen es insegura: se descarta y se recompila (C3) |
| **B5** | Puerta de CA | No debe salir `CA del broker ausente o invalida` ni `CA empotrada NO DECLARADA` | El segundo imprime las dos huellas: compárense y arréglese `main/certs/` (§1.2) |
| **B6** | URI e identidad | `broker mqtts://<host>:8883, usuario '<module_id>'` — **sin prefijo** | Un usuario con prefijo reabriría F-02. El puerto 1883 aquí sería una regresión de P0-2 |
| **B7** | Handshake y CONNACK | `[OK] CONNACK aceptado: TCP+TLS+cert+hostname+auth correctos` | Cualquier `[TCP]`/`[TLS]`/`[CERT]`/`[HOSTNAME]`/`[AUTH]`: tabla §2. **Es aquí donde el diagnóstico por capas ahorra la sesión** |
| **B8** | Suscripciones | Cuatro `[OK] suscripcion concedida` + la de `game/state` | `[ACL] SUBACK 0x80` ⇒ ACL del broker, no credenciales |
| **B9** | Presencia / LWT | El backend ve al módulo `online` en el tópico de presencia retenido | Conectado pero sin presencia visible ⇒ **ACL de publicación**. Confírmese con B10 |
| **B10** | Primer evento con PUBACK | No aparece `[ACL] 16 publicaciones QoS1 SIN un solo PUBACK` | Si aparece: autenticado sí, autorizado no. Mírese el log **del broker** (`Not authorized`), que es donde está el detalle |
| **B11** | `provision/state` | El módulo publica su estado de aprovisionamiento | Sin `root_key` en NVS el contexto está en **fallo cerrado** y rechaza toda credencial: es el comportamiento correcto mientras no exista el utillaje de fábrica, **no** un fallo del banco |

**Regla de la sesión:** no se salta un paso. B7 sin B3 es un `[TCP]` garantizado
y quince minutos perdidos.

---

## 4. Qué se puede diagnosticar sin osciloscopio y qué no

### Sin instrumentación: la consola serie basta

Todo el camino MQTT. Las seis capas de §2 se separan **leyendo el log**, que es
justamente el trabajo de este carril. También: presencia del W5500 por SPI,
enlace y DHCP, identidad cargada de NVS, puerta de CA, y ACL de suscripción
(SUBACK 0x80) y de publicación (contadores de PUBACK).

Con un PC en la misma red se añade, sin tocar la placa:

- `openssl s_client -connect <host>:8883 -showcerts` → ver el certificado que
  **de verdad** presenta el broker y su SAN (resuelve C1 y `[HOSTNAME]` sin
  reflashear);
- `mosquitto_sub -u <module_id> -P … --cafile ca.crt -p 8883` → separar «el
  broker no autoriza» de «el módulo no publica»;
- el **log del broker**, único sitio donde aparece el `Not authorized` de una
  denegación de ACL en publicación.

### Con multímetro

Tensiones de raíl, continuidad, y el estado estático de las líneas del 74HC165.

### Requiere osciloscopio o analizador lógico — **no se puede afirmar sin él**

- Integridad del bus SPI del W5500 a velocidad real (flancos, `RSTn`).
- **La cadena de captura del impacto**: anchura y rebotes del pulso del sensor
  DO. Ningún log distingue «el sensor no dispara» de «dispara y el firmware lo
  filtra».
- Transitorios de alimentación al encender los LED (caída y recuperación).
- Temporización del `74HC165` (latch/clock) — irrelevante mientras el
  `HW_GAP` siga abierto.

### No se puede diagnosticar de ninguna manera en este banco

Que la CA declarada sea **la del broker de producción**. La declaración ata el
binario a *un* certificado concreto y hace visible cualquier cambio; que ese
certificado sea el correcto **solo lo demuestra el handshake contra el broker
vivo**. Residual declarado, y así consta en la salida de la guarda.

---

## 5. `PENDING_PHYSICAL_VALIDATION` abiertos hoy — nominados

| Id | Qué está sin validar | Bloquea | Cómo se cierra |
|---|---|:---:|---|
| **PPV-C1** | El handshake TLS real contra el Mosquitto de producción: cadena, SAN y hostname | **Sí** | B7 con la CA de producción puesta y declarada |
| **PPV-C2** | Que la CA declarada sea la del broker real (la declaración solo ata el binario a *un* certificado) | **Sí** | B7 |
| **PPV-C3** | Autenticación real: `module_id` literal + password contra el fichero del broker | **Sí** | B7, `[AUTH]` ausente |
| **PPV-C4** | ACL real de publicación. Lo único que se preparó es **hacerla visible**; no está medida | **Sí** | B9-B10 |
| **PPV-C5** | Que los mensajes por capa se emitan **de verdad** en la placa. Están fijados estructuralmente sobre el fuente y el ELF enlaza; **ninguno se ha visto impreso** | No | B7 provocando cada fallo a propósito |
| **PPV-C6** | El umbral de 16 publicaciones sin PUBACK. Es un valor **elegido, no medido**: podría avisar tarde o disparar por congestión legítima | No | B10, y ajustar si el banco lo desmiente |
| **PPV-C7** | Reconexión tras caída del broker con sesión persistente | No | Parar y arrancar Mosquitto durante B10 |
| **PPV-C8** | `provision/state` de extremo a extremo | No | B11, con utillaje de fábrica |
| **PPV-C9** | **`HW_GAP`: el 74HC165 está quemado.** La cadena de captura de impacto no es validable con esta placa | **Sí, para D*** | Sustituir el integrado. No es trabajo de firmware |
| **PPV-C10** | Consumo, térmica y transitorios | No | Ver `docs/hardware/VALIDACION-FISICA-PENDIENTE.md` (47 validaciones, ninguna ejecutada) |

---

## 6. Lo que exigirá decisión del operador en el banco

Ninguna de estas la puede tomar un agente, y todas detienen la sesión si se
llega a ellas sin haberlas pensado:

1. **Qué CA se declara.** Requiere el `ca.crt` del Mosquitto de producción. Sin
   ese fichero el módulo **no conectará** por diseño: `NONE` no es un estado
   provisional que el banco pueda saltarse. *(PPV-C1/C2)*
2. **Host por IP o por nombre.** Si se configura por IP, esa IP tiene que estar
   en el SAN del certificado. Si no lo está, hay que **reemitir el certificado
   del broker** o pasar a nombre + DNS. Es un cambio de infraestructura, no de
   firmware, y es el fallo más probable de la sesión.
3. **Si se permite `DIANA_MQTT_INSECURE_LAB` en algún momento.** Recomendación:
   **no**. El diagnóstico por capas hace innecesario «quitar el TLS para ver si
   es eso»; y una imagen de laboratorio que sobrevive a la sesión es una vía de
   regresión de P0-2.
4. **`diana_id/mqtt_user` en NVS**, que el firmware ignora (C10): dejarla vacía
   o alinearla con `module_id`.
5. **Si se sustituye el 74HC165** antes o después de la sesión de transporte.
   Son independientes: PPV-C1..C4 se pueden cerrar con el `HW_GAP` abierto.
6. **Qué hacer si aparece `[ACL]`**: tocar el ACL del broker es un cambio en
   producción y requiere aprobación previa explícita.

---

## 7. Qué se dejó hecho en este carril, y cómo comprobarlo

```sh
make -C firmware test                                  # suite + todas las guardas
python3 firmware/esp32/tools/check_broker_ca.py        # C-1 y C-2, contador propio
./firmware/esp32/tools/ca_guard_calibration.sh         # CALIBRACIÓN: la guarda sabe ponerse roja
```

Estado medido en `lane/phys-prep`:

```
TOTAL:             1028 comprobaciones, 0 fallidas   (base: 1007)
MQTT/TLS:            26 estructurales, 0 fallidas    (sin cambio, contador separado)
BROKER_CA:           30 estructurales, 0 fallidas    (nuevo, contador propio)
PROVISION_BRIDGE:    38 estructurales, 0 fallidas    (sin cambio)
```

Build cruzado real con `espressif/idf:v5.5`, verificado **por sistema de
ficheros y `nm`, no por el log**:

```
BUILD_RC=0 · diana_firmware.bin 0xa1830 bytes
T diana_mqtt_ca_fingerprint      T diana_mqtt_ca_is_declared
D _binary_broker_ca_pem_start    D _binary_broker_ca_sha256_start
```

**Hallazgo del `objdump`, declarado:** el ELF contiene una llamada a
`esp_transport_ssl_enable_global_ca_store`, y su llamante es **`esp_mqtt_task`**
— código interno de esp-mqtt, no de Diana. Es una rama que esp-mqtt toma solo si
la configuración pide `use_global_ca_store`, cosa que este firmware nunca hace.
Lo que descarta esa rama no es el `nm` sino que **el identificador no aparece en
ninguna fuente de Diana**, y eso lo fija `check_mqtt_tls.py`. Se documenta para
que nadie lo reencuentre y lo confunda con un hallazgo.

---

## Comandos canónicos verificados (`CANONICAL_TEST_COMMANDS = VERIFIED`)

Existe esta sección porque `npm run test:unit` del backend **ejecutaba cero
tests y salía con código 1** durante un tiempo indeterminado, y era la puerta que
usa `.github/workflows/ci.yml` — la forma `--testPathIgnorePatterns=integration`
(con `=`) rompe el parseo de argumentos de jest. Nadie lo vio porque nadie
comprueba que el comando canónico *ejecute algo*.

Cada uno de estos se ha ejecutado y ha devuelto el `rc` indicado, con su cifra:

| comando | rc | qué mide |
|---|---|---|
| `make -C firmware test` | 0 | `HOST_SUITE` 1028 · `MQTT/TLS` 26 · `BROKER_CA` 30 · `PROVISION_BRIDGE` 38 |
| `python3 contracts/validate.py` | 0 | `CONTRACT_CHECKS` 89 |
| `bash scripts/security/secrets-scan.sh` | 0 | 971 ficheros rastreados |
| `bash scripts/security/secrets-scan.sh --self-test` | 0 | 9 calibraciones |
| `npm run test:unit` (en `server/backend`) | 0 | **961** tests · 3 pasadas seguidas |
| `npm test` (en `server/frontend`) | 0 | 308 tests · requiere `npm ci` antes |
| `bash tools/idf_verify_ca.sh` (en `firmware/esp32`, dentro de `espressif/idf:v5.5`) | 0 | guarda de la CA sobre el ELF |

**Regla permanente.** Un comando canónico que no ejecuta nada es peor que uno
que falla: el primero se lee como verde. Antes de apoyarse en cualquiera de
estos como puerta, comprobar que **la cifra de tests es mayor que cero**, no
sólo que el `rc` sea 0.

`npm test` en `server/backend` **NO es una puerta**: incluye las suites de
integración, levanta contenedores y es inestable por contención. La puerta es
`npm run test:unit`.

## Regla permanente para guardas de seguridad

`idf_verify_ca.sh` terminaba en `grep … && echo "HALLAZGO" || echo "ninguna"`, y
el `||` se tragaba el código: **devolvía 0 incluso encontrando una llamada a un
relajamiento de TLS**. Prohibido a partir de ahora:

```sh
# MAL: el rc lo decide el último comando de la tubería
grep -q PATRON "$f" && echo "HALLAZGO" || echo "ok"

# BIEN: acumular y cortar explícitamente
if grep -q PATRON "$f"; then HALLAZGOS=$((HALLAZGOS + 1)); fi
[ "$HALLAZGOS" -gt 0 ] && exit 1
```

Y toda guarda debe demostrarse **roja al menos una vez** sobre un artefacto que
de verdad incumpla. Esta se demostró: `rc=1` sobre un ELF de agosto sin la
declaración de huella, `rc=0` sobre el ELF recién construido.

## Regla permanente para exclusiones de escáneres

`secrets-scan.sh` excluía `*/testdata/*` en bloque: bastaba colocar una clave
privada real bajo un directorio con ese nombre. Y no compraba nada —
`git ls-files | grep /testdata/` devolvía **cero** ficheros.

**No se admiten exclusiones por patrón de ruta.** Una excepción se declara por
fichero y con su motivo. Una lista vacía es mejor que una excepción «por si
acaso»: la excepción por patrón la escribe el infractor.

---

# DECISIONES DEL OPERADOR PARA EL BANCO (cerradas)

Las dos que bloqueaban la sesión. Ya no hay que pensarlas con la placa delante.

## 1 · CA declarada = **CA privada de Diana**, no `NONE`

```
BROKER_CA         = Diana private CA
TLS_VERIFY        = REQUIRED
INSECURE_FALLBACK = FORBIDDEN
```

`NONE` es un estado de **preparación**, no una configuración válida de banco. El
banco debe probar exactamente el modelo que queremos conservar en producción: el
ESP32 valida una CA concreta, valida el nombre del broker, y **falla cerrado** si
la CA no está disponible.

**La CA pública va como material de confianza en el firmware.** La **clave
privada de la CA no entra en el ESP32 ni en el repositorio** — vive sólo en
`$CA_DIR` de la máquina de administración (ver `docs/security/pki-y-secretos.md`).

Antes del banco hay que rellenar `main/certs/broker_ca.pem` con la CA real y
`main/certs/broker_ca.sha256` con su huella:

```sh
openssl x509 -in ca.crt -noout -fingerprint -sha256
```

La guarda `diana_mqtt_ca_is_declared()` exige que coincidan. Un certificado
plantado que no case con la declaración **no conecta**, y eso está calibrado
(`tools/ca_guard_calibration.sh`, caso E2: certificado de nombre plausible,
ausente de toda lista negra, rechazado igualmente).

## 2 · Direccionamiento del broker = **NOMBRE**, no IP

```
BROKER_HOST       = mqtt.diana.local
BROKER_PORT       = 8883
BROKER_TRANSPORT  = mqtts
IP SAN            = opcional, NUNCA la identidad principal
```

**El motivo no es estético.** Si la identidad TLS es la IP, una decisión de red
pasa a formar parte del certificado: cada cambio de dirección obliga a reemitirlo
o a arrastrar SAN de IP adicionales. Con nombre, la IP cambia sin tocar la
identidad.

### Lo que había, y lo que se ha cambiado

`generate-certs.sh` emitía `IP:192.168.1.209` **para el camino de los módulos
ESP32, sin ningún nombre DNS**, y `CONFIG_DIANA_BROKER_HOST` traía esa misma IP
por defecto. Es decir, el árbol implementaba exactamente el anti-patrón.

Ahora:
- `MQTT_PUBLIC_NAME` (por defecto `mqtt.diana.local`) encabeza el SAN;
- la IP se conserva **como conveniencia secundaria**, no como identidad;
- `CONFIG_DIANA_BROKER_HOST` pasa a ser el nombre, con la razón escrita en su
  `help` para que nadie lo revierta a una IP sin leerla.

### Verificado ejecutando, no razonado

PKI generada con `NEW_CA=1` en un directorio efímero:

```
SAN emitido: DNS:mqtt.diana.local, DNS:mosquitto, DNS:localhost,
             IP Address:127.0.0.1, IP Address:192.168.1.209

openssl verify -verify_hostname mqtt.diana.local   -> VALIDA
openssl verify -verify_hostname mosquitto          -> VALIDA
openssl verify -verify_hostname broker.ajeno.local -> RECHAZADO
```

**Requisito para la red del banco:** el nombre debe resolver desde el módulo. No
hace falta montar DNS interno: basta que resuelva de forma controlada durante la
prueba. Lo que no admite excepción es que el nombre usado por el firmware
coincida **exactamente** con un `DNS:` del SAN.

## Gate del banco

Positivo, completo:
```
ESP32 real → Ethernet → resolve hostname → TLS 8883 → CA OK → hostname OK
  → MQTT auth → ACL → provision command → D1b → EXACTAMENTE 1 efecto
  → provision state → backend → PostgreSQL
repetir la MISMA orden → 0 efectos adicionales
```

Negativos obligatorios, cada uno con su capa distinguible en el log
(`[TCP] [TLS] [CERT] [HOSTNAME] [AUTH] [ACL]`):
```
CA incorrecta         -> FAIL            hostname incorrecto  -> FAIL
sin CA                -> FAIL CLOSED     certificado expirado -> FAIL
credencial incorrecta -> AUTH DENIED     ACL incorrecta       -> ACL DENIED
1883                  -> NO CONNECTION / NOT USED
```

Recordatorio que evita horas de depuración: **una denegación de ACL en
publicación devuelve `rc=0`**; sólo el fallo de autenticación da 135. El
diagnóstico por capas existe precisamente para separarlas.
