# syntax=docker/dockerfile:1
# ==============================================================================
# Diana · worker (tareas diferidas) — imagen multi-stage (WP-08, hallazgo F-13)
# ==============================================================================
# CONTEXTO DE BUILD: raíz del repositorio (NO server/worker).
#   docker build -f server/worker/Dockerfile -t diana/worker:local .
# Motivo: el worker comparte el esquema Prisma del backend
# (server/backend/prisma/schema.prisma; ver worker/package.json → prisma:generate
# --schema ../backend/prisma/schema.prisma). Ese fichero está fuera de
# server/worker, así que el contexto debe abarcar server/backend/prisma.
#
# El worker NO expone puertos ni servidor HTTP: es un bucle que trabaja contra
# PostgreSQL. Por eso su healthcheck es de proceso (no hay endpoint /health;
# ver compose.yml).
# ==============================================================================

# ---------------------------------------------------------------- build
FROM node:20.19-bookworm-slim AS build
WORKDIR /app

# CAUSA RAÍZ (worker en bucle de fallo con motor Prisma equivocado, F-13 bis):
# esta etapa ejecutaba `prisma generate` SIN openssl instalado. El detector de
# libssl de @prisma/get-platform (ver getBinaryTargetForCurrentPlatformInternal
# en @prisma/get-platform/dist/chunk-7PMGXL6S.js) no encuentra libssl.so ni el
# binario `openssl`, avisa "Prisma failed to detect the libssl/openssl version"
# y usa el motor de query FIJO por defecto `debian-openssl-1.1.x`
# (`defaultLibssl = "1.1.x"`). La etapa runtime, en cambio, SÍ instala openssl
# (paquete `openssl` de bookworm = OpenSSL 3.0.x) y ese motor 1.1.x no es
# compatible con esa libssl: el cliente Prisma revienta en la PRIMERA consulta
# (no al arrancar), así que el proceso node sigue vivo y `pgrep` seguía viendo
# "sano" un worker que no completaba ni una tarea. El Dockerfile del backend
# no tiene este fallo porque vuelve a correr `prisma generate` en su propia
# etapa runtime, YA con openssl instalado (ver server/backend/Dockerfile).
# Aquí instalamos openssl ANTES de generar, para que el motor que se copia al
# runtime (COPY --from=build .../node_modules/.prisma) sea el mismo
# debian-openssl-3.0.x que corresponde a la etapa runtime.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY server/worker/package.json server/worker/package-lock.json ./
RUN npm ci

COPY server/backend/prisma ./prisma
# Los DOS tsconfig: el de desarrollo y el de compilación. `tsconfig.build.json`
# es el que excluye las pruebas del `dist/` de producción, y `npm run build` lo
# invoca por nombre: sin copiarlo, la imagen falla con «path does not exist»
# aunque en el repositorio todo esté bien. Funcionaba en el repo y no en la
# imagen, que es justo el fallo que sólo aparece al construir de verdad.
COPY server/worker/tsconfig.json server/worker/tsconfig.build.json ./
COPY server/worker/src ./src
# Cliente Prisma (client + engines) a partir del esquema compartido y compilación.
RUN npx prisma generate --schema ./prisma/schema.prisma && npm run build

# ---------------------------------------------------------------- runtime
FROM node:20.19-bookworm-slim AS runtime
# openssl: engines de Prisma (misma versión ABI que la usada al generar en build).
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system diana \
    && useradd --system --gid diana --home-dir /app --shell /usr/sbin/nologin diana

WORKDIR /app
ENV NODE_ENV=production \
    HEARTBEAT_FILE=/var/lib/diana/worker-heartbeat.json

# Sólo dependencias de producción (@prisma/client). El CLI de Prisma NO hace
# falta en runtime: copiamos el cliente ya generado desde la etapa build.
COPY server/worker/package.json server/worker/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server/backend/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist

# Directorio de exportaciones diferidas (worker/src/main.ts: EXPORTS_DIR).
RUN mkdir -p /var/lib/diana/exports /app/exports \
    && chown -R diana:diana /app /var/lib/diana

USER diana

# El worker no atiende HTTP: en vez de comprobar sólo que el proceso node
# sigue vivo (`pgrep`, insuficiente — ver nota de causa raíz arriba: un
# proceso vivo puede tener TODAS sus tareas fallando en bucle), el
# healthcheck lee el heartbeat que main.ts escribe en cada vuelta del bucle
# (dist/health.js) y comprueba que además de vivo esté SIRVIENDO: heartbeat
# reciente y sin una racha de fallos consecutivos de tarea. Ver
# src/health.ts (lógica pura, con pruebas) y src/healthcheck.ts (CLI).
HEALTHCHECK --interval=20s --timeout=5s --start-period=15s --retries=5 \
  CMD ["node", "dist/healthcheck.js"]

CMD ["node", "dist/main.js"]
