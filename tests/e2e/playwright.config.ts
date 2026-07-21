import { defineConfig, devices } from "@playwright/test";

/**
 * E2E de los 16 escenarios del encargo (§19) contra el STACK COMPLETO.
 *
 * A diferencia de server/frontend/e2e (que usa el adaptador MOCK y levanta un
 * `vite preview`), esta suite espera un stack ya en marcha (Compose): panel +
 * backend + PostgreSQL + Mosquitto + simulador de módulos. Por eso NO hay
 * bloque `webServer`: lo levanta e2e.yml antes de invocar `npm test`.
 *
 * DIANA_BASE_URL apunta al proxy del stack (por defecto http://localhost:8080).
 * MQTT_URL apunta al broker, para los escenarios que inyectan mensajes de
 * módulo directamente por MQTT.
 */
export default defineConfig({
  testDir: ".",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.DIANA_BASE_URL ?? "http://localhost:8080",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "escritorio",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
});
