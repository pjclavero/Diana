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
| P-01 | RAM del nodo Proxmox ajustada (≈7 GB disponibles con todo en marcha) | MEDIA → **MATERIALIZADO (2026-07-26)** | La VM pide 4 GB; se verifica el margen antes de arrancar y se documenta. Ninguna VM existente se toca. **El riesgo se ha cumplido:** la VM está declarada `memory=4096` + `balloon=1024` (D-11) sobre un nodo sobrecomprometido, así que el globo le quita memoria y **no dispone de los 4 GB nominales**. Consecuencia medida y repetida: **BuildKit muere por OOM a mitad de compilar y deja la imagen anterior**, con el síntoma engañoso de un `build` que «termina» sin aplicar el cambio. Paliativo en uso: parar contenedores no esenciales para compilar y **verificar el artefacto** antes de levantar (`deployment/procedimiento.md` §8). **Sin resolver**: exige decisión del operador sobre el reparto de memoria del nodo. La cifra exacta de RAM efectiva no está verificada en este repositorio |
| P-02 | Sin Docker ni sudo en la máquina de desarrollo | MEDIA | El trabajo Docker real se hace en la VM; en local sólo validación estática |
| P-03 | Sin hardware físico | ALTA para aceptación final | Simulador contractual + procedimiento de validación física; lo no probado se declara pendiente |
| P-04 | Agentes en paralelo pisando ficheros | MEDIA | Worktrees separados y propiedad de rutas en `OWNERSHIP.md` |
| P-05 | Declarar como validado algo no ejecutado | ALTA | Regla de evidencia: sin salida registrada no hay `APPROVED` |
| P-06 | Exposición accidental del panel a Internet | ALTA | Firewall restrictivo, sin publicación en el proxy inverso de VM104, revisión de seguridad independiente |
| P-07 | **Red de la VM 109 sin DNS utilizable** (nuevo, 2026-07-26) | ALTA para la operación | El único resolver es el MagicDNS de Tailscale (`100.100.100.100`), que responde `server misbehaving`: `git`, `docker pull` y `npm ci` fallan, y **cualquier despliegue o actualización queda bloqueado**. Paliativo usado una vez: código por bundle de git y override **temporal** de `/etc/resolv.conf`, restaurado al terminar. **Sin resolver**: requiere decisión del operador (`tailscale set --accept-dns=false` o revisar los nameservers de la tailnet) |
| P-08 | **Deriva entre lo desplegado y `develop`** (nuevo, 2026-07-26) | MEDIA | La VM corre `133d760` (D9 incluido, verificado por SSH) y `develop` va por delante con el arreglo de X-06 y las observaciones de la 4ª supervisión, sin desplegar. Con el DNS y la RAM como están, redesplegar no es trivial, así que la deriva tiende a crecer. Mitigación: declarar en `STATUS.md`, en cada entrega, **qué commit corre en la VM** — no basta con decir «desplegado» |
