#!/usr/bin/env bash
# Calibracion del carril FW-PROVISION. NO forma parte de `make test`: es el
# utillaje que demuestra que las pruebas saben ponerse ROJAS.
#
# AVISO: cada mutante se revierte con `git checkout -- <fichero>`, asi que este
# guion DESTRUYE cualquier cambio sin commitear en los ficheros que muta. Se
# ejecuta sobre un arbol limpio, despues de commitear, nunca antes.
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

CAP='python3 firmware/esp32/tools/check_mqtt_rx_capacity.py'

# M9 · la capacidad vuelve al 2048 elegido a ojo: el config/desired real de un
# modulo 3x3 (2239 B) deja de caber y la configuracion no puede aplicarse nunca.
mutate "M9 capacidad de recepcion por debajo del contrato" \
  "firmware/esp32/components/diana_platform_esp/include/diana/platform_esp.h" \
  '#define DIANA_MQTT_RX_PAYLOAD_MAX 4096' \
  '#define DIANA_MQTT_RX_PAYLOAD_MAX 2048' \
  "$CAP" '#define DIANA_MQTT_RX_PAYLOAD_MAX 2048'

# M10 · capacidad suficiente para el mensaje real pero SIN el margen declarado:
# el peor caso del contrato (2640 B) seguiria sin caber. Que quepa "el de hoy"
# no es lo que la guarda promete.
mutate "M10 capacidad sin margen sobre el peor caso" \
  "firmware/esp32/components/diana_platform_esp/include/diana/platform_esp.h" \
  '#define DIANA_MQTT_RX_PAYLOAD_MAX 4096' \
  '#define DIANA_MQTT_RX_PAYLOAD_MAX 2304' \
  "$CAP" '#define DIANA_MQTT_RX_PAYLOAD_MAX 2304'

REASM='python3 firmware/esp32/tools/check_mqtt_reassembly.py'
CORE="firmware/esp32/components/diana_core"
PESP="firmware/esp32/components/diana_platform_esp"

# M11 · un mensaje incompleto se entrega igual: exactamente el defecto original,
# ahora en la logica que SI se compila en host.
mutate "M11 se entrega un mensaje incompleto" \
  "$CORE/src/mqtt_reasm.c" \
  'if (r->recibido < r->total) return DIANA_REASM_INCOMPLETO;' \
  'if (r->recibido < r->total) r->total = r->recibido;' \
  "$TEST" 'r->total = r->recibido;'

# M12 · se retira la comprobacion de contiguidad: un fragmento solapado o con
# salto deja de ser un error y se acomoda, dejando un hueco sin escribir.
mutate "M12 sin comprobacion de contiguidad" \
  "$CORE/src/mqtt_reasm.c" \
  'if (off != r->recibido)' \
  'if (false && off != r->recibido)' \
  "$TEST" 'if (false && off != r->recibido)'

# M13 · el exceso de capacidad se TRUNCA en vez de rechazarse: el fallo ruidoso
# se convierte en el silencioso, que es lo que este arreglo existe para evitar.
mutate "M13 truncar en vez de rechazar por capacidad" \
  "$CORE/src/mqtt_reasm.c" \
  '        if (total > cap) {' \
  '        if (total > cap) { total = cap; } if (0) {' \
  "$TEST" 'if (total > cap) { total = cap; }'

# M14 · el total deja de comprobarse entre fragmentos.
mutate "M14 el total puede cambiar a mitad del mensaje" \
  "$CORE/src/mqtt_reasm.c" \
  'if (total != r->total)' \
  'if (false && total != r->total)' \
  "$TEST" 'if (false && total != r->total)'

# M15 · el estado NO se limpia tras un error: el parcial contamina al siguiente.
mutate "M15 el error no limpia el estado" \
  "$CORE/src/mqtt_reasm.c" \
  '    diana_mqtt_reasm_reset(r);
    *motivo = texto;' \
  '    *motivo = texto;' \
  "$TEST" '    *motivo = texto;
    return DIANA_REASM_ERROR;'

