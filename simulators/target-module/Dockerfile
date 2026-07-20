# Simulador de módulo Diana (WP-05) — sustituto contractual del firmware ESP32.
#
# IMPORTANTE — contexto de build:
#   Este Dockerfile espera construirse con el CONTEXTO EN LA RAÍZ DEL REPOSITORIO,
#   no en simulators/, porque en tiempo de ejecución el simulador localiza y valida
#   contra contracts/mqtt/*.schema.json y contracts/schemas/common.schema.json
#   (contrato congelado, ver contracts/mqtt/README.md) subiendo directorios desde su
#   propio código — así que ambos árboles (contracts/ y simulators/) deben convivir
#   dentro de la imagen exactamente como conviven en el repositorio.
#
#   docker build -f simulators/target-module/Dockerfile -t diana-simulator .
#
#   El compose.yml de WP-01 debe referenciarlo bajo el perfil "simulator" con:
#     build:
#       context: .
#       dockerfile: simulators/target-module/Dockerfile
#
# NO se ha podido construir ni ejecutar esta imagen en este entorno de desarrollo
# (no hay daemon Docker disponible aquí). Se ha revisado a mano y el equivalente
# en local (npm ci && npm run build && node dist/cli.js run ...) sí se ha probado.

# ---------------------------------------------------------------- build
FROM node:20-slim AS build

WORKDIR /workspace

COPY simulators/package.json simulators/package-lock.json* ./simulators/
WORKDIR /workspace/simulators
RUN npm install --no-audit --no-fund

WORKDIR /workspace
COPY simulators/tsconfig.json ./simulators/
COPY simulators/src ./simulators/src

WORKDIR /workspace/simulators
RUN npm run build \
    && npm prune --omit=dev --no-audit --no-fund

# ---------------------------------------------------------------- runtime
FROM node:20-slim AS runtime

RUN groupadd --system diana && useradd --system --gid diana --home-dir /workspace diana

WORKDIR /workspace

# Contrato congelado: sólo lectura, necesario para la autovalidación del simulador.
COPY --chown=diana:diana contracts ./contracts

COPY --chown=diana:diana --from=build /workspace/simulators/dist ./simulators/dist
COPY --chown=diana:diana --from=build /workspace/simulators/node_modules ./simulators/node_modules
COPY --chown=diana:diana simulators/package.json ./simulators/package.json
COPY --chown=diana:diana simulators/scenarios ./simulators/scenarios

WORKDIR /workspace/simulators
USER diana

ENV NODE_ENV=production

ENTRYPOINT ["node", "dist/cli.js"]
CMD ["run", "--help"]
