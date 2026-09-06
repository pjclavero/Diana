#!/usr/bin/env bash
# ==============================================================================
# Diana · E2E-1 GAME — levanta el escenario en contenedores EFÍMEROS
# ==============================================================================
# PostgreSQL real, Mosquitto real (con TLS, autenticación y la ACL REAL del
# repo) y el backend real construido desde server/backend/Dockerfile. Ni un
# mock del dominio.
#
# NO toca producción, ni la VM109, ni ningún fichero fuera de tests/e2e/game/**:
# los certificados, el `passwd` y las contraseñas se generan bajo
# tests/e2e/game/.tmp/ y mueren con `down.sh`. En particular NO ejecuta
# infrastructure/mosquitto/set-coordinator.sh (ver README.md, decisión D6):
# publicar un `hit` como module-01 ya está autorizado de serie por la ACL.
#
# Uso:   ./up.sh          (idempotente: hace down primero)
# Salida: tests/e2e/game/.tmp/env.json — lo lee la prueba.
# ==============================================================================
set -euo pipefail
export LC_ALL=C

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GAME_DIR="$(cd "${HERE}/.." && pwd)"
REPO_ROOT="$(cd "${GAME_DIR}/../../.." && pwd)"
TMP="${GAME_DIR}/.tmp"

NET=diana-e2egame-net
PG=diana-e2egame-postgres
MQ=diana-e2egame-mosquitto
BE=diana-e2egame-backend
IMAGE="${DIANA_E2E_BACKEND_IMAGE:-diana/backend:e2egame}"

# Puertos de host, altos y propios de este carril para no chocar con nada.
PG_PORT="${DIANA_E2E_PG_PORT:-15477}"
MQ_PORT="${DIANA_E2E_MQTT_PORT:-18877}"
BE_PORT="${DIANA_E2E_API_PORT:-13077}"

log() { printf '[up] %s\n' "$*" >&2; }

# ---------------------------------------------------------------- 0. limpieza
"${HERE}/down.sh" >/dev/null 2>&1 || true
rm -rf "${TMP}"
mkdir -p "${TMP}/certs" "${TMP}/mosquitto"
chmod 700 "${TMP}"

# La imagen tiene que existir ANTES: construirla aquí escondería el fallo de
# construcción dentro del arranque del escenario.
if ! docker image inspect "${IMAGE}" >/dev/null 2>&1; then
  echo "ERROR: no existe la imagen ${IMAGE}." >&2
  echo "  Constrúyela primero, desde ${REPO_ROOT}:" >&2
  echo "    docker build -f tests/e2e/game/harness/Dockerfile.e2e -t ${IMAGE} ." >&2
  echo "  (Dockerfile.e2e = server/backend/Dockerfile con UNA diferencia" >&2
  echo "   documentada en su cabecera; ver también el README de este carril.)" >&2
  exit 1
fi

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
MQTT_MODULE01_PASSWORD="$(secret)"
MQTT_MODULE02_PASSWORD="$(secret)"
MQTT_MODULE09_PASSWORD="$(secret)"

# --------------------------------------------------------------- 2. TLS (CA)
# CA propia + certificado de servidor con `mosquitto` y `localhost` en el SAN:
# el backend valida al broker por su nombre de red, la prueba lo valida por
# localhost. Mismo material, dos vistas.
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
# La clave de la CA no sale de aquí: 0600 y nadie la monta en ningún contenedor.
chmod 600 "${TMP}/certs/ca.key"
# La clave del SERVIDOR sí se monta, y mosquitto corre dentro como uid 1883
# mientras el fichero es del uid del host: con 0600 el broker no puede leerla y
# muere con «Unable to load server key file». Es una clave EFÍMERA de dos días,
# de una CA de usar y tirar, que sólo existe bajo tests/e2e/game/.tmp/ y que
# `down.sh` borra. No confundir con el material de infrastructure/mosquitto.
chmod 644 "${TMP}/certs/server.key"

# ----------------------------------------------- 3. usuarios y ACL del broker
# `mosquitto_passwd -U` cifra en el sitio un fichero de líneas usuario:clave,
# de modo que ninguna contraseña pasa por la línea de comandos.
cat > "${TMP}/mosquitto/passwd" <<EOF
backend:${MQTT_BACKEND_PASSWORD}
module-01:${MQTT_MODULE01_PASSWORD}
module-02:${MQTT_MODULE02_PASSWORD}
module-09:${MQTT_MODULE09_PASSWORD}
EOF
chmod 600 "${TMP}/mosquitto/passwd"
docker run --rm -v "${TMP}/mosquitto:/w" eclipse-mosquitto:2.0.18 \
  mosquitto_passwd -U /w/passwd
# mosquitto exige que el fichero de contraseñas sea legible por su usuario.
chmod 644 "${TMP}/mosquitto/passwd"
if grep -qF "module-01:${MQTT_MODULE01_PASSWORD}" "${TMP}/mosquitto/passwd"; then
  echo "ERROR: mosquitto_passwd no cifró el fichero; hay claves en claro." >&2
  exit 1
