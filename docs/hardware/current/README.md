# DIANA - PROTOTIPO DE HARDWARE ACTUAL

Esta carpeta es la fuente de verdad del hardware fisico actualmente montado y
del firmware que corresponde a dicho montaje.

Estado: PROTOTIPO V1 REAL, DO-only, sobre ESP32-S3 + W5500.

Perfil firmware:

```text
PROTO_DO_W5500
```

Firmware:

```text
firmware/esp32/
```

Perfil de placa:

```text
firmware/esp32/boards/esp32s3_proto_do_w5500.h
```

## Como leer esta carpeta

Los datos estan clasificados por evidencia:

| Etiqueta | Significado |
| --- | --- |
| CONFIRMADO EN HARDWARE REAL | Observado o medido en el prototipo fisico |
| CONFIRMADO POR CODIGO | Existe en firmware o pruebas |
| CONFIRMADO POR DOCUMENTACION | Esta documentado, pero no necesariamente medido |
| PENDIENTE DE MEDICION | Falta medir en banco |
| PENDIENTE DE IDENTIFICAR | Falta modelo/revision exacta |
| PENDIENTE DE INSTALAR | Componente elegido pero no montado |
| LEGACY | No usar para el prototipo actual |
| DISENO FUTURO | Valido como direccion futura, no montado ahora |

## Documentos principales

| Documento | Contenido |
| --- | --- |
| [componentes.md](componentes.md) | Inventario real por modulo comercial |
| [bom-prototipo.csv](bom-prototipo.csv) | BOM del prototipo fisico V1, separada de la PCB futura |
| [conexionado.md](conexionado.md) | Tabla maestra de GPIO, cableado y diagrama de bloques |
| [pinout.md](pinout.md) | Pinout efectivo contra firmware |
| [alimentacion.md](alimentacion.md) | Tensiones, alimentacion y niveles logicos |
| [sensores-do.md](sensores-do.md) | Sensores DO-only y 74HC165 |
| [leds.md](leds.md) | Aros WS2812B reales |
| [ethernet-w5500.md](ethernet-w5500.md) | Modulo W5500, pinout y estado de bring-up |
| [selector-identify.md](selector-identify.md) | Selector SPDT e IDENTIFY |
| [firmware.md](firmware.md) | Firmware exacto asociado a este hardware |
| [validacion.md](validacion.md) | Estado de validacion por subsistema |
| [pendientes.md](pendientes.md) | Incidencias y pendientes actuales |

## Documentacion no actual

La documentacion historica no se borra. La clasificacion viva esta en:

```text
docs/hardware/legacy/
docs/hardware/future/
```

Regla: si hay conflicto entre esta carpeta y documentos antiguos, esta carpeta
gana para el prototipo fisico actualmente montado.
