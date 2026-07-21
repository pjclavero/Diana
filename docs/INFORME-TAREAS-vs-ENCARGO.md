# Diana · Informe de tareas frente al encargo

**Fecha:** 2026-07-21 · **Rama:** `develop` @ HEAD · **VM:** `diana-server` (109, 192.168.1.209)

Este informe recorre **todas** las tareas del encargo (requisitos de programa) y del dosier
(requisitos de producto) y marca, una a una, si están hechas o no. Después, para cada tarea
hecha (o parcialmente hecha) se da un resumen de cómo está. La fuente de tareas es
[`PROGRAM_BRIEF.md`](coordination/PROGRAM_BRIEF.md), el dosier y las secciones del encargo.

**Leyenda:** ✅ hecha y verificada ejecutando · 🟡 parcial (hecho lo posible sin hardware o
con un resto abierto) · 🔴 no hecha · 🔬 bloqueada por hardware físico.

Regla del encargo respetada: nada marcado ✅ usa «debería funcionar»; se apoya en evidencia
ejecutada. Lo no probado no se marca hecho.

---

## 1. Tabla maestra de tareas

### A. Entregables de producto (encargo §1)

| # | Tarea | Estado |
|---|---|:---:|
| A1 | Estructura profesional de repositorio | ✅ |
| A2 | Separación inequívoca firmware / servidor | ✅ |
| A3 | Firmware base ESP32-S3 | 🟡 |
| A4 | Integración W5500 (Ethernet) | 🟡 |
| A5 | Contratos MQTT versionados | ✅ |
| A6 | Backend | ✅ |
| A7 | Motor de partidas | 🟡 |
| A8 | PostgreSQL | ✅ |
| A9 | Panel web | ✅ |
| A10 | WebSocket en tiempo real | 🟡 |
| A11 | Simulador de módulos/dianas | 🟡 |
| A12 | Stack Docker Compose autocontenido | ✅ |
| A13 | Pruebas unitarias | ✅ |
| A14 | Pruebas de integración | ✅ |
| A15 | Pruebas E2E | 🟡 |
| A16 | Pruebas de seguridad | 🟡 |
| A17 | Pruebas de carga | 🟡 |
| A18 | Diseño electrónico documentado | 🟡 |
| A19 | Esquemas eléctricos (proyecto KiCad) | 🟡 |
| A20 | Documentación de montaje | 🟡 |
| A21 | Documentación de operación | ✅ |
| A22 | Documentación de despliegue | ✅ |
| A23 | Documentación de recuperación | 🟡 |
| A24 | VM Proxmox nueva y dedicada | ✅ |
| A25 | Despliegue real en la VM | 🟡 |
| A26 | Documentación de la VM en `s9-server` | 🔴 |
| A27 | CI reproducible | 🟡 |
| A28 | Estado del proyecto y hoja de ruta actualizados | ✅ |

### B. VM y sistema operativo (encargo §14/§15)

| # | Tarea | Estado |
|---|---|:---:|
| B1 | VM KVM 4 vCPU / 4 GB / 50 GB, Debian estable, bridge LAN | ✅ |
| B2 | VMID e IP verificados libres (109 / .209) | ✅ |
| B3 | SSH por clave, sin root con contraseña | ✅ |
| B4 | Usuario administrativo con sudo | ✅ |
| B5 | qemu-guest-agent | ✅ |
| B6 | Docker Engine + Compose + Buildx (fuente oficial) | ✅ |
| B7 | Sincronización de tiempo | ✅ |
| B8 | Actualizaciones de seguridad automáticas | ✅ |
| B9 | Cortafuegos (SSH admin, HTTP/HTTPS LAN+Tailscale, MQTT módulos) | ✅ |
| B10 | Arranque automático (`onboot` + `restart`) | ✅ |
| B11 | Herramientas: git, curl, wget, jq, unzip, ca-certificates | 🟡 |
| B12 | `gh` (CLI de GitHub) | 🔴 |
| B13 | Tailscale instalado | ✅ |
| B14 | Tailscale unido a la tailnet | 🔴 |
| B15 | PostgreSQL/Node/Mosquitto NO en el host (sólo en Docker) | ✅ |
| B16 | Integración con la política de copias del homelab | ✅ |

### C. Electrónica (encargo §18)

