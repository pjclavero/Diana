#!/usr/bin/env bash
# ==============================================================================
# Diana · E2E MODULES-UI — levanta el escenario en contenedores EFÍMEROS
# ==============================================================================
# PostgreSQL real, Mosquitto real (TLS 8883, `allow_anonymous false`, ACL REAL
# del repositorio), backend real migrado con Prisma y **el panel real servido
# por nginx**, que es lo que este carril añade sobre `tests/e2e/game/harness`.
#
# Este fichero es una ADAPTACIÓN declarada de `tests/e2e/game/harness/up.sh`
# (mismo contrato `env.json`, mismos criterios de espera POR EFECTO). Las
# diferencias, todas a propósito:
#
#   1. **NO se siembra topología.** El escenario empieza con la tabla `modules`
#      VACÍA: el paso 1 comprueba el estado vacío REAL del panel. `up.sh` del
#      carril GAME sí sembraba paneles y módulos.
#   2. **Se añade el panel** (`diana-e2emodui-frontend`), construido en modo
#      `real` y servido por el mismo nginx no privilegiado de producción.
#   3. **En el broker sólo existe el usuario `backend`.** No se crea ninguna
#      credencial de módulo: en este escenario NO hay dispositivos, y no
#      tenerlos en el `passwd` lo hace estructural en vez de una promesa.
#   4. `CORS_ORIGINS` incluye el origen del panel, porque aquí el navegador
#      hace peticiones de origen cruzado de verdad (panel en un puerto,
#      backend en otro).
#
# NO toca producción, ni la VM109, ni ningún fichero fuera de
# tests/e2e/modules-ui/**.
#
# Uso:   ./up.sh          (idempotente: hace down primero)
# Salida: tests/e2e/modules-ui/.tmp/env.json — lo lee la prueba.
# ==============================================================================
set -euo pipefail
export LC_ALL=C

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LANE_DIR="$(cd "${HERE}/.." && pwd)"
REPO_ROOT="$(cd "${LANE_DIR}/../../.." && pwd)"
TMP="${LANE_DIR}/.tmp"

NET=diana-e2emodui-net
PG=diana-e2emodui-postgres
MQ=diana-e2emodui-mosquitto
BE=diana-e2emodui-backend
FE=diana-e2emodui-frontend
BE_IMAGE="${DIANA_E2E_BACKEND_IMAGE:-diana/backend:e2emodules}"
FE_IMAGE="${DIANA_E2E_FRONTEND_IMAGE:-diana/frontend:e2emodules}"

# Puertos de host, altos y propios de este carril para no chocar con el carril
# GAME (15477/18877/13077) ni con nada más.
PG_PORT="${DIANA_E2E_PG_PORT:-15487}"
MQ_PORT="${DIANA_E2E_MQTT_PORT:-18887}"
BE_PORT="${DIANA_E2E_API_PORT:-13087}"
FE_PORT="${DIANA_E2E_WEB_PORT:-18087}"

log() { printf '[up] %s\n' "$*" >&2; }

# ---------------------------------------------------------------- 0. limpieza
"${HERE}/down.sh" >/dev/null 2>&1 || true
rm -rf "${TMP}"
mkdir -p "${TMP}/certs" "${TMP}/mosquitto"
chmod 700 "${TMP}"

# Las imágenes tienen que existir ANTES: construirlas aquí escondería el fallo
# de construcción dentro del arranque del escenario. En particular, un fallo
# del GUARDIÁN de modo productivo del panel («CONFIGURACIÓN PROHIBIDA») tiene
# que verse como lo que es, un error de build, y no como «el panel no levanta».
for img in "${BE_IMAGE}" "${FE_IMAGE}"; do
  if ! docker image inspect "${img}" >/dev/null 2>&1; then
    echo "ERROR: no existe la imagen ${img}." >&2
    echo "  Constrúyelas primero, desde ${REPO_ROOT}:" >&2
    echo "    docker build -f tests/e2e/game/harness/Dockerfile.e2e -t ${BE_IMAGE} ." >&2
    echo "    ${HERE}/build-frontend.sh" >&2
    exit 1
  fi
done

