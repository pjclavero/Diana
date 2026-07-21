# ESTADO DE EJECUCIÓN

Actualizado por el organizador. Última actualización: 2026-07-20.

| WP | Paquete | Modelo | Rama | Estado | Evidencia / revisión |
|---|---|---|---|---|---|
| WP-00 | Fundación y contratos | Opus | `develop` | `READY_FOR_REVIEW` (2ª vuelta) | `NO CONFORME` del supervisor; H-01..H-07 corregidos; validador 43/0 con resolución estricta |
| WP-01 | Infraestructura Docker | Sonnet | `feat/wp01-infra` | `READY_FOR_REVIEW` | `docker compose config` limpio en base + 4 perfiles; ACL reescrita tópico a tópico |
| WP-02 | Backend y motor de partidas | Opus | `feat/wp02-backend` | `IN_PROGRESS` | — |
| WP-03 | Panel web | Sonnet | `feat/wp03-frontend` → `develop` | `READY_FOR_REVIEW` | build + typecheck + lint limpios; 30/30 unit; **E2E ejecutados de verdad con navegador: 18/18** tras corregir 4 bugs reales (strict-mode del badge de conexión, `vite preview` en IPv6, locator por subcadena en responsive, perfil iPad en WebKit no instalado→Chromium). Corre contra adaptador mock (contrato real pendiente, X-06) |
| WP-04 | Firmware ESP32-S3 | Opus | `feat/wp04-firmware` | `CHANGES_REQUESTED` | 338/338 comprobaciones en host; resincronizando con el contrato corregido |
| WP-05 | Simulador | Sonnet | `feat/wp05-simulator` | `CHANGES_REQUESTED` | 28/28 tests; resincronizando con el contrato corregido |
| WP-06 | Hardware / KiCad | Opus | `feat/wp06-hardware` | `READY_FOR_REVIEW` | Sin KiCad instalado: **ERC/DRC no ejecutados**. 47 validaciones físicas pendientes |
| WP-07 | CI y pruebas | Sonnet | `feat/wp07-ci` → `develop` | `READY_FOR_REVIEW` | 5 workflows (YAML validado), incl. `firmware-idf.yml` (compila con `espressif/idf:v5.3.1`). Andamiaje `tests/`. Baselines de `develop` reproducidos ejecutando. Los 16 escenarios E2E son **placeholder** (`test.fixme`), documentados en `tests/e2e/README.md`; ninguno implementado |
| WP-08 | VM 109 y despliegue | Sonnet | `feat/wp08-vm-deploy` | `IN_PROGRESS` | VM creada, red y SSH verificados; aprovisionando |
| WP-09 | Documentación `s9-server` | Sonnet | `feat/diana-vm109` | `PENDING` | Espera datos finales de WP-08 |
| WP-10 | Seguridad | Opus | informe | `READY_FOR_REVIEW` | `docs/security/threat-model.md` + 6 ficheros en `evidence/` (salida real de comandos). 18 hallazgos F-01..F-18: 1 crítico (F-02, ACL MQTT por `client_id`), 6 altos, 10 medios, 1 bajo. **8 de ellos NO reproducidos en ejecución**: el stack no arranca (F-13, faltan `Dockerfile` de backend y worker) |
| WP-11 | Calidad | Opus | informe | `PENDING` | — |
| WP-12 | Supervisión | Opus | dictamen | `IN_PROGRESS` | Ola 0 dictaminada `NO CONFORME`; re-revisión pendiente |

## Hallazgos abiertos que cruzan paquetes

