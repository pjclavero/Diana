# P0-2 · Saneamiento forense del árbol de producción (`/opt/diana`)

Inventario **de sólo lectura**, previo a construir ninguna imagen. Nada se ha
borrado, movido ni corregido. Fecha: 2026-08-13, VM109.

Criterio de clasificación:

| | |
|---|---|
| **A** | runtime/secreto esperado — debe existir fuera de Git y **sobrevivir** al despliegue |
| **B** | modificación productiva legítima — debe estar representada en el commit objetivo |
| **C** | residuo — candidato a eliminación, sólo tras dictamen |
| **D** | evidencia — mover o conservar deliberadamente antes de limpiar |
| **E** | **desconocido / no explicado — BLOQUEANTE** |

## 1. Identidad del despliegue

```
HEAD      6da16d431556fae2f50a81d89e90225364063dc4
rama      develop (no detached), ahead 33 de origin/develop
origin    https://github.com/pjclavero/Diana.git
objetivo  hotfix/p02-tls-6da16d4 @ f682876
```

`HEAD` coincide exactamente con `PROD_BASE = P0-2_BASE = 6da16d4`. El commit
objetivo desciende de él por línea directa.

## 2. Tracked modificados — 5, todos clase B, 0 desconocidos

```
 compose.yml                             |  45 ++++++--
 infrastructure/backups/backup.sh        |  37 +++++++-
 infrastructure/backups/restore.sh       |  25 ++++-
 infrastructure/mosquitto/acl            | 139 +++++++++++++++++++++-----
 infrastructure/mosquitto/mosquitto.conf |  79 +++++++++++-----
 5 files changed, 273 insertions(+), 52 deletions(-)
```

**Cada uno de los 5 es byte a byte idéntico a su versión en `2586dbc`**, el
commit del hotfix que fotografía el árbol de producción. Comprobado por sha256
vivo contra `git show 2586dbc:<fichero>`:

| sha256 | fichero |
|---|---|
| `e13116048096a058…` | `compose.yml` |
| `8605be98165275f9…` | `infrastructure/backups/backup.sh` |
| `31bc861ab0f7286e…` | `infrastructure/backups/restore.sh` |
| `d7aac889f69cab8f…` | `infrastructure/mosquitto/acl` |
| `8148fd60c788dd93…` | `infrastructure/mosquitto/mosquitto.conf` |

**Respuesta a la pregunta que decide la puerta** — *¿cada diferencia de la
configuración viva está incluida en el hotfix objetivo?* **Sí, y de forma
exacta.** El contenido vivo es literalmente el de `2586dbc`; el commit objetivo
difiere de ahí sólo por el delta deliberado de P0-2, ya revisado. No hay ni una
línea productiva que el despliegue fuese a pisar sin estar representada. No hay
nada que «preservar a mano».

El diff completo es reproducible sin acceso a la VM: `git diff 6da16d4 2586dbc`.

## 3. Untracked — 30 ficheros, 0 desconocidos

| ruta | tipo | clase | motivo |
|---|---|---|---|
| `infrastructure/mosquitto/certs/` (4) | dir | **A** | `ca.crt`, `server.crt` (0644 root), `server.key` (**0600 uid 1883**), `ca.key` (0600 root). Material TLS vivo: si desaparece, el broker no arranca y el backend aborta. |
| `infrastructure/mosquitto/passwd` | fichero | **A** | Credenciales del broker. `sha256 f2fbb190…` = el `passwd.CLEAN` instalado tras la Etapa B. **Modo 0644** → ver hallazgo abajo. |
| `infrastructure/backups/verify-restore.sh` | fichero | **B** | Idéntico a `2586dbc`. El hotfix lo añade como fichero nuevo. |
| `infrastructure/mosquitto/generate-certs.sh` | fichero | **B** | Idéntico a `2586dbc`. Ídem. |
| `rollback/p02-tls-20260811/` (6) | dir | **D** | Punto de rollback de P0-2 del 11-ago: `compose.yml`, `mosquitto.conf`, `passwd.PRE-F02`, digests de imagen, SHA256SUMS, servicios. Se conserva hasta cerrar P0-2. |
| `backups/pre-d9-20260726-…sql.gz` | fichero | **D** | Volcado de base previo al despliegue D9. Contiene datos de la aplicación. |
| `staging-p02/` (21) | dir | **D→C** | Material de ATAQUE de las celdas 1-9: `otra-ca.key`, `impostor.csr/key`, `exp.crt/key` (certificado caducado), `ca-db/`. Evidencia hoy; **destrucción obligatoria** en la limpieza final de P0-2. |
| `compose.yml.PRE-HC-20260810` | fichero | **C** | Copia previa al healthcheck de P0-1. Superada por `rollback/`. Candidato a eliminación. |