# El panel lleva HORNEADA la URL del backend (Vite sustituye
# `import.meta.env.*` en tiempo de compilación). Si la imagen se construyó
# apuntando a otro puerto, el navegador pediría a un sitio que no existe y la
# prueba fallaría por la razón equivocada. Se comprueba POR EFECTO, grepeando
# el `dist` que hay DENTRO de la imagen efectivamente desplegada.
EXPECTED_API="http://127.0.0.1:${BE_PORT}"
if ! docker run --rm --entrypoint sh "${FE_IMAGE}" -c \
     "grep -Rql -- '${EXPECTED_API}' /usr/share/nginx/html/assets" >/dev/null 2>&1; then
  echo "ERROR: la imagen ${FE_IMAGE} NO tiene horneada la URL ${EXPECTED_API}." >&2
  echo "  Reconstruye el panel: ${HERE}/build-frontend.sh" >&2
  exit 1
fi
log "panel: URL del backend (${EXPECTED_API}) verificada dentro de la imagen"

docker network create "${NET}" >/dev/null
log "red ${NET} creada"

# ------------------------------------------------------- 1. secretos efímeros
# Nunca en argv (ni de un `docker run`, que queda en `docker inspect`): se
# escriben a fichero 0600 y se entregan por --env-file o por montaje.
secret() { head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 24; }

PG_PASSWORD="$(secret)"
JWT_SECRET="$(secret)"
ADMIN_PASSWORD="$(secret)"
MQTT_BACKEND_PASSWORD="$(secret)"
# Contraseña del usuario de MENOR privilegio que usa el paso 9 (permisos).
# 12 caracteres mínimo (CreateUserDto), aquí 24.
VIEWER_PASSWORD="$(secret)"

# --------------------------------------------------------------- 2. TLS (CA)
log "generando material TLS efímero"
openssl req -x509 -newkey rsa:2048 -nodes -days 2 \
  -keyout "${TMP}/certs/ca.key" -out "${TMP}/certs/ca.crt" \
  -subj "/C=ES/O=Diana E2E/CN=Diana E2E CA" >/dev/null 2>&1
openssl req -newkey rsa:2048 -nodes \
  -keyout "${TMP}/certs/server.key" -out "${TMP}/certs/server.csr" \
  -subj "/C=ES/O=Diana E2E/CN=mosquitto" >/dev/null 2>&1
printf 'subjectAltName = DNS:mosquitto,DNS:%s,DNS:localhost,IP:127.0.0.1\n' "${MQ}" \
  > "${TMP}/certs/san.ext"
openssl x509 -req -in "${TMP}/certs/server.csr" -days 2 \
  -CA "${TMP}/certs/ca.crt" -CAkey "${TMP}/certs/ca.key" -CAcreateserial \
  -extfile "${TMP}/certs/san.ext" -out "${TMP}/certs/server.crt" >/dev/null 2>&1
chmod 644 "${TMP}/certs/ca.crt" "${TMP}/certs/server.crt"
chmod 600 "${TMP}/certs/ca.key"
# La clave del SERVIDOR sí se monta y mosquitto corre dentro como uid 1883: con
# 0600 no puede leerla. Es material EFÍMERO de dos días bajo .tmp/ que borra
# `down.sh`. Mismo razonamiento (y misma decisión) que el carril GAME.
chmod 644 "${TMP}/certs/server.key"

# ----------------------------------------------- 3. usuarios y ACL del broker
# SÓLO `backend`. Este escenario no tiene dispositivos: que el broker no
# conozca a ningún módulo es parte de lo que se está comprobando.
cat > "${TMP}/mosquitto/passwd" <<EOF
backend:${MQTT_BACKEND_PASSWORD}
EOF
chmod 600 "${TMP}/mosquitto/passwd"
docker run --rm -v "${TMP}/mosquitto:/w" eclipse-mosquitto:2.0.18 \
  mosquitto_passwd -U /w/passwd
chmod 644 "${TMP}/mosquitto/passwd"
if grep -qF "backend:${MQTT_BACKEND_PASSWORD}" "${TMP}/mosquitto/passwd"; then
  echo "ERROR: mosquitto_passwd no cifró el fichero; hay claves en claro." >&2
  exit 1
fi
log "usuario MQTT cifrado (sólo backend: no hay dispositivos en este escenario)"

ACL_FILE="${REPO_ROOT}/infrastructure/mosquitto/acl"
[[ -f "${ACL_FILE}" ]] || { echo "ERROR: no existe ${ACL_FILE}" >&2; exit 1; }

# ---------------------------------------------------------------- 4. Postgres
printf 'POSTGRES_DB=diana_e2e\nPOSTGRES_USER=diana_e2e\nPOSTGRES_PASSWORD=%s\n' \
  "${PG_PASSWORD}" > "${TMP}/postgres.env"
