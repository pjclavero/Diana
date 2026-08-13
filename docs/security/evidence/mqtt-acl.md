# Evidencia · MQTT (ACL, TLS, client_id)

> **REGISTRO HISTÓRICO.** Capturado antes de P0-2 (transcripciones de
> `mosquitto.conf` previas al 2026-08-10). Los números de línea y el texto de
> abajo NO corresponden al fichero actual: hoy el listener es 8883 con TLS,
> `use_username_as_clientid true` está activo y la regla nft del 1883 se ha
> sustituido por 8883. Ver `p02-baseline-produccion.md` y el hotfix
> `hotfix/p02-tls-6da16d4`. Se conserva porque documenta lo que se midió.

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
