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
| P-08 | **Deriva entre lo desplegado y `develop`** (nuevo 2026-07-26; **agravado 2026-08-04**) | MEDIA → **ALTA (2026-08-04)** | La VM sigue corriendo `133d760`, y `develop` va ya por `1aa1fbc`: **seis commits por delante**, con X-06 (vista en directo), F4 (reinicio de estadística), F5 (ascenso a gestor) y F6 (diagnóstico) **sólo en el repositorio**. La deriva ha crecido exactamente como se predijo, y ahora incluye **dos migraciones de base de datos sin aplicar** (`20260726200000_manager_activation`, `20260726210000_hit_stats_reset`), lo que convierte el próximo despliegue en una operación con cambio de esquema, no en un simple `up -d`. Con el DNS y la RAM como están, redesplegar sigue sin ser trivial. Mitigación: declarar en `STATUS.md`, en cada entrega, **qué commit corre en la VM y qué migraciones le faltan** — no basta con decir «desplegado» |
| P-09 | **Un contenedor `healthy` puede estar completamente roto** (nuevo, 2026-08-04) | ALTA | Hallazgo del supervisor de F4 en la VM 109: `diana-worker-1` figura `healthy` mientras **todas** sus tareas fallan en bucle por un desajuste del motor de Prisma (`debian-openssl-3.0.x` frente a `1.1.x`). El healthcheck del worker es `pgrep` (`deployment/procedimiento.md` §7): comprueba que el proceso vive, no que haga su trabajo. Consecuencia medida: la tabla `statistics` de producción está **vacía**, y durante semanas se atribuyó a que «nadie la escribe» en vez de a que **el escritor está roto** — la misma premisa falsa que provocó el bloqueante B1 de F4. Riesgo general: **el verde del stack no es evidencia de funcionamiento**. Mitigación: arreglar el motor de Prisma del worker y sustituir los healthchecks de proceso por healthchecks que ejerzan la función (una tarea completada recientemente, no un PID vivo). **Sin resolver** |
| P-10 | **Pruebas atadas a fechas absolutas que caducan** (nuevo, 2026-08-04) | MEDIA | `server/backend/test/invitations/manager-activation.spec.ts` fija fechas literales (`MANANA = 2026-07-27`, l. 9) y **no congela el reloj**, así que las 8 pruebas que dependen de ellas pasaron en su día y **fallan desde el 27 de julio** sin que nada haya cambiado en el producto. Efecto real: la suite del backend está en rojo (584/8/7 el 2026-08-04) y una suite en rojo por una causa espuria **esconde las regresiones de verdad**. Mitigación: congelar el reloj (`jest.useFakeTimers().setSystemTime(...)`) o derivar las fechas de `Date.now()`. **Sin resolver; este barrido de documentación no toca pruebas** |