chmod 600 "${TMP}/postgres.env"
docker run -d --name "${PG}" --network "${NET}" --network-alias postgres \
  --env-file "${TMP}/postgres.env" \
  -p "127.0.0.1:${PG_PORT}:5432" \
  --tmpfs /var/lib/postgresql/data \
  postgres:16.4-alpine >/dev/null
log "postgres arrancando (host 127.0.0.1:${PG_PORT})"

# --------------------------------------------------------------- 5. Mosquitto
docker run -d --name "${MQ}" --network "${NET}" --network-alias mosquitto \
  -p "127.0.0.1:${MQ_PORT}:8883" \
  -v "${HERE}/mosquitto.conf:/mosquitto/config/mosquitto.conf:ro" \
  -v "${TMP}/mosquitto/passwd:/mosquitto/config/passwd:ro" \
  -v "${ACL_FILE}:/mosquitto/config/acl:ro" \
  -v "${TMP}/certs/ca.crt:/mosquitto/certs/ca.crt:ro" \
  -v "${TMP}/certs/server.crt:/mosquitto/certs/server.crt:ro" \
  -v "${TMP}/certs/server.key:/mosquitto/certs/server.key:ro" \
  eclipse-mosquitto:2.0.18 >/dev/null
log "mosquitto arrancando (TLS, host 127.0.0.1:${MQ_PORT})"

for i in $(seq 1 60); do
  if docker exec "${PG}" pg_isready -U diana_e2e -d diana_e2e >/dev/null 2>&1; then break; fi
  [[ $i -eq 60 ]] && { echo "ERROR: postgres no llegó a estar listo." >&2; docker logs "${PG}" | tail -30 >&2; exit 1; }
  sleep 1
done
log "postgres listo"

# Mosquitto POR EFECTO: handshake TLS real contra el 8883 validando la CA.
for i in $(seq 1 30); do
  state="$(docker inspect -f '{{.State.Status}}' "${MQ}")"
  if [[ "${state}" != "running" ]]; then
    echo "ERROR: mosquitto salió (${state}). Log:" >&2; docker logs "${MQ}" | tail -30 >&2; exit 1
  fi
  if openssl s_client -connect "127.0.0.1:${MQ_PORT}" -servername localhost \
       -CAfile "${TMP}/certs/ca.crt" -verify_return_error </dev/null >/dev/null 2>&1; then
    break
  fi
  [[ $i -eq 30 ]] && { echo "ERROR: el 8883 de mosquitto no completa el handshake TLS." >&2; docker logs "${MQ}" | tail -30 >&2; exit 1; }
  sleep 1
done
log "mosquitto listo"

# ------------------------------------------------- 6. migraciones y semillas
DATABASE_URL="postgresql://diana_e2e:${PG_PASSWORD}@postgres:5432/diana_e2e?schema=public"
printf 'DATABASE_URL=%s\n' "${DATABASE_URL}" > "${TMP}/db.env"
chmod 600 "${TMP}/db.env"

log "aplicando migraciones Prisma (imagen real del backend)"
docker run --rm --network "${NET}" --env-file "${TMP}/db.env" \
  "${BE_IMAGE}" npx prisma migrate deploy >/dev/null

log "semilla de REFERENCIA (roles y modos de juego reales) — y NADA más"
docker run --rm --network "${NET}" --env-file "${TMP}/db.env" \
  "${BE_IMAGE}" node dist/scripts/seed-reference.js >/dev/null

# Verificación explícita del punto de partida: CERO módulos. Si algo los
# sembrara, el paso 1 («estado vacío real») dejaría de medir lo que dice medir
# y hay que enterarse aquí, no dentro de una aserción del navegador.
rc=0
COUNT="$(docker exec "${PG}" psql -qtAX -U diana_e2e -d diana_e2e \
  -c 'select count(*) from modules;')" || rc=$?
[[ ${rc} -eq 0 ]] || { echo "ERROR: no se pudo consultar la tabla modules (rc=${rc})." >&2; exit 1; }
if [[ "${COUNT// /}" != "0" ]]; then
  echo "ERROR: el escenario debe empezar con 0 módulos y hay ${COUNT}." >&2
  exit 1
fi
log "punto de partida verificado en la BD: 0 módulos"