fi
log "usuarios MQTT cifrados (backend, module-01, module-02, module-09)"

# La ACL es la REAL del repositorio, montada tal cual y en SOLO LECTURA. Si
# alguien le quitase a module-01 el permiso de escritura sobre su `hit`, esta
# prueba se pondría roja — que es exactamente lo que debe pasar.
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

# Esperar a Postgres por su EFECTO (acepta consultas), no por un `sleep`.
for i in $(seq 1 60); do
  if docker exec "${PG}" pg_isready -U diana_e2e -d diana_e2e >/dev/null 2>&1; then break; fi
  [[ $i -eq 60 ]] && { echo "ERROR: postgres no llegó a estar listo." >&2; docker logs "${PG}" | tail -30 >&2; exit 1; }
  sleep 1
done
log "postgres listo"

# Y a Mosquitto por el suyo: que siga en pie y con el listener TLS abierto. Un
# fallo de ACL o de certificados lo mata al arrancar (Exited).
for i in $(seq 1 30); do
  state="$(docker inspect -f '{{.State.Status}}' "${MQ}")"
  if [[ "${state}" != "running" ]]; then
    echo "ERROR: mosquitto salió (${state}). Log:" >&2; docker logs "${MQ}" | tail -30 >&2; exit 1
  fi
  # Por EFECTO, no por el log: se completa un handshake TLS real contra el
  # 8883 validando la CA. Eso prueba a la vez que el listener está abierto y
  # que el material TLS sirve. (El log de mosquitto no anuncia el listener con
  # `log_type notice`, así que grepearlo daría un falso «no está listo».)
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
  "${IMAGE}" npx prisma migrate deploy >/dev/null

log "semilla de referencia (roles y modos de juego reales)"
docker run --rm --network "${NET}" --env-file "${TMP}/db.env" \
  "${IMAGE}" node dist/scripts/seed-reference.js >/dev/null

log "topología del escenario (paneles y módulos)"
docker run --rm --network "${NET}" --env-file "${TMP}/db.env" \
  -v "${HERE}/seed-fixture.js:/app/seed-fixture.js:ro" \
  "${IMAGE}" node /app/seed-fixture.js >/dev/null

# ------------------------------------------------------------------ 7. backend
# NODE_ENV=production a propósito: es el único modo en que el backend EXIGE
# TLS contra el broker (mqtt.service.ts) y un JWT_SECRET explícito. Probar en
# `development` sería probar otro producto.
cat > "${TMP}/backend.env" <<EOF
NODE_ENV=production
PORT=3000
DATABASE_URL=${DATABASE_URL}
MQTT_URL=mqtts://mosquitto:8883
MQTT_CA_FILE=/app/certs/mqtt-ca.crt
MQTT_USERNAME=backend
MQTT_PASSWORD=${MQTT_BACKEND_PASSWORD}
JWT_SECRET=${JWT_SECRET}
CORS_ORIGINS=http://localhost:${BE_PORT}
DIANA_ADMIN_USERNAME=admin
DIANA_ADMIN_PASSWORD=${ADMIN_PASSWORD}
LOG_LEVEL=debug
TZ=UTC
EOF
chmod 600 "${TMP}/backend.env"

docker run -d --name "${BE}" --network "${NET}" --network-alias backend \
  --env-file "${TMP}/backend.env" \
  -p "127.0.0.1:${BE_PORT}:3000" \
  -v "${TMP}/certs/ca.crt:/app/certs/mqtt-ca.crt:ro" \
  "${IMAGE}" >/dev/null
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

# El backend debe estar CONECTADO al broker, no sólo vivo: si no lo está, el
# `start` de la ronda no se entregaría y el escenario mediría otra cosa.
for i in $(seq 1 30); do
  if docker logs "${BE}" 2>&1 | grep -qi "Conectado a mqtts://\|Conexión MQTT establecida\|MQTT conectado"; then break; fi
  [[ $i -eq 30 ]] && { log "AVISO: no se ha visto en el log la conexión MQTT; la prueba lo comprobará por efecto."; break; }
  sleep 1
done
log "backend listo"

# --------------------------------------------------------------- 8. contrato
cat > "${TMP}/env.json" <<EOF
{
  "apiBaseUrl": "http://127.0.0.1:${BE_PORT}",
  "mqttUrl": "mqtts://127.0.0.1:${MQ_PORT}",
  "mqttCaFile": "${TMP}/certs/ca.crt",
  "adminUsername": "admin",
  "adminPassword": "${ADMIN_PASSWORD}",
  "modules": {
    "module-01": "${MQTT_MODULE01_PASSWORD}",
    "module-02": "${MQTT_MODULE02_PASSWORD}",
    "module-09": "${MQTT_MODULE09_PASSWORD}"
  },
  "postgres": {
    "container": "${PG}",
    "user": "diana_e2e",
    "database": "diana_e2e",
    "hostPort": ${PG_PORT}
  },
  "containers": { "postgres": "${PG}", "mosquitto": "${MQ}", "backend": "${BE}" }
}
EOF
chmod 600 "${TMP}/env.json"
log "escenario en pie · contrato en ${TMP}/env.json"
