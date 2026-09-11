# syntax=docker/dockerfile:1
# ==============================================================================
# Diana · backend (NestJS) — imagen multi-stage (WP-08, hallazgo F-13)
# ==============================================================================
# CONTEXTO DE BUILD: raíz del repositorio (NO server/backend).
#   docker build -f server/backend/Dockerfile -t diana/backend:local .
# Motivo: en tiempo de ejecución el backend LEE los esquemas congelados de
# contracts/mqtt y contracts/schemas (ContractValidator, ingesta MQTT). Ese
# árbol vive en la raíz del repo, fuera de server/backend, así que el contexto
# debe abarcar ambos. Ver compose.yml (build.context: .).
#
# La MISMA imagen la usan tres servicios de compose.yml:
#   - backend   → node dist/main.js
#   - migrate   → npx prisma migrate deploy   (necesita el CLI de Prisma)
#   - seed(dev) → npm run seed:*               (perfil dev)
# Por eso el runtime incluye el cliente Prisma generado, los engines y el CLI.
# ==============================================================================

# ---------------------------------------------------------------- build
FROM node:20.19-bookworm-slim AS build
WORKDIR /app

COPY server/backend/package.json server/backend/package-lock.json ./
RUN npm ci

COPY server/backend/tsconfig.json server/backend/tsconfig.build.json server/backend/nest-cli.json ./
COPY server/backend/prisma ./prisma
COPY server/backend/src ./src
# Genera el cliente Prisma (client + engines) y compila TypeScript a dist/.
RUN npx prisma generate && npm run build

# ---------------------------------------------------------------- runtime
FROM node:20.19-bookworm-slim AS runtime
# openssl: requerido por los engines de Prisma en Debian.
# wget: lo usa el healthcheck de compose.yml (imagen slim no lo trae).
# mosquitto: trae `mosquitto_passwd`, que es lo que escribe el fichero de
#   credenciales del broker cuando el backend emite la identidad MQTT de un
#   módulo. Sin este binario la emisión falla CERRADA: el backend arranca, dice
#   «autoridad de credenciales INACTIVA» y ningún ESP32 puede darse de alta.
#   Instala también el demonio; no se arranca nunca (el CMD es node) y es el
#   único paquete de Debian que trae la herramienta.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl wget mosquitto \
    && rm -rf /var/lib/apt/lists/* \
    # El paquete deja un servicio y un passwd propios del broker que este
    # contenedor no debe tener ni arrancar.
    && rm -rf /etc/mosquitto /var/lib/mosquitto \
    # Comprobación de construcción: si un cambio de base o de paquete se lleva
    # el binario por delante, la imagen NO se construye. La alternativa es
    # descubrirlo dando de alta el primer módulo físico.
    && mosquitto_passwd -c -b /tmp/comprobacion usuario clave-de-comprobacion \
    && grep -q '^usuario:\$7\$' /tmp/comprobacion \
    && rm -f /tmp/comprobacion

# Usuario NO root explícito (no reutilizamos el usuario 'node' de la imagen base).
#
# El grupo `mosquitto` se crea con el GID 1883, que es el del usuario con el que
# corre `eclipse-mosquitto`. Backend y broker comparten el volumen de
# credenciales: el backend escribe el `passwd` y el broker lo lee. Compartir el
# grupo permite dejar el fichero en 0640 —dueño escribe, broker lee, nadie
# más— en vez de abrirlo a todo el mundo con 0644.
RUN groupadd --system diana \
    && groupadd --system --gid 1883 mosquitto-broker \
    && useradd --system --gid diana --home-dir /app --shell /usr/sbin/nologin diana \
    && usermod --append --groups mosquitto-broker diana

WORKDIR /app
ENV NODE_ENV=production \
    DIANA_CONTRACTS_DIR=/app/contracts

# Sólo dependencias de producción + el CLI de Prisma (devDependency que el
# servicio `migrate` necesita para `prisma migrate deploy`).
COPY server/backend/package.json server/backend/package-lock.json ./
RUN npm ci --omit=dev \
    && npm install --no-save prisma@6.14.0 \
    && npm cache clean --force

# Esquema + migraciones (para migrate deploy) y regeneración del cliente en runtime.
COPY server/backend/prisma ./prisma
RUN npx prisma generate

# Artefacto compilado y contratos congelados (sólo lectura en ejecución).
COPY --from=build /app/dist ./dist
COPY contracts ./contracts

# Fuente ÚNICA de identidades + su generador canónico.
#
# `CanonicalIdentitySource` no parsea `identities.json`: invoca
# `generate-identities.mjs`, que es quien valida la fuente y quien genera la
# ACL. Los dos tienen que estar DENTRO de la imagen o no hay forma de
# comprobar que una identidad está declarada antes de emitirle credencial —y
# una credencial sin regla de ACL autentica y no queda confinada.
COPY infrastructure/mosquitto/generate-identities.mjs infrastructure/mosquitto/identities.json ./infrastructure/mosquitto/

# Volúmenes montados por compose (diana_exports, diana_firmware).
RUN mkdir -p /app/exports /app/firmware && chown -R diana:diana /app

# Punto de montaje del volumen de credenciales del broker.
#
# Docker inicializa un volumen con nombre copiando el contenido Y los permisos
# del directorio de la imagen: creándolo aquí con dueño/grupo/modo correctos,
# el volumen nace así y no hace falta ningún `chown` en tiempo de arranque.
# El bit setgid (2) hace que lo que se cree dentro herede el grupo del broker.
RUN mkdir -p /app/mqtt-credentials \
    && chown diana:mosquitto-broker /app/mqtt-credentials \
    && chmod 2770 /app/mqtt-credentials

USER diana
EXPOSE 3000

# El prefijo global del backend es /api (config.globalPrefix), de modo que la
# sonda de vida real es /api/health (HealthController @Get() bajo /health).
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "dist/main.js"]
