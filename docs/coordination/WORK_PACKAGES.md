# PAQUETES DE TRABAJO

Estados permitidos: `PENDING` · `IN_PROGRESS` · `BLOCKED` · `READY_FOR_REVIEW` · `CHANGES_REQUESTED` · `APPROVED` · `MERGED`

El estado vivo está en `STATUS.md`. Aquí vive el **contrato** de cada paquete.

---

## WP-00 · Fundación y contratos

- **Responsable:** Organizador (Opus)
- **Rama:** `develop`
- **Rutas:** `contracts/**`, `docs/coordination/**`, `docs/adr/**`, raíz del repositorio
- **Dependencias:** ninguna
- **Criterios:** esqueleto de repositorio conforme al encargo §4; contratos MQTT v1 con esquemas, ejemplos válidos e inválidos y validador ejecutable; ADR iniciales.
- **Pruebas:** `python3 contracts/validate.py` → 0 fallos.
- **Revisión:** Supervisor.

## WP-01 · Infraestructura Docker

- **Responsable:** agente Sonnet (DevOps)
- **Rama:** `feat/wp01-infra`
- **Rutas:** `compose.yml`, `compose.dev.yml`, `.env.example`, `Makefile`, `infrastructure/**` (excepto `infrastructure/vm/**`)
- **Dependencias:** WP-00
- **Criterios:** stack con `proxy`, `frontend`, `backend`, `worker`, `postgres`, `mosquitto`, `migrate`, `backup` y perfiles `dev`/`test`/`simulator`; healthchecks; volúmenes; usuarios no root; imágenes con versión fijada; sin secretos; Mosquitto sin anónimo con ACL por módulo.
- **Pruebas:** `docker compose config` limpio; validación de la ACL; `make` con todos los objetivos del encargo §13.
- **Revisión:** QA + Seguridad.

## WP-02 · Backend, base de datos y motor de partidas

- **Responsable:** agente Opus (riesgo alto: concurrencia, idempotencia, motor de juego)
- **Rama:** `feat/wp02-backend`
- **Rutas:** `server/backend/**`, `server/worker/**`, `server/database/**`, `contracts/api/**`
- **Dependencias:** WP-00
- **Criterios:** NestJS modular con los módulos del encargo §9; las 23 entidades del dosier §21.1 en migraciones versionadas; ingesta MQTT idempotente; WebSocket; OpenAPI; exportación CSV; los 4 modos de juego del encargo §10; cálculo de precisión conforme al encargo §11 (incluye el caso *no calculable*); sin contraseñas por defecto embebidas.
- **Pruebas:** unitarias + integración con PostgreSQL y Mosquitto reales; pruebas de idempotencia y de reglas de precisión.
- **Revisión:** QA + Seguridad + Supervisor.

## WP-03 · Panel web

- **Responsable:** agente Sonnet (Frontend)
- **Rama:** `feat/wp03-frontend`
- **Rutas:** `server/frontend/**`
- **Dependencias:** WP-00 (contratos), interfaz con WP-02 por OpenAPI
- **Criterios:** React+TS+Vite; las pantallas del encargo §12; editor de matriz 3×3 con rotación e identificación; vista en directo por WebSocket; responsive en ordenador, tableta y móvil; **el estado nunca se representa sólo por color** (texto + icono + patrón).
- **Pruebas:** unitarias de componentes, pruebas de accesibilidad, E2E Playwright.
- **Revisión:** QA.

## WP-04 · Firmware ESP32-S3

- **Responsable:** agente Opus (riesgo alto: sincronización, colas, OTA)
- **Rama:** `feat/wp04-firmware`
- **Rutas:** `firmware/**`, `docs/firmware/**`
- **Dependencias:** WP-00
- **Criterios:** proyecto ESP-IDF con CMake, `sdkconfig.defaults`, particiones OTA A/B; HAL que permita compilar y probar la lógica en host; driver W5500; cliente MQTT; identidad NVS; selector SATÉLITE/AUTO/PRINCIPAL; máquinas de estado de módulo y de diana; 9 canales piezo abstraídos; 3 cadenas LED; cola persistente; watchdog; causa de reinicio; OTA con rollback.
- **Pruebas:** suite unitaria en host (máquinas de estado, cola, idempotencia, reconexión, clasificación de crosstalk) ejecutada de verdad.
- **Prohibido:** afirmar que un umbral piezo está calibrado. Los valores son iniciales y configurables.
- **Revisión:** Supervisor + QA.

## WP-05 · Simulador de módulos

