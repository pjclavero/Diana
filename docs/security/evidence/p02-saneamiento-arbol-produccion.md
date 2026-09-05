# P0-2 · Saneamiento forense del árbol de producción (`/opt/diana`)

> **AVISO DE PROCEDENCIA (porte D1, 2026-09-05).** Este documento se tomó tal
> cual de la rama `hotfix/p02-tls-6da16d4` y describe mediciones hechas sobre
> **el árbol de esa rama y la VM de producción de agosto de 2026**, donde el
> listener MQTT en claro (1883) ya se había retirado. En `mp0/integration` ese
> listener **sigue existiendo** como perfil de transición, porque el firmware
> físico lo lleva cableado (decisión D1 del operador, pendiente). Léelo como
> historia medida, no como descripción del árbol actual. El estado vigente de
> esta rama es `TLS_WIRED_NOT_EXCLUSIVE` y está en
> `docs/coordination/D1-PORTE-P02.md`.

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

---

# Saneamiento selectivo EJECUTADO (2026-08-13)

| elemento / grupo | clase | acción | destino | verificación |
|---|---|---|---|---|
| `infrastructure/mosquitto/passwd` | A | conservar | ubicación actual | 7/7 sano tras la operación |
| `certs/ca.crt`, `certs/server.crt`, `certs/server.key` | A | conservar | runtime | broker `healthy` |
| **`certs/ca.key`** | **A-PKI** | **extraer** | `/root/diana-pki` (0700, root) | **copia verificada por sha256 ANTES de destruir el original**; `shred` después |
| `.env` | A | conservar | runtime | intacto |
| `.env.bak-pre-pull-…`, `.env.bak-wp08-…` | C-secreto | **destruir** | — | `shred`; nada los referenciaba y **0 claves** ausentes de `.env` |
| 5 tracked modificados | B | no preservar a mano | Git objetivo | idénticos a `2586dbc` |
| `verify-restore.sh`, `generate-certs.sh` | B | conservar | ya en el objetivo | — |
| `rollback/`, `backups/`, `staging-p02/`, `compose.yml.PRE-HC-…`, `passwd.PRE` | D | **mover** | `/root/diana-evidence/p0-2/predeploy/` (0700) | fuera del checkout |

`ca.key`: original `50cbdbea8232dc46…`, copia `50cbdbea8232dc46…` — idénticas
antes de destruir. Queda además `SHA256SUMS` junto a la copia. **Destino final
pendiente: almacenamiento offline fuera de VM109.** Comprobado antes de mover
que **ningún contenedor la monta**, ninguna unidad systemd la referencia y
`compose.yml` sólo la nombra en comentarios.

## Consecuencia que casi se me escapa: `generate-certs.sh` habría creado una CA nueva

Sacar `ca.key` del árbol dejó una trampa. El script generaba la CA en
`CERT_DIR` **cada vez que llegaba a ese punto** —certificado caducado o
`FORCE=1`—, así que la siguiente rotación habría emitido en silencio una CA
distinta e invalidado la confianza de todos los clientes. Una rotación de
servidor no puede convertirse en un cambio de raíz de confianza por accidente.

Corregido, y es lo que el operador pedía conceptualmente: la herramienta pasa a
ser de **provisión y rotación**, no algo que el stack necesite para arrancar.

- `CA_DIR` (por defecto `/root/diana-pki`) separa la CA del material de runtime.
- Si la CA existe, **se reutiliza y no se toca**.
- Si no existe, **aborta** explicando cómo traerla.
- Sólo `NEW_CA=1` crea una raíz nueva, avisando de que hay que redistribuir
  `ca.crt` a backend, simulador y firmware.
- Guardarraíl final: si al terminar apareciera `ca.key` en `CERT_DIR`, sale con error.

Calibrado ejecutándolo: (A) sin CA y sin `NEW_CA` → `rc=1` y **cero** ficheros
creados; (B) con `NEW_CA=1` → CA en `CA_DIR`, cadena `OK`, y `ca.key` **no**
aparece en el árbol de despliegue; (C) segunda pasada → *«reutilizando la CA
existente»* y la clave no cambia.

## Estado final del checkout

```
 M compose.yml                              (B, idéntico a 2586dbc)
 M infrastructure/backups/backup.sh         (B)
 M infrastructure/backups/restore.sh        (B)
 M infrastructure/mosquitto/acl             (B)
 M infrastructure/mosquitto/mosquitto.conf  (B)
?? infrastructure/backups/verify-restore.sh (B, nuevo en el objetivo)
?? infrastructure/mosquitto/generate-certs.sh (B, ídem)
?? infrastructure/mosquitto/certs/          (A: ca.crt, server.crt, server.key)
?? infrastructure/mosquitto/passwd          (A)
```

Todo lo que permanece dentro de `/opt/diana` está ahí por una razón explícita
de runtime o de despliegue. Ni evidencia, ni copias manuales, ni credenciales
obsoletas, ni artefactos de laboratorio.

Queda un residuo conocido y **no tocado**: `server/backend/node_modules/`
(ignorado, caché de construcción). No cumple la propiedad, pero eliminarlo no
aporta a P0-2 y sí puede sorprender a algún procedimiento; se anota para
decidirlo aparte.

## Gate

```
0 elementos E                                    ✔
0 secretos obsoletos conocidos                   ✔ (dos .env.bak destruidos)
0 evidencia dentro del checkout                  ✔
0 residuos conocidos (salvo node_modules, anotado) ✔
tracked production = exactamente explicado       ✔ (5/5 == 2586dbc)
runtime secrets presentes y deliberados          ✔
ca.key fuera del deploy tree                     ✔
HEAD/base conocidos                              ✔ (6da16d4)

SANITIZED TREE → LISTO PARA BUILD DEL HOTFIX
```

## Regla operativa permanente

**En producción Diana queda PROHIBIDO usar `git clean` como procedimiento de
despliegue o recuperación.** Demostrado empíricamente sobre este inventario:
`git clean -fd` habría borrado `infrastructure/mosquitto/passwd` y los
certificados no ignorados —broker sin arrancar y backend abortando por CA
ausente— y `-fdx` se habría llevado además `.env` y las claves privadas. La
limpieza es siempre selectiva y basada en inventario.
