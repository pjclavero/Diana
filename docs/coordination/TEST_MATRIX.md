# MATRIZ DE PRUEBAS

Cada fila indica qué se prueba, cómo se ejecuta y dónde queda la evidencia.
La columna **Resultado** sólo se rellena con salida realmente ejecutada.

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
| F-01 | Máquina de estados del módulo | ver `docs/testing/` |
| F-02 | Máquina de estados de diana | ver `docs/testing/` |
| F-03 | Cola persistente y reenvío | ver `docs/testing/` |
| F-04 | Idempotencia de eventos | ver `docs/testing/` |
| F-05 | Clasificación de crosstalk | ver `docs/testing/` |
| F-06 | Caducidad y repetición de comandos | ver `docs/testing/` |
| F-07 | Compilación ESP-IDF para ESP32-S3 | PENDIENTE (CI) |
| F-08 | Detección de impacto real, umbrales, 1.000 impactos | HW |
| F-09 | OTA y rollback sobre hardware | HW |

## Backend

| ID | Prueba | Resultado |
|---|---|---|
| B-01 | Unitarias de dominio | ver `docs/testing/` |
| B-02 | Migraciones sobre PostgreSQL real | ver `docs/testing/` |
| B-03 | Ingesta MQTT idempotente (duplicado no puntúa) | ver `docs/testing/` |
| B-04 | El servidor no reescribe T1/T2 | ver `docs/testing/` |
| B-05 | Reglas de precisión, incluido *no calculable* | ver `docs/testing/` |
| B-06 | Permisos por rol | ver `docs/testing/` |
| B-07 | Exportación CSV | ver `docs/testing/` |

## Frontend

| ID | Prueba | Resultado |
|---|---|---|
| W-01 | Componentes | ver `docs/testing/` |
| W-02 | Estado no representado sólo por color | ver `docs/testing/` |
| W-03 | Responsive escritorio/tableta/móvil | ver `docs/testing/` |
| W-04 | E2E de partida completa | ver `docs/testing/` |

## Infraestructura y despliegue

| ID | Prueba | Resultado |
|---|---|---|
| I-01 | `docker compose config` | ver `docs/testing/` |
| I-02 | Build de imágenes | ver `docs/testing/` |
| I-03 | Healthchecks en verde | ver `docs/testing/` |
| I-04 | Mosquitto rechaza acceso anónimo | ver `docs/testing/` |
| I-05 | ACL: un módulo no puede escribir en el tópico de otro | ver `docs/testing/` |
| I-06 | PostgreSQL no accesible desde fuera del stack | ver `docs/testing/` |
| I-07 | Backup y restauración | ver `docs/testing/` |
| I-08 | Supervivencia a `reboot` | ver `docs/testing/` |
| I-09 | Rollback documentado y probado | ver `docs/testing/` |

## E2E con simulador (encargo §19)

| ID | Escenario | Resultado |
|---|---|---|
| E-01 | Registrar 9 módulos | ver `docs/testing/` |
| E-02 | Elegir principal | ver `docs/testing/` |
| E-03 | Configurar matriz 3×3 | ver `docs/testing/` |
| E-04 | Calibración simulada | ver `docs/testing/` |
| E-05 | Crear jugador | ver `docs/testing/` |
| E-06 | Partida aleatoria | ver `docs/testing/` |
| E-07 | Recibir impactos | ver `docs/testing/` |
| E-08 | Penalizar impacto incorrecto | ver `docs/testing/` |
| E-09 | Terminar ronda | ver `docs/testing/` |
| E-10 | Calcular resultado | ver `docs/testing/` |
| E-11 | Mostrar estadísticas | ver `docs/testing/` |
| E-12 | Exportar | ver `docs/testing/` |
| E-13 | Reiniciar backend | ver `docs/testing/` |
| E-14 | Recuperar eventos encolados | ver `docs/testing/` |
| E-15 | Reconectar módulo | ver `docs/testing/` |
| E-16 | Rechazar duplicados | ver `docs/testing/` |

## Carga

| ID | Prueba | Resultado |
|---|---|---|
| L-01 | 9 módulos y 81 dianas simultáneos | ver `docs/testing/` |
| L-02 | Ráfagas de impactos | ver `docs/testing/` |
| L-03 | Telemetría continua | ver `docs/testing/` |
| L-04 | Reconexiones y retransmisión MQTT | ver `docs/testing/` |

## Seguridad

| ID | Prueba | Resultado |
|---|---|---|
| S-01 | Escaneo de secretos en el repositorio | ver `docs/security/` |
| S-02 | Análisis de dependencias | ver `docs/security/` |
| S-03 | Exposición de puertos en la VM | ver `docs/security/` |
| S-04 | Sin credenciales por defecto | ver `docs/security/` |
| S-05 | Logs sin secretos | ver `docs/security/` |
