# Diana · Informe de estado

**Fecha:** 2026-07-21 · **Rama integrada:** `develop` @ `9fd4431` · **VM:** `diana-server` (109, 192.168.1.209)

> **DOCUMENTO HISTÓRICO — no describe el estado de hoy.** Es la fotografía del 2026-07-21 y se
> conserva sin retocar para no falsear el historial. Después de esta fecha llegaron el programa
> F1-F6, el lote G-A…G-I, el cierre de deudas y el despliegue del 2026-07-26. **El estado vivo
> está en `docs/coordination/STATUS.md`**; el recuento de tareas frente al encargo, en
> `docs/INFORME-TAREAS-vs-ENCARGO.md` (revisado el 2026-07-26). Lo que aquí se dé por pendiente
> puede estar hecho, y al revés: las cifras de pruebas de este informe son las de aquel día.
>
> **Corrección de puntero, 2026-09-05.** El estado vivo **ya no** está en
> `docs/coordination/STATUS.md` (que también se quedó parado, en el 2026-08-04):
> está en [`docs/STATE.md`](STATE.md). Y la fila «nunca compilado con ESP-IDF»
> de este informe está caducada: hay `BUILD = PASS` documentado en
> `docs/firmware/evidencia-build-esp-idf.md`.

Este documento responde de forma honesta a «¿está todo hecho? ¿falta algo?». Sigue la
estructura del §25 del encargo. **No** se usa «debería funcionar» ni «probablemente»: lo
marcado ✅ está ejecutado con evidencia; lo demás se clasifica sin maquillar.

---

## 0. ¿Está todo hecho?

**No.** El núcleo del sistema está **construido, desplegado y verificado en lo esencial**:
el stack arranca y está sano en la VM, la base de datos migró de verdad y los contratos y la
lógica están probados. Pero quedan tareas reales (copia/restauración/reinicio, ingesta
extremo a extremo, documentación en `s9-server`, dictamen final del supervisor y PR a `main`)
y hay hallazgos abiertos, incluido uno de seguridad **crítico confirmado en vivo** (F-02).

---

## 1. Repositorio

- Estructura profesional con separación **firmware / servidor / contratos / hardware / docs**.
- Rama de integración `develop`; `main` intacta (el PR final aún no se ha abierto).
- Contratos MQTT v1 congelados: 12 esquemas, validador ejecutable (**43 comprobaciones,
  0 fallos**), 6 ADR (`docs/adr/0001`–`0006`).
- **Líneas base reproducidas ejecutando** (por calidad, WP-11):

  | Componente | Resultado |
  |---|---|
  | Contratos | 43/0 |
  | Firmware (host) | 389/389 |
  | Simulador | 33/33 |
  | Backend (unit) | 157 pasados + 5 saltados |
  | **Backend (integración, contra PostgreSQL real)** | ✅ **5/5** |
  | Frontend | build/typecheck/lint limpios + 30/30 unit + **E2E 18/18** |

## 2. VM 109 y despliegue

- VM creada (KVM, 4 vCPU, `memory=4096` + `balloon=1024`, 50 GB, `vmbr0`, `.209`), Debian 12,
  Docker Engine, usuario `diana-admin` (SSH por clave, sin root remoto ni contraseñas).
- **Stack Docker Compose desplegado y sano: 7/7 servicios `healthy`** (backend, worker,
  mosquitto, postgres, frontend, proxy, backup).
- **Seis defectos reales que impedían arrancar**, corregidos en el repositorio y verificados
  (detalle y evidencia en `docs/deployment/procedimiento.md` §8): `listen_addresses` de
  Postgres, permisos y orden del `mosquitto.conf`, healthcheck del broker, prefijo `/api` del
  proxy, y los `Dockerfile` de backend/worker que faltaban (F-13).
- ✅ **Migración aplicada contra base viva** (`prisma migrate deploy`) — riesgo nº1 cerrado.
- ✅ Restricciones verificadas: 24 tablas, 4 marcas temporales en `BIGINT`/`timestamptz`.
- ✅ API REST alcanzable por el proxy (`/api/health` → `{"status":"ok"}`).

## 3. Documentación en `s9-server` (WP-09)

