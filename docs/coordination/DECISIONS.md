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
| D-11 | 2026-07-20 | VM 109 con `memory=4096` y `balloon=1024` | **Decisión del usuario.** El nodo está sobrecomprometido (37,8 GB asignados sobre 32 GB, 4,4 GB de swap en uso); el balloon cumple los 4 GB del encargo sin degradar producción | ADR-0005 |
| D-12 | 2026-07-20 | La VM 109 se añade al job `backup-daily-critical` existente | Integración con la política de copias vigente; cambio aditivo con copia previa del fichero | ADR-0005 |
| D-13 | 2026-07-20 | T2 de un satélite viaja en `game/event`, no reescribiendo su `hit` | Hallazgo H-01 del supervisor: ningún módulo debe escribir el tópico de otro, o la ACL estricta deja inejecutable la consolidación | — |
| D-14 | 2026-07-20 | Los `$ref` pasan a `../schemas/common.schema.json#/…` | Hallazgo H-02: la forma anterior sólo resolvía con el validador propio; ajv y los generadores de tipos habrían fallado | — |
| D-15 | 2026-07-20 | Se restituyen los modos `memory` y `no_shoot` en los enums | Hallazgo H-03: el dosier §16.5-16.6 los incluye; sólo el duelo (§16.7) está fuera de alcance | — |
| D-16 | 2026-07-20 | La caducidad de comando se mide desde `issued_at_ms`; el `nonce` se persiste en NVS | Hallazgo H-05: medida desde la recepción se reiniciaba en cada reentrega QoS 1 y no protegía contra reproducción | — |
| D-17 | 2026-07-20 | El validador registra los esquemas **sólo** por `$id` | Registrarlos también por nombre de fichero enmascaraba `$ref` rotos y daba verde donde CI habría fallado | — |

## Correcciones al dosier

El dosier es la fuente de requisitos y no se sustituye. Sólo se corrigen errores objetivos.
El supervisor señaló (H-06) que la primera fila de esta tabla estaba mal clasificada: no es
una errata del dosier sino un **cambio de requisito** impuesto por el encargo del programa.
Se reclasifica y se separa de las erratas reales:

### Cambios de requisito (no son erratas)

| Punto | Dosier | Cambio | Autoridad |
|---|---|---|---|
| §19.1 árbol de carpetas | `backend/`, `frontend/`, `firmware/` colgando de la raíz | `server/backend`, `server/frontend`, `firmware/esp32` | Encargo del programa §4, registrado en [`PROGRAM_BRIEF.md`](PROGRAM_BRIEF.md) y ADR-0004. Se conserva íntegra la separación conceptual del dosier |

### Erratas y defectos objetivos
| §15.3 ejemplo de impacto | `elapsed_us` plano, sin distinguir origen | bloques `device` y `coordinator` | El propio dosier §14.2 y §29.7 exigen distinguir las marcas; el ejemplo no lo reflejaba |
| §1 "Reparabile" | errata | "Reparable" | errata tipográfica |
