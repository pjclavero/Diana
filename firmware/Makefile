# Makefile de pruebas en HOST del firmware Diana.
#
# No necesita ESP-IDF ni hardware: compila la logica de negocio (diana_core)
# contra la implementacion de HAL de simulacion (test_host/hal_host.c) con un
# gcc normal y ejecuta la suite completa.
#
#   make test        compila y ejecuta la suite + validacion de contratos
#   make build       solo compila
#   make contracts   valida los mensajes generados contra los JSON Schema
#   make clean

CC      ?= gcc
PYTHON  ?= python3

ROOT    := $(abspath $(dir $(lastword $(MAKEFILE_LIST)))..)
FW      := $(ROOT)/firmware/esp32
CORE    := $(FW)/components/diana_core
HALDIR  := $(FW)/components/diana_hal
HOST    := $(FW)/test_host
BUILD   := $(FW)/build-host
MSGDIR  := $(BUILD)/messages
MSGDIR7 := $(BUILD)/messages-adr0007
# Contrato ADR-0007: ya RECONCILIADO dentro de `contracts/` en este arbol.
# Antes se extraia de la rama `mp0b/contract-reconcile`, que NUNCA existio en
# `origin`: en un clon limpio (actions/checkout trae UNA sola rama) el
# `rev-parse` fallaba y `make test` terminaba en Error 2 DESPUES de 853
# comprobaciones verdes. La rama esta integrada -- `hit-event.schema.json` es
# identico al de aquella rama -- asi que la validacion se hace contra el propio
# arbol y ya no depende de ninguna referencia git.
# Fichero y campo que materializan el contrato: se comprueban ANTES de validar
# para que retirar el contrato salga ROJO en vez de pasar en silencio.
ADR7SCHEMA := $(ROOT)/contracts/mqtt/hit-event.schema.json
ADR7FIELD  := detection_method

CFLAGS  := -std=c11 -MMD -MP -Wall -Wextra -Werror -Wshadow -Wconversion \
           -Wno-sign-conversion -O1 -g \
           -I$(CORE)/include -I$(HALDIR)/include -I$(HOST) -I$(FW)/boards
LDFLAGS := -lm

