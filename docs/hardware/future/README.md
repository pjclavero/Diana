# Documentacion future / pendiente

Esta carpeta clasifica contenido que describe disenos previstos, PCB futura,
ruta analogica historica o validaciones que aun no pertenecen al prototipo real
montado en banco.

Fuente actual: [`../current/README.md`](../current/README.md).

## Contenido futuro o no fabricado

| Ruta | Estado | Motivo |
| --- | --- | --- |
| `hardware/electronics/**` | FUTURO / NO FABRICADO | KiCad, BOM, calculos y esquemas pertenecen a la PCB futura, no al cableado actual. |
| `docs/hardware/VALIDACION-FISICA-PENDIENTE.md` | FUTURO / CHECKLIST | Validacion para fabricacion o cierre de banco, no evidencia de que ya este validado. |
| `docs/hardware/decisiones.md` | CONTEXTO DE DISENO | Mantiene decisiones de arquitectura; verificar contra `current/` antes de montar. |
| `docs/hardware/riesgos.md` | CONTEXTO DE DISENO | Riesgos utiles, pero no pinout vigente. |
| `docs/hardware/notas-de-diseno.md` | CONTEXTO DE DISENO | Notas de producto/PCB, no conexionado real. |
| `docs/firmware/pinout-preliminar.md` | OBSOLETO / PRELIMINAR | Propuesta analogica previa, no verificada sobre el prototipo DO-only actual. |

## Regla de lectura

Todo lo que sea PCB, analog front-end, comparadores, ADC, VREF, AUTO por selector
ON-OFF-ON o 8 LED por diana debe tratarse como diseno futuro/historico salvo que
tambien este confirmado en `docs/hardware/current/`.
