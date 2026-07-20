# ESTADO DE EJECUCIÓN

Actualizado por el organizador. Última actualización: 2026-07-20.

| WP | Paquete | Modelo | Rama | Estado | Revisión |
|---|---|---|---|---|---|
| WP-00 | Fundación y contratos | Opus | `develop` | `APPROVED` | Supervisor |
| WP-01 | Infraestructura Docker | Sonnet | `feat/wp01-infra` | `PENDING` | — |
| WP-02 | Backend y motor de partidas | Opus | `feat/wp02-backend` | `PENDING` | — |
| WP-03 | Panel web | Sonnet | `feat/wp03-frontend` | `PENDING` | — |
| WP-04 | Firmware ESP32-S3 | Opus | `feat/wp04-firmware` | `PENDING` | — |
| WP-05 | Simulador | Sonnet | `feat/wp05-simulator` | `PENDING` | — |
| WP-06 | Hardware / KiCad | Opus | `feat/wp06-hardware` | `PENDING` | — |
| WP-07 | CI y pruebas | Sonnet | `feat/wp07-ci` | `PENDING` | — |
| WP-08 | VM 109 y despliegue | Sonnet | `feat/wp08-vm-deploy` | `PENDING` | — |
| WP-09 | Documentación `s9-server` | Sonnet | `feat/diana-vm109` (otro repo) | `PENDING` | — |
| WP-10 | Seguridad | Opus | informe | `PENDING` | — |
| WP-11 | Calidad | Opus | informe | `PENDING` | — |
| WP-12 | Supervisión | Opus | dictamen | `PENDING` | — |

## Bitácora

- **2026-07-20** · Auditados ambos repositorios y el nodo Proxmox. `Diana` contenía sólo
  el dosier y un README. `s9-server` accesible, convención de fichas por máquina y por
  servicio confirmada.
- **2026-07-20** · Inventario Proxmox: VMID 100-108 ocupados, 109 libre; IP .209 libre;
  bridge `vmbr0`; thin pool con 211 GB disponibles; plantilla Debian 12 cloud-init presente.
  Ninguna VM existente modificada.
- **2026-07-20** · Contratos MQTT v1 congelados. `contracts/validate.py`: 41 comprobaciones,
  0 fallos.
