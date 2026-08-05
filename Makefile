# ==============================================================================
# Diana · Makefile — orquestación del stack Docker (WP-01)
# ==============================================================================
# `make help` lista todos los objetivos con su descripción.
#
# Convenciones:
#   - COMPOSE agrupa los ficheros base (compose.yml) y, cuando corresponde,
#     el override de desarrollo (compose.dev.yml).
#   - La mayoría de objetivos aceptan variables de entorno ya exportadas o
#     definidas en .env (docker compose las lee automáticamente).
#   - Ningún objetivo de este Makefile ejecuta `docker build`/`up` como parte
#     de la validación de WP-01: eso lo hace WP-08 en la VM real. Aquí sólo
#     se definen los objetivos para cuando el stack SÍ pueda construirse
#     (todos los paquetes convergidos) y para la validación estática
#     (`docker compose config`, `contracts-test`).
# ==============================================================================

SHELL := /usr/bin/env bash
.SHELLFLAGS := -eu -o pipefail -c

COMPOSE       := docker compose
COMPOSE_DEV   := docker compose -f compose.yml -f compose.dev.yml
ENV_FILE      := .env
ENV_EXAMPLE   := .env.example

.DEFAULT_GOAL := help

.PHONY: help bootstrap dev test lint build up down deploy backup restore \
        reset-dev simulate logs ps contracts-test config config-dev \
        mosquitto-users firmware-host-test check-ports load-test api-contract

help: ## Muestra esta ayuda
	@echo "Diana · objetivos disponibles:"
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z0-9_-]+:.*?## / {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

bootstrap: ## Prepara un entorno local: copia .env.example -> .env si no existe
	@if [ -f $(ENV_FILE) ]; then \
		echo "$(ENV_FILE) ya existe, no se sobrescribe."; \
	else \
		cp $(ENV_EXAMPLE) $(ENV_FILE); \
		echo "Creado $(ENV_FILE) a partir de $(ENV_EXAMPLE)."; \
		echo "EDITA $(ENV_FILE) y genera secretos reales (ver cabecera del fichero)."; \
	fi
	@echo "Genera credenciales MQTT con: make mosquitto-users"

mosquitto-users: ## Genera usuarios MQTT (backend, healthcheck, módulos) con mosquitto_passwd
	@echo "Uso: ./infrastructure/mosquitto/generate-users.sh <usuario>"
	@echo "Ejemplos:"
	@echo "  ./infrastructure/mosquitto/generate-users.sh backend"
	@echo "  ./infrastructure/mosquitto/generate-users.sh healthcheck"
	@echo "  ./infrastructure/mosquitto/generate-users.sh module-m1"

dev: ## Levanta el stack en modo desarrollo (compose.yml + compose.dev.yml, perfil dev)
	$(COMPOSE_DEV) --profile dev up --build

test: ## Ejecuta el stack de pruebas efímero (perfil test: BD/broker efímeros + test-runner)
	$(COMPOSE) --profile test up --build --abort-on-container-exit --exit-code-from test-runner
	$(COMPOSE) --profile test down -v

lint: ## Valida la sintaxis de todos los compose (base, dev, todos los perfiles)
	$(COMPOSE) config -q
	$(COMPOSE_DEV) --profile dev config -q
	$(COMPOSE) --profile test config -q
	$(COMPOSE) --profile simulator config -q
	$(COMPOSE) --profile monitoring config -q
	@echo "OK: todos los compose son sintácticamente válidos."

build: ## Construye las imágenes del stack base
	$(COMPOSE) build

up: ## Levanta el stack completo en segundo plano (perfil por defecto)
	$(COMPOSE) up -d

down: ## Detiene y elimina los contenedores del stack (conserva volúmenes)
	$(COMPOSE) down

deploy: ## Despliegue: build + migrate + up, en ese orden, con verificación de salud
	$(COMPOSE) build
	$(COMPOSE) up -d postgres mosquitto
	$(COMPOSE) up migrate
	$(COMPOSE) up -d
	@echo "Desplegado. Revisa 'make ps' y 'make logs' para confirmar salud de los servicios."

backup: ## Lanza un backup manual inmediato (fuera del cron programado)
	$(COMPOSE) exec backup /scripts/backup.sh

restore: ## Restaura un backup: make restore FILE=/backups/daily/xxx.sql.gz [TARGET_DB=diana_restore_test]
	@if [ -z "$(FILE)" ]; then echo "Uso: make restore FILE=/backups/daily/xxx.sql.gz [TARGET_DB=...]"; exit 1; fi
	$(COMPOSE) exec backup /scripts/restore.sh $(FILE) $(if $(TARGET_DB),--target-db $(TARGET_DB),)

reset-dev: ## Para el entorno dev y elimina sus volúmenes (datos de prueba, no producción)
	$(COMPOSE_DEV) --profile dev down -v
	@echo "Entorno de desarrollo reiniciado. Vuelve a levantar con 'make dev'."

simulate: ## Levanta mosquitto + backend + el simulador de módulos (perfil simulator)
	$(COMPOSE) --profile simulator up --build mosquitto backend device-simulator

logs: ## Sigue los logs de todos los servicios activos
	$(COMPOSE) logs -f --tail=200

ps: ## Lista el estado de los servicios (incluye healthchecks)
	$(COMPOSE) ps

contracts-test: ## Valida los contratos MQTT (esquemas + ejemplos válidos/inválidos)
	python3 contracts/validate.py

# El generador de tipos NO es dependencia del panel: se invoca con `npx -y` a
# una versión EXACTA. Motivo comprobado, no estético: `openapi-typescript`
# declara `peer typescript@^5.x` en TODAS sus versiones publicadas (7.4.0 a
# 7.13.0, la última) y el panel usa `typescript@~6.0.2`. Tenerlo como
# devDependency rompía `npm ci` con ERESOLVE en el job Frontend, y las salidas
# eran relajar los peers de TODO el árbol del panel (--legacy-peer-deps) o
# forzar el peer con `overrides`: ambas ACEPTAN el conflicto en vez de
# resolverlo. Sacándolo del árbol no hay conflicto que aceptar: el panel
# instala con peers estrictos y la herramienta corre con su propio TypeScript
# 5.x soportado. Verificado: la salida es byte a byte idéntica por las dos vías.
OPENAPI_TS := openapi-typescript@7.13.0

api-contract: ## Regenera el contrato REST (OpenAPI + tipos TS) y falla si diverge del árbol
	cd server/backend && npm run openapi
	cd server/frontend && npx -y $(OPENAPI_TS) ../../contracts/api/openapi.json -o src/api/generated/schema.d.ts
	git diff --exit-code contracts/api/openapi.json server/frontend/src/api/generated/schema.d.ts

config: ## Vuelca la configuración resuelta del stack base (equivalente a `docker compose config`)
	$(COMPOSE) config

config-dev: ## Vuelca la configuración resuelta del stack de desarrollo
	$(COMPOSE_DEV) --profile dev config

# --- WP-07 · objetivos de CI y pruebas ---------------------------------------

firmware-host-test: ## Compila y ejecuta los tests en host del firmware (gcc, sin ESP-IDF)
	$(MAKE) -C firmware test

check-ports: ## Verifica que sólo el proxy/broker publican puertos (PostgreSQL interno)
	bash tests/security/check-port-exposure.sh

load-test: ## Lanza el generador de carga MQTT (9 módulos/81 dianas) contra un stack ya levantado
	cd tests/load && (npm ci || npm install) && npm start