# ------------------------------------------------------------------ 7. backend
# NODE_ENV=production a propósito: es el único modo en que el backend EXIGE TLS
# contra el broker y un JWT_SECRET explícito.
cat > "${TMP}/backend.env" <<EOF
NODE_ENV=production
PORT=3000
DATABASE_URL=${DATABASE_URL}
MQTT_URL=mqtts://mosquitto:8883
MQTT_CA_FILE=/app/certs/mqtt-ca.crt
MQTT_USERNAME=backend
MQTT_PASSWORD=${MQTT_BACKEND_PASSWORD}
JWT_SECRET=${JWT_SECRET}
CORS_ORIGINS=http://127.0.0.1:${FE_PORT},http://localhost:${FE_PORT}
DIANA_ADMIN_USERNAME=admin
DIANA_ADMIN_PASSWORD=${ADMIN_PASSWORD}
LOG_LEVEL=debug
TZ=UTC
EOF
chmod 600 "${TMP}/backend.env"

# `--restart` NO: el paso 4 del escenario reinicia este contenedor a mano
# (`docker restart`) para comprobar que los datos sobreviven al proceso.
docker run -d --name "${BE}" --network "${NET}" --network-alias backend \
  --env-file "${TMP}/backend.env" \
  -p "127.0.0.1:${BE_PORT}:3000" \
  -v "${TMP}/certs/ca.crt:/app/certs/mqtt-ca.crt:ro" \
  "${BE_IMAGE}" >/dev/null
log "backend arrancando (host 127.0.0.1:${BE_PORT})"

for i in $(seq 1 90); do
  state="$(docker inspect -f '{{.State.Status}}' "${BE}")"
  if [[ "${state}" != "running" ]]; then
    echo "ERROR: el backend salió (${state}). Log:" >&2; docker logs "${BE}" | tail -40 >&2; exit 1
  fi
  if curl -fsS "http://127.0.0.1:${BE_PORT}/api/health" >/dev/null 2>&1; then break; fi
  [[ $i -eq 90 ]] && { echo "ERROR: el backend no respondió en /api/health." >&2; docker logs "${BE}" | tail -40 >&2; exit 1; }
  sleep 1
done
log "backend listo"

# ------------------------------------- 7a. primer acceso del administrador
# La cuenta inicial nace con `must_change_password = true` (auth.service.ts), y
# el panel la desvía a la pantalla de cambio de contraseña ANTES de cualquier
# ruta. Eso es producto real, no un estorbo: se atraviesa como lo atravesaría
# un operador, por la API de verdad, y el escenario arranca con una sesión
# normal. La contraseña definitiva es la que va al `env.json`.
#
# `curl -X POST` con cuerpo desde fichero 0600; ningún secreto en argv.
api_login() { # $1 usuario, $2 contraseña -> token por stdout
  printf '{"username":"%s","password":"%s"}' "$1" "$2" > "${TMP}/req.json"
  chmod 600 "${TMP}/req.json"
  local out rc=0
  out="$(curl -fsS -X POST "http://127.0.0.1:${BE_PORT}/api/auth/login" \
    -H 'Content-Type: application/json' --data-binary "@${TMP}/req.json")" || rc=$?
  rm -f "${TMP}/req.json"
  [[ ${rc} -eq 0 ]] || return ${rc}
  printf '%s' "${out}" | sed -n 's/.*"access_token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'
}

api_change_password() { # $1 token, $2 actual, $3 nueva
  printf 'header = "Authorization: Bearer %s"\n' "$1" > "${TMP}/curlrc"
  printf '{"current_password":"%s","new_password":"%s"}' "$2" "$3" > "${TMP}/req.json"
  chmod 600 "${TMP}/curlrc" "${TMP}/req.json"
  local rc=0
  curl -fsS --config "${TMP}/curlrc" -X POST \
    "http://127.0.0.1:${BE_PORT}/api/auth/change-password" \
    -H 'Content-Type: application/json' --data-binary "@${TMP}/req.json" >/dev/null || rc=$?
  rm -f "${TMP}/curlrc" "${TMP}/req.json"
  return ${rc}
}

ADMIN_INITIAL_PASSWORD="${ADMIN_PASSWORD}"
ADMIN_PASSWORD="$(secret)$(secret)"   # 48 caracteres, muy por encima del mínimo
rc=0
TOKEN="$(api_login admin "${ADMIN_INITIAL_PASSWORD}")" || rc=$?
[[ ${rc} -eq 0 && -n "${TOKEN}" ]] || { echo "ERROR: el admin no pudo iniciar sesión (rc=${rc})." >&2; exit 1; }
api_change_password "${TOKEN}" "${ADMIN_INITIAL_PASSWORD}" "${ADMIN_PASSWORD}" \
  || { echo "ERROR: el admin no pudo completar el primer acceso." >&2; exit 1; }
