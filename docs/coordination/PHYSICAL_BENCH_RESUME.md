# Retomar el banco físico · `module-01`

Estado congelado el 2026-09-12. El servidor y el panel están **esperando** a que
se hagan los últimos gates físicos; no hay trabajo de backend pendiente que
descubrir por el camino.

## Qué hay flasheado ahora mismo

```
App version en silicio     5c803fa-dirty
NO incluye                 el arreglo de suscripción tras CONNACK (carril A)
                           ni la cola ligada a identidad
```

El firmware de la placa es **anterior** a los dos arreglos de esta tanda. Eso
importa: mientras no se reflashee, el módulo sigue sin recibir nada por MQTT y
`reported_config_version` seguirá en 0 haga lo que haga el servidor.

El candidato a flashear es el HEAD actual, y ya compila **limpio** (`ac5cfa8`
en adelante, sin `-dirty`): la CA pública, su declaración y el perfil de banco
están versionados.

## Qué está conectado

```
ESP32-S3      QFN56 rev v0.2 · MAC 10:20:ba:4b:b7:04
USB           /dev/diana-esp32 -> ttyACM0 en ia-server (VM102), por passthrough
              persistente `diana-esp32s3`; el Proxmox y VM109 NO lo ven
Ethernet      W5500 · DHCP · última IP 192.168.1.168
Broker        mqtts://192.168.1.209:8883 · TLS-only, sin 1883
Identidad     module-01 / banco-01 · credencial emitida por el servidor
```

## Qué NO tocar

- **La NVS.** Lleva `module_id`, `system_id`, `hw_rev`, `mqtt_user` y la
  contraseña. Flashear **sólo la aplicación**, nunca `0x9000`.
- **La partición `evtqueue`.** Los 8 eventos de `lab-module-01` los retira solo
  el firmware nuevo al ligar la cola a la identidad. Ese es el gate.
- **Los 6 impactos históricos** con claves ajenas en NULL. Son evidencia de
  cómo estaba el sistema; rellenarlos sería inventar datos.
- **La CA y el certificado del broker.** No se regeneran.

## Último contador

```
hit_events de module-01    7
seq_hi en NVS              3456
desired_config_version     1
reported_config_version    0      <- lo que cierra el gate de configuración
```

## Pendientes físicos, en orden

1. **Flashear el candidato limpio** (sólo aplicación). Va primero, y no
   después de un golpe: el firmware de la placa es anterior a los dos
   arreglos, así que sin reflashear ni la cola ni la configuración pueden
   cerrarse. En el arranque hay que
   ver, en este orden: `[OK] CONNACK aceptado`, luego
   `[OK] N suscripciones emitidas tras el CONNACK`, luego
   `config v1 APLICADA y persistida`, y el aviso de la cola retirando los 8
   eventos de la identidad anterior por una sola vez.
2. **Comprobar en VM109**: `reported_config_version = 1`, `config_state =
   applied`, `config_applied_at` no nulo. Cierra `CONFIG_RECONCILIATION_PHYSICAL`.
3. **Reiniciar otra vez**: el retenido vuelve y el log debe decir
   `noop, se redeclara`, no un segundo «APLICADA». Eso demuestra la
   persistencia en NVS y que no hay bucle.
4. **Golpe único en D1** → debe publicarse (la cola ya no lo bloquea) y cerrar
   `QUEUE_IDENTITY_BINDING_PHYSICAL_GATE`.
5. **Comando desde el panel → LED físico**.
6. **Los tres juegos**, `reconnect` y `endurance` de una hora.

## Comandos exactos para rearmar el vigilante

Desde `ia-server`, observa PostgreSQL de VM109 sin tocar el serie ni publicar
nada:

```sh
bash scripts/bench/observar-primer-modulo.sh module-01
```

Avisa del paso OFFLINE→ONLINE, de la configuración confirmada y del primer
impacto. Es de **sólo lectura**: si pudiera provocar esos hitos, no serviría
para comprobarlos.

Para esperar a un impacto concreto, con la cuenta de partida N:

```sh
# ajusta el umbral a la cuenta actual antes de golpear
docker exec diana-postgres-1 psql -qtAX -U diana_app -d diana \
  -c "select count(*) from hit_events where module_slug='module-01';"
```

## Trampa conocida

**Abrir el puerto serie reinicia la placa** aunque no se toquen DTR/RTS a
propósito; lo mismo `esptool read_flash`. En la prueba de endurance, un monitor
conectado a destiempo falsearía un «reinicio espontáneo». Anota siempre si un
reinicio fue de utillaje.

## Material del banco

En `~/diana-private/handoff/module-01/` (0700), fuera de Git: la CA pública
autoritativa, la contraseña MQTT (0600, **no se puede volver a leer del
servidor**), los cuatro volcados de NVS y el de `evtqueue`. Índice no sensible
en `docs/coordination/ARTEFACTOS-BANCO-MODULE-01.md`; integridad con
`sha256sum -c manifest.sha256`.
