# Incidencia · VM109 no queda operativa tras un reinicio: el broker no vuelve

**Fecha:** 2026-09-13 · **Máquina:** VM109 `diana-server` (192.168.1.209) · **Severidad:** alta (pérdida silenciosa de servicio)
**Estado:** diagnosticado parcialmente, **sin corregir** (por decisión del operador: primero plan, luego arreglo)
**Revisión 2 (2026-09-13):** la sección 6 de la versión original contenía una afirmación FALSA sobre la persistencia de Mosquitto. Corregida y explicada abajo.

---

## 1. Resumen en una frase

Tras un apagado y arranque limpios de VM109, **seis de los siete contenedores del stack volvieron solos y el broker MQTT no**, sin que ningún mecanismo lo detectara ni lo avisara: la API y el panel respondían con normalidad mientras el sistema estaba, en la práctica, ciego y mudo frente a las dianas.

## 2. Por qué importa

Todo el producto pasa por el broker. Sin él:

- los módulos no reciben órdenes (`module/{id}/command`, `config/desired`, `maintenance/command`);
- el backend no ingiere impactos, presencia, telemetría ni estado de selector;
- el coordinador no recibe `system/{id}/command` ni publica `game/state`.

Y lo más grave: **el resto del sistema parece sano**. `/api/health` devuelve 200, el frontend sirve, PostgreSQL está arriba y los contenedores marcan `healthy`. Un operador que mire el panel no ve nada anómalo. VM109 tiene `onboot=1`, así que este escenario es exactamente lo que ocurriría tras un corte de luz de madrugada.

## 3. Cronología (relojes de la propia VM)

| Hora (UTC) | Hecho |
|---|---|
| 02:00:45 | `systemd`: «Stopping docker.service» |
| 02:01:06 | `docker.service: Deactivated successfully` — apagado **limpio** del demonio |
| 02:01:18 | Fin del arranque anterior (`journalctl --list-boots`) |
| 02:01:56 | Comienza el arranque nuevo |
| 02:03:49 | `docker.service`: «Starting up» |
| 02:03:57 | `dockerd`: «Restoring containers: start.» |
| 02:03:58 | `diana-mosquitto-1` → `FinishedAt`, `ExitCode=255` |
| 02:04:13 | `dockerd`: «Loading containers: done.» — **sin el broker** |
| 02:04:25 | `docker.service` activo. 6/7 contenedores arriba y sanos |
| 02:06:04 | Arranque **manual** (`docker start diana-mosquitto-1`) → `ExitCode=0`, `Running=true` |
| 02:06:48 | `module-01` y el backend reconectan solos; estado íntegro |

El apagado fue ordenado (`qm shutdown`, ACPI), no un corte. Es decir: **el escenario benigno ya reproduce el fallo**.

## 4. Evidencia cruda

```
docker inspect diana-mosquitto-1
  ExitCode     = 255
  Error        = (vacío)
  StartedAt    = 2026-09-12T10:29:51Z     ← el arranque ORIGINAL, no el del reinicio
  FinishedAt   = 2026-09-13T02:03:58Z
  RestartCount = 0
  Policy       = unless-stopped
```

- `docker logs diana-mosquitto-1` **no contiene ni una línea** del intento de arranque: las últimas son las del cierre limpio anterior (`Saving in-memory database to /mosquitto/data//mosquitto.db`, `Client backend disconnected`).
- `journalctl -b 0` no registra **ningún error** relativo a mosquitto; la única mención es la del arranque manual posterior.
- Los otros seis servicios, con la misma política `unless-stopped`, volvieron sin intervención.

## 5. Qué está establecido y qué no

**Establecido:**

1. El fallo es reproducible por un reinicio limpio, no requiere un corte brusco.
2. `RestartCount = 0`: Docker **no reintentó** pese a `restart: unless-stopped`.
3. Nada alertó. El healthcheck del propio broker no puede avisar de un contenedor que no existe, y no hay supervisión externa que vigile la *ausencia* de un servicio.
4. Arrancarlo a mano funciona a la primera y sin tocar nada más.

**NO establecido — y conviene no darlo por sabido:**

- Si Docker llegó a ejecutar el proceso. El `ExitCode=255` junto con un `StartedAt` que **sigue siendo el del día anterior** sugiere que el contenedor nunca llegó a arrancar en este arranque y que el 255 es el código que el demonio anota al encontrar, durante la restauración, una tarea cuyo final no puede determinar. La hipótesis contraria —que arrancó y murió en menos de un segundo— es incompatible con que `StartedAt` no se actualizara.
- Por qué `unless-stopped` no aplicó. No se ha encontrado la regla que lo explique.

**Hipótesis ya descartadas con evidencia:**

- *Montaje tardío de `/opt/diana`*: `findmnt` confirma que está en `/dev/sda1` sobre la raíz ext4. No hay unidad de montaje separada que pudiera llegar después que Docker.
- *Permisos del ACL* (incidencia D6 conocida, que dejaba el contenedor en `Exited(13)`): el código aquí es 255 y el fichero está en 644.
- *Pérdida de la base de retenidos*: descartada — vive en un volumen nombrado (ver §6).

## 6. CORRECCIÓN · la «segunda fragilidad» que publiqué NO existe

**La primera versión de este informe afirmaba que `/mosquitto/data` no tenía volumen y que
cualquier recreación del contenedor borraría los retenidos. Es falso.** Queda aquí en vez de
borrarse, porque el error de método importa más que el dato.

Lo verificado, en los dos extremos:

