# ADR-0001 · Stack del servidor

**Estado:** aceptado · 2026-07-20

## Contexto

El dosier §18.2 propone TypeScript + NestJS, React, PostgreSQL, Prisma, Mosquitto,
Nginx/Caddy y Docker Compose, y admite cambiarlo mediante decisión formal.

## Decisión

Se adopta la propuesta del dosier sin cambios:

- Backend: TypeScript + NestJS (monolito modular, no microservicios).
- ORM: Prisma, con migraciones versionadas en el repositorio.
- Base de datos: PostgreSQL.
- Frontend: React + TypeScript + Vite.
- Broker: Eclipse Mosquitto.
- Proxy: Nginx.
- Orquestación: Docker Compose.

## Motivo

No se ha encontrado ninguna razón técnica fuerte para desviarse. El homelab ya opera
Mosquitto y PostgreSQL en VM105, de modo que el equipo tiene rodaje con ambos. NestJS
aporta modularidad, validación estricta y generación de OpenAPI sin trabajo adicional.

## Consecuencias

- Un único lenguaje (TypeScript) entre backend, worker, frontend y simulador reduce el
  coste de cambio de contexto y permite compartir tipos derivados de los contratos.
- Prisma condiciona el modelado: los tipos de PostgreSQL poco habituales exigen SQL crudo
  en migraciones. Aceptado.
- El perfil `lite` con SQLite del dosier §37 queda como evolución; Prisma lo permite pero
  no se implementa ahora.
