# Evidencia — validación física 3×3 sobre `f273ec0`

```
SESSION              = physical 3x3 validation
DATE                 = 2026-09-09
MACHINE              = portatil de banco (Windows 11, ESP-IDF v5.5 nativo)
BRANCH               = mp0/integration
COMMIT               = f273ec0057261010772a5b7379f195086d3a1b40
FIRMWARE_APP_VERSION = f273ec0        (leido del binario en silicio)
ESP32                = ESP32-S3 (QFN56) rev v0.2, PSRAM octal 8 MB
MAC base / Ethernet  = 10:20:ba:4b:b7:04 / 10:20:ba:4b:b7:07
PUERTO               = COM6 (USB-Enhanced-SERIAL CH343)
ESP-IDF              = v5.5 (tag v5.5, 8c750b08); submodulo nimble modificado -> "v5.5-dirty"
FIRMWARE SIZE        = diana_firmware.bin 661 584 B (0xa1850)
```

Este documento **preserva** un baseline físico probado. No declara
`FIRMWARE_PHYSICAL_READY`, ni `PILOT_READY`, ni `PRODUCTION_READY`.

## Cerrado

```
ESP_IDF_BUILD         = PASS
BOOT                  = PASS
LED_D1_D9             = PASS
INPUT_D1_D9           = PASS
HIT_TEST_45           = PASS
HIT_TEST_90           = PASS
CROSSTALK             = PASS
D1B_COMPILE           = PASS
D1B_LINK              = PASS
D1B_RUNTIME_REACHABLE = PASS
```

## Resuelto

```
D6_ZERO_IN_90 = OPERATOR_OMISSION
D6            = HEALTHY
```

## Abierto

```
SENSOR_POWER_5V_UNDERSIZED = BLOCKING
SENSOR_POWER_RELIABILITY   = OPEN
W5500                      = PARTIAL
MQTT_TLS                   = NOT_RUN
GAME_E2E                   = NOT_RUN
RECONNECT                  = NOT_RUN
ENDURANCE_1H               = NOT_RUN
HOST_REGRESSION            = PARTIAL
SUPERVISOR                 = NOT_RUN
DOUBLE_IMPACT_CONTROL      = NOT_RUN
```

`NOT_RUN` significa **no ejecutado**. No es `PASS` ni `FAIL`.

## Evidencia destacada

```
220 activaciones analizadas en tres conjuntos independientes  (46 + 115 + 59)
modelo  eventos = activaciones - multi - suprimidas_por_refractario
        coincidio EXACTAMENTE en los tres:  46=46 · 111=111 · 58=58
la cola nunca crecio por encima de las activaciones -> cero duplicacion observada
38 golpes de crosstalk sobre D5 sin contaminacion a ninguna de las 8 vecinas
~341 s de idle acumulado sin un solo falso positivo  (221 s + 120 s)
```

El refractario por canal es `DIANA_DEFAULT_BLANKING_US = 60000` (60 ms) y la
ventana de agrupacion `DIANA_DEFAULT_GROUP_WINDOW_US = 2000` (2 ms); ambos
declarados `PENDING_PHYSICAL_TUNING` en el propio codigo.

## Hallazgos de documentación corregidos por esta sesión

- `W5500 SPI=OK` (`app_main.c:145`) imprime `diana_platform_eth_available()`, es
  decir **disponibilidad del driver**, no una lectura de VERSIONR. El firmware
  operativo nunca lee ese registro. Ademas ESP-IDF reintenta VERSIONR hasta
  `0x04` en `w5500_verify_id()`, de modo que un `0x00` inicial quedaria
  enmascarado.
- `HC165_SPI = 5 MHz` (en `evidencia-build-esp-idf.md`) es falso: el HC165 se
  lee por bit-banging GPIO con `esp_rom_delay_us(1)` por semiciclo (~500 kHz).
  El 5 MHz del arbol es `DIANA_ETH_SPI_HZ`, el SPI del W5500.
- `GAPS-MP0.md` mantiene `HW_GAP-74HC165` abierto y D4-D9 sin divisor. El
  operador confirma ambos resueltos, y las nueve dianas responden.

## Identidad usada

```
LAB/PILOT IDENTITY — NOT FACTORY PROVISIONING
```

Se escribieron **unicamente** `diana_id/module_id` y `diana_id/system_id` en
NVS, como blobs, para desbloquear el camino `impacto -> evento`. **No** se
escribio `root_key`, ni credenciales MQTT, ni contrasenas, ni CA. El modulo
sigue en `UNPROVISIONED` para D1b y falla cerrado, como debe.

## Artefactos binarios NO versionados

Conservados fuera de Git en `artifacts/firmware/2026-09-09-physical-3x3-f273ec0/`
(ruta ignorada). Su nombre, tamano y SHA-256 constan en `manifest.sha256`.

```
coredump-preexisting.bin   HISTORICAL_PREEXISTING_CRASH
                           NOT PRODUCED BY CURRENT f273ec0 SESSION
                           PRESERVED FOR FUTURE ANALYSIS
nvs-antes.bin              LOCAL_SENSITIVE_ARTIFACT · DO_NOT_COMMIT
nvs-lab-identity.bin       LOCAL_SENSITIVE_ARTIFACT · DO_NOT_COMMIT
```

El coredump se leyo de la particion `coredump` **antes** de flashear nada y
corresponde a un firmware anterior (`21c09db-dirty`, compilado con IDF 5.5.2).
La particion se borro despues, de modo que cualquier coredump posterior sera
inequivocamente nuevo. No debe atribuirse este crash a `f273ec0`.

## Verificar esta evidencia

```sh
cd docs/firmware/evidence/2026-09-09-physical-3x3-f273ec0
sha256sum -c manifest.sha256
```