| # | Tarea | Estado |
|---|---|:---:|
| C1 | Proyecto KiCad con 8 hojas (01-power … 08-connectors) | ✅ |
| C2 | BOM y cálculos (potencia, térmica, bulk) | ✅ |
| C3 | ERC (comprobación de reglas eléctricas) ejecutado | 🔴 |
| C4 | DRC (reglas de diseño) ejecutado | 🔴 |
| C5 | Layout de PCB | 🔴 |
| C6 | Fabricación y validación física de la PCB | 🔬 |

### D. Seguridad (encargo §20)

| # | Tarea | Estado |
|---|---|:---:|
| D1 | Gestión de secretos (`.env`, sin secretos en git) | ✅ |
| D2 | Credencial por módulo, Mosquitto sin anónimo, ACL | ✅ |
| D3 | Modelo de amenazas + informe de hallazgos | ✅ |
| D4 | Análisis de dependencias (`npm audit`) | ✅ |
| D5 | Revisión de seguridad independiente | ✅ |
| D6 | Autenticación web, roles, validación, rate limiting, cabeceras | ✅ |
| D7 | Imágenes no root, análisis de imágenes | 🟡 |
| D8 | TLS (MQTT y HTTP) activado | 🔴 |
| D9 | OTA firmada + rollback | 🟡 |
| D10 | Cierre de F-02 (ACL por client_id) | 🔴 |

### E. Proceso y gobernanza (encargo §2, §3, §24, §25)

| # | Tarea | Estado |
|---|---|:---:|
| E1 | Organizador Opus (paquetes, ramas, olas, integración) | ✅ |
| E2 | Supervisor Opus — 1ª vuelta (dictamen `NO CONFORME`) | ✅ |
| E3 | Supervisor Opus — 2ª vuelta sobre lo corregido | 🔴 |
| E4 | Supervisor Opus — dictamen final | 🔴 |
| E5 | Calidad independiente (WP-11) | ✅ |
| E6 | Independencia §2.4 en la cadena unitaria | 🟡 |
| E7 | Protección del servidor (no tocar VMs 100-108) | ✅ |
| E8 | Disciplina git (ramas, worktrees, commits, sin ocultar fallos) | ✅ |
| E9 | PR `develop` → `main` | 🔴 |
| E10 | Informe final §25 (definitivo, ligado al dictamen) | 🟡 |

---

## 2. Resumen por tarea hecha (y parcial)

### A. Entregables de producto

**A1 · Estructura de repositorio — ✅**
Árbol profesional con `firmware/esp32`, `server/{backend,frontend,worker}`, `contracts`,
`simulators`, `infrastructure`, `hardware`, `tests`, `docs`, `.github`. Registrado en ADR-0004.

**A2 · Separación firmware/servidor — ✅**
El código ESP32 vive sólo en `firmware/esp32`; el servidor en `server/`. La lógica pura del
firmware (`diana_core`, C11) se separa del hardware por una tabla de punteros a función (HAL),
lo que permite probarla en host.

**A3 · Firmware ESP32-S3 — 🟡**
Lógica completa y **probada en host: 389/389 comprobaciones**. Máquinas de estado, captura de
impacto, cola persistente, idempotencia, clasificación de crosstalk, comandos con nonce
persistido y caducidad, OTA A/B. **Falta: nunca se ha compilado con ESP-IDF ni corrido en
silicio.** Es la laguna mayor. El workflow `firmware-idf.yml` existe para cerrarla en CI.

**A4 · Integración W5500 — 🟡**
Presente en el esquemático (hoja 02) y en el HAL del firmware (SPI + reset). No validada
físicamente (sin PCB ni chip).

**A5 · Contratos MQTT versionados — ✅**
12 esquemas JSON Schema 2020-12, namespace `targets/v1`, modelo temporal de 4 marcas,
idempotencia por `event_id`, ACL tópico a tópico. Validador ejecutable: **43 comprobaciones,
0 fallos**. Congelados como v1.

**A6 · Backend — ✅**
NestJS + Prisma, 23 entidades, ingesta MQTT idempotente, motor de partidas, OpenAPI,
exportación CSV, 5 roles. **Desplegado y `healthy` en la VM**; la API responde por el proxy
(`/api/health` → `{"status":"ok"}`). 157 tests unitarios + 5 de integración (ver A14).

**A7 · Motor de partidas — 🟡**
Cuatro modos implementados y probados en host (añadir uno no toca el núcleo; semilla
explícita para reproducibilidad). **Resto abierto:** la ingesta e2e de impactos hasta
PostgreSQL no se verificó (X-18); faltan los modos `memory` y `no_shoot`.

