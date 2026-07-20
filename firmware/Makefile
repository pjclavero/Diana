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

CFLAGS  := -std=c11 -Wall -Wextra -Werror -Wshadow -Wconversion \
           -Wno-sign-conversion -O1 -g \
           -I$(CORE)/include -I$(HALDIR)/include -I$(HOST)
LDFLAGS := -lm

CORE_SRC := $(wildcard $(CORE)/src/*.c)
HOST_SRC := $(wildcard $(HOST)/*.c) $(wildcard $(HOST)/tests/*.c)
SRC      := $(CORE_SRC) $(HOST_SRC)
OBJ      := $(patsubst $(FW)/%.c,$(BUILD)/%.o,$(SRC))
BIN      := $(BUILD)/diana_tests

.PHONY: all test build contracts clean

all: test

build: $(BIN)

$(BUILD)/%.o: $(FW)/%.c
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) -c $< -o $@

$(BIN): $(OBJ)
	@mkdir -p $(dir $@)
	$(CC) $(OBJ) -o $@ $(LDFLAGS)

# Ejecuta la suite en C y despues valida contra los esquemas CONGELADOS.
test: $(BIN)
	@rm -rf $(MSGDIR)
	@mkdir -p $(MSGDIR)
	@cd $(BUILD) && DIANA_MSG_DIR=$(MSGDIR) ./diana_tests
	@$(MAKE) --no-print-directory contracts

contracts:
	@$(PYTHON) $(FW)/tools/validate_messages.py --dir $(MSGDIR)

clean:
	@rm -rf $(BUILD)