unset ADMIN_INITIAL_PASSWORD
ADMIN_TOKEN="$(api_login admin "${ADMIN_PASSWORD}")"
[[ -n "${ADMIN_TOKEN}" ]] || { echo "ERROR: la contraseña nueva del admin no vale." >&2; exit 1; }
log "primer acceso del administrador completado (must_change_password resuelto)"

# --------------------------------------- 7b. usuario de MENOR privilegio (§9)
# Rol `consulta`: sólo lecturas (READ_ONLY de domain/rbac/permissions.ts). NO
# tiene `modules:write` ni `provisioning:issue`/`provisioning:read` — que, como
# dice el encargo, no los tiene NINGÚN rol salvo el `*` del administrador.
# Se crea AQUÍ, por API real y con el admin real, para que la prueba de
# permisos no tenga que fabricar nada.
VIEWER_INITIAL_PASSWORD="${VIEWER_PASSWORD}"
printf '{"username":"consulta_e2e","password":"%s","role":"consulta"}' "${VIEWER_INITIAL_PASSWORD}" \
  > "${TMP}/req.json"
printf 'header = "Authorization: Bearer %s"\n' "${ADMIN_TOKEN}" > "${TMP}/curlrc"
chmod 600 "${TMP}/req.json" "${TMP}/curlrc"
rc=0
curl -fsS --config "${TMP}/curlrc" -X POST "http://127.0.0.1:${BE_PORT}/api/users" \
  -H 'Content-Type: application/json' --data-binary "@${TMP}/req.json" >/dev/null || rc=$?
rm -f "${TMP}/req.json" "${TMP}/curlrc"
[[ ${rc} -eq 0 ]] || { echo "ERROR: no se pudo crear el usuario de consulta (rc=${rc})." >&2; exit 1; }

# También nace con `must_change_password`: se atraviesa igual que el admin,
# para que el paso de permisos mida el permiso y no una pantalla intermedia.
VIEWER_PASSWORD="$(secret)$(secret)"
TOKEN="$(api_login consulta_e2e "${VIEWER_INITIAL_PASSWORD}")"
[[ -n "${TOKEN}" ]] || { echo "ERROR: consulta_e2e no pudo iniciar sesión." >&2; exit 1; }
api_change_password "${TOKEN}" "${VIEWER_INITIAL_PASSWORD}" "${VIEWER_PASSWORD}" \
  || { echo "ERROR: consulta_e2e no pudo completar el primer acceso." >&2; exit 1; }
unset VIEWER_INITIAL_PASSWORD TOKEN ADMIN_TOKEN
log "usuario de menor privilegio creado (consulta_e2e, rol consulta)"

# ------------------------------------------------------------------ 8. panel
docker run -d --name "${FE}" --network "${NET}" --network-alias frontend \
  -p "127.0.0.1:${FE_PORT}:8080" \
  "${FE_IMAGE}" >/dev/null
log "panel arrancando (host 127.0.0.1:${FE_PORT})"

for i in $(seq 1 60); do
  state="$(docker inspect -f '{{.State.Status}}' "${FE}")"
  if [[ "${state}" != "running" ]]; then
    echo "ERROR: el panel salió (${state}). Log:" >&2; docker logs "${FE}" | tail -40 >&2; exit 1
  fi
  if curl -fsS "http://127.0.0.1:${FE_PORT}/" >/dev/null 2>&1; then break; fi
  [[ $i -eq 60 ]] && { echo "ERROR: el panel no sirvió su index." >&2; docker logs "${FE}" | tail -40 >&2; exit 1; }
  sleep 1
done
log "panel listo"

# --------------------------------------------------------------- 9. contrato
cat > "${TMP}/env.json" <<EOF
{
  "webBaseUrl": "http://127.0.0.1:${FE_PORT}",
  "apiBaseUrl": "http://127.0.0.1:${BE_PORT}",
  "mqttUrl": "mqtts://127.0.0.1:${MQ_PORT}",
  "mqttCaFile": "${TMP}/certs/ca.crt",
  "adminUsername": "admin",
  "adminPassword": "${ADMIN_PASSWORD}",
  "viewerUsername": "consulta_e2e",
  "viewerPassword": "${VIEWER_PASSWORD}",
  "postgres": {
    "container": "${PG}",
    "user": "diana_e2e",
    "database": "diana_e2e",
    "hostPort": ${PG_PORT}
  },
  "containers": {
    "postgres": "${PG}",
    "mosquitto": "${MQ}",
    "backend": "${BE}",
    "frontend": "${FE}"
  }
}
EOF
chmod 600 "${TMP}/env.json"
log "escenario en pie · contrato en ${TMP}/env.json"
