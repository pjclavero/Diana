import { defineConfig, devices } from "@playwright/test";

/**
 * Configuración E2E contra el panel con el adaptador MOCK (sin backend).
 * `npm run e2e` levanta `vite preview` sobre el build de producción.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    // El perfil de tableta usa el viewport/formato del iPad pero sobre Chromium:
    // el CI sólo aprovisiona Chromium (`playwright install --with-deps chromium`),
    // así que WebKit (motor por defecto del iPad) nunca estaría disponible.
    { name: "tablet", use: { ...devices["iPad (gen 7)"], defaultBrowserType: "chromium" } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