```
compose.yml:442        - mosquitto_data:/mosquitto/data
compose.yml:713-714    mosquitto_data:  name: diana_mosquitto_data
producción             docker inspect diana-mosquitto-1
                       volume diana_mosquitto_data -> /mosquitto/data  rw=true
                       /var/lib/docker/volumes/diana_mosquitto_data/_data/mosquitto.db
                       9223 bytes · uid 1883 · mtime 2026-09-13 02:36
```

El volumen existe desde el commit original del compose, está en producción y `mosquitto.db`
vive en él. **Los retenidos sobreviven a recrear el contenedor.**

**Cómo se produjo el error, que es lo que hay que no repetir:** se leyó una ventana de veinte
líneas del compose (`sed -n '311,330p'`), se vio que la lista de `volumes` contenía sólo
configuración y certificados, y se concluyó que no había volumen de datos. La lista continuaba
más abajo. Una ventana truncada leída como si fuera la lista completa — el mismo patrón contra
el que este proyecto lleva toda la sesión: afirmar sobre lo que no se ha observado entero.

**Consecuencias:**

- La fase «migrar la persistencia de Mosquitto» **no tiene objeto**: ya está migrada. Lo que sí
  queda por hacer es lo contrario de lo que decía este informe: **demostrar** que se conserva —
  recreando el contenedor de verdad y comprobando los retenidos — y dejar un control negativo
  que detecte una regresión futura.
- La recuperación se hizo con `docker start` en vez de `up` por esta premisa falsa. Fue
  conservador y no causó daño, pero no era necesario por el motivo que se creyó.
- **El fallo de arranque sigue sin explicación.** La persistencia nunca fue candidata a causa;
  descartarla no acerca el diagnóstico.

Lo que sí sigue en pie y merece verificarse en A1: que el UID/GID del volumen (1883) y sus
permisos son correctos, y que `mosquitto.db` se escribe de verdad al cerrar (el log del cierre
limpio mostraba `Saving in-memory database`, así que hay indicio, no prueba, de que sí).

## 7. Contexto: por qué se reinició la VM

El reinicio no fue caprichoso. El agente invitado QEMU de VM109 estaba caído (`qm agent 109 ping` → rc=255) tras ejecutarse un comando bloqueante (`sleep`) dentro de un `qm guest exec`, que agota el canal. **Es la segunda vez que ocurre** (la primera, el 2026-08-10, con `pg_dump` reintentando DNS).

Como `qm guest exec` era el **único** acceso a VM109 —no había clave SSH autorizada y la consola serie exige credenciales no documentadas—, perder el agente dejaba la VM sin ninguna vía de gestión, con todos los servicios funcionando. El reinicio fue la única salida disponible.

**Mitigación ya aplicada:** se instaló la clave pública `ia02@ia-server` en `authorized_keys` de `root` y `diana-admin`, y se verificó por efecto que **SSH funciona desde VM102 (ia-server) hacia VM109** con `diana-admin` (`id -un` → `diana-admin`, `docker ps -q | wc -l` → 7). `PermitRootLogin` está en `no` y **no se ha modificado**: la vía operativa es `diana-admin`. El acceso a VM109 ya no depende del agente QEMU.

## 8. Coste colateral

El reinicio destruyó la evidencia pendiente de un despliegue anterior: los `StartedAt` de `mosquitto`, `frontend` y `postgres` que servirían para demostrar que aquel despliegue de backend no los recreó. Quedan **definitivamente no verificables**. La salida de `docker compose up -d backend` sí indicaba que sólo tocó ese servicio, pero eso es un indicio, no la prueba.

## 9. Lo que hay que decidir (insumo para el plan, no el plan)

Por orden de lo que este incidente demuestra que falta:

1. **Que la ausencia de un servicio se note.** Es lo más urgente y lo más barato. Hoy nada distingue «broker caído» de «todo bien» desde fuera. Cualquier arreglo del arranque puede volver a fallar; que no avise, no debería.
2. **Determinar la causa real del `unless-stopped` que no aplicó**, antes de elegir remedio. Cambiar a `restart: always`, o añadir una unidad `systemd` que ejecute `docker compose up -d` tras `docker.service`, son parches razonables — pero elegir sin saber por qué falló arriesga tapar el síntoma.
3. **Reproducirlo.** El fallo se da con un reinicio limpio, así que es reproducible a voluntad en una ventana controlada. Sin reproducción no hay forma de saber si un arreglo arregla.
4. **Demostrar la persistencia que ya existe.** El volumen está montado (§6); lo que falta es la prueba de que los retenidos sobreviven a una recreación real del contenedor, y un control negativo, versionado, que se ponga rojo si alguien quita ese volumen.
5. **Verificación de arranque como parte del procedimiento de despliegue**: contar 7/7 y comprobar el broker explícitamente, no confiar en que `/api/health` responda.

## 10. Deuda relacionada, ya registrada

- `qm guest exec` no admite comandos bloqueantes; las esperas van del lado del host. Reincidencia documentada.
- Credenciales de SO de VM109 no documentadas en ninguna parte: la consola serie no es una vía de rescate real hoy.
- `chown -R` en el `Dockerfile` del backend alarga cada construcción varios minutos.

---

*Recuperación aplicada en esta incidencia: `docker start diana-mosquitto-1`, elegido por una premisa que resultó falsa (ver §6); conservador, pero no necesario por el motivo que se creyó. Comprobado después: 7/7 contenedores sanos, `module-01` y backend reconectados, `configState=applied`, panel libre.*
