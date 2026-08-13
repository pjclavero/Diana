# Operación de Diana en la VM 109

> Paquete WP-08. Complementa el
> [procedimiento de despliegue](../deployment/procedimiento.md). Cubre
> arranque/parada, copias de seguridad, recuperación, pruebas de verificación
> y reinicio de la máquina.

## Arranque / parada

```bash
cd /opt/diana
docker compose up -d          # levanta todo el stack (perfil por defecto)
docker compose ps             # estado + salud
docker compose logs -f backend
docker compose down           # para y elimina contenedores (CONSERVA volúmenes)
```

`restart: unless-stopped` en todos los servicios persistentes. **Corrección (2026-07-26):**
este documento decía que el retorno tras `reboot` estaba «verificado en la sección Reinicio».
**No lo está.** Esa sección sólo da el comando; **el `reboot` de la VM con comprobación del
retorno automático nunca se ha ejecutado** (`deployment/procedimiento.md`, cierre del §9). La
configuración está puesta; el comportamiento no está demostrado.

> **Antes de tocar esta VM, lee `deployment/procedimiento.md` §8.** Hay tres trampas reales y
> repetidas: (1) `docker compose up -d` puede reintentar el one-shot `migrate` y abortar el
> arranque del backend; (2) **compilar con todo levantado mata a BuildKit por falta de memoria**
> y deja la imagen anterior corriendo, con un `build` que parece haber terminado bien; (3) **el
> DNS de la VM está roto** (MagicDNS de Tailscale), así que `git`, `docker pull` y `npm` fallan
> con «Could not resolve host» hasta que el operador lo arregle.

## Datos que persisten (volúmenes nombrados)

| Volumen | Contenido |
|---|---|
| `diana_postgres_data` | Base de datos PostgreSQL. |
| `diana_mosquitto_data` | Persistencia del broker (retained + colas QoS). |
| `diana_backups` | Copias `pg_dump` (daily/weekly/monthly). |
| `diana_exports`, `diana_firmware`, `diana_proxy_certs` | Exportaciones, firmware, certificados. |

`docker compose down` NO borra estos volúmenes. Sólo `down -v` los elimina
(destructivo: no usar en producción sin confirmación del operador).

## Copias de seguridad

El servicio `backup` ejecuta `backup.sh` según `BACKUP_CRON` (02:30 UTC por
defecto): `pg_dump` comprimido a `diana_backups:/backups/daily/`, con rotación
semanal/mensual y purga por retención. Es de sólo lectura sobre la base.

Copia manual inmediata:

```bash
docker compose exec backup /scripts/backup.sh
docker compose exec backup ls -lh /backups/daily
```

## Recuperación (restauración de prueba aislada)

Antes de restaurar sobre la base real, validar el dump en una base separada
(`--target-db`), sin tocar `diana`:

```bash
FILE=$(docker compose exec -T backup sh -c 'ls -1 /backups/daily/*.sql.gz | tail -1')
docker compose exec backup /scripts/restore.sh "$FILE" --target-db diana_restore_test
# Verificar y luego limpiar:
docker compose exec backup psql -c 'DROP DATABASE diana_restore_test'
```

## Pruebas de verificación en la VM

### Integración contra PostgreSQL real (idempotencia + modelo temporal)

Las 5 pruebas de `server/backend/test/integration/` necesitan base viva y
dependencias de desarrollo (jest/ts-jest), que NO están en la imagen de
producción. Se ejecutan en un contenedor efímero de Node en la red interna,
contra una base de datos de pruebas dedicada (`diana_it`):

```bash
cd /opt/diana
set -a; . ./.env; set +a
NET=$(docker network ls --format '{{.Name}}' | grep -E 'internal$' | head -1)
# Base de pruebas dedicada + migración:
docker compose exec -T postgres psql "$DATABASE_URL" -c "CREATE DATABASE diana_it;"
IT_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/diana_it?schema=public"
docker run --rm --network "$NET" -v /opt/diana:/repo -w /repo/server/backend \
  -e DATABASE_URL="$IT_URL" node:20.19-bookworm-slim \
  bash -c "npm ci && npx prisma migrate deploy && npm run test:integration"
```

> La base `diana_it` se vacía parcialmente durante las pruebas (README de
> integración): nunca apuntarlas a la base de producción.

### ACL de Mosquitto

