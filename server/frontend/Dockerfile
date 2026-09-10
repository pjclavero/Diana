# syntax=docker/dockerfile:1

# Diana · Panel web (WP-03)
# Build multi-stage: compila con Node y sirve el estático con nginx sin root.
# NO se ha podido construir esta imagen en este entorno de desarrollo (no hay
# daemon Docker disponible). Las versiones están fijadas explícitamente.

FROM node:20.19-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Autenticación SIEMPRE real contra `/api/auth` (VITE_AUTH_BASE_URL).
# Datos de negocio: `real` POR DEFECTO. Antes era `mock`, de modo que esta
# imagen —la de producción— salía sirviendo datos de demostración a quien no
# pasara `--build-arg`. Además, `npm run build` de abajo ABORTA si alguien
# fuerza `mock` aquí: el guardián de `vite.config.ts` no deja que exista un
# bundle de producción con el adaptador de demostración dentro.
# El backend usa prefijo `api` SIN versión.
ARG VITE_API_MODE=real
ARG VITE_API_BASE_URL=/api
ARG VITE_AUTH_BASE_URL=/api
ARG VITE_WS_URL=/ws
ENV VITE_API_MODE=${VITE_API_MODE} \
    VITE_API_BASE_URL=${VITE_API_BASE_URL} \
    VITE_AUTH_BASE_URL=${VITE_AUTH_BASE_URL} \
    VITE_WS_URL=${VITE_WS_URL}
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
USER nginx
COPY --chown=nginx:nginx nginx.conf /etc/nginx/conf.d/default.conf
COPY --chown=nginx:nginx --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
