# MASTER PLAN · Proyecto Diana

**Organizador:** agente Opus (hilo principal)
**Supervisor técnico:** agente Opus independiente
**Fuente de requisitos:** `dosier_tecnico_matriz_dianas_modulares.md` (v0.1, 2965 líneas, leído íntegro)
**Rama de integración:** `develop` → PR a `main`
**Fecha de arranque:** 2026-07-20

---

## 1. Objetivo del programa

Dejar Diana con una base funcional real: contratos congelados, firmware compilable,
backend y panel operativos, simulador capaz de jugar partidas sin hardware, stack
Docker desplegado en una VM Proxmox nueva y documentación en `s9-server`.

No se marca como validado nada que no se haya ejecutado. Todo lo que depende del
hardware físico definitivo se implementa con abstracción + simulador + procedimiento
de validación física, y queda explícitamente marcado como *pendiente de banco*.

## 2. Olas

| Ola | Contenido | Estado |
|---|---|---|
| 0 | Auditoría, esqueleto de repositorio, contratos MQTT v1, ADR, coordinación | `APPROVED` |
| 1 | Infra Docker, backend, frontend, firmware, simulador, KiCad, CI | ver `STATUS.md` |
| 2 | Integración MQTT ↔ backend ↔ panel, modos de juego, estadísticas | ver `STATUS.md` |
| 3 | Creación de VM 109, endurecimiento, despliegue real, documentación `s9-server` | ver `STATUS.md` |
| 4 | Calidad: E2E, carga, seguridad, backup/restore, reboot, rollback | ver `STATUS.md` |
| 5 | Cierre supervisado: auditoría final, correcciones, PR, dictamen | ver `STATUS.md` |

Regla de avance: **no se entra en una ola si una dependencia crítica está `NO CONFORME`.**
Un bloqueo en una línea no detiene las demás (regla 3.2 del encargo).

## 3. Decisiones de arquitectura de la Ola 0

Congeladas en `docs/adr/`:

- **ADR-0001** Stack del servidor: NestJS + Prisma + PostgreSQL + React/Vite + Mosquitto.
- **ADR-0002** Modelo temporal de cuatro marcas (T1 dispositivo, T2 coordinador, T3 recepción, T4 persistencia).
- **ADR-0003** Idempotencia por `event_id` generado en el módulo; `(module_id, boot_id, local_sequence)` único.
- **ADR-0004** Separación firmware / servidor / contratos con propiedad de rutas por paquete.
- **ADR-0005** Identidad de la VM: VMID 109, `diana-server`, 192.168.1.209.
- **ADR-0006** Precisión no calculable cuando se desconoce la munición restante (nunca se inventan fallos).

## 4. Mapa de dependencias

```
contracts/ (Ola 0, congelado)
     │
     ├──> WP-02 backend ──┬──> WP-11 QA E2E ──> WP-12 dictamen
     ├──> WP-04 firmware  │
     ├──> WP-05 simulador ┘
     └──> WP-03 frontend ─┘
WP-01 infra ──> WP-08 VM + despliegue ──> WP-11 QA en VM
WP-06 hardware  (independiente, sólo depende del dosier)
WP-07 CI        (depende de que existan los paquetes; se ajusta al final)
WP-10 seguridad (revisa todo lo anterior, no implementa)
```

`WP-06` (hardware) y `WP-09` (documentación `s9-server`) no bloquean a nadie:
si algo se atasca en software, siguen avanzando.

## 5. Reglas de ejecución

1. Nadie trabaja sobre `main`. Cada paquete tiene rama propia y worktree propio.
2. Cada paquete declara sus **rutas permitidas**; escribir fuera de ellas es un fallo de proceso.
3. Quien implementa no aprueba su propio trabajo. QA y seguridad son agentes distintos.
4. Sin evidencia ejecutada no hay `APPROVED`.
5. Ningún secreto entra en git. `.env.example` con valores de ejemplo; secretos reales sólo en la VM.
6. Sobre Proxmox: inventario antes de tocar, ninguna VM existente se modifica, ningún VMID ni IP se reutiliza.

## 6. Criterio de "terminado"

Ver `docs/coordination/TEST_MATRIX.md`. Un paquete está terminado cuando tiene
código + documentación + pruebas ejecutadas con salida registrada + revisión
independiente + dictamen del supervisor.
