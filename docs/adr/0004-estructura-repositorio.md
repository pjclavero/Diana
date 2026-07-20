# ADR-0004 · Estructura del repositorio

**Estado:** aceptado · 2026-07-20

## Contexto

El dosier §19.1 dibuja `backend/`, `frontend/` y `firmware/` colgando de la raíz. El
encargo del programa exige, en cambio, una separación inequívoca entre el código del
ESP32 y el resto, con el firmware bajo `firmware/esp32/` y el software de servidor
bajo `server/`.

## Decisión

Se adopta el árbol del encargo. El código del ESP32 vive exclusivamente en
`firmware/esp32/` y no se mezcla con backend, frontend, Docker, simulador ni electrónica.

Los contratos compartidos viven en `contracts/` y son la **única** fuente: firmware,
backend y simulador derivan de ahí y no copian definiciones a mano.

## Motivo

La separación conceptual del dosier se conserva íntegra; sólo cambia la profundidad de
las carpetas. Agrupar bajo `server/` permite además asignar propiedad de rutas por
paquete sin ambigüedad, que es lo que hace viable el trabajo en paralelo.

## Consecuencias

- Cualquier referencia del dosier a `backend/x` se lee como `server/backend/x`.
- La tabla de propiedad de rutas (§31.4 del dosier) se reescribe en `OWNERSHIP.md`.
