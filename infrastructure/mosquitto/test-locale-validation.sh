#!/usr/bin/env bash
# ==============================================================================
# Diana · test-locale-validation.sh — prueba de regresión del fallo de colación
# ==============================================================================
# Bajo un locale distinto de C (p. ej. es_ES.UTF-8), el rango [a-z] de una
# expresión regular bash dentro de [[ =~ ]] deja de ser estrictamente ASCII y
# una vocal acentuada (u otro carácter no-ASCII de esa colación) puede colar
# como válida: la regex "parece validar" un module_id inválido. Se detectó en
# revisión, reproducido y corregido con `export LC_ALL=C` al principio de
# set-coordinator.sh y generate-users.sh (comparaciones deterministas con
# independencia del entorno de quien los ejecute).
#
# Esta prueba SÓLO tiene sentido si esta máquina tiene instalado un locale no-C
# con acentos (p. ej. es_ES.UTF-8): bajo C el defecto es invisible, por eso no
# basta con probarlo en el locale por defecto del entorno de CI.
#
# Uso: ./test-locale-validation.sh
# Sale 0 si ambos scripts rechazan el module_id acentuado bajo el locale
# probado (y aceptan uno ASCII válido); sale 1 si alguno lo admite.
# ==============================================================================
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ACCENTED_ID="módulo1"
VALID_ID="sim-locale-test"
CANDIDATE_LOCALES=("es_ES.UTF-8" "es_ES.utf8")

PASS=0
FAIL=0
log_pass() { echo "  [PASS] $1"; PASS=$((PASS + 1)); }
log_fail() { echo "  [FAIL] $1"; FAIL=$((FAIL + 1)); }

TEST_LOCALE=""
for loc in "${CANDIDATE_LOCALES[@]}"; do
  if locale -a 2>/dev/null | grep -qix "${loc/UTF-8/utf8}"; then
    TEST_LOCALE="$loc"
    break
  fi
done

if [[ -z "$TEST_LOCALE" ]]; then
  echo "AVISO: no hay un locale es_ES(.UTF-8|.utf8) instalado en esta máquina;" >&2
  echo "no se puede reproducir el fallo de colación aquí. Instálalo (p. ej." >&2
  echo "'sudo locale-gen es_ES.UTF-8') o ejecuta esta prueba en una máquina que" >&2
  echo "lo tenga. NO se considera una prueba pasada por omisión: se aborta." >&2
  exit 2
fi

echo "Usando locale de prueba: $TEST_LOCALE"

# --- set-coordinator.sh: opera sobre una copia del acl para no tocar el real.
TMP_ACL="$(mktemp)"
cp "${SCRIPT_DIR}/acl" "$TMP_ACL"
TMP_SCRIPT="$(mktemp)"
sed "s#ACL_FILE=\"\${SCRIPT_DIR}/acl\"#ACL_FILE=\"${TMP_ACL}\"#" "${SCRIPT_DIR}/set-coordinator.sh" > "$TMP_SCRIPT"
chmod +x "$TMP_SCRIPT"

echo "=== set-coordinator.sh bajo LC_ALL=$TEST_LOCALE LANG=$TEST_LOCALE ==="
if LC_ALL="$TEST_LOCALE" LANG="$TEST_LOCALE" "$TMP_SCRIPT" "$ACCENTED_ID" >/tmp/locale-test-sc.out 2>&1; then
  log_fail "set-coordinator.sh ACEPTÓ '$ACCENTED_ID' bajo $TEST_LOCALE (debía rechazarlo)"
else
  if grep -qF "$ACCENTED_ID" "$TMP_ACL"; then
    log_fail "set-coordinator.sh dijo error pero SÍ escribió '$ACCENTED_ID' en el acl"
  else
    log_pass "set-coordinator.sh rechazó '$ACCENTED_ID' bajo $TEST_LOCALE y no tocó el acl"
  fi
fi

if LC_ALL="$TEST_LOCALE" LANG="$TEST_LOCALE" "$TMP_SCRIPT" "$VALID_ID" >/tmp/locale-test-sc-valid.out 2>&1; then
  if grep -qF "user ${VALID_ID}" "$TMP_ACL"; then
    log_pass "set-coordinator.sh sigue aceptando un module_id ASCII válido bajo $TEST_LOCALE"
  else
    log_fail "set-coordinator.sh dijo éxito pero no escribió el bloque esperado"
  fi
else
  log_fail "set-coordinator.sh rechazó un module_id ASCII válido ('$VALID_ID') bajo $TEST_LOCALE"
fi

rm -f "$TMP_ACL" "$TMP_SCRIPT"

# --- generate-users.sh: se ejecuta sobre una COPIA en un directorio temporal,
# nunca sobre el propio SCRIPT_DIR (el repositorio): el caso VALID_ID pasa la
# validación y llega a invocar mosquitto_passwd de verdad, que escribiría un
# "passwd" real junto al script si se ejecutara in situ. Aunque ese fichero
# está cubierto por .gitignore, no debe generarse dentro del árbol del repo
# (regla del carril ACL/F-02: ninguna credencial se genera en el árbol).
TMP_GU_DIR="$(mktemp -d)"
cp "${SCRIPT_DIR}/generate-users.sh" "$TMP_GU_DIR/generate-users.sh"
chmod +x "$TMP_GU_DIR/generate-users.sh"

echo "=== generate-users.sh bajo LC_ALL=$TEST_LOCALE LANG=$TEST_LOCALE ==="
OUT="$(LC_ALL="$TEST_LOCALE" LANG="$TEST_LOCALE" "$TMP_GU_DIR/generate-users.sh" "${ACCENTED_ID}" 2>&1)"
RC=$?
if [[ $RC -ne 0 ]] && echo "$OUT" | grep -q "no cumple\|ERROR"; then
  log_pass "generate-users.sh rechazó '${ACCENTED_ID}' bajo $TEST_LOCALE"
else
  log_fail "generate-users.sh NO rechazó '${ACCENTED_ID}' bajo $TEST_LOCALE (salida: $OUT)"
fi

OUT2="$(LC_ALL="$TEST_LOCALE" LANG="$TEST_LOCALE" "$TMP_GU_DIR/generate-users.sh" "${VALID_ID}" 2>&1)"
if echo "$OUT2" | grep -q "no cumple"; then
  log_fail "generate-users.sh rechazó un module_id ASCII válido bajo $TEST_LOCALE (salida: $OUT2)"
else
  log_pass "generate-users.sh sigue aceptando un module_id ASCII válido bajo $TEST_LOCALE (pasó la validación)"
fi

rm -rf "$TMP_GU_DIR"

echo ""
echo "=== Resumen: ${PASS} correctos, ${FAIL} fallos ==="
[[ "$FAIL" -eq 0 ]]
