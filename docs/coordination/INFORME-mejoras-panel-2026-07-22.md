# Informe — Mejoras del panel Diana (F3 + lote G-A…G-I)

> **HISTORICAL — no describe el estado de hoy.** Se conserva sin retocar como
> evidencia fechada. **No es fuente de estado**: la fuente canónica es
> [`../STATE.md`](../STATE.md).
>
> Contradicción concreta ya resuelta: este documento afirma que **el firmware
> nunca se ha compilado con ESP-IDF**. Eso fue cierto cuando se escribió y
> **hoy es falso**. `docs/firmware/evidencia-build-esp-idf.md` registra
> `BUILD = PASS` con `espressif/idf:v5.5`, con SHA-256 de los cuatro artefactos,
> y **23 símbolos de D1b sobreviven a `--gc-sections`** en el ELF (medido con
> `xtensa-esp32s3-elf-nm`). Compilar y enlazar **no** es haber flasheado ni
> haber corrido en silicio: eso sigue pendiente.

> Fecha: 2026-07-22 · Rama: `develop` · Entorno: VM 109 `diana-server`
> (192.168.1.209 / Tailscale 100.117.178.92, panel en `:8080`).
> Método por bloque: **implementación + tests + supervisor independiente** (§2.4) +
> **verificación en vivo**. Fuente de producto: `docs/product/alcance-panel-roles-firmware.md`.
>
> **DOCUMENTO HISTÓRICO — su tabla de «Pendiente» (§5) está obsoleta.** Es la fotografía del
> 2026-07-22, cuando sólo estaban cerrados F3, G-A y G-B. A 2026-07-26 están cerrados con
> supervisor independiente **G-C, G-D, G-E, G-F, G-G y G-H**, y **G-I salvo su D9** (barrido de
> obsolescencia: en `develop`, con la 4ª supervisión en curso, sin desplegar). También quedó
> superado el §3: la Opción B (entidad `View`) **no se difirió, se construyó** en G-H.1. Sigue
> siendo cierto el §4 completo, incluido que **el firmware nunca se ha compilado con ESP-IDF**.
> Estado vivo en `docs/coordination/STATUS.md`.

## 1. Resumen ejecutivo

Se retomó el panel para hacerlo **usable** y se abordó el lote de mejoras del responsable
(2026-07-22). A la fecha de este informe están **cerrados**: F3 (firmware/OTA), **G-A**
(quick wins de UX) y **G-B** (subir el binario de firmware). Todo desplegado y verificado en
vivo en la VM 109. Producción del homelab (VMs 100-108) intacta: Diana vive aislada en la 109.

## 2. Trabajo cerrado

### F3 · Firmware / OTA — ✅ CONFORME CON OBSERVACIONES
- Endpoints `/api/modules/:id/firmware/{available,deploy,deployments}`. El gestor/admin
  **acepta** una versión firmada → se crea un `Deployment` y se dispara la **OTA real** por
  MQTT (`sendOtaCommand`, valida el esquema y **exige firma**; publica por `slug`).
- Reglas verificadas en vivo: deploy→`sent`+`commandId`; 2º deploy en curso→409; sin
  firma→400; módulo ajeno→403; `moduleId` malformado→400 (`ParseUUIDPipe`, D1 del supervisor).
- Diferido a F5 (requieren migración): D2 (índice único parcial «un in-flight por módulo») y
  D3 (campo `Module.targetBoard` para validar compatibilidad de placa).

### G-A · Quick wins de UX — ✅ CONFORME CON OBSERVACIONES
- **Prueba de LED:** el mismo botón enciende y **apaga** (toggle→`off`) + botón «Apagar todas».
- **Botón «volver»** reutilizable (`BackButton`, `navigate(-1)`) en prueba de sensores/LED,
  calibración y detalle de módulo.
- **Editor de matriz:** soltar en celda **ocupada** ahora **intercambia** (swap) en vez de
  machacar al ocupante — causa de que la celda central pareciera «no aceptar sueltas»; realce
  de la celda destino; celda bloqueada no finge ser soltable. Lógica pura `applyMove` (testeada).
- Defecto latente del supervisor corregido (no machacar a un ocupante si el módulo viene de fuera).

