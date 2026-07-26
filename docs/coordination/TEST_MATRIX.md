# MATRIZ DE PRUEBAS

Cada fila indica qué se prueba, cómo se ejecuta y dónde queda la evidencia.
La columna **Resultado** sólo se rellena con salida realmente ejecutada.

> **Corrección importante (2026-07-26) — X-17.** 46 filas de esta matriz remitían a
> `` `docs/testing/` `` como lugar de la evidencia. **Ese directorio está vacío** (sólo su
> `.gitkeep.md`, comprobado hoy): eran **punteros colgados** que se leían como si la prueba
> estuviera hecha y documentada. Se sustituyen por «⚠ puntero colgado (X-17)» para que no
> engañen. Dónde está la evidencia que **sí** existe:
> - Suites reproducidas ejecutando → `docs/quality/suites-evidence.md` y
>   `docs/quality/dictamen-calidad.md`.
> - Seguridad, con salida real de comandos → `docs/security/evidence/`.
> - Despliegue e integración contra la VM → `docs/deployment/procedimiento.md` §8-§9 y el
>   commit de despliegue `8220a45`.
> - Cifras vigentes a `133d760`: backend 471 pasan + 7 saltadas, frontend 131/131,
>   integración 7/7, contratos 43/0. Firmware (389/389) y simulador (33/33) **no se han
>   vuelto a ejecutar desde el 2026-07-21**.
>
> Y lo que hay que decir sin rodeos: **los 16 escenarios E2E del §19 (E-01…E-16) NO están
> hechos.** Son `test.fixme` en `tests/e2e/scenarios.spec.ts`, con 0 aserciones. Las filas de
> Infra y Carga (I-*, L-*) tampoco se han ejecutado.

## Leyenda

- `VERDE` — ejecutado y correcto, con salida registrada.
- `ROJO` — ejecutado y fallido.
- `PENDIENTE` — todavía no ejecutado.
- `HW` — no ejecutable sin hardware físico; procedimiento documentado.

## Contratos

| ID | Prueba | Comando | Resultado |
|---|---|---|---|
| C-01 | Todos los esquemas son JSON Schema 2020-12 válidos | `python3 contracts/validate.py` | VERDE |
| C-02 | Los 16 ejemplos válidos validan | idem | VERDE |
| C-03 | Los 12 ejemplos inválidos son rechazados | idem | VERDE |
| C-04 | Un payload con marca temporal de servidor es rechazado | idem (`server-timestamp-injected`) | VERDE |
| C-05 | `schema_version` futura es rechazada | idem | VERDE |

## Firmware (host)

| ID | Prueba | Resultado |
|---|---|---|
| F-01 | Máquina de estados del módulo | ⚠ puntero colgado (X-17) — ver nota de cabecera |
| F-02 | Máquina de estados de diana | ⚠ puntero colgado (X-17) — ver nota de cabecera |
| F-03 | Cola persistente y reenvío | ⚠ puntero colgado (X-17) — ver nota de cabecera |
| F-04 | Idempotencia de eventos | ⚠ puntero colgado (X-17) — ver nota de cabecera |
| F-05 | Clasificación de crosstalk | ⚠ puntero colgado (X-17) — ver nota de cabecera |
| F-06 | Caducidad y repetición de comandos | ⚠ puntero colgado (X-17) — ver nota de cabecera |
| F-07 | Compilación ESP-IDF para ESP32-S3 | PENDIENTE (CI) |
| F-08 | Detección de impacto real, umbrales, 1.000 impactos | HW |
| F-09 | OTA y rollback sobre hardware | HW |

## Backend

| ID | Prueba | Resultado |
|---|---|---|
| B-01 | Unitarias de dominio | ⚠ puntero colgado (X-17) — ver nota de cabecera |
| B-02 | Migraciones sobre PostgreSQL real | ⚠ puntero colgado (X-17) — ver nota de cabecera |
| B-03 | Ingesta MQTT idempotente (duplicado no puntúa) | ⚠ puntero colgado (X-17) — ver nota de cabecera |
| B-04 | El servidor no reescribe T1/T2 | ⚠ puntero colgado (X-17) — ver nota de cabecera |
| B-05 | Reglas de precisión, incluido *no calculable* | ⚠ puntero colgado (X-17) — ver nota de cabecera |
| B-06 | Permisos por rol | ⚠ puntero colgado (X-17) — ver nota de cabecera |
| B-07 | Exportación CSV | ⚠ puntero colgado (X-17) — ver nota de cabecera |

