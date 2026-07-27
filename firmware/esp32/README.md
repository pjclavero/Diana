# Firmware Diana · ESP32-S3 + W5500

Firmware de los módulos de dianas 3×3. Implementa WP-04.

## Estado real de este código

| Parte | Estado |
|---|---|
| Lógica de negocio (`components/diana_core`) | **compilada y probada en host**, 389 comprobaciones en verde |
| Mensajes MQTT generados | **validados contra los JSON Schema congelados** de `contracts/mqtt/` (18 mensajes) |
| Capa de plataforma ESP-IDF (`components/diana_platform_esp`) | **COMPILA** con ESP-IDF v5.5.2 para esp32s3, en las dos configuraciones |
| Aplicación (`main/`) | **COMPILA** |
| Pinout (`boards/`) | **propuesta**, ningún pin verificado sobre hardware |
| Umbrales piezoeléctricos | **provisionales, SIN calibrar**: no hay hardware |
| Ejecución sobre placa | **NUNCA se ha grabado ni arrancado** |

Que compile no significa que funcione: **nada se ha ejecutado sobre hardware**.
Ver `docs/firmware/validacion-fisica-pendiente.md` para lo que falta comprobar.

## Por qué la lógica se prueba en PC

El paquete es de riesgo alto (tiempo, cola persistente, OTA) y el entorno de
desarrollo no tiene ESP-IDF, ni placa, ni permisos de administrador. La
arquitectura resuelve eso separando en dos:

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

## Compilar y grabar en el ESP32-S3

Requiere ESP-IDF **v5.5.2**. En Windows, `export.ps1` solo afecta a la consola
donde se ejecuta, así que hay un lanzador que lo hace por ti:

```powershell
cd firmware/esp32
.\idf.ps1 set-target esp32s3
.\idf.ps1 build
.\idf.ps1 flash monitor
```

La grabación es por el **USB nativo del ESP32-S3** (no hace falta sonda ni
adaptador). Para salir del monitor: `Ctrl+]`.

### Las dos configuraciones

| Configuración | Para qué | Cómo |
|---|---|---|
| **Fase 1** (por defecto) | Devkit + 2 módulos piezo comerciales + WiFi. Es con lo que se desarrolla hoy. | `.\idf.ps1 build` |
| **Módulo 3×3** | PCB topología B + Ethernet W5500. **La PCB no existe todavía**; se mantiene compilable para que un cambio no la rompa en silencio. | `.\idf.ps1 -B build_modulo -DSDKCONFIG_DEFAULTS="sdkconfig.defaults;sdkconfig.defaults.modulo" -DSDKCONFIG="build_modulo/sdkconfig" build` |

Placa, transporte de red, credenciales WiFi y polaridad del comparador se
eligen en `.\idf.ps1 menuconfig` → *Diana · configuracion del modulo*.

### Antes de grabar por primera vez

Pon el SSID y la contraseña de tu red en `menuconfig`, o el módulo arrancará y
se quedará reintentando la conexión (seguirá funcionando y encolando eventos en
local, que es lo que exige el dosier §14.3, pero no publicará nada).

### Endurecimiento de producción

`sdkconfig.defaults` **no** activa la firma de imagen ni el cifrado de NVS: sin
la clave de firma —que no está ni debe estar en el repositorio— el build
fallaría. Esos ajustes viven aparte:

```powershell
.\idf.ps1 -DSDKCONFIG_DEFAULTS="sdkconfig.defaults;sdkconfig.defaults.prod" build
```

### PSRAM desactivada a propósito

El N16R8 lleva PSRAM octal y el N8R2 la lleva quad: arrancar con la
configuración equivocada cuelga el módulo. Como el firmware cabe de sobra en la
RAM interna, se desactiva y **el mismo binario vale para las dos placas**. Esto
no libera los GPIO 35–37, que siguen cableados a la PSRAM dentro del módulo.

## Estructura

```
firmware/esp32/
├── CMakeLists.txt              proyecto ESP-IDF
├── idf.ps1                     lanzador que prepara el entorno de ESP-IDF
├── sdkconfig.defaults          base común: watchdog, OTA, coredump, particiones
├── sdkconfig.defaults.modulo   añade PCB topología B + Ethernet W5500
├── sdkconfig.defaults.prod     añade firma de imagen y NVS cifrada (necesita clave)
├── partitions.csv              OTA A/B + NVS + partición de cola de eventos
├── boards/
│   ├── diana_board.h           selector: incluye el pinout según menuconfig
│   ├── esp32s3_topoB_fase1.h   banco de pruebas (devkit + módulos comerciales)
│   └── esp32s3_w5500_topoB.h   módulo 3×3 definitivo
├── components/
│   ├── diana_core/             lógica pura (probada en host)
│   ├── diana_hal/              interfaz del HAL
│   └── diana_platform_esp/     red, MQTT, NVS, piezo, LED, OTA
├── main/                       aplicación y tareas
├── test_host/                  HAL de simulación + suite de pruebas
├── tools/                      validador de mensajes contra el contrato
└── build-host/                 salida de la compilación en PC (ignorada por git)
```

## Cómo se captura un impacto

No hay nueve interrupciones: **no caben** en el presupuesto de GPIO
(`hardware/electronics/calculations/03-presupuesto-gpio.md`). Las salidas de los
comparadores se combinan por diodos en un único `IRQ_ANY` y la identidad del
canal se lee después de un registro de desplazamiento 74HC165.

El reparto de responsabilidades es lo delicado:

1. **La ISR** (en IRAM, para sobrevivir a una escritura OTA) hace lo mínimo:
   anota el reloj monotónico y avisa. Ese instante es el `event_us` del evento y
   no puede depender de cuándo se llegue a atender el aviso.
2. **La tarea de piezo** lee el 74HC165, traduce bits a canales y encola un
   disparo por canal activo, todos con el instante de la ISR.
3. **`diana_core`** agrupa en la ventana de 1–3 ms y decide por amplitud
   (dosier §9.6). No sabe nada de todo lo anterior.

Se pierde el orden temporal entre canales dentro de una misma lectura (decenas
de µs). El algoritmo especificado decide por amplitud, no por orden, así que no
se pierde funcionalidad exigida — **pero hay que confirmarlo en banco**.

En la PCB definitiva hay además un peligro de arranque (decisión D-15): el
umbral lo genera un PWM filtrado, y con el PWM a cero **todos los comparadores
quedan disparados**. Por eso el driver fija el umbral y espera a que el filtro
RC se asiente *antes* de habilitar la interrupción.

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
