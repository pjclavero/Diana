# Evidencia · MQTT (ACL, TLS, client_id)

## mosquitto.conf: no existe use_username_as_clientid
```
9:# - Listener MQTT estándar (1883) + listener WebSocket (9001) para el panel.
29:allow_anonymous false
30:password_file /mosquitto/config/passwd
31:acl_file /mosquitto/config/acl
45:listener 1883
48:# --- TLS para el listener 1883 (PREPARADO, DESACTIVADO) ---------------------
54:#      quieres forzar TLS-only en el mismo puerto, o abre un listener 8883 nuevo.
57:# listener 8883
61:# require_certificate false
69:listener 9001
75:# listener 9001

$ grep -c use_username_as_clientid infrastructure/mosquitto/mosquitto.conf
0
```

## ACL: reglas que dependen de %c (client_id elegido por el cliente)
```
35:user backend
36:topic read #
37:topic write targets/v1/system/#
38:topic write targets/v1/module/+/config/desired
39:topic write targets/v1/module/+/ota
51:pattern write targets/v1/module/%c/presence
52:pattern write targets/v1/module/%c/status
53:pattern write targets/v1/module/%c/telemetry
54:pattern write targets/v1/module/%c/hit
55:pattern write targets/v1/module/%c/diagnostic
56:pattern write targets/v1/module/%c/config/reported
62:pattern read targets/v1/module/%c/command
63:pattern read targets/v1/module/%c/config/desired
64:pattern read targets/v1/module/%c/ota
65:pattern read targets/v1/system/+/game/state
95:user healthcheck
96:topic readwrite _health/probe
```

## TLS: unicas lineas TLS del fichero estan comentadas
```
51:#   2. Copia cafile/certfile/keyfile dentro del volumen infrastructure/mosquitto/certs/
54:#      quieres forzar TLS-only en el mismo puerto, o abre un listener 8883 nuevo.
57:# listener 8883
58:# cafile /mosquitto/certs/ca.crt
59:# certfile /mosquitto/certs/server.crt
60:# keyfile /mosquitto/certs/server.key
77:# cafile /mosquitto/certs/ca.crt
78:# certfile /mosquitto/certs/server.crt
79:# keyfile /mosquitto/certs/server.key
```

## Puerto 1883 abierto a toda la LAN en la VM
```
		ip saddr 192.168.1.0/24 tcp dport 1883 accept
```

---

## 2026-08-05 · F-02 cerrado — verificación contra broker real (carril ACL/F-02)

**Cambios aplicados:**
- `infrastructure/mosquitto/mosquitto.conf`: `use_username_as_clientid true`.
- El usuario mosquitto de un módulo pasa a ser EXACTAMENTE su `module_id` (se quita el
  prefijo `module-` que antes lo diferenciaba del `client_id`; ver
  `infrastructure/mosquitto/generate-users.sh` y `infrastructure/mosquitto/set-coordinator.sh`).
  Los patrones `%c` del ACL **no se han tocado** (siguen en `infrastructure/mosquitto/acl`
  tal cual): con `use_username_as_clientid` el broker reescribe el `client_id` con el
  usuario autenticado antes de evaluar la ACL, así que basta con que usuario == module_id
  para que `%c` deje de ser manipulable por el cliente.

**Método:** broker real 2.0.21 montado en `/tmp` (fuera del repo, sin sudo/Docker: paquete
`.deb` de Debian trixie extraído con `dpkg-deb -x`, arrancado con `LD_LIBRARY_PATH`), sobre
una COPIA de `infrastructure/mosquitto`, con usuarios de prueba `backend`/`m01`/`m02`
generados en esa copia (nunca en el repo).

**Reproducción del ataque original (F-02), repetida tal cual — ahora falla:**
```
$ mosquitto_pub -h 127.0.0.1 -p 1883 -u m01 -P <pw_m01> -i m02 -r -q 1 \
    -t targets/v1/module/m02/hit -m '{"suplantado_por":"m01"}'
$ mosquitto_sub -h 127.0.0.1 -p 1883 -u backend -P <pw_backend> \
    -t targets/v1/module/m02/hit -C 1
Timed out          <<< F-02 CERRADO: ya no llega nada, la ACL rechaza la publicación
```

**Batería completa (`test-acl.sh`, reescrito para no depender de una carrera de timing —
ver cabecera del script — y ampliado con las pruebas del canal de mantenimiento del
Trabajo 1 y la del coordinador):**
```
=== Resumen: 12 correctos, 0 fallos ===
```
Incluye: anónimo rechazado; módulo escribe lo suyo; módulo NO escribe lo de otro módulo (F-02);
módulo NO escribe config/desired, command, ota propios; backend escribe system/status;
backend escribe maintenance/command; backend NO escribe module/+/command (canal de juego);
coordinador SÍ escribe module/+/command; módulo lee su propio maintenance/command; y la
prueba 12, reproducción exacta del ataque de 2026-07-21, en verde.

**Efecto colateral encontrado y documentado:** `use_username_as_clientid` fuerza
`client_id = usuario` para TODA conexión, no sólo para módulos. Dos conexiones
*simultáneas* con el MISMO usuario (p. ej. `backend` publicando en una conexión mientras
`backend` observa en otra, que es justo el patrón que usaba la versión anterior de
`test-acl.sh`) reciben el mismo `client_id` y el broker desconecta la primera («Client
backend already connected, closing old connection»). No es un fallo de ACL: es MQTT
rechazando dos sesiones con igual `client_id`. No rompe la producción actual (el backend
mantiene una única conexión persistente), pero:
- Deja sin efecto el `MQTT_CLIENT_ID` que el backend pueda configurar por entorno (ver
  `server/backend/src/config/configuration.ts`): el broker lo sobrescribe siempre con el
  usuario autenticado. No es una regresión funcional (la ACL del backend ya autorizaba por
  usuario, no por `%c`), pero el valor de esa variable deja de tener efecto alguno sobre el
  `client_id` real.
- Si el backend llegara a escalar a más de una réplica con el mismo usuario `backend` y
  conexión MQTT simultánea, se desalojarían entre sí en bucle. Fuera de mi territorio
  (`server/**`); queda anotado para quien lo despliegue así.
- El healthcheck de Docker del propio contenedor mosquitto (`compose.yml`, servicio
  `mosquitto`) usa el usuario `healthcheck`, cuya entrada de ACL es `user healthcheck` (no
  depende de `%c`/`%u`), así que es indiferente al `client_id` — no se ve afectado.
- `generate-users.sh` y `set-coordinator.sh` se han actualizado para reflejar el nuevo
  esquema de nombres (usuario == module_id, sin prefijo) y se han verificado contra este
  mismo broker: alta, reasignación y desactivación del coordinador siguen funcionando
  igual que antes (activar/reasignar/consultar/desactivar), incluida la recarga en caliente
  con `kill -HUP`.

**Pendiente de otro carril:** `contracts/mqtt/README.md` sección 8 sigue describiendo el
usuario como `module-{module_id}` con prefijo; ese texto quedó desactualizado por este
cierre y hay que corregirlo desde el carril de contratos (`contracts/**`, fuera de mi
territorio).