**A8 · PostgreSQL — ✅**
**Migración aplicada contra base viva** (`20260720120000_init`), lo que nunca se había hecho.
Restricciones verificadas: 24 tablas, índices únicos de idempotencia, 4 marcas temporales en
`BIGINT`/`timestamptz`. No expuesto al host.

**A9 · Panel web — ✅**
19 pantallas, editor de matriz 3×3, vista en directo, regla de precisión no calculable. Ningún
estado se comunica sólo por color. **E2E ejecutados con navegador real: 18/18** (contra
adaptador mock; el contrato contra el backend real queda en X-06).

**A10 · WebSocket tiempo real — 🟡**
Gateway `/live` implementado en el backend. **Resto abierto:** el enrutado del WebSocket por
el proxy nginx no está resuelto (X-06/F-08): `/ws/` no casa con el namespace socket.io; la
vista en directo por WS aún no es alcanzable por el proxy. El REST completo sí lo es.

**A11 · Simulador — 🟡**
33/33 tests. **Conecta al Mosquitto real y completa un escenario de partida** (una credencial
de módulo basta por la ACL-por-client_id). **Resto abierto:** los impactos no se persistieron
en PostgreSQL (X-18).

**A12 · Stack Docker Compose — ✅**
Stack autocontenido con perfiles (base/dev/test/simulator/monitoring), healthchecks, ACL,
copias. **Desplegado en la VM: 7/7 servicios `healthy`.** Se corrigieron 6 defectos reales de
arranque (Postgres `listen_addresses`, permisos y orden de `mosquitto.conf`, healthcheck del
broker, prefijo `/api` del proxy, Dockerfiles ausentes) — detalle en
`deployment/procedimiento.md` §8.

**A13 · Pruebas unitarias — ✅**
Reproducidas ejecutando (WP-11): contratos 43/0, firmware 389/389, simulador 33/33, backend
157, frontend 30/30.

**A14 · Pruebas de integración — ✅**
**5/5 contra PostgreSQL real.** Demuestran lo que la memoria no puede: idempotencia
garantizada por la base (índice único + tupla `(module,boot,seq)`, incluso concurrente) y
microsegundos que sobreviven en `BigInt`. Reproducido dos veces. Se corrigió de paso un
defecto del propio test (medía el límite de `double` de JS, no la columna).

**A15 · Pruebas E2E — 🟡**
Frontend 18/18 con navegador. **Resto abierto:** los 16 escenarios E2E obligatorios del §19
están como placeholder honesto (`test.fixme`, 0 aserciones), documentados uno a uno; ninguno
implementado (requieren el stack completo con datos).

**A16 · Pruebas de seguridad — 🟡**
Modelo de amenazas + 18 hallazgos con evidencia; `npm audit`; escaneo de secretos; ACL probada
en vivo; **F-02 confirmado en vivo**. **Resto abierto:** 7 de los 18 hallazgos aún dependen de
verificación adicional en ejecución; TLS sin activar.

**A17 · Pruebas de carga — 🟡**
Generador de carga MQTT escrito (9 módulos / 81 dianas, ráfagas, reconexión con replay),
validado sintácticamente y sus payloads contra los esquemas. **No ejecutado** contra el broker
real todavía.

**A18/A19 · Electrónica y esquemas KiCad — 🟡**
Proyecto KiCad con **8 hojas**, 74 redes, 140 componentes, BOM de 58 líneas, cálculos de
potencia/térmica/bulk. **Resto abierto:** ERC y DRC **no ejecutados** (sin KiCad en el
entorno), sin layout ni PCB. Dos hallazgos que cambian el diseño: déficit de GPIO (X-01) y
térmica del convertidor (X-02).

**A20/A21/A22/A23 · Documentación — 🟡/✅**
Despliegue (`deployment/procedimiento.md`, con incidencias reales y evidencia) ✅ y operación
(`operations/operacion.md`) ✅ escritas. Montaje y recuperación 🟡: existen notas de hardware y
de recuperación del firmware, pero el manual de montaje mecánico y el runbook de recuperación
completo del servidor (restauración probada) están incompletos.

**A24 · VM Proxmox — ✅**
VM 109 `diana-server` creada (KVM, 4 vCPU, `memory=4096`+`balloon=1024`, 50 GB, `vmbr0`,
`.209`). Incidencia de cloud-init resuelta por inyección offline. Verificada: ping y SSH por
clave.

**A25 · Despliegue real — 🟡**
Stack sano y API respondiendo (ver A12). **Resto abierto:** copia de seguridad + restauración
en base aislada + `reboot` verificando el retorno automático, aún **no ejecutados**.

