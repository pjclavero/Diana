# Firmware Diana · ESP32-S3 + W5500

Firmware de los módulos de dianas 3×3. Implementa WP-04.

## Estado real de este código

| Parte | Estado |
|---|---|
| Lógica de negocio (`components/diana_core`) | Suite host ampliada para DO-only; pendiente de ejecutar en este Windows por falta de `make`/`gcc` |
| Mensajes MQTT generados | Esquemas y ejemplos validados con `python contracts/validate.py` desde la raiz |
| Capa de plataforma ESP-IDF (`components/diana_platform_esp`) | Adaptada a HC165 DO-only; build ESP-IDF real ejecutado con ESP-IDF v5.5 |
| Aplicación (`main/`) | Imagen completa flasheada; sensores HC165, LED, selector, IDENTIFY y tareas de red activas |
| Pinout (`boards/`) | `esp32s3_proto_do_w5500.h`, perfil del prototipo fisico actual |
| Umbrales piezoelectricos | No aplican al perfil DO-only; debounce/refractory quedan `PENDING_PHYSICAL_TUNING` |

Validacion fisica del alcance actualmente montado, todavia incompleta para el
modulo final: ESP32-S3 flashea y arranca por COM6. El 2026-08-23, con 74HC165
sustituidos y divisores resistivos en D1-D3,
los sensores se midieron en reposo `0 V` e impacto hasta `5 V`, asi que el
perfil queda `DIANA_DO_ACTIVE_HIGH`. La lectura serie quedo en reposo
`raw=0x0000`; se capturaron impactos reales D1=`0x0001`, D2=`0x0002` y
D3=`0x0004` sin reinicio. Los 9 aros WS2812B estan conectados; el test
individual valido los nueve aros, con 24 LED por aro y un unico aro encendido
en cada paso. Las filas corresponden a D1-D3, D4-D6 y D7-D9. La prueba
minima basada en el driver oficial W5500 de ESP-IDF 5.5 valido SPI, enlace y
DHCP (`192.168.1.168`) con GPIO10-13, RST/INT sin usar y sondeo de 10 ms. El
firmware completo reconoce el W5500 a 5 MHz tras reiniciar su alimentacion.
La caida que parecia originarse en el temporizador Ethernet quedo aislada el
2026-08-24: el autodiagnostico desbordaba la pila de `app_main` al reservar un
JSON de 3072 bytes. Los mensajes grandes pasan ahora por heap y la pila de
arranque es de 8192 bytes. El firmware completo flasheado queda estable con
`W5500 SPI=OK`; sin RJ45 informa correctamente `LINK=DOWN` e `IP=0.0.0.0`.
La imagen de operacion permanecio mas de seis minutos con todas las tareas,
golpes D1-D3 e IDENTIFY, sin reinicios, watchdog ni errores de memoria. Falta
repetir DHCP/MQTT con el cable conectado y aprovisionar `module_id`. La fuente
de verdad de este montaje es `docs/hardware/current/`, comenzando por
`docs/hardware/current/estado-actual.md`.

## Por qué la lógica se prueba en PC

El paquete es de riesgo alto (tiempo, cola persistente, OTA), por lo que la
arquitectura separa la logica portable de la plataforma ESP-IDF. Esto permite
probar la mayor parte del comportamiento sin depender de una placa conectada:

```
components/diana_core/     lógica pura, C11, sin ESP-IDF  -> se prueba en PC
components/diana_hal/      interfaz del hardware (solo cabeceras)
components/diana_platform_esp/  implementación real sobre ESP-IDF
test_host/                 implementación de simulación   -> permite la prueba
```

`diana_core` no incluye ni una cabecera de Espressif. Todo lo que necesita del
hardware pasa por la tabla de punteros de `diana/hal.h`. Eso permite ejecutar de
verdad las máquinas de estados, la cola, la idempotencia, el crosstalk, la
validación de comandos y las decisiones de OTA con un `gcc` normal.

## Ejecutar la suite

Una sola orden, desde la raíz del repositorio:

```bash
make -C firmware test
```

Compila con `-Wall -Wextra -Werror -Wconversion`, ejecuta la suite en C y luego
valida contra los esquemas congelados:

```
 TOTAL: 389 comprobaciones, 389 correctas, 0 fallidas
 18 mensajes generados por el firmware comprobados
 CONTRATO: conforme
```

Otros objetivos: `make -C firmware build`, `contracts`, `clean`.

## Compilar para el ESP32-S3

```bash
cd firmware/esp32
idf.py set-target esp32s3
idf.py fullclean
idf.py build
```

Requiere ESP-IDF v5.x. En este Windows se localizo ESP-IDF v5.5, Ninja y el
toolchain. El build y flash real se ejecutaron en COM6 con:

