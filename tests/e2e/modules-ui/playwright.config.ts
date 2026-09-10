import { defineConfig, devices } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Configuración PROPIA de este carril. No toca `tests/e2e/playwright.config.ts`
 * (que es de otro carril) y existe por una razón concreta: aquí el navegador
 * corre en un contenedor, así que hay que darle a Playwright el `wsEndpoint`
 * del servidor de navegador. Ver `harness/browser-up.sh` para el porqué
 * (esta máquina no tiene las bibliotecas de Chromium y no hay `sudo`).
 *
 * `baseURL` NO se fija aquí a propósito: la prueba navega con URL absolutas
 * leídas de `.tmp/env.json`, que es el contrato del arnés, para que no haya
 * dos sitios donde el puerto pueda quedar desincronizado.
 */
const WS_FILE = path.join(__dirname, ".tmp", "browser-ws");
const wsEndpoint =
  process.env.DIANA_E2E_BROWSER_WS ??
  (existsSync(WS_FILE) ? readFileSync(WS_FILE, "utf8").trim() : undefined);

export default defineConfig({
  testDir: __dirname,
  // Escenario secuencial y con estado compartido (un módulo que se da de alta,
  // se configura y se revoca): paralelizarlo mediría otra cosa.
  fullyParallel: false,
  workers: 1,
  // Sin reintentos: un reintento que pasa esconde una carrera real.
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: path.join(__dirname, ".report"), open: "never" }]],
  outputDir: path.join(__dirname, ".test-results"),
  timeout: 120_000,
  use: {
    trace: "retain-on-failure",
    ...(wsEndpoint ? { connectOptions: { wsEndpoint } } : {}),
  },
  projects: [
    {
      name: "escritorio",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
});