## 4. Ignorados relevantes

| ruta | clase | nota |
|---|---|---|
| `.env` | **A** | 0600 `diana-admin`. Configuración viva. |
| `.env.bak-pre-pull-20260721062758` | **C** | 0600. Contiene 4 secretos. |
| `.env.bak-wp08-20260721063052` | **C** | 0600. Contiene 4 secretos. |
| `certs/ca.key`, `certs/server.key` | **A** | Claves privadas. `ca.key` NO entra en ningún contenedor (verificado). |
| `staging-p02/*.key` | **D→C** | Claves del material de ataque. |
| `server/backend/node_modules/` | **C** | Caché, irrelevante. |

### Hallazgo: la credencial a rotar está en TRES sitios

Comprobado por hash: **`MQTT_BACKEND_PASSWORD` de los dos `.env.bak` es la
misma que la viva**. Cuando se ejecute la rotación pendiente —la credencial
apareció en una transcripción y está declarada comprometida— no basta con
cambiar `.env`: los dos respaldos deben destruirse con `shred`, no borrarse.
Son ficheros 0600, así que la exposición es local, pero perpetúan la credencial
comprometida en el disco de producción.

## 5. Hallazgo de seguridad abierto: `MQTT-PASSWD-PERMISSIONS`

`infrastructure/mosquitto/passwd` está en **0644 root:root**: cualquier usuario
local del host puede leer los hashes de contraseña de todos los módulos y del
backend.

Y explica de una vez la trampa histórica: el broker corre como **uid 1883** y
el fichero pertenece a `root`, así que necesita permiso de lectura para «otros»
— por eso `chmod 600` a secas producía `Unable to open pwfile` y el bucle de
reinicio documentado como fallo #2 del procedimiento.

La corrección conceptual es `owner = uid/gid efectivo de mosquitto` **más**
`mode 0600`. **No asumir 1883**: hay que leer el uid/gid real de la imagen
antes de aplicarlo. La prueba posterior debe demostrar cuatro cosas: el broker
arranca; la autenticación funciona; un usuario no privilegiado del host **no**
puede leer el fichero; y el health TLS sigue verde.

Prioridad **P1**, inmediatamente después de P0-2 o dentro del paquete
predespliegue si puede aislarse y probarse. No se tocó durante la ventana de
F-02 para no añadir una variable mientras se validaba identidad y ACL.

## 6. Por qué `git clean` habría sido destructivo

Un `git clean -fd` habría borrado **`infrastructure/mosquitto/passwd`** y los
certificados no ignorados: el broker no arrancaría y el backend abortaría por
CA ausente. Con `-x` se llevaría además `.env` y las claves privadas. La
limpieza debe ser selectiva y por lista explícita.

## 7. Dictamen de la puerta

```
TRACKED:
  5 modificados
  5 explicados (clase B, idénticos a 2586dbc)
  0 desconocidos

UNTRACKED:
  5 runtime/secretos (A)
  2 productivos ya en el objetivo (B)
  28 evidencia (D) · 21 de ellos material de ataque a destruir al cierre
  1 residuo (C)
  0 desconocidos

IGNORADOS RELEVANTES:
  4 runtime/secretos (A)
  3 residuos (C) · 2 con credenciales vivas

TARGET DIFF:
  toda modificación productiva representada en el commit objetivo

DEPLOY TREE:  APTO PARA SANEAMIENTO
```

**Cero elementos de clase E.** No queda nada sin explicar.

## 8. Lo que NO se ha hecho, deliberadamente

Ni `git reset --hard`, ni `git clean`, ni borrado de `.PRE`, ni sobrescritura
de `mosquitto.conf`, ni construcción de imagen, ni despliegue. Esto es la
fotografía; la limpieza selectiva viene después del dictamen.