```cmd
idf.py -DCMAKE_MAKE_PROGRAM=C:/Espressif/tools/ninja/1.12.1/ninja.exe -p COM6 build flash monitor
```

El puerto COM6 corresponde al ESP32-S3 visto en banco (`MAC:
10:20:ba:4b:b7:04`). No flashear sin confirmar puerto si cambia la enumeracion
USB.

## Estructura

```
firmware/esp32/
├── CMakeLists.txt              proyecto ESP-IDF
├── sdkconfig.defaults          watchdog, OTA, coredump, firma, NVS cifrada
├── partitions.csv              OTA A/B + NVS + partición de cola de eventos
├── boards/                     perfil proto-do-w5500 y pinouts historicos
├── components/
│   ├── diana_core/             lógica pura (probada)
│   ├── diana_hal/              interfaz del HAL
│   └── diana_platform_esp/     W5500, MQTT, NVS, HC165, LED, OTA
├── main/                       aplicación, bring-up y tareas
├── diagnostics/                proyectos mínimos reutilizables de banco
├── test_host/                  HAL de simulación + suite de pruebas
├── tools/                      validador de mensajes contra el contrato
└── build-host/                 salida de la compilación en PC (ignorada por git)
```

## Divergencia abierta con el contrato

Una sola, y deliberada. El firmware es **más estricto** que el contrato en un
punto, siguiendo la corrección (c) del hallazgo H-05:

| | Contrato | Firmware |
|---|---|---|
| `expires_in_ms` de `reboot`, `set_maintenance`, `start_calibration` | hasta 600 000 ms | **máximo 15 000 ms** |

Diez minutos de validez para un `reboot` (caso T18 de la auditoría) es una
ventana de reproducción grande para una orden que deja el módulo fuera de
servicio. El firmware la acota y **rechaza explícitamente** con motivo trazable
en `last_command.detail`, en vez de aceptar en silencio.

Consecuencia a tener en cuenta: un backend que emita hoy un `reboot` con 600 000
ms recibirá un rechazo. **Requiere ratificación en `contracts/mqtt/README.md`**;
si el contrato decide otro techo, se cambia la constante
`DIANA_CMD_CRITICAL_MAX_EXPIRES_MS` y basta.

Nota aparte: `contracts/mqtt/README.md` §6 todavía dice que la caducidad se mide
«desde la recepción del canal». El firmware ya implementa la corrección de H-05
(medir contra `issued_at_ms`), así que el texto del contrato va por detrás del
código en ese punto concreto.

## El contrato manda

`contracts/` está **congelado**. El firmware deriva de él, no lo copia a mano:

- Los enumerados de `src/types.c` se comparan automáticamente con los `enum` de
  los esquemas en cada `make test`. Si divergen, la suite falla.
- Cada mensaje que el firmware sabe generar se vuelca a disco durante las
  pruebas y se valida contra su JSON Schema real.
- QoS y `retain` de cada tópico están codificados según la tabla del contrato,
  incluido que un `hit` **nunca** se retiene.
- El Last Will es literalmente el del contrato §3, comprobado carácter a
  carácter en `test_reconnect.c`.

## Decisiones que conviene conocer

- **`event_us` sale de `esp_timer_get_time()`**, no de los ticks de FreeRTOS ni
  de la hora de pared. El dosier §14.2 exige resolución de 1 ms; los ticks no
  llegan y el reloj de pared puede no estar sincronizado.
- **`local_sequence` se persiste por bloques reservados** (64 por defecto). Al
  arrancar se reserva un bloque entero, así que un corte de corriente puede
  hacer que la secuencia salte hacia delante, pero **nunca** que se repita.
- **La caducidad de comandos se mide contra `issued_at_ms`** (hallazgo H-05).
  Medida desde la recepción, QoS 1 reiniciaba la ventana en cada reentrega y no
  protegía de nada. Esto obliga a hora de pared: el módulo arranca SNTP al
  obtener IP y, si no la consigue, acepta el comando **declarándolo** y se apoya
  en el nonce persistido.
- **El último nonce por emisor se persiste en NVS.** Una caché en RAM se perdía
  al reiniciar y reabría la ventana de reproducción entera.
- **Ningún módulo escribe en el tópico de otro** (hallazgo H-01). El coordinador
  no reescribe el `hit` del satélite: publica T2 en `system/…/game/event` con
  `hit_event_id`. Impuesto en código, no sólo documentado.
- **`client_id` MQTT = `module_id`**, sin prefijo: la ACL del broker depende de
  esa igualdad exacta.
- **La cola guarda estructuras, no JSON.** Así el reenvío marca `replay=true`
  sin tocar el `event_id`.
- **La OTA falla cerrada**: sin verificador de firma disponible, se rechaza. Y
  la prohibición durante partida se comprueba antes que nada.
