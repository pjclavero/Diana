# MP0 · Evidencia del laboratorio aislado

Ejecutado el **2026-08-23** sobre `mp0/integration`, base `b883da0`
(`FIRMWARE_BASE`). **VM109 no se tocó en ningún momento**; `diana_it` no se
reconstruyó; cero credenciales de producción.

## Entorno

**Docker rootless bajo `ia02`**, elegido sobre el grupo `docker` precisamente
para no conceder un privilegio permanente equivalente a root:

```
servidor   29.5.2      seguridad  [seccomp, name=rootless, cgroupns]
socket     unix:///run/user/1000/docker.sock
uid host   1000 (ia02) · en grupo docker: NO
red        diana-lab-net (bridge dedicada)
```

Requisitos instalados como root una sola vez: `uidmap`, `slirp4netns`.
Credenciales de laboratorio generadas con `mosquitto_passwd` **interactivo por
PTY**, nunca con `-b`; los secretos viajan por fichero de opciones `0600`, nunca
en `argv`. Laboratorio destruido al terminar.

## F-02 / ACL contra broker real — `PASS`

Broker `eclipse-mosquitto:2.1.2` con la `mosquitto.conf` y la `acl` **generadas
por el generador único** de MP0-A, y las 11 identidades de la fuente única.

La prueba **no se apoya en el código de salida**: un suscriptor real observa el
tópico y la evidencia es si el mensaje **se ve o no se ve**. Recordatorio de por
qué importa: un fallo de autenticación da `rc=135`, pero una denegación de ACL da
`rc=0`. El código de salida no distingue los dos casos.

| caso | clasificación | mensaje observado |
|---|---|---|
| `module-01` publica en SU namespace | `AUTH_OK_ACL_ALLOWED` | **sí** |
| `module-02` publica en SU namespace | `AUTH_OK_ACL_ALLOWED` | **sí** |
| `module-01` suplanta a `module-02` | `AUTH_OK_ACL_DENIED` | no |
| `module-02` suplanta a `module-01` | `AUTH_OK_ACL_DENIED` | no |
| `module-01` con `client_id=module-02` | `AUTH_OK_ACL_DENIED` | no |

### Las dos barreras, medidas por separado

`use_username_as_clientid` aparece **una sola vez** en `mosquitto.conf`, tras
`listener 1883`. **El listener 9001 (WebSockets) NO la tiene** — es por listener y
no la gobierna `per_listener_settings`. Para saber si eso reabre F-02 ahí, la
matriz se repitió contra un broker gemelo **sin esa directiva**, que reproduce la
condición del 9001:

> **La misma matriz vuelve a pasar entera.** La ACL, al no contener `%c` ni `%u`
> y nombrar el `module_id` literal, deniega la suplantación **por sí sola**. La
> defensa en profundidad de MP0-A queda demostrada, no afirmada.

Aun así, **falta la directiva en el 9001 y debe añadirse**: la barrera 2 la cubre
hoy, pero depender de una sola barrera no es lo acordado.

### Calibración del medidor

Con una ACL mutada que concede a `module-01` escritura sobre
`targets/v1/module/module-02/hit`, la matriz **se pone roja** en exactamente los
dos casos afectados —suplantación directa y `client_id` ajeno— mientras
`module-02 → module-01` **sigue correctamente denegado**. El medidor discrimina;
no es un rojo global.

## Migración PostgreSQL real — `PASS`

`postgres:16-alpine`, puerto atado a `127.0.0.1`, contraseña en fichero `0600`.

| escenario | resultado |
|---|---|
| **A** · base limpia → 16 migraciones | `All migrations successfully applied`; `detection_method` presente, `amplitude` NULLable, `CHECK` presente |
| **B** · esquema anterior **con filas** → nueva migración | 3 filas analógicas insertadas ANTES; tras migrar: **3 conservadas**, las 3 marcadas `analog_envelope`, `CHECK` presente |

El escenario B se repitió porque el primer intento insertó **0 filas** sin que se
notara (los errores estaban redirigidos a `/dev/null`): el `CHECK` se habría
validado sobre una tabla vacía, que es el caso trivial. La versión válida es la
que inserta filas y **lo comprueba antes de continuar**.

### El `CHECK` ejercido por escritura directa

| escritura | resultado |
|---|---|
| `analog_envelope` con amplitude y threshold | ACCEPT |
| `analog_envelope` sin amplitude ni threshold | REJECT |
| `digital_threshold` sin amplitude ni threshold | ACCEPT |
| `digital_threshold` con amplitude y threshold | REJECT |
| `digital_threshold` con `noise_floor` | REJECT |
| `analog_envelope` con amplitude pero sin threshold | REJECT |

Las dos últimas no estaban en el encargo; se añadieron para cubrir los bordes.

### Calibración: la restricción se valida de verdad

`convalidated = t`. Y al corromper a propósito las filas heredadas
(`amplitude=NULL` en filas analógicas) **la base se niega a añadir la
restricción**:

```
ERROR: check constraint "hit_events_detection_method_coherent"
       of relation "hit_events" is violated by some row
```

No es un `NOT VALID` que acepte datos heredados incoherentes en silencio.

## Reproducción

Scripts en el directorio de trabajo del laboratorio (no versionados por contener
credenciales efímeras): generación de identidades por PTY, matriz F-02/ACL con
observador, y matriz de migración/`CHECK`. Todo el material se destruyó al
terminar; lo reproducible es el procedimiento descrito aquí.

## Estado

```
IDENTITY_GENERATOR       = UNIQUE
F02_BROKER_REAL          = PASS
ACL_BROKER_REAL          = PASS
POSTGRES_MIGRATION_REAL  = PASS
```

Pendiente de infraestructura ajena: `ESP_IDF_BUILD` (portátil del operador).