✅ **Hecha (PR #7, rama `feat/diana-vm109`).** Creadas las fichas `maquinas/vm109-diana.md`
(máquina/recursos/software/acceso/creación/copias/comprobaciones) y `servicios/diana.md`
(función/arquitectura/URLs/gestión/verificación/seguridad), y actualizados `indice.md` e
`inventario.md` (fila VM 109, puerto 8080, nodo Tailscale pendiente, tabla de accesos).
Estado reflejado sin maquillar (base desplegada, no producción; F-02/X-21/X-06/X-18
abiertos; Tailscale sin unir, `gh` sin instalar). Pendiente: merge del PR por el operador.

## 4. Calidad por paquete de trabajo

| WP | Paquete | Estado | Nota |
|---|---|---|---|
| WP-00 | Contratos | READY (2ª vuelta) | validador estricto 43/0 |
| WP-01 | Infra Docker | integrado | corregido en despliegue real |
| WP-02 | Backend | integrado | 157+5; integración 5/5 real; hotfix worker rescatado |
| WP-03 | Panel web | integrado | E2E 18/18 con navegador real |
| WP-04 | Firmware | 389/389 host | **nunca compilado con ESP-IDF** (laguna mayor) |
| WP-05 | Simulador | 33/33 | conecta al broker real; ingesta e2e sin verificar (X-18) |
| WP-06 | Hardware/KiCad | entregado | **ERC/DRC no ejecutados**, sin PCB |
| WP-07 | CI | integrado | 5 workflows; 16 E2E son placeholder honesto |
| WP-08 | VM/despliegue | **mayormente hecho** | stack sano; falta copia/restauración/reboot |
| WP-09 | Docs s9-server | 🔴 no iniciada | — |
| WP-10 | Seguridad | READY | 18 hallazgos; **F-02 confirmado en vivo** |
| WP-11 | Calidad | READY | **CONFORME CON OBSERVACIONES** |
| WP-12 | Supervisión | pendiente | 1ª vuelta `NO CONFORME` corregida; **falta 2ª vuelta y dictamen final** |

**Independencia §2.4 (observación de calidad, sin maquillar):** los tests unitarios de
backend/firmware/simulador los escribió el mismo paquete que implementa. La única capa de
prueba verdaderamente independiente (E2E de WP-07) está aún como placeholder. La
independencia existe a nivel agregado (WP-10 seguridad, WP-11 calidad, WP-12 supervisión son
distintos de los implementadores), no en la cadena unitaria.

## 5. Seguridad

- Modelo de amenazas + 18 hallazgos (`docs/security/`), con evidencia ejecutada.
- 🔴 **F-02 (CRÍTICO) — CONFIRMADO EN VIVO:** la ACL de MQTT autoriza por `client_id`, no por
  usuario; con las credenciales de un módulo y el `client_id` de otro se publica en el tópico
  ajeno (probado: el backend recibió el mensaje suplantado). La mitigación exige alinear
  **usuario = client_id = module_id** (cambio de contrato §8, para el supervisor):
  `use_username_as_clientid true` a secas rompería el enrutado por el prefijo del usuario.
- Dictámenes emitidos: CORS/JWT_SECRET (el REST no repite el fallo previo; el WebSocket sí),
  sudo de la VM (aceptable), caducidad de comandos sin NTP (inaceptable tal cual para acciones
  físicas). TLS preparado pero **desactivado** en todas las capas (F-07).

## 6. Clasificación de lo pendiente

### Bloqueos reales (impiden algo y hay que decidir/actuar)
- **F-02** (seguridad crítica): decisión de contrato de identidad MQTT pendiente del supervisor.
- **X-18** ingesta e2e: el simulador publica pero no se persistieron impactos; falta
  caracterizar orquestación de partida vs suscripción/ingesta (WP-02/WP-05).
- **X-01** déficit de GPIO (29 pines necesarios vs 25): decisión de arquitectura de hardware.

### Pendiente de validación física (no se puede marcar hecho sin hardware)
- Firmware compilado con ESP-IDF y probado sobre ESP32-S3 (OTA/rollback reales).
- Sensado piezo (ensayos D1, D4), acoplamiento cruzado (G5), térmica del convertidor (X-02).
- ERC/DRC en KiCad y fabricación de PCB.

### Mejora futura
- TLS en MQTT/HTTP (F-07), enrutado WebSocket por el proxy (X-06), `use_username_as_clientid`
  tras el rediseño de identidad, modos de juego `memory`/`no_shoot`, revocación de JWT (F-12).

### No hecho todavía (trabajo pendiente, no fallido)
- **WP-09** documentación en `s9-server`.
- Copia de seguridad + restauración aislada + `reboot` de la VM.
- Implementar los 16 escenarios E2E (hoy placeholder).
- **WP-12** 2ª vuelta del supervisor + dictamen final.
- **PR `develop` → `main`** y el informe final §25 definitivo.

### Fallado / revelado al ejecutar (documentado, no oculto)
- La ingesta e2e no persistió (X-18). El `test-acl.sh` da 2 falsos negativos de arnés.
- El firmware nunca se compiló con ESP-IDF. Los E2E estaban rotos y se arreglaron (X-07).

## 7. Dictamen del supervisor

**Pendiente.** La 1ª vuelta fue `NO CONFORME` (2 bloqueantes + 5 mayores), todos corregidos.
La 2ª vuelta sobre los contratos corregidos y el **dictamen final** con la evidencia de
despliegue **aún no se han emitido**. El encargo prohíbe `CONFORME` sin evidencia de pruebas:
hoy hay evidencia para la mayor parte del servidor, pero F-02 confirmado y las lagunas de
hardware condicionan el veredicto.

## 8. Orden sugerido al continuar

1. **WP-09**: documentar la VM 109 en `s9-server` (datos ya disponibles).
2. Cerrar el ciclo de despliegue: copia → restauración aislada → `reboot`.
3. Investigar **X-18** (ingesta e2e) y el enrutado WebSocket (X-06).
4. Llevar **F-02** al supervisor como decisión de contrato de identidad MQTT.
5. **WP-12**: 2ª vuelta + dictamen final.
6. **PR `develop` → `main`** y el informe §25 definitivo.
