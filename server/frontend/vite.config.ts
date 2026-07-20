/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
    // CSS no se procesa en jsdom (no evalúa @media), así que se deja fuera:
    // aplicar aquí las reglas de "display: none" de los breakpoints rompería
    // las consultas de accesibilidad. El comportamiento responsive real se
    // verifica con Playwright (tests/e2e) en un navegador de verdad.
    css: false,
    exclude: ["node_modules/**", "e2e/**", "dist/**"],
  },
});
