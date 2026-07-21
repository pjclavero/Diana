# E2E · 16 escenarios del encargo (§19)

Suite Playwright contra el **stack completo** (Compose + simulador de módulos),
no contra el mock del panel. La levanta `.github/workflows/e2e.yml` (job
`stack-e2e`); aquí no se puede ejecutar porque el entorno de desarrollo no
tiene demonio Docker.

## Estado real

**Los 16 escenarios son PLACEHOLDER.** Están declarados con `test.fixme` en
`scenarios.spec.ts`: Playwright los cuenta y los marca como pendientes, nunca
como superados. Ninguno tiene aserciones implementadas todavía. No se marca
como cubierto ningún esqueleto vacío.

| ID    | Escenario                     | Fichero              | Estado      |
|-------|-------------------------------|----------------------|-------------|
| E-01  | Registrar 9 módulos           | `scenarios.spec.ts`  | PLACEHOLDER |
| E-02  | Elegir principal              | `scenarios.spec.ts`  | PLACEHOLDER |
| E-03  | Configurar matriz 3×3         | `scenarios.spec.ts`  | PLACEHOLDER |
| E-04  | Calibración simulada          | `scenarios.spec.ts`  | PLACEHOLDER |
| E-05  | Crear jugador                 | `scenarios.spec.ts`  | PLACEHOLDER |
| E-06  | Partida aleatoria             | `scenarios.spec.ts`  | PLACEHOLDER |
| E-07  | Recibir impactos              | `scenarios.spec.ts`  | PLACEHOLDER |
| E-08  | Penalizar impacto incorrecto  | `scenarios.spec.ts`  | PLACEHOLDER |
| E-09  | Terminar ronda                | `scenarios.spec.ts`  | PLACEHOLDER |
| E-10  | Calcular resultado            | `scenarios.spec.ts`  | PLACEHOLDER |
| E-11  | Mostrar estadísticas          | `scenarios.spec.ts`  | PLACEHOLDER |
| E-12  | Exportar                      | `scenarios.spec.ts`  | PLACEHOLDER |
| E-13  | Reiniciar backend             | `scenarios.spec.ts`  | PLACEHOLDER |
| E-14  | Recuperar eventos encolados   | `scenarios.spec.ts`  | PLACEHOLDER |
| E-15  | Reconectar módulo             | `scenarios.spec.ts`  | PLACEHOLDER |
| E-16  | Rechazar duplicados           | `scenarios.spec.ts`  | PLACEHOLDER |

## Cómo implementarlos

1. Levantar el stack: `make deploy` (o el job `stack-e2e` de `e2e.yml`).
2. Exportar `DIANA_BASE_URL` (proxy, por defecto `http://localhost:8080`) y
   `MQTT_URL` (broker).
3. Quitar `.fixme` del escenario, escribir las aserciones reales y actualizar
   la fila de esta tabla y la de `docs/coordination/TEST_MATRIX.md`.

El simulador de módulos (`simulators/`) es la fuente de mensajes MQTT; el panel
y la API se conducen por `baseURL`. Reutilizar `tests/fixtures/players.json`
para E-05.
