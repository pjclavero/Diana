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

# DEVICE_MANAGEMENT_COMMAND_PATH = UNIQUE. Propiedad ESTRUCTURAL: no la
# cubre ninguna prueba de comportamiento, y se rompe sin que nada falle.
	@$(PYTHON) $(FW)/tools/check_d1b_unique_path.py

# P0-2 + F-02. app_main.c y mqtt_client.c NO se compilan en host: la unica
# cobertura posible sobre ellos es estructural.
	@$(PYTHON) $(FW)/tools/check_mqtt_tls.py

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