Desde el **host de la VM**, por TLS contra el 8883 publicado:

```bash
cd /opt/diana/infrastructure/mosquitto
# Alta previa de las identidades de prueba (una sola vez). LEE EL AVISO DE
# ABAJO ANTES DE EJECUTARLO: en VM109 esta ruta tiene obstáculos conocidos.
./generate-users.sh module-acltest-a
./generate-users.sh module-acltest-b
./generate-users.sh module-aclobserver
# Contraseñas por entorno, no por argumento (no acaban en el historial ni en
# `ps`). Sin argumentos: localhost:8883 validando ./certs/ca.crt.
ACL_A_PW='…' ACL_B_PW='…' ACL_OBS_PW='…' ./test-acl.sh
```

**Identidades dedicadas, nunca las reales.** `module-acltest-a/b` no tienen
ninguna regla propia en la ACL: atraviesan exactamente los mismos
`pattern … %c` que `module-01`, así que lo que se demuestra es la política de
producción y no una hecha para que el test pase. `module-aclobserver` es de sólo
lectura y acotado al espacio de nombres de prueba.

**Por qué no se reutiliza `backend` como observador:** con
`use_username_as_clientid true` el broker reescribe el client_id con el usuario
autenticado, así que un observador conectado como `backend` tendría el mismo
client_id que el backend de producción; los dos se expulsarían en bucle,
provocando flapping de la ingesta real y envenenando el propio resultado.

El script **distingue** un rechazo de autenticación de una denegación de ACL, y
cuenta el primero como ERROR DE ARNÉS, no como acierto: un control que no llega
a tocar la ACL no demuestra nada sobre la autorización. Si ves `[ERROR]` en el
resumen, el resultado no es interpretable aunque no haya `[FAIL]`.

Estas tres cuentas son **temporales**: se borran al cerrar P0-2, junto con
`module-p02a/b`.

> **Una sola ejecución a la vez.** El script toma un cerrojo: dos observadores
> con el mismo usuario se expulsarían mutuamente.

#### Alta de usuarios del broker — NO EJECUTADO, con obstáculos conocidos

Este procedimiento **no se ha ejecutado todavía** y por tanto no está
verificado. Se escribe aquí con lo que sí está comprobado en VM109, en lugar
de dar una receta limpia que fallaría, porque este documento ya indujo cuatro
veces a comandos que no funcionaban:

| obstáculo | comprobado |
|---|---|
| `mosquitto_passwd` **no está instalado** en el host de la VM | sí |
| el montaje de `passwd` en el contenedor es `:ro` — `mosquitto_passwd` dentro del contenedor **no puede escribirlo** | sí (`docker inspect`: `RW=false`) |
| `generate-users.sh` hace `chmod 600`; con el propietario equivocado provoca `Unable to open pwfile` y **bucle de reinicio** del broker | documentado como fallo #2 en `deployment/procedimiento.md` |
| mosquitto **no relee** `password_file` solo: hace falta recargarlo (`SIGHUP`) | sí |

Consecuencia práctica: dar de alta estas tres identidades **requiere una
decisión del operador** sobre cómo escribir en `passwd` (instalar
`mosquitto-clients` en el host, montar el fichero en lectura-escritura, o
generar los hashes fuera y añadirlos), y es una modificación de producción.
Hasta que eso ocurra, `test-acl.sh` **no se ha ejecutado nunca de extremo a
extremo**: la rama de su clasificador que produce los `[PASS]` —la denegación
de ACL real— no la ha visto funcionar nadie. Las otras tres ramas
(`AUTH_DENIED`, `SIN_TRANSPORTE`, error de TLS) sí están medidas contra el
broker real.

Estas identidades son **temporales** y se borran al cerrar P0-2, junto con
`module-p02a`/`module-p02b`, que siguen en el `passwd` de producción.

> **Si falla la conexión, NO republiques el 1883.** Esa es la reacción que
> deshace P0-2 entero, y este documento ya indujo a ella dos veces con dos
> comandos distintos que no funcionaban. Comprueba en este orden: que
> `./certs/ca.crt` existe y es legible; que el 8883 está publicado
> (`ss -ltn | grep 8883`); y que el broker está sano
> (`docker compose ps mosquitto`). Un `Error: A TLS error occurred` significa
> CA equivocada, no que haga falta texto en claro.

### Simulador -> Mosquitto -> PostgreSQL

