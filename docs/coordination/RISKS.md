# RIESGOS

Severidad: `ALTA` (bloquea aceptación) · `MEDIA` (degrada) · `BAJA` (molestia).
Los riesgos de producto vienen del dosier §34; aquí se añaden los del programa.

## Riesgos de producto (dosier §34) — estado en esta entrega

| Riesgo | Sev. | Mitigación implementada | Pendiente |
|---|---|---|---|
| Vibración cruzada | ALTA | Contrato con `neighbours`, `group_window_us`, `neighbour_ratio`; clasificador en firmware; escenario en el simulador | Ajuste de umbrales en banco con piezos reales |
| Piezo daña el ESP32 | ALTA | Cadena de protección diseñada en `hardware/` (descarga, serie, Schottky, clamp) | Prueba de sobretensión física |
| Dos módulos principales | ALTA | Conflicto `dual_principal` en `system-status`; el backend bloquea el inicio | Prueba con dos módulos reales |
| Latencia de red altera el tiempo | ALTA | Modelo de 4 marcas; T3/T4 fuera del payload; `elapsed_us` del coordinador | Medición del presupuesto de error real |
| Eventos duplicados | ALTA | `event_id` del módulo + deduplicación en coordinador y backend + pruebas | — |
| OTA fallida deja el módulo inservible | ALTA | Particiones A/B, firma, `confirm`/`rollback` en el contrato | Prueba OTA sobre hardware |
| Sobreconsumo de LED | MEDIA | `led_brightness_max` en configuración; presupuesto de potencia documentado | Medida de consumo real |
| Escasez de GPIO | MEDIA | Presupuesto de pines en `hardware/calculations/` | Verificación contra la placa concreta |
| Precisión falsa | MEDIA | Regla *no calculable* implementada y probada | — |
| Cambios de contrato | MEDIA | `schema_version`, ejemplos inválidos, validador en CI | — |

## Riesgos del programa

| # | Riesgo | Sev. | Mitigación |
|---|---|---|---|
| P-01 | RAM del nodo Proxmox ajustada (≈7 GB disponibles con todo en marcha) | MEDIA | La VM pide 4 GB; se verifica el margen antes de arrancar y se documenta. Ninguna VM existente se toca |
| P-02 | Sin Docker ni sudo en la máquina de desarrollo | MEDIA | El trabajo Docker real se hace en la VM; en local sólo validación estática |
| P-03 | Sin hardware físico | ALTA para aceptación final | Simulador contractual + procedimiento de validación física; lo no probado se declara pendiente |
| P-04 | Agentes en paralelo pisando ficheros | MEDIA | Worktrees separados y propiedad de rutas en `OWNERSHIP.md` |
| P-05 | Declarar como validado algo no ejecutado | ALTA | Regla de evidencia: sin salida registrada no hay `APPROVED` |
| P-06 | Exposición accidental del panel a Internet | ALTA | Firewall restrictivo, sin publicación en el proxy inverso de VM104, revisión de seguridad independiente |
