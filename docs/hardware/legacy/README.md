# Documentacion legacy / superada

Esta carpeta no contiene el cableado activo del prototipo. Es un indice de
documentos historicos que pueden seguir sirviendo como evidencia de banco o
contexto, pero no deben usarse como fuente principal para cablear, alimentar o
modificar firmware.

Fuente actual: [`../current/README.md`](../current/README.md).

## Documentos superados por `docs/hardware/current/`

| Documento | Estado | Motivo |
| --- | --- | --- |
| `docs/hardware/prototipo-do-only.md` | SUPERADO PARCIALMENTE | Contiene notas cronologicas utiles, pero la fuente consolidada es `current/`. |
| `docs/hardware/conexionado-prototipo.md` | SUPERADO PARCIALMENTE | Sustituido por `current/conexionado.md` y `current/pinout.md`. |
| `docs/hardware/calibracion-sensores-do.md` | SUPERADO PARCIALMENTE | Sustituido para el montaje actual por `current/sensores-do.md` y `current/validacion.md`. |
| `docs/firmware/pinout-definitivo.md` | SUPERADO PARCIALMENTE | Pinout efectivo consolidado en `current/pinout.md`. |
| `docs/firmware/validacion-fisica-pendiente.md` | SUPERADO PARCIALMENTE | Estado vivo consolidado en `current/validacion.md` y `current/pendientes.md`. |
| `firmware/esp32/boards/esp32s3_w5500_protoA.h` | LEGACY | Perfil preliminar analogico; el perfil activo es `esp32s3_proto_do_w5500.h`. |

## Reglas de uso

- Si hay conflicto, manda `docs/hardware/current/`.
- Las notas legacy pueden citarse como historial, no como conexionado vigente.
- No declarar validado nada solo porque aparezca en un documento legacy.