> **`docker compose --profile simulator up -d device-simulator` no simula
> nada.** El `CMD` de esa imagen es `run --help`, y las variables `MQTT_HOST`/
> `MQTT_PORT` que compose le pasaba nunca se leyeron (retiradas en P0-2). El
> simulador elige broker sólo con `--broker`.

```bash
docker compose --profile simulator run --rm device-simulator run \
  --broker mqtts://mosquitto:8883 \
  --cafile /workspace/certs/ca.crt \
  --username module-01 --password "$M1_PW" --modules 1
# --modules 1 NO es arbitrario: el simulador crea UN transporte MQTT POR
# MÓDULO (simulators/src/simulation.ts), y con `use_username_as_clientid true`
# los tres compartirían client_id `module-01` y se expulsarían en bucle;
# además module-02/03 publicarían en tópicos que la ACL les niega. Para varios
# módulos hacen falta credenciales por módulo, una por identidad.
# NO EJECUTADO todavía contra la VM (a 2026-08-13): esta receta es coherente
# con el compose y el CLI actuales —el montaje de ca.crt existe y --cafile está
# implementado— pero hasta que alguien la corra, es un procedimiento, no una
# verificación. Si falla, arréglala aquí; no reabras el 1883.
# El backend ingesta desde MQTT; comprobar filas en hit_events:
docker compose exec -T postgres psql "$DATABASE_URL" -c "SELECT count(*) FROM hit_events;"
```

## Reinicio de la VM

```bash
sudo reboot
# Tras volver:
docker compose ps    # comprobar servicio a servicio que vuelven todos
```

**NO EJECUTADO.** A 2026-07-26 nadie ha reiniciado la VM 109 para comprobar que el stack
vuelve solo. Es una de las dos comprobaciones que faltan para cerrar el ciclo de despliegue
(la otra es la **restauración** de una copia en base aislada, tampoco ejecutada). Hasta que se
haga, esto es un procedimiento, no una verificación.

## Notas de seguridad de esta instalación (pendientes)

- **MQTT sobre TLS (P0-2, desde 2026-08-13)**: mosquitto sirve en `8883` con
  certificado de una CA propia, y el backend valida CA y nombre de servidor. Si
  la CA falta o no se puede leer, el backend **aborta**: no existe camino que
  convierta un error de CA en una conexión sin validar. Los certificados se
  generan con `infrastructure/mosquitto/generate-certs.sh`; `ca.key` no entra
  en ningún contenedor.
- El único puerto MQTT publicado al host es `8883`. **Los módulos ESP32
  físicos NO pueden usarlo todavía**: el firmware vigente tiene
  `mqtt://%s:1883` cableado (`firmware/esp32/main/app_main.c`), sin TLS ni CA.
  P0-2 asegura TLS para el plano de servidor e integración; **el transporte
  MQTT TLS del firmware queda pendiente de implementación y validación
  física**, en un carril propio. No hay módulos físicos activos hoy (40 h de
  log del broker sin ninguno), así que esto no bloquea las celdas 10-16, pero
  no debe describirse al revés. PostgreSQL NO se publica. El proxy publica `8080`.
- **No queda ningún listener MQTT/TCP en claro**, ni publicado al host ni
  dentro de la red interna de Docker. El `listener 1883` interno se eliminó el 2026-08-13,
  cuando `test-acl.sh` —su única razón de ser— aprendió a hablar TLS. Lo vigila
  `server/backend/test/mqtt/broker-sin-listener-en-claro.spec.ts`, que se pone
  roja si alguien lo reintroduce en `mosquitto.conf` o vuelve a publicar el
  1883 en `compose.yml`.
- **El simulador necesita `--cafile`** para hablar con el broker
  (`--broker mqtts://…:8883 --cafile …/certs/ca.crt`). Sin ella aborta en vez de
  conectar sin validar. La receta antigua con `mqtt://…:1883` ya no funciona y
  no debe "arreglarse" reabriendo el puerto.
- **`MQTT_URL` es la escapatoria a vigilar**: tiene precedencia absoluta sobre
  protocolo, host y puerto. No definirla en el `.env` de la VM.
- **nginx sigue en claro**: el bloque HTTPS/8443 continúa preparado y
  comentado. P0-2 cubrió el transporte MQTT, no el HTTP.
- No exponer nada a Internet sin revisar antes CORS, TLS y contraseñas.