# M16 · el firmware real vuelve a copiar el fragmento como si fuera el mensaje.
# La suite de host seguiria VERDE: mqtt_client.c no se compila ahi. Solo la
# guarda estructural puede cazarlo.
mutate "M16 el manejador vuelve a copiar ev->data a pelo" \
  "$PESP/src/mqtt_client.c" \
  '        size_t plen = 0;' \
  '        memcpy(rx->payload, ev->data, (size_t)ev->data_len);
        size_t plen = 0;' \
  "$REASM" 'memcpy(rx->payload, ev->data,'

# M17 · el reensamblador se cae del CMakeLists: compila en host por wildcard,
# pero el binario del ESP32 no lo lleva y el firmware ni siquiera enlaza.
mutate "M17 mqtt_reasm.c fuera del CMakeLists del componente" \
  "$CORE/CMakeLists.txt" \
  '         "src/mqtt_reasm.c"' \
  '         # "src/mqtt_reasm.c"' \
  "$REASM" '# "src/mqtt_reasm.c"'

MAIN="firmware/esp32/main"

# M18 · el buffer de recepcion vuelve a la pila de diana_net. La suite de host
# sigue VERDE (main/ no se compila ahi) y el firmware compila sin una queja:
# solo la placa lo dice, con un stack overflow. La guarda lo caza antes.
mutate "M18 diana_platform_rx de vuelta a la pila" \
  "$MAIN/app_tasks.c" \
  '        static diana_platform_rx rx;' \
  '        diana_platform_rx rx;' \
  "$CAP" '
        diana_platform_rx rx;'

SUBS='python3 firmware/esp32/tools/check_topic_subscriptions.py'

# M19 · se cae la suscripcion a maintenance/command: el handler vuelve a ser
# codigo inalcanzable y la suite de host sigue VERDE, porque alli el
# despachador se invoca a mano. Es el defecto exacto que habia.
mutate "M19 handler de mantenimiento sin suscripcion" \
  "$PESP/src/mqtt_client.c" \
  '        "maintenance/command",' \
  '' \
  "$SUBS" '"command", "config/desired", "ota", "provision",'

# M20 · la diana pedida se ignora y se enciende el modulo entero, que es lo que
# hacia antes: lo caza la suite, no una guarda estructural.
mutate "M20 led_test enciende todas las dianas" \
  "$CORE/src/led.c" \
  '        bool en_prueba = (test_target >= 1 && test_target <= DIANA_TARGET_COUNT &&
                          (uint8_t)(test_target - 1) == target0);' \
  '        bool en_prueba = (test_target >= 1 && test_target <= DIANA_TARGET_COUNT);' \
  "$TEST" 'bool en_prueba = (test_target >= 1 && test_target <= DIANA_TARGET_COUNT);'

# M21 · 'act' deja de exigir reloj: led_test se ejecutaria con una orden de
# antiguedad desconocida. El contrato lo prohibe y la suite lo fija.
mutate "M21 act sin exigir reloj" \
  "$CORE/src/command.c" \
  '    default:                   return clock_ok && !expired;' \
  '    default:                   return true;' \
  "$TEST" 'default:                   return true;'

# M22 · 'read' pasa a exigir reloj: un modulo recien arrancado sin hora se
# vuelve indiagnosticable, que es justo lo que 6-bis evita.
mutate "M22 read exigiendo reloj" \
  "$CORE/src/command.c" \
  '    case DIANA_MNT_CAT_READ:   return true;' \
  '    case DIANA_MNT_CAT_READ:   return clock_ok;' \
  "$TEST" 'case DIANA_MNT_CAT_READ:   return clock_ok;'

CLOCK='python3 firmware/esp32/tools/check_clock_source.py'

# M23 · vuelve el server_from_dhcp incondicional: esp_netif_sntp_init falla
# entero, el modulo se queda sin hora y el repertorio 'act' queda vetado. Es el
# defecto exacto que se midio en el banco, y la suite de host no lo ve.
mutate "M23 SNTP dependiendo del DHCP" \
  "$PESP/src/net_w5500.c" \
  '#ifdef CONFIG_LWIP_DHCP_GET_NTP_SRV
    cfg.server_from_dhcp = true;
    cfg.renew_servers_after_new_IP = true;
#else
    cfg.server_from_dhcp = false;
    cfg.renew_servers_after_new_IP = false;
#endif' \
  '    cfg.server_from_dhcp = true;
    cfg.renew_servers_after_new_IP = true;' \
  "$CLOCK" '    cfg.server_from_dhcp = true;
    cfg.renew_servers_after_new_IP = true;'

printf '\n=================================================\n'
printf ' CALIBRACION: %d mutantes cazados, %d huecos\n' "$pass" "$fail"
printf '=================================================\n'
[ "$fail" -eq 0 ]