- **Responsable:** agente Sonnet
- **Rama:** `feat/wp05-simulator`
- **Rutas:** `simulators/**`
- **Dependencias:** WP-00
- **Criterios:** simula 1..9 módulos y hasta 81 dianas; principal y satélites; estados LED; impactos válidos e incorrectos; vibración cruzada; duplicados; retrasos; desconexión/reconexión; pérdida y retransmisión; baja tensión; reinicio; versiones de firmware distintas. Escenarios **deterministas** por semilla para E2E. Ejecutable en Docker y en local.
- **Pruebas:** partida completa sin hardware; los mensajes emitidos validan contra los contratos.
- **Revisión:** QA.

## WP-06 · Diseño electrónico

- **Responsable:** agente Opus (riesgo alto: cadena piezo y potencia)
- **Rama:** `feat/wp06-hardware`
- **Rutas:** `hardware/**`, `docs/hardware/**`
- **Dependencias:** dosier §8–§11 y §28
- **Criterios:** proyecto KiCad con las 8 hojas del encargo §18; BOM preliminar; cálculos de potencia, protección piezo y presupuesto de GPIO; notas de diseño; alternativas; riesgos; protocolo de prueba; lista explícita de puntos que exigen validación física.
- **Prohibido:** afirmar validación física o enviar a fabricar. Sin ERC ejecutado sobre un esquemático real no se declara ERC conforme.
- **Revisión:** Supervisor.

## WP-07 · CI y armazón de pruebas

- **Responsable:** agente Sonnet
- **Rama:** `feat/wp07-ci`
- **Rutas:** `.github/**`, `tests/**`
- **Dependencias:** WP-01..WP-05 (se ajusta al final de la Ola 1)
- **Criterios:** workflows separando trabajos rápidos y lentos; formato, lint, typecheck, pruebas de contratos, build Docker, `docker compose config`, escaneo de secretos, análisis de dependencias; workflow nightly/manual para E2E completo, carga y 9 módulos simulados.
- **Revisión:** QA.

## WP-08 · VM Proxmox y despliegue

- **Responsable:** agente Sonnet con perfil de sistemas
- **Rama:** `feat/wp08-vm-deploy`
- **Rutas:** `infrastructure/vm/**`, `infrastructure/provisioning/**`, `docs/deployment/**`, `docs/operations/**`
- **Dependencias:** WP-01, WP-02, WP-03
- **Criterios:** VM 109 `diana-server` con 4 vCPU / 4 GB / 50 GB sobre `vmbr0` e IP 192.168.1.209; Debian 12 cloud-init; guest agent; SSH por clave; Docker desde fuente oficial; firewall; despliegue en `/opt/diana`; supervivencia a `reboot` verificada.
- **Prohibido:** modificar cualquier VM existente, reutilizar VMID o IP, exponer nada a Internet.
- **Revisión:** Supervisor + Seguridad.

## WP-09 · Documentación en `s9-server`

- **Responsable:** agente de documentación
- **Repositorio:** `pjclavero/s9-server`, rama `feat/diana-vm109`
- **Rutas:** `maquinas/vm109-diana.md`, `servicios/diana.md`, más índices existentes
- **Dependencias:** WP-08 (datos reales de la VM)
- **Criterios:** dos fichas separadas (máquina y servicio/uso) conforme a la convención del repositorio; índices, inventario, estado, red y backups actualizados; sin secretos.
- **Revisión:** Supervisor.

## WP-10 · Revisión de seguridad independiente

- **Responsable:** agente Opus, **no implementa**
- **Rama:** sólo informe, `docs/security/**`
- **Criterios:** escaneo de secretos, dependencias, exposición de puertos, ACL MQTT, roles, validación, cabeceras, usuarios no root, OTA firmada, logs sin secretos; modelo de amenazas; hallazgos con severidad; mitigaciones; riesgos aceptados.

## WP-11 · Calidad independiente

- **Responsable:** agente Opus/Sonnet, **no implementa**
- **Rutas:** `docs/testing/**`, evidencias
- **Criterios:** ejecuta las pruebas de verdad, recoge la salida, contrasta con `TEST_MATRIX.md` y distingue fallo real de fallo de utillaje.

## WP-12 · Supervisión técnica

- **Responsable:** agente Opus supervisor
- **Criterios:** custodia el dosier, aprueba contratos, revisa arquitectura y seguridad, exige correcciones y emite el dictamen final (`CONFORME` / `CONFORME CON OBSERVACIONES` / `NO CONFORME`). No puede emitir `CONFORME` sin evidencias.
