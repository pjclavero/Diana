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
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl wget \
    && rm -rf /var/lib/apt/lists/*

# Usuario NO root explícito (no reutilizamos el usuario 'node' de la imagen base).
RUN groupadd --system diana \
    && useradd --system --gid diana --home-dir /app --shell /usr/sbin/nologin diana

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

# Volúmenes montados por compose (diana_exports, diana_firmware).
RUN mkdir -p /app/exports /app/firmware && chown -R diana:diana /app

USER diana
EXPOSE 3000

# El prefijo global del backend es /api (config.globalPrefix), de modo que la
# sonda de vida real es /api/health (HealthController @Get() bajo /health).
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "dist/main.js"]
