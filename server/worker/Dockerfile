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

COPY server/worker/package.json server/worker/package-lock.json ./
RUN npm ci

COPY server/backend/prisma ./prisma
COPY server/worker/tsconfig.json ./
COPY server/worker/src ./src
# Cliente Prisma (client + engines) a partir del esquema compartido y compilación.
RUN npx prisma generate --schema ./prisma/schema.prisma && npm run build

# ---------------------------------------------------------------- runtime
FROM node:20.19-bookworm-slim AS runtime
# openssl: engines de Prisma. procps: pgrep para el healthcheck de proceso.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl procps \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system diana \
    && useradd --system --gid diana --home-dir /app --shell /usr/sbin/nologin diana

WORKDIR /app
ENV NODE_ENV=production

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

# El worker no atiende HTTP: comprobamos que el proceso sigue vivo.
HEALTHCHECK --interval=20s --timeout=5s --start-period=15s --retries=5 \
  CMD pgrep -f "node dist/main.js" >/dev/null || exit 1

CMD ["node", "dist/main.js"]
