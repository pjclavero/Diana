#!/usr/bin/env bash
# Calibracion del carril FW-PROVISION. NO forma parte de `make test`: es el
# utillaje que demuestra que las pruebas saben ponerse ROJAS.
#
# Cada mutante: se aplica, se VERIFICA CON GREP que ha entrado en el fichero
# (una mutacion que no entra no calibra nada), se ejecuta la comprobacion que
# deberia cazarla, se registra el rc REAL y se revierte con git checkout.
set -u +e
cd "$(dirname "${BASH_SOURCE[0]}")/../../.."
REPO="$PWD"

pass=0; fail=0

mutate() {
  local name="$1" file="$2" before="$3" after="$4" cmd="$5" grep_after="$6"
  printf '\n=== MUTANTE %s ===\n' "$name"
  python3 - "$REPO/$file" "$before" "$after" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1]); s = p.read_text()
if sys.argv[2] not in s:
    print("NO_APLICA: no se encuentra el texto original"); sys.exit(2)
p.write_text(s.replace(sys.argv[2], sys.argv[3], 1))
PY
  if [ $? -ne 0 ]; then echo "  MUTANTE NO APLICADO"; fail=$((fail+1)); return; fi

  if grep -qF "$grep_after" "$REPO/$file"; then
    echo "  mutacion VERIFICADA en $file"
  else
    echo "  MUTACION NO ENTRO en $file -- no calibra nada"
    git -C "$REPO" checkout -- "$file"; fail=$((fail+1)); return
  fi

  eval "$cmd" >/tmp/mut.log 2>&1; rc=$?
  echo "  rc=$rc  ($(grep -cE '  FALLO' /tmp/mut.log) lineas FALLO)"
  if [ "$rc" -ne 0 ]; then
    echo "  RESULTADO: ROJO -- la prueba caza el mutante"; pass=$((pass+1))
  else
    echo "  RESULTADO: VERDE -- HUECO DE COBERTURA"; fail=$((fail+1))
  fi
  git -C "$REPO" checkout -- "$file"
}

TEST='make -C firmware test'
BRIDGE='python3 firmware/esp32/tools/check_prov_bridge.py'

# M1 · routing por subcadena: el defecto original, en el propio enrutador.
mutate "M1 strstr en el enrutador" \
  "firmware/esp32/components/diana_core/src/topic_route.c" \
  'if (strcmp(tail, TABLE[i].tail) != 0) continue;' \
  'if (strstr(tail, TABLE[i].tail) == NULL) continue;' \
  "$TEST" 'strstr(tail, TABLE[i].tail)'

# M2 · se retira la suscripcion: el hueco de transporte vuelve.
mutate "M2 sin suscripcion a provision" \
  "firmware/esp32/components/diana_platform_esp/src/mqtt_client.c" \
  '"command", "config/desired", "ota", "provision",' \
  '"command", "config/desired", "ota",' \
  "$BRIDGE" '"command", "config/desired", "ota",'

# M3 · el despachador vuelve a strstr.
mutate "M3 strstr en el despachador" \
  "firmware/esp32/main/app_commands.c" \
  'if (kind == DIANA_ROUTE_MODULE_OTA) {' \
  'if (strstr(rx->topic, "/ota")) {' \
  "$BRIDGE" 'strstr(rx->topic, "/ota")'

# M4 · el estado deja de publicarse (el hueco de salida vuelve).
mutate "M4 out.publish descartado" \
  "firmware/esp32/main/app_provision.c" \
  '    diana_publish_provision_state(a, &cmd, &out);' \
  '    (void)out.publish;' \
  "$BRIDGE" '(void)out.publish;'

# M5 · retain literal en vez de la tabla del contrato.
mutate "M5 retain literal false" \
  "firmware/esp32/main/app_provision.c" \
  '.retain = diana_topic_retain(DIANA_TOPIC_PROVISION_STATE),' \
  '.retain = false,' \
  "$BRIDGE" '.retain = false,'

# M6 · el contrato cambia retain: el estado deja de retenerse.
mutate "M6 provision/state sin retain" \
  "firmware/esp32/components/diana_core/src/messages.c" \
  '    true,  /* provision/state */' \
  '    false, /* provision/state */' \
  "$TEST" 'false, /* provision/state */'

# M7 · la ORDEN pasa a retenerse: el replay servido por el broker.
mutate "M7 la ORDEN se retiene" \
  "firmware/esp32/components/diana_core/src/messages.c" \
  '    false, /* provision (comando) */' \
  '    true,  /* provision (comando) */' \
  "$TEST" 'true,  /* provision (comando) */'

# M8 · SECRETO en el estado publicado: el control positivo de verdad, sobre el
# serializador REAL y no sobre un payload de laboratorio.
mutate "M8 root_key en el estado publicado" \
  "firmware/esp32/components/diana_core/src/provisioning.c" \
  '    diana_json_str(&j, "provisioning_key_fingerprint",' \
  '    diana_json_str(&j, "root_key", ctx->st.provisioning_key_fingerprint);
    diana_json_str(&j, "provisioning_key_fingerprint",' \
  "$TEST" 'diana_json_str(&j, "root_key"'

printf '\n=================================================\n'
printf ' CALIBRACION: %d mutantes cazados, %d huecos\n' "$pass" "$fail"
printf '=================================================\n'
[ "$fail" -eq 0 ]