**A27 · CI reproducible — 🟡**
5 workflows escritos con YAML validado (`ci`, `firmware-idf`, `integration`, `e2e`, `nightly`),
incluido el que compila el firmware con ESP-IDF. **Resto abierto:** no se han ejecutado en
GitHub Actions todavía; su verde real está por confirmar.

**A28 · Estado y hoja de ruta — ✅**
`docs/phases/ROADMAP.md` (12 fases con estado real), `STATUS.md`, `INFORME-ESTADO-2026-07-21.md`
y este informe.

### B. VM y sistema (resumen de lo hecho)

**B1-B10, B13, B15, B16 · ✅** — Verificado en la VM el 2026-07-21: guest agent `active`,
sincronía de tiempo `NTPSynchronized=yes` (chrony), `unattended-upgrades active`, cortafuegos
nft con reglas por puerto, `restart:` en 14 servicios, Docker/git/curl/wget/jq/unzip
presentes, Tailscale instalado y `tailscaled active`. Ningún runtime de aplicación en el host.

**B11 · 🟡** — Faltan por confirmar `ca-certificates` explícitamente (los demás presentes).

**B12 · 🔴** — `gh` (CLI de GitHub) **no instalado** en la VM. Pendiente.

**B14 · 🔴** — Tailscale **no unido a la tailnet** («Logged out»): falta la auth key, que el
encargo permite dejar como único paso pendiente documentado.

### D. Seguridad (resumen de lo hecho)

**D1-D6 · ✅** — Secretos fuera de git (`.env` 0600), Mosquitto sin anónimo con credencial por
módulo y ACL tópico a tópico, modelo de amenazas + 18 hallazgos, `npm audit`, revisión
independiente (WP-10), y en el backend: JWT + permisos como guards globales, `ValidationPipe`
estricto, `helmet`, rate limiting, cabeceras y CSP.

**D7 · 🟡** — Imágenes corren como usuario no root (verificable con `docker run … id`); el
análisis de imágenes (Trivy) está en el nightly pero no ejecutado.

**D9 · 🟡** — OTA con verificación sha256 + firma delegada a ESP-IDF + rollback A/B en el
firmware; sin validar sobre hardware.

**D10 · 🔴** — **F-02 confirmado en vivo** (un módulo suplanta a otro por `client_id`); la
mitigación exige alinear usuario=client_id=module_id, decisión de contrato para el supervisor.

### E. Proceso (resumen de lo hecho)

**E1 · ✅** — Organizador: 8+ paquetes en worktrees aislados, integración por olas con
verificación ejecutada (así se cazaron bugs reales de `.gitignore`, entorno y despliegue).

**E2 · ✅** — Supervisor 1ª vuelta: dictamen `NO CONFORME` con 2 bloqueantes + 5 mayores, todos
corregidos (H-01…H-07).

**E5 · ✅** — Calidad independiente (WP-11): **CONFORME CON OBSERVACIONES**, con las suites
reproducidas ejecutando.

**E6 · 🟡** — La independencia existe a nivel agregado (seguridad/calidad/supervisión son
equipos distintos de los implementadores), pero los tests unitarios de
backend/firmware/simulador los escribió el mismo paquete que implementa. Documentado, no
maquillado.

**E7 · ✅** — Proxmox: VMs 100-108 intactas (inventario inicial), sin reutilizar VMID/IP, sin
tocar la red del host; cambio de la política de copias aditivo y con respaldo previo.

**E8 · ✅** — Ramas temáticas, worktrees separados, commits pequeños de una sola naturaleza,
integración sólo con pruebas verdes, fallos preexistentes reportados (X-07, X-16, X-18), sin
force-push.

**E10 · 🟡** — Hay informe de estado y este informe de tareas; el informe final §25
**definitivo** queda ligado al dictamen final del supervisor (E4), aún pendiente.

---

## 3. Lo que falta, en una frase

Cerrar el despliegue (copia/restauración/`reboot`), la ingesta e2e (X-18) y el WebSocket
(X-06); instalar `gh` y unir Tailscale; documentar la VM en `s9-server` (A26); decidir F-02
con el supervisor; y emitir la 2ª vuelta + dictamen final, para abrir el PR a `main` y el
informe §25 definitivo. Todo lo que exige hardware (firmware en ESP-IDF, ensayos piezo,
ERC/DRC, PCB) queda marcado como validación física pendiente, no como hecho.
