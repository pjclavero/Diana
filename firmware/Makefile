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
# Arbol de contratos RECONCILIADO (ADR-0007), extraido FUERA del repositorio.
# contracts/** no es propiedad de este carril: no se copia al arbol de trabajo.
ADR7REF ?= mp0b/contract-reconcile
# Ruta FIJA (no mktemp): con `?=` recursivo, un $(shell mktemp) se reevaluaria
# en cada referencia y cada linea de la receta miraria a un directorio distinto.
ADR7DIR ?= /tmp/diana-contracts-adr0007-$(shell id -u)

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

# ADR-0007. Valida los payloads que llevan `detection_method` contra el contrato
# reconciliado de $(ADR7REF), extraido a un directorio temporal fuera del repo.
# Si esa referencia no existe, se dice y se falla: no se da por bueno en silencio.
contracts-adr0007:
	@git -C $(ROOT) rev-parse --verify $(ADR7REF) >/dev/null 2>&1 || \
	  { echo "CONTRATO ADR-0007: falta la referencia $(ADR7REF); no se puede validar"; exit 1; }
	@rm -rf $(ADR7DIR) && mkdir -p $(ADR7DIR)
	@git -C $(ROOT) archive $(ADR7REF) contracts | tar -x -C $(ADR7DIR)
	@echo "\n=== ADR-0007: contrato reconciliado de $(ADR7REF) @ $$(git -C $(ROOT) rev-parse --short $(ADR7REF)) ==="
	@$(PYTHON) $(FW)/tools/validate_messages.py --dir $(MSGDIR7) \
	   --contracts $(ADR7DIR)/contracts

clean:
	@rm -rf $(BUILD)
