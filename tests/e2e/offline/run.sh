#!/usr/bin/env bash
# ============================================================================
# Diana · arnés del carril E2E-2 (offline / recovery).
# ============================================================================
# Levanta un stack EFÍMERO (PostgreSQL, Mosquitto y el backend real), aplica el
# alta mínima de módulos y ejecuta el escenario. Sin `set -e`: cada paso captura
# su `rc` explícitamente y se verifica por su EFECTO, no por que el comando
# dijera que había ocurrido.
#
#   ./tests/e2e/offline/run.sh            → escenario normal (debe quedar VERDE)
#   ./tests/e2e/offline/run.sh --calibrate→ rompe la idempotencia y EXIGE ROJO
#   ./tests/e2e/offline/run.sh --keep     → no derriba el stack al terminar
#
# Se ejecuta SIEMPRE desde la raíz del repositorio (el build del backend
# necesita contracts/ en el contexto).
# ============================================================================
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
HERE="${REPO_ROOT}/tests/e2e/offline"
COMPOSE=(docker compose -f "${HERE}/compose.offline.yml" --project-directory "${REPO_ROOT}")

CALIBRATE=0
KEEP=0
for arg in "$@"; do
  case "$arg" in
    --calibrate) CALIBRATE=1 ;;
    --keep) KEEP=1 ;;
    *) echo "Argumento desconocido: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\n=== %s\n' "$*"; }

cleanup() {
  if [[ "$KEEP" -eq 1 ]]; then
    say "Stack en pie a petición (--keep). Derribar con:"
    echo "  ${COMPOSE[*]} down -v"
    return
  fi
  say "Derribando el stack efímero"
  "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1
}
trap cleanup EXIT

# --------------------------------------------------------------- cabecera HEAD
say "Cabecera"
echo "repo:   $(git -C "$REPO_ROOT" config --get remote.origin.url 2>/dev/null)"
echo "rama:   $(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"
echo "HEAD:   $(git -C "$REPO_ROOT" rev-parse HEAD)"
echo "sucio:  $(git -C "$REPO_ROOT" status --porcelain | wc -l) fichero(s) sin confirmar"

# ------------------------------------------------------------------ stack
say "Levantando PostgreSQL + Mosquitto + backend (imagen real)"
"${COMPOSE[@]}" up -d --build --wait backend
rc=$?
if [[ $rc -ne 0 ]]; then
  echo "FALLO: el stack no llegó a estado saludable (rc=$rc)." >&2
  "${COMPOSE[@]}" ps
  "${COMPOSE[@]}" logs --tail 80 backend migrate
  exit 1
fi

# EFECTO, no rc: el backend responde y dice que ve base de datos y broker.
say "Comprobando el efecto observable del arranque"
for _ in $(seq 1 60); do
  body="$(curl -sf http://127.0.0.1:13000/api/health/ready)"
  if [[ "$body" == *'"database":true'* && "$body" == *'"mqtt":true'* ]]; then break; fi
  sleep 2
done
if [[ "$body" != *'"database":true'* || "$body" != *'"mqtt":true'* ]]; then
  echo "FALLO: /health/ready nunca declaró base de datos y broker listos." >&2
  echo "último cuerpo: ${body:-<vacío>}" >&2
  "${COMPOSE[@]}" logs --tail 100 backend
  exit 1
fi
echo "health/ready: $body"

# ------------------------------------------------------------------- alta
say "Alta mínima de módulos (sin ella la presencia no se persiste)"
"${COMPOSE[@]}" exec -T -e PGPASSWORD=diana_e2e postgres \
  psql -v ON_ERROR_STOP=1 -U diana_e2e -d diana_e2e < "${HERE}/seed.sql"
rc=$?
[[ $rc -ne 0 ]] && { echo "FALLO: el alta de módulos no se aplicó (rc=$rc)." >&2; exit 1; }

