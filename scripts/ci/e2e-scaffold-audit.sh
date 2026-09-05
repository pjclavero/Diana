#!/usr/bin/env bash
# Auditoria de honestidad del andamiaje E2E.
#
# El job de E2E del stack se llamo durante un tiempo "16 escenarios" y su paso
# "Ejecutar los 16 escenarios", cuando los 16 eran `test.fixme`: levantaba
# Postgres, Mosquitto, backend, worker y simulador, ejecutaba CERO aserciones y
# salia verde. Este script existe para que el NOMBRE del job no pueda volver a
# desviarse de lo que la suite hace de verdad.
#
# Cuenta, sobre el fuente y sin comentarios, cuantos escenarios son andamiaje
# (`test.fixme`) y cuantos son ejecutables (`test(`, `test.only`, `test.skip`).
#
# Salida:
#   rc=0  si TODOS los escenarios siguen siendo andamiaje (estado esperado hoy)
#   rc=1  si ya hay escenarios ejecutables -> el job debe dejar de llamarse
#         "scaffold" y pasar a reportar cobertura real
#   rc=2  error de uso / fichero ausente
#
# Uso: scripts/ci/e2e-scaffold-audit.sh [ruta-al-spec]

set -uo pipefail

SPEC="${1:-tests/e2e/scenarios.spec.ts}"

if [[ ! -f "$SPEC" ]]; then
  echo "E2E AUDIT: no existe el fichero de escenarios '$SPEC'" >&2
  exit 2
fi

# Se despoja el fuente de comentarios de bloque y de linea ANTES de contar, para
# que un `test(` citado en la prosa de una cabecera no se cuente como escenario.
STRIPPED="$(
  sed -e ':a' -e 'N' -e '$!ba' -e 's://[^\n]*::g' "$SPEC" \
  | perl -0777 -pe 's{/\*.*?\*/}{}gs' 2>/dev/null || sed -e 's://.*::' "$SPEC"
)"

count() { printf '%s\n' "$STRIPPED" | grep -cE "$1" || true; }

FIXME=$(count '(^|[^A-Za-z0-9_.])test\.fixme\s*\(')
ONLY=$(count   '(^|[^A-Za-z0-9_.])test\.only\s*\(')
SKIP=$(count   '(^|[^A-Za-z0-9_.])test\.skip\s*\(')
PLAIN=$(count  '(^|[^A-Za-z0-9_.])test\s*\(')

RUNNABLE=$(( PLAIN + ONLY ))
TOTAL=$(( FIXME + SKIP + RUNNABLE ))

echo "--- Auditoria del andamiaje E2E ($SPEC) ---"
echo "  escenarios declarados          : $TOTAL"
echo "  andamiaje (test.fixme)         : $FIXME"
echo "  desactivados (test.skip)       : $SKIP"
echo "  EJECUTABLES (test / test.only) : $RUNNABLE"

if (( RUNNABLE > 0 )); then
  echo
  echo "E2E AUDIT: hay $RUNNABLE escenario(s) EJECUTABLE(s)."
  echo "El job ya no es solo andamiaje: renombralo y reporta la cobertura real"
  echo "en .github/workflows/e2e.yml en vez de anunciarlo como 'scaffold'."
  exit 1
fi

# El NUMERO tambien forma parte de la afirmacion. El nombre del job dice
# "16 test.fixme"; si alguien anade un decimoseptimo, el nombre pasa a mentir
# y hasta ahora nada lo habria detectado, porque solo se comprobaba
# RUNNABLE == 0. Una cifra publicada que nadie verifica es una cifra falsa
# esperando su turno.
DECLARADOS=${E2E_EXPECTED_FIXME:-16}
if (( FIXME != DECLARADOS )); then
  echo
  echo "E2E AUDIT: hay $FIXME test.fixme, pero el job anuncia $DECLARADOS."
  echo "Actualiza el nombre del job en .github/workflows/e2e.yml y la variable"
  echo "E2E_EXPECTED_FIXME, o corrige el recuento. El nombre debe ser cierto."
  exit 1
fi

echo
echo "E2E AUDIT: los $TOTAL escenarios son ANDAMIAJE. Se ejecutan 0 aserciones."
echo "El job se anuncia como 'scaffold' con $FIXME: nombre y hechos coinciden."
exit 0
