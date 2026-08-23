# Diana · Sistema modular de dianas electronicas 3x3

Plataforma de entrenamiento y juego con dianas luminosas modulares para proyectiles
ligeros. El prototipo fisico actual agrupa **3x3 dianas** gobernadas por un
**ESP32-S3**, sensores comerciales por salida digital `DO`, **9 aros WS2812B de
24 LED** y un modulo Ethernet **W5500** en bring-up. Hasta nueve modulos forman
una matriz logica de **9x9 (81 dianas)** coordinada por MQTT contra un servidor
Docker.

> Requisitos, arquitectura y fases: [`dosier_tecnico_matriz_dianas_modulares.md`](dosier_tecnico_matriz_dianas_modulares.md).
> Ese documento es la fuente normativa del producto. Para el montaje fisico real
> de banco manda [`docs/hardware/current/README.md`](docs/hardware/current/README.md).

---

## Principio crítico

```
El ESP32 registra el tiempo.
El coordinador valida la partida.
El servidor administra, guarda y visualiza.
```

La hora de llegada al servidor **nunca** sustituye a la del impacto. El modelo de cuatro
marcas temporales está descrito en [ADR-0002](docs/adr/0002-modelo-temporal.md) y se
impone por contrato: hay un ejemplo inválido que falla si alguien intenta colar una marca
de servidor en un payload MQTT.

## Estructura

```
firmware/esp32/   Firmware ESP-IDF del módulo. Aislado del resto.
server/           backend (NestJS) · frontend (React+Vite) · worker · database
contracts/        MQTT, API y esquemas. Fuente única compartida.
simulators/       Simulador de módulos: partidas completas sin hardware.
infrastructure/   Docker, Mosquitto, Postgres, proxy, backups, provisión, VM.
hardware/         Electrónica (KiCad, BOM, cálculos) y mecánica.
tests/            integración · e2e · carga · seguridad
docs/             arquitectura, ADR, API, MQTT, firmware, hardware, despliegue,
                  operación, seguridad, pruebas, coordinación, fases
```

El código del ESP32 vive **exclusivamente** bajo `firmware/esp32/`. Los contratos no se
copian a mano entre firmware y backend: ambos derivan de `contracts/`.

## Hardware real actual

La fuente de verdad del prototipo montado esta en
[`docs/hardware/current/README.md`](docs/hardware/current/README.md).

Resumen de banco:

- MCU: ESP32-S3, firmware `PROTO_DO_W5500`, flasheado y observado por COM6.
- LED: 9 aros WS2812B de 24 LED, total 216 LED en 3 cadenas de 72.
- Sensores: ruta DO-only; D1-D3 montados con divisor resistivo y validados como
  activos-alto; D4-D9 pendientes con sensores reales.
- Registro DO: 2 x 74HC165 a 3.3 V.
- Selector: SPDT de 2 posiciones esperado; estado actual observado invalido
  hasta corregir cableado/posicion.
- Ethernet: W5500 cableado por SPI, pero aun no validado; `VERSIONR=0x00`,
  `LINK=DOWN`, LEDs RJ45 apagados.

Documentacion anterior y disenos de PCB quedan clasificados como legado o futuro
en [`docs/hardware/legacy/README.md`](docs/hardware/legacy/README.md) y
[`docs/hardware/future/README.md`](docs/hardware/future/README.md).

## Arranque rápido

```bash
cp .env.example .env        # y edita los secretos; .env nunca entra en git
make bootstrap              # dependencias y preparación
make up                     # levanta el stack
make simulate               # simula módulos y juega sin hardware
make test                   # pruebas
```

Validación de contratos, que no necesita nada instalado salvo Python:

```bash
python3 contracts/validate.py --verbose
```

## Estado del proyecto

**A 2026-08-24:** el stack de servidor ya existia como banco de software y el
firmware ESP32-S3 del prototipo DO-only se ha compilado, flasheado y observado en
hardware real. No existe PCB fabricada. El prototipo fisico actual aun tiene
validacion parcial: LED OK en los 9 aros, sensores D1-D3 OK con divisor
resistivo, sensores D4-D9 pendientes, W5500 pendiente por fallo SPI/link y
partida completa real pendiente. Siguen abiertos hallazgos de seguridad de la
plataforma, incluida suplantacion de modulo por `client_id` y ausencia de TLS.

El estado vivo de cada paquete de trabajo está en
[`docs/coordination/STATUS.md`](docs/coordination/STATUS.md); el plan, en
[`MASTER_PLAN.md`](docs/coordination/MASTER_PLAN.md); las pruebas y su resultado real, en
[`TEST_MATRIX.md`](docs/coordination/TEST_MATRIX.md).

Lo que depende del hardware físico definitivo (calibración piezo, consumo real, ERC sobre
PCB fabricada, OTA sobre módulo real) está implementado con abstracción, simulador y
procedimiento de validación, y aparece marcado como **pendiente de banco**. No se declara
validado nada que no se haya ejecutado.

## Licencia

Ver [LICENSE](LICENSE).
