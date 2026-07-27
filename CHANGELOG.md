# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
Versionado semántico.

## [No publicado]

### Firmware ESP32-S3 — topología B y primera compilación real (2026-07-27)

#### Añadido

- **El firmware compila.** Primer `idf.py build` real del proyecto, con ESP-IDF
  v5.5.2 y destino `esp32s3`, en dos configuraciones: banco de fase 1 y módulo
  3×3. Hasta ahora todos los ficheros advertían «NO COMPILADO» en su cabecera.
- Selección de placa por `menuconfig` (`boards/diana_board.h`): banco de la
  fase 1 (devkit + módulos piezo comerciales) o módulo 3×3 definitivo.
- Transporte de red seleccionable: **WiFi** para desarrollar mientras no hay
  W5500, **Ethernet W5500** para producción (`net_wifi.c`). Ambos desembocan en
  el mismo `esp_netif`, así que MQTT, SNTP y OTA no cambian.
- `idf.ps1`: lanzador que prepara el entorno de ESP-IDF en Windows, donde
  `export.ps1` sólo afecta a la consola en la que se ejecuta.
- `sdkconfig.defaults.modulo` y `sdkconfig.defaults.prod`, para no mezclar la
  configuración de desarrollo con la del módulo y la de producción.
- Documentación: `docs/firmware/pinout-definitivo.md`,
  `fase1-protoboard.md` y `plan-cambios-firmware.md`.

#### Cambiado

- **Pinout migrado a la topología B.** La captura de impactos pasa de nueve
  interrupciones directas + multiplexor CD74HC4067 a **una interrupción
  agregada** (OR cableado de diodos) más un **74HC165** que identifica el
  canal, y ADC SPI externo. Cierra los hallazgos X-01 y X-04.
- La PSRAM se **desactiva** a propósito: el N16R8 la lleva octal y el N8R2
  quad, y arrancar con la configuración equivocada cuelga el módulo. El
  firmware cabe en la RAM interna, así que un mismo binario vale para ambas
  placas. No libera los GPIO 35–37, que siguen cableados a la PSRAM.
- El endurecimiento de producción (firma de imagen y NVS cifrada) sale de la
  configuración por defecto: exigía una clave que no está en el repositorio.

#### Corregido

- **`sdkconfig.defaults` hacía imposible compilar**: la firma de imagen exigía
  una clave inexistente, así que el build fallaba siempre (X-23).
- El pinout anterior usaba GPIO 33, 35, 36 y 37, ocupados por la PSRAM octal
  del N16R8, y el GPIO 3 de strapping como entrada analógica.
- `led_strip` ya no viene dentro de ESP-IDF: se declara como dependencia del
  gestor de componentes.
- `esp_task_wdt` vive dentro de `esp_system` desde ESP-IDF 5.x.
- El directorio `boards/` no estaba en ninguna ruta de inclusión.
- `SPI_FLASH_SEC_SIZE` se usaba sin incluir `spi_flash_mmap.h`.

#### Pendiente

- **Nada se ha grabado ni ejecutado sobre hardware.** Que compile no significa
  que funcione.
- X-24: contradicción en la polaridad del comparador entre el cálculo 02 §6 y
  la hoja 04. **WP-06 debe corregir el cálculo antes de fabricar.**
- El componente del ADC SPI externo sigue sin elegir, así que
  `piezo_amplitude` del módulo definitivo devuelve error a propósito en lugar
  de fingir una lectura.

### Añadido

- Estructura profesional del repositorio con separación firmware / servidor / contratos.
- Contratos MQTT v1 congelados: 12 esquemas JSON Schema 2020-12, definiciones comunes,
  16 ejemplos válidos y 12 inválidos, y validador ejecutable (`contracts/validate.py`).
- Modelo temporal de cuatro marcas (dispositivo, coordinador, recepción, persistencia),
  con el tiempo del servidor excluido del payload por contrato.
- ADR 0001-0006: stack del servidor, modelo temporal, idempotencia, estructura del
  repositorio, identidad de la VM y precisión no calculable.
- Documentos de coordinación: plan maestro, paquetes de trabajo, propiedad de rutas,
  dependencias, decisiones, riesgos, matriz de pruebas y estado.
- `CONTRIBUTING.md`, `SECURITY.md` y `.gitignore` con exclusión de secretos.

## [0.1.0] — punto de partida

- Dosier técnico del sistema modular de dianas 3×3 (v0.1).
