# Firmware Diana · ESP32-S3 + W5500

Firmware de los módulos de dianas 3×3. Implementa WP-04.

## Estado real de este código

| Parte | Estado |
|---|---|
| Lógica de negocio (`components/diana_core`) | **compilada y probada en host**, 338 comprobaciones en verde |
| Mensajes MQTT generados | **validados contra los JSON Schema congelados** de `contracts/mqtt/` |
| Capa de plataforma ESP-IDF (`components/diana_platform_esp`) | **escrita, NUNCA compilada**: no hay ESP-IDF en el entorno de desarrollo |
| Aplicación (`main/`) | **escrita, NUNCA compilada** |
| Pinout (`boards/`) | **propuesta preliminar**, ningún pin verificado sobre hardware |
| Umbrales piezoeléctricos | **provisionales, SIN calibrar**: no hay hardware |

Nada de lo que toca hardware se ha ejecutado. Ver
`docs/firmware/validacion-fisica-pendiente.md` para el listado completo de lo
que falta comprobar y cómo.

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
 TOTAL: 338 comprobaciones, 338 correctas, 0 fallidas
 15 mensajes generados por el firmware comprobados
 CONTRATO: conforme
```

Otros objetivos: `make -C firmware build`, `contracts`, `clean`.

## Compilar para el ESP32-S3 (no verificado)

```bash
cd firmware/esp32
idf.py set-target esp32s3
idf.py build flash monitor
```

Requiere ESP-IDF v5.x. **Este build nunca se ha ejecutado.** Es previsible que
la primera compilación real requiera ajustes en nombres de API y en la lista de
`REQUIRES` de los componentes.

## Estructura

```
firmware/esp32/
├── CMakeLists.txt              proyecto ESP-IDF
├── sdkconfig.defaults          watchdog, OTA, coredump, firma, NVS cifrada
├── partitions.csv              OTA A/B + NVS + partición de cola de eventos
├── boards/                     pinout preliminar por placa
├── components/
│   ├── diana_core/             lógica pura (probada)
│   ├── diana_hal/              interfaz del HAL
│   └── diana_platform_esp/     W5500, MQTT, NVS, piezo, LED, OTA (sin compilar)
├── main/                       aplicación y tareas (sin compilar)
├── test_host/                  HAL de simulación + suite de pruebas
├── tools/                      validador de mensajes contra el contrato
└── build-host/                 salida de la compilación en PC (ignorada por git)
```

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
- **La caducidad de comandos se mide sobre el reloj monotónico** desde la
  recepción, no restando `issued_at_ms` de la hora local: un módulo con el reloj
  atrasado no debe poder aceptar órdenes viejas.
- **La cola guarda estructuras, no JSON.** Así el reenvío marca `replay=true`
  sin tocar el `event_id`.
- **La OTA falla cerrada**: sin verificador de firma disponible, se rechaza. Y
  la prohibición durante partida se comprueba antes que nada.
