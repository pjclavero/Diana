# Diana · Informe de tareas frente al encargo

**Fecha:** 2026-07-26 (revisión completa de estados) · **Rama:** `develop` @ `133d760` ·
**Desplegado en la VM:** `develop` @ `133d760` (incluye D9; verificado por SSH el 2026-07-26) · **VM:** `diana-server` (109, 192.168.1.209)

> **Aviso de alcance de esta revisión.** Los estados se han contrastado el 2026-07-26 contra el
> código de `develop` y el historial de git. **No se ha tocado la VM 109** para hacerla, ni por
> lectura: lo que aquí figura como verificado en la VM procede de las verificaciones anteriores
> registradas en `deployment/procedimiento.md` §8-§9 y en el commit de despliegue `8220a45`.
> **La verificación funcional con credenciales reales sigue sin hacerse**: nadie ha jugado una
> partida de principio a fin desde el panel.

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
| A26 | Documentación de la VM en `s9-server` | 🟡 |
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
| B14 | Tailscale unido a la tailnet | 🟡 |
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
**Cinco** modos implementados y probados en host (`random`, `sequence`, `reaction`,
`all_against_clock` y **`duelo`**, añadido en G-E; añadir uno no toca el núcleo; semilla
explícita para reproducibilidad). Desde G-I el motor además **reacciona a la caída de un
módulo**: auto-pausa de la ronda si el caído participa, pausa dura si es el coordinador de la
partida, y nunca reanuda solo. **Resto abierto:** la ingesta e2e de impactos hasta PostgreSQL
**sigue sin verificarse** (X-18-INGESTA, sin reintentar desde 2026-07-21); faltan los modos
`memory` y `no_shoot`, que están en el contrato y no en el código (comprobado el 2026-07-26 en
`src/domain/game/strategies/`).

**A8 · PostgreSQL — ✅**
**Migración aplicada contra base viva** (`20260720120000_init`), lo que nunca se había hecho.
Restricciones verificadas: 24 tablas, índices únicos de idempotencia, 4 marcas temporales en
`BIGINT`/`timestamptz`. No expuesto al host.

**A9 · Panel web — ✅**
19 pantallas iniciales, hoy **más de 30 rutas** tras F1–F3 y el lote G (login, módulos,
propiedad, firmware, jugadores, equipos, participantes, presets, vistas, matrices, marcador,
duelo, demo, invitaciones, unirse por QR, resiliencia). Editor de matriz 3×3 con datos reales,
regla de precisión no calculable, ningún estado comunicado sólo por color. **E2E ejecutados con
navegador real: 18/18** (contra adaptador mock). Unitarias del frontend a `133d760`: **131/131**,
con `tsc` y `oxlint` limpios.
**Matiz que hay que decir:** la imagen de producción se compila con `VITE_API_MODE=mock`
(`server/frontend/Dockerfile:19`). Las pantallas nuevas no dependen de ese modo —tienen cliente
propio contra `/api` real con JWT— pero las **heredadas** (estado del sistema, telemetría y
configuración de módulo, calibración, prueba de sensores/LED, diagnósticos, incidencias)
siguen colgando de `realAdapter`, cuyas rutas el backend no expone: enseñan **datos de
demostración**, y el propio panel lo declara. Es el resto vivo de X-21.

**A10 · WebSocket tiempo real — 🟡**
Gateway implementado en el backend (`namespace: '/live'`, `path: '/ws/socket.io'`), con salas
por partida. **Resto abierto y precisado el 2026-07-26 leyendo el código:** el panel abre un
**WebSocket crudo** contra `${VITE_WS_URL}/games/:id/live`
(`server/frontend/src/api/realGameSocket.ts:41`), y un `WebSocket` nativo **no habla el
protocolo de socket.io**. Es decir, el problema no es sólo de enrutado del proxy: los dos
extremos hablaban protocolos distintos, y por eso **la vista en directo nunca pudo funcionar
contra el backend real** (X-06). El REST sí es alcanzable por el proxy.
**Corregido en código el mismo 2026-07-26 (`5c3b7ac`), después de escribirse el párrafo
anterior:** el panel pasa a `socket.io-client`, el gateway sirve en `/ws/socket.io` con salas
reales por partida —antes emitía a **todos** los clientes— y recuerda el último estado para
quien se suscribe. Se sigue en 🟡 y no en ✅ por tres razones concretas: **no está desplegado**,
**no se ha probado con un navegador real contra el backend desplegado**, y **el canal en directo
no exige autenticación**: el namespace no valida el JWT.

