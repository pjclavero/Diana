# PROPIEDAD DE RUTAS

Regla: un agente **sólo** escribe dentro de las rutas de su paquete. Un cambio
transversal se solicita al organizador, que lo aplica en `develop` o lo asigna.

| Ruta | Paquete | Responsable |
|---|---|---|
| `contracts/**` | WP-00 | Organizador / Arquitectura |
| `docs/coordination/**`, `docs/adr/**` | WP-00 | Organizador |
| `compose*.yml`, `.env.example`, `Makefile` | WP-01 | DevOps |
| `infrastructure/**` (salvo `vm/`, `provisioning/`) | WP-01 | DevOps |
| `server/backend/**`, `server/worker/**`, `server/database/**` | WP-02 | Backend |
| `contracts/api/**` (OpenAPI generado) | WP-02 | Backend |
| `server/frontend/**` | WP-03 | Frontend |
| `firmware/**`, `docs/firmware/**` | WP-04 | Firmware |
| `simulators/**` | WP-05 | Simulador |
| `hardware/**`, `docs/hardware/**` | WP-06 | Hardware |
| `.github/**`, `tests/**` | WP-07 | CI / Calidad |
| `infrastructure/vm/**`, `infrastructure/provisioning/**`, `docs/deployment/**`, `docs/operations/**` | WP-08 | Sistemas |
| `docs/security/**` | WP-10 | Seguridad |
| `docs/testing/**` | WP-11 | Calidad |
| `docs/coordination/SUPERVISOR_REPORT.md` | WP-12 | Supervisor |
| repositorio `s9-server` | WP-09 | Documentación |

## Conflictos conocidos y su resolución

- `server/README.md` y `README.md` raíz: los escribe el organizador, no los paquetes.
- `docs/architecture/**`: lo escribe el organizador con aportaciones de los paquetes.
- El simulador **consume** `contracts/` pero no lo modifica. Si necesita un cambio de
  contrato, lo escala; no lo parchea localmente.
- El backend genera `contracts/api/openapi.json` como artefacto: es la única ruta de
  `contracts/` que un paquete distinto de WP-00 puede tocar.