# ------------------------------------------------------- mutación (calibración)
if [[ "$CALIBRATE" -eq 1 ]]; then
  say "CALIBRACIÓN · rompiendo la idempotencia"
  echo "ADR-0003 delega la idempotencia en las restricciones de la base de datos"
  echo "(PrismaHitRepository interpreta la violación P2002 como duplicado). Se"
  echo "retiran esas restricciones: el backend deja de deduplicar."
  "${COMPOSE[@]}" exec -T -e PGPASSWORD=diana_e2e postgres psql -v ON_ERROR_STOP=1 -U diana_e2e -d diana_e2e -c \
    'DROP INDEX "public"."hit_events_event_id_key"; DROP INDEX "public"."hit_events_module_slug_device_boot_id_local_sequence_key";'
  rc=$?
  [[ $rc -ne 0 ]] && { echo "FALLO: la mutación no se aplicó (rc=$rc)." >&2; exit 1; }

  # VERIFICACIÓN DE LA MUTACIÓN, antes de medir nada. Un `grep` sobre el estado
  # REAL del esquema, no sobre la intención del comando anterior.
  say "Verificando la mutación (grep sobre el esquema vivo)"
  idx="$("${COMPOSE[@]}" exec -T -e PGPASSWORD=diana_e2e postgres \
        psql -Aqt -U diana_e2e -d diana_e2e -c \
        "SELECT indexname FROM pg_indexes WHERE tablename='hit_events' AND indexdef ILIKE '%UNIQUE%';")"
  echo "índices únicos que quedan: [${idx//$'\n'/, }]"
  if echo "$idx" | grep -q 'hit_events_event_id_key'; then
    echo "FALLO: la mutación NO está en pie; medir ahora sería mentir." >&2
    exit 1
  fi
fi

# ------------------------------------------------------------- dependencias
say "Dependencias del arnés"
if [[ ! -d "${HERE}/node_modules" ]]; then
  (cd "$HERE" && npm install --no-audit --no-fund)
  rc=$?
  [[ $rc -ne 0 ]] && { echo "FALLO: npm install (rc=$rc)." >&2; exit 1; }
fi

# ---------------------------------------------------------------- escenario
say "Ejecutando el escenario"
log="$(mktemp)"
(cd "$HERE" && node --test --test-concurrency=1 offline-recovery.test.mjs) 2>&1 | tee "$log"
scenario_rc="${PIPESTATUS[0]}"   # el rc de la tubería es del `tee`, no del escenario

say "Resultado"
if [[ "$CALIBRATE" -eq 1 ]]; then
  # El escenario se ejecuta EXACTAMENTE IGUAL que en verde: nada le dice que la
  # idempotencia está rota. Lo que se exige es que se ponga ROJO, y por el
  # motivo correcto — no por un fallo cualquiera.
  if [[ $scenario_rc -eq 0 ]]; then
    echo "CALIBRACIÓN FALLIDA: con la idempotencia ROTA el escenario siguió en VERDE." >&2
    echo "No ejerce la propiedad que dice ejercer." >&2
    exit 1
  fi
  if grep -q 'El reenvío duplicó el impacto' "$log"; then
    echo "CALIBRACIÓN OK · rojo (rc=$scenario_rc) y por el motivo esperado:"
    grep -m1 'El reenvío duplicó el impacto' "$log"
    echo "Contraprueba: relanzar sin --calibrate debe volver a verde."
    exit 0
  fi
  echo "CALIBRACIÓN DUDOSA (rc=$scenario_rc): rojo, pero sin la aserción de duplicación." >&2
  echo "Un rojo por otro motivo no demuestra que la propiedad esté medida." >&2
  exit 1
fi

if [[ $scenario_rc -eq 0 ]]; then
  echo "ESCENARIO VERDE (rc=0)."
else
  echo "ESCENARIO ROJO (rc=$scenario_rc)." >&2
fi
exit $scenario_rc