**A11 · Simulador — 🟡**
33/33 tests. **Conecta al Mosquitto real y completa un escenario de partida** (una credencial
de módulo basta por la ACL-por-client_id). **Resto abierto:** los impactos no se persistieron
en PostgreSQL (X-18-INGESTA). Sin reintentar desde 2026-07-21; el simulador tampoco se ha
vuelto a ejecutar contra el broker desde entonces.

**A12 · Stack Docker Compose — ✅**
Stack autocontenido con perfiles (base/dev/test/simulator/monitoring), healthchecks, ACL,
copias. **Desplegado en la VM: 7/7 servicios `healthy`.** Se corrigieron 6 defectos reales de
arranque (Postgres `listen_addresses`, permisos y orden de `mosquitto.conf`, healthcheck del
broker, prefijo `/api` del proxy, Dockerfiles ausentes) — detalle en
`deployment/procedimiento.md` §8.

**A13 · Pruebas unitarias — ✅**
Reproducidas ejecutando por calidad (WP-11, 2026-07-21): contratos 43/0, firmware 389/389,
simulador 33/33, backend 157, frontend 30/30. **A `133d760` (2026-07-26), según los commits que
las ejecutaron:** backend **471 pasan + 7 saltadas** (las saltadas exigen `DATABASE_URL`),
frontend **131/131**, `tsc -b`, `tsc --noEmit` y `oxlint` limpios. Firmware y simulador **no se
han vuelto a ejecutar** desde el 2026-07-21: sus cifras son las de entonces.
**Verificación por mutación (G-I/D9):** 12 mutaciones aplicadas sobre el código real
(8 backend + 4 frontend); las 12 mueren. Es la única parte del proyecto con esa evidencia.

**A14 · Pruebas de integración — ✅**
**5/5 contra PostgreSQL real** en 2026-07-21, y **7/7** en el despliegue del 2026-07-26 tras
añadirse la prueba de concurrencia del cerrojo de panel (N8), que hasta ese día estaba escrita
pero **declarada como no ejecutada**. Demuestran lo que la memoria no puede: idempotencia
garantizada por la base (índice único + tupla `(module,boot,seq)`, incluso concurrente) y
microsegundos que sobreviven en `BigInt`. Reproducido dos veces. Se corrigió de paso un
defecto del propio test (medía el límite de `double` de JS, no la columna).

**A15 · Pruebas E2E — 🟡**
Frontend 18/18 con navegador. **Resto abierto:** los 16 escenarios E2E obligatorios del §19
están como placeholder honesto (`test.fixme`, 0 aserciones), documentados uno a uno; ninguno
implementado (requieren el stack completo con datos). **Comprobado de nuevo el 2026-07-26:**
`tests/e2e/scenarios.spec.ts` sigue con los 16 `test.fixme` (E-01…E-16) y `docs/testing/` sigue
vacío salvo su `.gitkeep.md` (X-17 abierto).

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
Stack sano y API respondiendo (ver A12). **Último despliegue: 2026-07-26** (`develop` @
`045fdd1`): 4 migraciones aplicadas contra la base viva, imágenes backend/frontend/worker
reconstruidas, **8/8 contenedores `healthy`**, copia de la base tomada antes de tocar nada.
**Resto abierto:** (a) **restauración** en base aislada y **`reboot`** verificando el retorno
automático **siguen sin ejecutarse**; (b) el HEAD de `develop` (`133d760`, D9) **no está
desplegado**; (c) la verificación viva fue de superficie (contenedores, esquema y códigos HTTP),
**sin autenticarse con credenciales reales ni jugar una partida**; (d) dos incidencias de
infraestructura abiertas en la VM, el **DNS roto** (MagicDNS de Tailscale) y la **memoria por
debajo de lo nominal**, que obliga a parar contenedores para poder compilar sin que BuildKit
muera por OOM (`deployment/procedimiento.md` §8).

**A27 · CI reproducible — 🟡**
5 workflows escritos con YAML validado (`ci`, `firmware-idf`, `integration`, `e2e`, `nightly`),
incluido el que compila el firmware con ESP-IDF. **Resto abierto:** no se han ejecutado en
GitHub Actions todavía; su verde real está por confirmar.