| # | Hallazgo | Origen | Afecta a | Estado |
|---|---|---|---|---|
| X-01 | El presupuesto de GPIO del dosier §8.4 **no cuadra**: 29 pines necesarios (34 con reserva) frente a 25 disponibles | WP-06 | WP-04, WP-06 | Abierto. Topología alternativa propuesta (OR de diodos + 74HC165 + ADC SPI): 21 usados, pero 3 de los 4 de reserva son JTAG |
| X-02 | Térmica del convertidor: Tj = 137 °C a brillo máximo con η=0,90, por encima del límite de 125 °C | WP-06 | WP-06 | Abierto. El tope de brillo pasa de recomendación a **requisito térmico** |
| X-03 | El detector de envolvente pasivo del dosier §9.2 tiene τ_ataque de 3,20 ms para impactos de <1 ms: inservible | WP-06 | WP-06 | Corregido en el diseño con seguidor (4,70 µs); pendiente de validación física |
| X-04 | GPIO 3 propuesto para sensado de 12 V es pin de strapping | WP-04 | WP-04, WP-06 | Abierto, a resolver en la revisión de pinout |
| X-05 | Healthchecks del stack asumen `/health` en backend, worker y frontend | WP-01 | WP-01, WP-02, WP-03 | Abierto, se verifica al integrar |
| X-06 | El contrato REST que asume el panel no está negociado con el backend | WP-03 | WP-02, WP-03 | Abierto, se cierra con la OpenAPI real |
| X-07 | ~~E2E de Playwright no ejecutables aquí~~ **Reclasificado por WP-07: Chromium SÍ se instala.** Ejecutados de verdad: **6 pasan, 12 fallan.** No es utillaje: bug real de strict-mode en `server/frontend/e2e/game-flow.spec.ts:46` (`getByText(/en directo\|conectando/i)` casa 2 elementos) y `vite preview` atado sólo a IPv6 `::1` (falta `--host 127.0.0.1` en `server/frontend/playwright.config.ts`) | WP-03 | WP-03, WP-11 | **Cerrado.** WP-03 los corrigió (4 bugs en total, no 2); E2E 18/18 con navegador real. El adaptador es mock: la ejecución contra el backend real queda en X-06 |
| X-16 | El worker (`server/worker`) **no tiene ningún test**: `npm test` sale con código 1 ("No tests found"). En CI se usa `jest --passWithNoTests` para no romper, pero es una laguna de cobertura, no una solución | WP-07 | WP-02 | Abierto |
| X-08 | **F-02** · La ACL de MQTT autoriza por `%c` (`client_id`, que elige el cliente) y no por `%u`: unas credenciales cualesquiera de módulo bastan para publicar `hit`, `status`, `telemetry`… en nombre de **cualquier otro módulo**. Falta `use_username_as_clientid true` | WP-10 | WP-01, WP-04, WP-05 | Abierto. **Crítico.** Reproducción exacta en `findings.md`; no ejecutada contra la VM |
| X-09 | **F-04** · El contrato de variables de entorno entre `compose.yml` y el backend está roto en 5 variables: `JWT_SECRET` no se pasa, `CORS_ORIGIN` vs `CORS_ORIGINS`, `MQTT_HOST/PORT` vs `MQTT_URL`, `SESSION_SECRET` sin uso, `DIANA_ADMIN_*` sin pasar. Con `NODE_ENV=production` el backend **no arranca**; sin él, firma los JWT con `'desarrollo-inseguro-cambiar'` | WP-10 | WP-01, WP-02, WP-08 | Abierto. Alto |
| X-10 | **F-13** · Faltan los `Dockerfile` de `server/backend` y `server/worker`; 4 de los 6 servicios que construyen imagen apuntan a un contexto sin `Dockerfile`. Impide ejecutar el stack y, por tanto, verificar F-02, F-03, F-05, F-06, F-08, F-09, F-11 y F-12 | WP-10 | WP-01, WP-02, **WP-08 (en curso)** | En curso en WP-08. WP-10 debe reabrir la verificación cuando arranque |
| X-11 | **F-07** · Sin TLS en ninguna capa: el bloque HTTPS de `nginx.conf:136-144` y el listener MQTT 8883 de `mosquitto.conf:57-61` están comentados. JWT, contraseñas de login y credenciales MQTT viajan en claro por la LAN | WP-10 | WP-01, WP-04, WP-08 | Abierto. Alto |
| X-12 | **F-08** · El proxy reescribe `/api/` → `/` pese al prefijo global `api` del backend, y `/ws/` no casa con el namespace `/live`. Al corregir el enrutado hay que verificar que `/api/auth/login` sigue en la zona `api_auth` (5 r/s) y no cae en la general (20 r/s) | WP-10 | WP-01, WP-02, WP-07 | Abierto. Riesgo de perder el control antifuerza bruta al arreglar el fallo funcional |
| X-13 | **F-14 + F-02** · Sin secure boot ni cifrado de flash, el acceso físico a un módulo entrega sus credenciales MQTT. Aceptar ese riesgo por custodia física **sólo es defendible si F-02 se cierra antes**: mientras la ACL autorice por `client_id`, comprometer un módulo compromete a todos | WP-10 | WP-01, WP-04, WP-06 | Abierto. Decisión conjunta pendiente |
| X-14 | **F-16** · El firmware acepta comandos sin verificar caducidad cuando no hay hora (`clock_ok == false`). Requiere (a) rechazar los comandos con consecuencia física en ese estado y (b) confirmar que existe servidor NTP alcanzable en la LAN, que no tiene salida a Internet | WP-10 | WP-04, WP-08 | Abierto |
| X-15 | **F-17** · `npm audit`: 23 vulnerabilidades en backend (12 altas), 3 altas en worker (`effect`/`prisma`, la única con camino de ejecución en producción), 5 en simuladores (1 crítica sin identificar: falta `npm audit --json`) | WP-10 | WP-02, WP-05, WP-07 | Abierto |

## Bitácora

- **2026-07-20** · Auditados ambos repositorios y el nodo Proxmox. `Diana` contenía sólo el
  dosier y un README. `s9-server` accesible, con convención de ficha por máquina y por servicio.
- **2026-07-20** · Inventario Proxmox: VMID 109 e IP .209 libres; `vmbr0`; thin pool con 211 GB.
  Nodo sobrecomprometido en RAM (37,8 GB asignados sobre 32 GB, 4,4 GB de swap en uso).
- **2026-07-20** · Contratos MQTT v1 congelados y puestos a revisión.
- **2026-07-20** · Lanzada la Ola 1 con siete paquetes en worktrees aislados.
- **2026-07-20** · VM 109 creada. **Incidencia:** la imagen `debian-12-genericcloud` traía
  cloud-init instalado pero no se ejecutó, así que la VM arrancaba sin red y con `ssh.service`
  caído por ausencia de claves de host. Resuelto inyectando red estática, claves de host y
  clave pública en el disco montado por `kpartx`, y desactivando la gestión de red de
  cloud-init. Verificado: ping 3/3 y SSH por clave.
- **2026-07-20** · Dictamen del supervisor sobre la Ola 0: **`NO CONFORME`**, con dos
  bloqueantes (ACL contradictoria que dejaba inejecutable la consolidación temporal; `$ref`
  que sólo resolvían con el validador propio) y cinco mayores. Todos corregidos y publicados.
