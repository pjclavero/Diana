# ESTADO DE EJECUCIÓN

Actualizado por el organizador. Última actualización: 2026-07-20.

| WP | Paquete | Modelo | Rama | Estado | Evidencia / revisión |
|---|---|---|---|---|---|
| WP-00 | Fundación y contratos | Opus | `develop` | `READY_FOR_REVIEW` (2ª vuelta) | `NO CONFORME` del supervisor; H-01..H-07 corregidos; validador 43/0 con resolución estricta |
| WP-01 | Infraestructura Docker | Sonnet | `feat/wp01-infra` | `READY_FOR_REVIEW` | `docker compose config` limpio en base + 4 perfiles; ACL reescrita tópico a tópico |
| WP-02 | Backend y motor de partidas | Opus | `feat/wp02-backend` | `IN_PROGRESS` | — |
| WP-03 | Panel web | Sonnet | `feat/wp03-frontend` | `READY_FOR_REVIEW` | build + typecheck + lint limpios; 30/30 tests; E2E escritos, **sin ejecutar** (falta Chromium) |
| WP-04 | Firmware ESP32-S3 | Opus | `feat/wp04-firmware` | `CHANGES_REQUESTED` | 338/338 comprobaciones en host; resincronizando con el contrato corregido |
| WP-05 | Simulador | Sonnet | `feat/wp05-simulator` | `CHANGES_REQUESTED` | 28/28 tests; resincronizando con el contrato corregido |
| WP-06 | Hardware / KiCad | Opus | `feat/wp06-hardware` | `READY_FOR_REVIEW` | Sin KiCad instalado: **ERC/DRC no ejecutados**. 47 validaciones físicas pendientes |
| WP-07 | CI y pruebas | Sonnet | `feat/wp07-ci` | `PENDING` | — |
| WP-08 | VM 109 y despliegue | Sonnet | `feat/wp08-vm-deploy` | `IN_PROGRESS` | VM creada, red y SSH verificados; aprovisionando |
| WP-09 | Documentación `s9-server` | Sonnet | `feat/diana-vm109` | `PENDING` | Espera datos finales de WP-08 |
| WP-10 | Seguridad | Opus | informe | `PENDING` | — |
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
| X-07 | E2E de Playwright no ejecutables aquí (sin Chromium ni privilegios) | WP-03 | WP-07, WP-11 | Abierto, se ejecutan en CI o en la VM |

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