**A26 · Documentación de la VM en `s9-server` — 🟡**
Según `docs/INFORME-ESTADO-2026-07-21.md` §3 se entregaron las fichas `maquinas/vm109-diana.md`
y `servicios/diana.md` y se actualizaron `indice.md` e `inventario.md`, en el **PR #7** de
`s9-server` (rama `feat/diana-vm109`). **No verificable desde este repositorio** —vive en otro
repo— y **el merge lo hace el operador**. Además, la ficha describe el estado a **2026-07-21**:
no incluye el lote G-A…G-I, ni el despliegue del 2026-07-26, ni las incidencias de DNS y RAM.
Pasa de 🔴 a 🟡 por eso: escrito y entregado, sin mergear y desactualizado.

**A28 · Estado y hoja de ruta — ✅**
`docs/phases/ROADMAP.md` (12 fases con estado real), `STATUS.md`, `INFORME-ESTADO-2026-07-21.md`
y este informe. Los dos informes con fecha en el nombre son **fotografías** de su día y se
conservan como tales; el estado vivo está en `STATUS.md`.

### Lote G-A…G-I y programa F1–F6 (posteriores al encargo original)

No son tareas del encargo §1, sino requisitos de producto añadidos por la dirección los días
2026-07-21 y 2026-07-22 (`docs/product/alcance-panel-roles-firmware.md` §6). Estado a
2026-07-26: **G-A…G-H cerrados con supervisor independiente y desplegados**; **G-I desplegado
salvo D9**, cuyo barrido de obsolescencia está en `develop` (`133d760`) con **tres
supervisiones `NO CONFORME` ya corregidas y la cuarta EN CURSO**, sin desplegar. F1, F2 y F3
cerradas y desplegadas; F4 y F5 mayoritariamente entregadas por G-D con restos abiertos
(reset de estadística por partida; código de activación de gestor; envío real de correo);
**F6 (diagnóstico) sigue sin cablear al backend**. Detalle por bloque en `STATUS.md`.

### B. VM y sistema (resumen de lo hecho)

**B1-B10, B13, B15, B16 · ✅** — Verificado en la VM el 2026-07-21: guest agent `active`,
sincronía de tiempo `NTPSynchronized=yes` (chrony), `unattended-upgrades active`, cortafuegos
nft con reglas por puerto, `restart:` en 14 servicios, Docker/git/curl/wget/jq/unzip
presentes, Tailscale instalado y `tailscaled active`. Ningún runtime de aplicación en el host.

**B11 · 🟡** — Faltan por confirmar `ca-certificates` explícitamente (los demás presentes).

**B12 · 🔴** — `gh` (CLI de GitHub) **no instalado** en la VM. Pendiente.

**B14 · 🟡** — Estaba como 🔴 («Logged out», sin auth key) desde el 2026-07-21. **Hoy hay
indicio en contra, no comprobación:** la incidencia de DNS del 2026-07-26
(`deployment/procedimiento.md` §8) registra que el único resolver de la VM era
`100.100.100.100` con `search …ts.net`, es decir **MagicDNS de la tailnet**, que sólo se
configura estando unida. **No lo he verificado**: este barrido de documentación no toca la VM.
Queda como 🟡 con la contradicción declarada, a confirmar con un `tailscale status` cuando el
operador entre. Y unida o no, **su DNS está roto**, que es el problema operativo real.

### D. Seguridad (resumen de lo hecho)

**D1-D6 · ✅** — Secretos fuera de git (`.env` 0600), Mosquitto sin anónimo con credencial por
módulo y ACL tópico a tópico, modelo de amenazas + 18 hallazgos, `npm audit`, revisión
independiente (WP-10), y en el backend: JWT + permisos como guards globales, `ValidationPipe`
estricto, `helmet`, rate limiting, cabeceras y CSP.

**D7 · 🟡** — Imágenes corren como usuario no root (verificable con `docker run … id`); el
análisis de imágenes (Trivy) está en el nightly pero no ejecutado.

**D9 · 🟡** — OTA con verificación sha256 + firma delegada a ESP-IDF + rollback A/B en el
firmware. Del lado del servidor el ciclo se cerró en G-B y en el bloque de deudas: subida del
binario por el admin con **sha256 y tamaño calculados por el servidor** (no se cree al cliente),
descarga pública para el módulo, **compatibilidad de placa** que rechaza en vez de suponer
cuando la placa del módulo no consta, y «un despliegue en vuelo por módulo» garantizado por un
**índice único parcial** en la base, no por una comprobación con carrera. **Sigue sin validarse
sobre hardware**: el firmware nunca se ha compilado con ESP-IDF, así que ninguna OTA ha
terminado nunca en un dispositivo real. Y con `MQTT_ENABLED` apagado, la orden de OTA se
descarta en silencio y el `Deployment` queda en `sent` sin OTA real.