CORE_SRC := $(wildcard $(CORE)/src/*.c)
HOST_SRC := $(wildcard $(HOST)/*.c) $(wildcard $(HOST)/tests/*.c)
SRC      := $(CORE_SRC) $(HOST_SRC)
OBJ      := $(patsubst $(FW)/%.c,$(BUILD)/%.o,$(SRC))
BIN      := $(BUILD)/diana_tests

.PHONY: all test build contracts contracts-adr0007 clean

all: test

build: $(BIN)

$(BUILD)/%.o: $(FW)/%.c
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) -c $< -o $@

# Sin esto, cambiar una CABECERA no recompila los .o que la incluyen y la suite
# se ejecuta con objetos de dos disposiciones de struct distintas: verdes o
# rojos falsos. Se descubrio anadiendo un campo a host_hal_ctx (MP0-S).
-include $(OBJ:.o=.d)

$(BIN): $(OBJ)
	@mkdir -p $(dir $@)
	$(CC) $(OBJ) -o $@ $(LDFLAGS)

# Ejecuta la suite en C y despues valida contra los esquemas CONGELADOS.
test: $(BIN)
	@rm -rf $(MSGDIR) $(MSGDIR7)
	@mkdir -p $(MSGDIR) $(MSGDIR7)
	@cd $(BUILD) && DIANA_MSG_DIR=$(MSGDIR) DIANA_MSG_DIR_ADR0007=$(MSGDIR7) ./diana_tests
	@$(MAKE) --no-print-directory contracts-adr0007
	@$(MAKE) --no-print-directory contracts

contracts:
	@$(PYTHON) $(FW)/tools/validate_messages.py --dir $(MSGDIR)

# El arreglo de RSTn del W5500 se fija sobre el propio fuente: net_w5500.c NO se
# compila en la suite de host, asi que ninguna prueba en C puede cubrirlo.
	@$(PYTHON) $(FW)/tools/check_w5500_reset.py

# VERSIONR observable. Misma razon estructural: net_w5500.c no se compila en
# host. Cubre ademas que el log no vuelva a mezclar disponibilidad del driver
# con comunicacion SPI real, y que la lectura periodica no degenere en sondeo.
	@$(PYTHON) $(FW)/tools/check_w5500_versionr.py

# DEVICE_MANAGEMENT_COMMAND_PATH = UNIQUE. Propiedad ESTRUCTURAL: no la
# cubre ninguna prueba de comportamiento, y se rompe sin que nada falle.
	@$(PYTHON) $(FW)/tools/check_d1b_unique_path.py

# P0-2 + F-02. app_main.c y mqtt_client.c NO se compilan en host: la unica
# cobertura posible sobre ellos es estructural.
	@$(PYTHON) $(FW)/tools/check_mqtt_tls.py

# C-1 + C-2. La CA no puede degradarse en silencio (declaracion explicita de
# huella) y el camino de conexion tiene que distinguir la capa que falla. Vive
# en app_main.c / mqtt_client.c y en el CONTENIDO de main/certs/, nada de lo
# cual compila en host. Contador PROPIO, no sumado a MQTT/TLS.
	@$(PYTHON) $(FW)/tools/check_broker_ca.py

# MP0-F.0 · ADR-0008. El puente del plano DEVICE_MANAGEMENT vive en
# main/app_commands.c, main/app_provision.c y mqtt_client.c, que NO se compilan
# en host: que el enrutado sea exacto lo prueba la suite (test_prov_bridge.c),
# pero que el codigo lo USE y que el firmware se suscriba solo se puede fijar
# estructuralmente. Contador PROPIO, no sumado a los demas.
	@$(PYTHON) $(FW)/tools/check_prov_bridge.py

# CONFIG_RECONCILIATION. La decision (apply/noop/reject, sin reloj, persistida)
# la prueba test_config_reconcile.c en host. Lo que NO compila en host es quien
# EMITE las suscripciones y cuando --el defecto medido era suscribirse antes del
# CONNACK, con lo que el config/desired retenido no llegaba nunca-- ni que el
# despachador use esa logica en vez de resolver la version a mano. Contador
# PROPIO, no sumado a los demas.
	@$(PYTHON) $(FW)/tools/check_config_reconcile.py

# MQTT_RX_CAPACITY. El tamano del buffer de recepcion no es una opinion: esta
# guarda CONSTRUYE el config/desired mas grande que el contrato permite, lo
# valida contra el esquema y lo mide, y se pone roja si la capacidad declarada
# en platform_esp.h queda por debajo. Existe porque el buffer de 2048 bytes no
# llegaba al mensaje normal de un modulo 3x3 (2239 B) y la configuracion no
# podia aplicarse nunca. Contador PROPIO, no sumado a los demas.
	@$(PYTHON) $(FW)/tools/check_mqtt_rx_capacity.py

# MQTT_REASSEMBLY. El reensamblado de fragmentos es logica pura en diana_core y
# la suite de host lo ejercita fragmento a fragmento. Lo que esta guarda fija es
# el CABLEADO en mqtt_client.c --- que no se compila en host ---: que el
# manejador use el reensamblador y las tres cifras del evento, que un parcial o
# un error no lleguen nunca a la cola y que el fuente este en el CMakeLists del
# componente. Contador PROPIO, no sumado a los demas.
	@$(PYTHON) $(FW)/tools/check_mqtt_reassembly.py

# TOPIC_SUBSCRIPTIONS. Un handler sin suscripcion es codigo inalcanzable, y ya
# ha pasado tres veces: provision, config/desired y maintenance/command. La
# suite de host no puede verlo --- alli el despachador se invoca a mano, asi
# que sus ramas se ejercitan aunque el firmware real no reciba nunca ese
# topico. Contador PROPIO, no sumado a los demas.
	@$(PYTHON) $(FW)/tools/check_topic_subscriptions.py

# CLOCK_SOURCE. Sin hora de pared la regla 6-bis rechaza todo el repertorio
# 'act' del canal de mantenimiento: el panel no puede pedir nada que mueva
# hardware. net_w5500.c no se compila en host. Contador PROPIO.
	@$(PYTHON) $(FW)/tools/check_clock_source.py

# LED_TEST_INDEPENDENCE. Los tres defectos que se midieron en el banco ---
# encender D2 apagaba D1, apagar D1 apagaba la ultima, y un unico plazo ---
# venian de un hueco de estado GLOBAL en main/, que no se compila en host.
# Contador PROPIO.
	@$(PYTHON) $(FW)/tools/check_led_test_independence.py

# MAINTENANCE_RETURN_PATH. Una orden de mantenimiento tiene que poder demostrar
# que hizo o por que no. Los rechazos se publicaban por la via generica, sin
# request_id, y el serializador los descartaba en silencio: nadie se enteraba.
# Contador PROPIO.
	@$(PYTHON) $(FW)/tools/check_maintenance_return_path.py

# ADR-0007. Valida los payloads que llevan `detection_method` contra el contrato
# de ESTE arbol. Sin descarga ni referencia git: funciona en un clon limpio.
# La guarda de abajo no es cosmetica: si alguien retira el contrato ADR-0007 de
# `contracts/`, la receta falla en vez de validar contra un esquema mudo.
contracts-adr0007:
	@test -f $(ADR7SCHEMA) || \
	  { echo "CONTRATO ADR-0007: falta $(ADR7SCHEMA); no se puede validar"; exit 1; }
	@grep -q '"$(ADR7FIELD)"' $(ADR7SCHEMA) || \
	  { echo "CONTRATO ADR-0007: $(ADR7SCHEMA) ya no declara $(ADR7FIELD); regresion del contrato"; exit 1; }
	@echo "" && echo "=== ADR-0007: contrato reconciliado, validado contra el arbol de trabajo ==="
	@$(PYTHON) $(FW)/tools/validate_messages.py --dir $(MSGDIR7)

clean:
	@rm -rf $(BUILD)
