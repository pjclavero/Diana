# Encargo del programa

Los documentos de coordinación citan "el encargo" como fuente normativa junto al dosier.
El supervisor señaló, con razón (hallazgo H-06), que ese documento no estaba en el
repositorio: una fuente normativa invisible no es auditable. Aquí queda registrada.

**Origen:** instrucción del responsable del proyecto al equipo de agentes, 2026-07-20.
**Jerarquía:** el `dosier_tecnico_matriz_dianas_modulares.md` es la fuente de **requisitos
de producto**. El encargo es la fuente de **requisitos de programa** (cómo se organiza,
qué se entrega, qué se despliega). Donde el encargo modifica un requisito del dosier, se
registra como decisión explícita, no como corrección de errata.

---

## 1. Objetivo

Preparar Diana con una base funcional real, no una auditoría ni un plan: estructura
profesional de repositorio, separación firmware/servidor, firmware ESP32-S3, integración
W5500, contratos MQTT versionados, backend, motor de partidas, PostgreSQL, panel web,
WebSocket, simulador, stack Docker autocontenido, pruebas (unitarias, integración, E2E,
seguridad, carga), diseño electrónico y esquemas, documentación de montaje y operación,
una VM Proxmox nueva dedicada, despliegue real en ella, documentación en `s9-server`, CI
reproducible y hoja de ruta actualizada.

La entrega debe permitir continuar el desarrollo físico sin rehacer backend, contratos,
despliegue ni organización del repositorio.

## 2. Estructura de repositorio impuesta

El encargo fija el árbol con `firmware/esp32/`, `server/`, `contracts/`, `simulators/`,
`infrastructure/`, `hardware/`, `tests/`, `docs/` y `.github/`, y exige que el código del
ESP32 viva **exclusivamente** bajo `firmware/esp32/`, sin mezclarse con backend, frontend,
Docker, simulador ni electrónica.

Esto **modifica** el árbol del dosier §19.1 (que colgaba `backend/` y `frontend/` de la
raíz). Es un cambio de requisito de programa, no una errata del dosier. Ver
[ADR-0004](../adr/0004-estructura-repositorio.md) y la corrección de clasificación en
`DECISIONS.md`.

## 3. Reglas de ejecución vinculantes

- **No limitarse a planificar.** Ejecutar hasta donde llegue lo posible sin hardware
  definitivo. Cuando algo exija hardware: implementar la abstracción, el simulador y las
  pruebas automáticas, diseñar el procedimiento de validación física y marcar **sólo** la
  validación física como pendiente. Nunca marcar como validado lo no probado físicamente.
- **No pedir confirmación por decisiones menores.** Adoptar una opción razonable,
  documentarla y continuar. Detenerse sólo ante: falta de credenciales imprescindibles,
  acción destructiva con riesgo real, falta de acceso al hipervisor, falta absoluta de
  almacenamiento, o conflicto de requisitos no resoluble con seguridad.
- **Un bloqueo en una línea no detiene las demás.**
- **Protección del servidor.** Inventariar antes de tocar Proxmox. No modificar ninguna VM
  existente, no reutilizar VMID ni IP, no borrar recursos, no cambiar la red del host, no
  exponer servicios públicamente sin autorización.
- **Git.** No trabajar sobre `main`; ramas temáticas y worktrees separados; commits
  pequeños y de una sola naturaleza; pruebas antes de integrar; sin `force-push` en ramas
  compartidas; no mezclar una rama con pruebas fallidas; no ocultar fallos preexistentes.
- **Independencia de calidad.** Ningún agente implementa, prueba, revisa y aprueba lo
  mismo. Calidad y seguridad son equipos distintos de quien implementa.

## 4. Definición de terminado

Código + documentación + pruebas + **ejecución real** + revisión independiente +
seguridad cuando aplique + sin secretos + criterios comprobados + supervisor conforme +
estado actualizado.

Prohibidas las expresiones "debería funcionar", "probablemente" y "parece correcto". Para
marcar algo como validado hay que mostrar la evidencia ejecutada.

## 5. Requisitos de la VM

4 vCPU, 4 GB RAM, 50 GB, KVM (no LXC), Debian estable minimal, bridge LAN existente, VMID
e IP verificados como libres, guest agent, arranque automático, integración con la
política de copias, y todo el proyecto dentro de Docker salvo Docker, SSH, Tailscale,
guest agent, firewall y herramientas administrativas.

## 6. Dictámenes del supervisor

Exactamente uno de: `CONFORME`, `CONFORME CON OBSERVACIONES`, `NO CONFORME`. No puede
emitirse `CONFORME` sin evidencias de pruebas.