**D4 · ✅ (medición envejecida)** — El `npm audit` que sostiene X-15 (23 vulnerabilidades en el
backend, 12 altas; 3 altas en el worker; 5 en simuladores) se ejecutó el **2026-07-20** y **no
se ha vuelto a ejecutar** desde entonces, pese a que el árbol de dependencias ha cambiado. La
tarea del encargo (analizar dependencias) está hecha; el hallazgo X-15 sigue **abierto y sin
remediar**.

**D10 · 🔴** — **F-02 confirmado en vivo** (un módulo suplanta a otro por `client_id`); la
mitigación exige alinear usuario=client_id=module_id, decisión de contrato para el supervisor.

### E. Proceso (resumen de lo hecho)

**E1 · ✅** — Organizador: 8+ paquetes en worktrees aislados, integración por olas con
verificación ejecutada (así se cazaron bugs reales de `.gitignore`, entorno y despliegue).

**E2 · ✅** — Supervisor 1ª vuelta: dictamen `NO CONFORME` con 2 bloqueantes + 5 mayores, todos
corregidos (H-01…H-07).

**E3/E4 · 🔴 a nivel de programa, pero hay mucha supervisión real por bloque.** La 2ª vuelta
sobre la Ola 0 y el dictamen final del programa **siguen sin emitirse**. Lo que sí existe, y no
es poco, es un supervisor independiente por bloque en F1–F3 y en G-A…G-I, con **dictámenes
adversos de verdad**: G-G fue `NO CONFORME` en su 1ª ronda (el marcador multijugador mostraba
«0 aciertos» para todos porque nadie escribía `HitEvent.participantId`), y D9 de G-I encadenó
**tres** `NO CONFORME` seguidos por el mismo error con caras distintas —confundir «el módulo
calla» con «el backend está sordo»— antes de la 4ª supervisión, **en curso al cerrar este
informe**. No se convalidan como E3/E4: son revisiones de bloque, no del programa.

**E5 · ✅** — Calidad independiente (WP-11): **CONFORME CON OBSERVACIONES**, con las suites
reproducidas ejecutando.

**E6 · 🟡** — La independencia existe a nivel agregado (seguridad/calidad/supervisión son
equipos distintos de los implementadores), pero los tests unitarios de
backend/firmware/simulador los escribió el mismo paquete que implementa. Documentado, no
maquillado.

**E7 · ✅** — Proxmox: VMs 100-108 intactas (inventario inicial), sin reutilizar VMID/IP, sin
tocar la red del host; cambio de la política de copias aditivo y con respaldo previo.

**E8 · ✅** — Ramas temáticas, worktrees separados, commits pequeños de una sola naturaleza,
integración sólo con pruebas verdes, fallos preexistentes reportados (X-07, X-16,
X-18-INGESTA), sin
force-push.

**E10 · 🟡** — Hay informe de estado y este informe de tareas; el informe final §25
**definitivo** queda ligado al dictamen final del supervisor (E4), aún pendiente.

---

## 3. Lo que falta, en una frase

Cerrar el despliegue (restauración aislada y `reboot`), la ingesta e2e (X-18-INGESTA) y el
WebSocket (X-06, que no es enrutado sino protocolos distintos en cada extremo); **hacer la
verificación funcional con credenciales reales**, que nadie ha hecho; **arreglar el DNS y la
memoria de la VM**, que hoy hacen frágil cualquier despliegue; cerrar el resto de X-21 (las
pantallas heredadas, entre ellas el diagnóstico F6); cerrar D9 con su 4ª supervisión y
desplegarlo; instalar `gh` y confirmar el estado de Tailscale; mergear y actualizar la
documentación de la VM en `s9-server` (A26); decidir F-02 con el supervisor y activar TLS
(F-07); atender las 23 vulnerabilidades de npm (X-15); y emitir la 2ª vuelta + dictamen final
del programa, para abrir el PR a `main` y el informe §25 definitivo. Todo lo que exige hardware
(firmware en ESP-IDF, ensayos piezo, ERC/DRC, PCB, 47 validaciones físicas, déficit de GPIO
X-01, térmica de 137 °C X-02, strapping de GPIO 3 X-04) queda marcado como validación física
pendiente, no como hecho.
