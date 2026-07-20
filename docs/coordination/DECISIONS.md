# REGISTRO DE DECISIONES

Decisiones menores tomadas sin consultar (regla 3.2 del encargo). Las que afectan a
varias áreas tienen además un ADR en `docs/adr/`.

| # | Fecha | Decisión | Motivo | ADR |
|---|---|---|---|---|
| D-01 | 2026-07-20 | Rama de integración `develop`; `main` sólo por PR | El encargo prohíbe trabajar sobre `main` y los paquetes necesitan una base común | — |
| D-02 | 2026-07-20 | El firmware vive en `firmware/esp32/`, el servidor en `server/` | Separación inequívoca exigida por el encargo §4, distinta del árbol del dosier §19.1 | ADR-0004 |
| D-03 | 2026-07-20 | Los tiempos T3/T4 **no** viajan en el payload MQTT | Impedir por contrato que la hora de llegada sustituya a la del impacto | ADR-0002 |
| D-04 | 2026-07-20 | `additionalProperties: false` en todos los esquemas | Un campo silencioso es un cambio de contrato no versionado | — |
| D-05 | 2026-07-20 | Los eventos nunca se publican como retenidos | Un retenido reproduciría impactos al reconectar un cliente | — |
| D-06 | 2026-07-20 | `crosstalk_rejected` se transmite en vez de descartarse en silencio | Sin el evento no se puede auditar la decisión ni afinar umbrales | — |
| D-07 | 2026-07-20 | VMID 109 e IP 192.168.1.209 | Ambos libres y coherentes con la convención VMID→IP del homelab | ADR-0005 |
| D-08 | 2026-07-20 | `boot_id` en cada arranque además de `local_sequence` | `local_sequence` sola no distingue un reflasheo de un reinicio | ADR-0003 |
| D-09 | 2026-07-20 | Semilla explícita (`seed`) en los comandos de partida | Sin ella los modos aleatorios no son reproducibles en E2E | — |
| D-10 | 2026-07-20 | El coordinador calcula `elapsed_us`, no el backend | El dosier §14.2 fija al coordinador como autoridad temporal | ADR-0002 |

## Correcciones al dosier

El dosier es la fuente de requisitos y no se sustituye. Se corrigen sólo errores objetivos:

| Punto | Dosier | Corrección | Motivo |
|---|---|---|---|
| §19.1 árbol de carpetas | `backend/`, `frontend/`, `firmware/` colgando de la raíz | `server/backend`, `server/frontend`, `firmware/esp32` | El encargo §4 exige separación explícita firmware/servidor; se conserva la separación conceptual |
| §15.3 ejemplo de impacto | `elapsed_us` plano, sin distinguir origen | bloques `device` y `coordinator` | El propio dosier §14.2 y §29.7 exigen distinguir las marcas; el ejemplo no lo reflejaba |
| §1 "Reparabile" | errata | "Reparable" | errata tipográfica |
