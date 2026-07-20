# Diana · Sistema modular de dianas electrónicas 3×3

Plataforma de entrenamiento y juego con dianas luminosas modulares para proyectiles
ligeros. Cada módulo agrupa **3×3 dianas** con sensor piezoeléctrico y ocho LED RGB por
diana, gobernadas por un **ESP32-S3** con Ethernet **W5500**. Hasta nueve módulos forman
una matriz lógica de **9×9 (81 dianas)** coordinada por MQTT contra un servidor Docker.

> Requisitos, arquitectura y fases: [`dosier_tecnico_matriz_dianas_modulares.md`](dosier_tecnico_matriz_dianas_modulares.md).
> Ese documento es la fuente normativa del proyecto.

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