### G-B · Subir el binario de firmware — ✅ (supervisor en curso al redactar)
- `POST /api/firmware/upload` (admin, multipart): guarda el `.bin` en el volumen persistente
  `diana_firmware` (`/app/firmware`), **calcula sha256 y tamaño reales del archivo** (no se
  confía en el cliente), crea la `FirmwareVersion` con la `url` de descarga.
- `GET /api/firmware/:id/binary` (**público**): lo descarga el **módulo** en la OTA (sin JWT),
  con `Content-Length` y `X-Fw-Sha256`; 404 si falta el registro o el binario.
- Verificado en vivo: **sha256 local == servidor == descarga**; subir sin token→401;
  no-semver→400; descarga inexistente→404. Con esto **el ciclo OTA se cierra de verdad**
  (subir → servir en la red local → desplegar).

## 3. Decisiones de producto fijadas (2026-07-22)

Registradas en `docs/product/alcance-panel-roles-firmware.md` §6:
- **Jerarquía:** diana → **módulo** (3×3 dianas) → **panel = `TargetSystem`** (3×3 módulos) →
  **vista** (hasta 3×3 paneles). La UI **pagina por panel** (sin scroll infinito).
- **«2 paneles juntos en una partida» = Opción B (entidad `View`), DIFERIDA.** Hoy sólo
  **costuras aditivas** porque el motor ya es agnóstico al panel (planifica sobre una lista
  plana de dianas). «Separados» (varias partidas a la vez, una por panel) ya está soportado de
  base; falta guardarraíl «un juego por panel» + UI.
- **Coordinador por panel** (selector `PRINCIPAL/SATELITE/AUTO`). Decisiones aditivas
  apuntadas: **`coordinator_module_id`** en `module-config` (fijar principal en remoto,
  resuelve «2 principales»), **DHCP por defecto**, y **resolver la autoelección AUTO** (tarea
  de firmware). Implementación real depende de **retomar el firmware** (nunca compilado con ESP-IDF).
- **Resiliencia (defaults):** caída de módulo → **auto-pausa** + cuenta atrás → operador decide;
  caída del coordinador → **pausa dura**.
- **Modo demo:** efímero (sin jugadores; 10 últimos tiempos sólo en la sesión).
- **Correo:** flujo preparado + **panel de configuración SMTP**; envío real pendiente de relay.

## 4. Hallazgos honestos / estado real

- El **firmware nunca se ha compilado con ESP-IDF**: la autoelección AUTO, la aplicación
  completa de `config/desired`, la descarga OTA en el dispositivo (`esp_https_ota`) y la
  sincronización de reloj están sin terminar. El backend/contrato sí avanzan.
- La **presencia real** de módulos aún no mueve el estado `online` (parte de X-06/X-18); se
  aborda en G-I.
- Con `MQTT_ENABLED` apagado, `sendOtaCommand` descarta la publicación en silencio (a revisar
  para producción con hardware real).
- La contraseña inicial del admin fue **cambiada por el operador** (pudo entrar al panel); las
  verificaciones usan un token admin efímero firmado con el secreto del contenedor, sin tocar
  su cuenta.

## 5. Pendiente (backlog priorizado)

| Bloque | Alcance | Estado |
|---|---|---|
| G-C | Dashboard de módulos: resumen paginado + panel del módulo (Ver 9 dianas/Calibración/Pruebas/Actualizar) | Siguiente |
| G-D | Jugadores+equipos (F4/F5): buscar, invitación correo+SMTP, QR, temporales, equipos | Pendiente |
| G-E | Modos nuevos: duelo + demo | Pendiente |
| G-F | Presets por gestor (5 custom) | Pendiente |
| G-G | Dashboard resultados/estadísticas estilo «máquina de dardos» | Pendiente |
| G-H | Matriz avanzada: favoritas, paginación por panel, concurrencia (View diferida) | Pendiente |
| G-I | Resiliencia y reconexión (auto-pausa módulo/coordinador); cierra X-06/X-18 | Pendiente |

Cierre del ciclo de despliegue (restauración aislada + `reboot`) y PR `develop`→`main` siguen
siendo el hito final, tras el lote de mejoras.

_Informe generado por el equipo Diana · 2026-07-22_
