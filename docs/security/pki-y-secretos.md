# PKI y secretos · dónde vive cada cosa (D2, D3)

Documento normativo del carril **A · SECURITY CLEANUP**. Define qué material
existe en cada sitio, qué comprobación automática lo sostiene y cómo se
demuestra que hoy el repositorio está limpio.

La comprobación automática es `scripts/security/secrets-scan.sh`, enganchada al
job `secrets` de `.github/workflows/ci.yml`. Se calibra con
`./scripts/security/secrets-scan.sh --self-test`, que planta secretos de mentira
en una copia temporal y exige que el escáner se ponga **rojo** con cada uno.

---

## 1. Fábrica / administración — SOLO ahí

| Material | Dónde vive | Modo | Nunca en |
|---|---|---|---|
| `ca.key` (clave privada de la CA) | `$CA_DIR` de la máquina de administración, por defecto `/root/diana-pki` (dir. `0700`) | `0600` | repositorio · imagen de contenedor · artefacto de CI · `infrastructure/mosquitto/certs/` · ningún cliente ni módulo |
| `ca.srl` (serial de la CA) | junto a `ca.key` en `$CA_DIR` | `0600` | igual que arriba |

**Por qué.** Quien tiene `ca.key` emite un certificado de servidor válido para
el broker y lo suplanta: todo el TLS de P0-2 pasa a ser decorativo. La CA
**firma desde fuera** del despliegue; `generate-certs.sh` la usa desde `$CA_DIR`
y sólo deposita en el despliegue el material que el broker necesita.

`generate-certs.sh` ya defiende esto en tiempo de ejecución con
`comprobar_ca_key_fuera()`, que aborta si aparece un `ca.key` en `$CERT_DIR`,
y con la guarda que impide que `NEW_CA=1` sobrescriba una CA existente.

## 2. Despliegue (runtime del broker) — material público más la clave del servidor

| Material | Ruta | Propietario | Modo |
|---|---|---|---|
| `ca.crt` | `infrastructure/mosquitto/certs/` | operador | `0644` |
| `server.crt` | `infrastructure/mosquitto/certs/` | operador | `0644` |
| `server.key` | `infrastructure/mosquitto/certs/` | debe poder leerlo el uid del broker | `0600` con propietario `1883`, o `0640` con grupo `1883` |
| `passwd` (hashes de mosquitto_passwd) | `infrastructure/mosquitto/passwd` | ídem | ídem |
| `acl` | `infrastructure/mosquitto/acl` | operador | `0644` — **no contiene secretos**: sólo nombres de usuario y patrones de tópico |

Todo el directorio `infrastructure/mosquitto/certs/` y el fichero `passwd` están
en `.gitignore`, y el escáner falla si alguno aparece rastreado o si esos
patrones desaparecen del `.gitignore`.

`compose.yml` monta los **ficheros TLS uno a uno**, nunca el directorio: montar
la carpeta metería `ca.key` dentro del contenedor si alguien la dejase ahí. El
escáner comprueba también esa forma del montaje.

### Permisos: la regla es «adecuados al proceso», no «restrictivos a ciegas»

El broker abre `acl_file`, `password_file` y `keyfile` **después** de dejar los
privilegios de root y pasar a uid `1883`. Un `0600` propiedad del operador es
ilegible para ese proceso y el contenedor muere con `Exited(13)`:
`Error: Unable to open acl_file`. Es exactamente el defecto **D6**.

De ahí las dos mitades de la regla:

- Lo que **no** es secreto (`acl`, `ca.crt`, `server.crt`) va legible por todos
  (`0644`) y no escribible por grupo/otros.
- Lo que **sí** es secreto (`passwd`, `server.key`) se queda en `0600`/`0640`
  pero **cambia de propietario o de grupo** al uid del broker. Relajar un
  secreto a `0644` para que el broker arranque sería cambiar una caída ruidosa
  por una fuga silenciosa.

## 3. Identidades MQTT (D3)

`infrastructure/mosquitto/identities.json` es la **fuente única**: declara
**quién** existe (`backend`, `healthcheck`, `module-01..09`), nunca **con qué
contraseña**. Los derivados (`acl`, `users.generated.txt`,
`modules.generated.json`, `identities.generated.env.example` y el fixture del
simulador) se regeneran con `generate-identities.mjs` y se verifican con
`--check`; **no se editan a mano**.

Las contraseñas las crea `generate-users.sh` con `mosquitto_passwd` sobre
`passwd`, ignorado por git, y se imprimen **una sola vez** para que el operador
las guarde en su gestor de secretos. La plantilla
`identities.generated.env.example` lleva sólo **nombres** de variable con el
valor marcador `CAMBIAR`.

Lo que impide reintroducir credenciales de laboratorio son tres reglas del
escáner, todas calibradas:

- `D3-CRED-KEY` — un campo `password`/`secret`/`token`… en cualquier artefacto
  de identidad. La lista de artefactos **se descubre** sobre `git ls-files`, no
  está escrita a mano: un fichero de identidad nuevo queda cubierto desde el
  primer commit.
- `D3-PW-HASH` — un hash `$6$`/`$7$` colado en un artefacto de identidad.
- `D3-ENV-VALUE` — la plantilla `.env.example` con un valor real en vez del
  marcador.

## 4. Qué NO cubre esto (decisión del operador)

- **Historial de git.** El escáner mira el árbol rastreado en el commit actual,
  no todos los commits pasados. Auditar el historial y, en su caso, purgarlo es
  una decisión con coste (reescritura de historia pública) que corresponde al
  operador.
- **Rotación.** Que hoy no haya secretos en el repositorio no dice nada sobre
  credenciales que hayan estado expuestas antes en otro canal.
- **El listener 1883 en claro ya NO existe** en esta línea: se retiró de
  `mosquitto.conf`, de `compose.yml` y de `04-firewall.sh` al caer la premisa de
  la decisión D1 (el firmware ya habla `mqtts://…:8883`). Lo que sí sigue en
  claro es el `listener 9001` de WebSockets dentro de la red interna (deuda D4).
  Y una advertencia que no caduca: toda credencial que VIAJÓ por el 1883
  mientras estuvo abierto debe considerarse comprometida ante cualquiera que
  tuviera acceso a la LAN. Cerrar el puerto no rota las credenciales; eso no lo
  arregla ningún escáner.