## Frontend

| ID | Prueba | Resultado |
|---|---|---|
| W-01 | Componentes | ⚠ puntero colgado (X-17) — ver nota de cabecera |
| W-02 | Estado no representado sólo por color | ⚠ puntero colgado (X-17) — ver nota de cabecera |
| W-03 | Responsive escritorio/tableta/móvil | ⚠ puntero colgado (X-17) — ver nota de cabecera |
| W-04 | E2E de partida completa | ⚠ puntero colgado (X-17) — ver nota de cabecera |

## Infraestructura y despliegue

| ID | Prueba | Resultado |
|---|---|---|
| I-01 | `docker compose config` | ⚠ puntero colgado (X-17) — ver nota de cabecera |
| I-02 | Build de imágenes | ⚠ puntero colgado (X-17) — ver nota de cabecera |
| I-03 | Healthchecks en verde | ⚠ puntero colgado (X-17) — ver nota de cabecera |
| I-04 | Mosquitto rechaza acceso anónimo | ⚠ puntero colgado (X-17) — ver nota de cabecera |
| I-05 | ACL: un módulo no puede escribir en el tópico de otro | ⚠ puntero colgado (X-17) — ver nota de cabecera |
| I-06 | PostgreSQL no accesible desde fuera del stack | ⚠ puntero colgado (X-17) — ver nota de cabecera |
| I-07 | Backup y restauración | ⚠ puntero colgado (X-17) — ver nota de cabecera |
| I-08 | Supervivencia a `reboot` | ⚠ puntero colgado (X-17) — ver nota de cabecera |
| I-09 | Rollback documentado y probado | ⚠ puntero colgado (X-17) — ver nota de cabecera |

## E2E con simulador (encargo §19)

| ID | Escenario | Resultado |
|---|---|---|
| E-01 | Registrar 9 módulos | ⚠ puntero colgado (X-17) — ver nota de cabecera |
| E-02 | Elegir principal | ⚠ puntero colgado (X-17) — ver nota de cabecera |
| E-03 | Configurar matriz 3×3 | ⚠ puntero colgado (X-17) — ver nota de cabecera |
| E-04 | Calibración simulada | ⚠ puntero colgado (X-17) — ver nota de cabecera |
| E-05 | Crear jugador | ⚠ puntero colgado (X-17) — ver nota de cabecera |
| E-06 | Partida aleatoria | ⚠ puntero colgado (X-17) — ver nota de cabecera |
| E-07 | Recibir impactos | ⚠ puntero colgado (X-17) — ver nota de cabecera |
| E-08 | Penalizar impacto incorrecto | ⚠ puntero colgado (X-17) — ver nota de cabecera |
| E-09 | Terminar ronda | ⚠ puntero colgado (X-17) — ver nota de cabecera |
| E-10 | Calcular resultado | ⚠ puntero colgado (X-17) — ver nota de cabecera |
| E-11 | Mostrar estadísticas | ⚠ puntero colgado (X-17) — ver nota de cabecera |
| E-12 | Exportar | ⚠ puntero colgado (X-17) — ver nota de cabecera |
| E-13 | Reiniciar backend | ⚠ puntero colgado (X-17) — ver nota de cabecera |
| E-14 | Recuperar eventos encolados | ⚠ puntero colgado (X-17) — ver nota de cabecera |
| E-15 | Reconectar módulo | ⚠ puntero colgado (X-17) — ver nota de cabecera |
| E-16 | Rechazar duplicados | ⚠ puntero colgado (X-17) — ver nota de cabecera |

## Carga

| ID | Prueba | Resultado |
|---|---|---|
| L-01 | 9 módulos y 81 dianas simultáneos | ⚠ puntero colgado (X-17) — ver nota de cabecera |
| L-02 | Ráfagas de impactos | ⚠ puntero colgado (X-17) — ver nota de cabecera |
| L-03 | Telemetría continua | ⚠ puntero colgado (X-17) — ver nota de cabecera |
| L-04 | Reconexiones y retransmisión MQTT | ⚠ puntero colgado (X-17) — ver nota de cabecera |

## Seguridad

| ID | Prueba | Resultado |
|---|---|---|
| S-01 | Escaneo de secretos en el repositorio | ver `docs/security/` |
| S-02 | Análisis de dependencias | ver `docs/security/` |
| S-03 | Exposición de puertos en la VM | ver `docs/security/` |
| S-04 | Sin credenciales por defecto | ver `docs/security/` |
| S-05 | Logs sin secretos | ver `docs/security/` |
