/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { esCompilacionDeProduccion, resolverModoApi } from "./src/api/apiMode.js";

/**
 * Guardián de compilación: una build de PRODUCCIÓN en modo `mock` no se
 * produce, falla.
 *
 * Sin esto, el único aviso era un comentario. Con esto, el bundle de
 * producción con el adaptador de demostración dentro **no llega a existir**:
 * `vite build` aborta antes de emitir nada, con el motivo escrito.
 *
 * La misma regla se vuelve a comprobar en tiempo de ejecución dentro del
 * bundle (`src/api/index.ts` → `resolverModoApi(import.meta.env)`), porque
 * ésta se puede rodear compilando con `--mode development`, y aquella no: mira
 * lo que quedó horneado. Ninguna de las dos sobra.
 */
function guardaDeModoProductivo(): Plugin {
  return {
    name: "diana:guarda-de-modo-productivo",
    // `config` corre antes de resolver nada: si aborta, no se emite un solo fichero.
    config(_config, { command, mode }) {
      if (command !== "build") return;
      const env = loadEnv(mode, process.cwd(), "VITE_");
      const entorno = {
        VITE_API_MODE: process.env.VITE_API_MODE ?? env.VITE_API_MODE,
        MODE: mode,
        PROD: mode === "production",
        // OJO: NO se mira `process.env.NODE_ENV`. Vite lo pone a
        // `production` en TODA build, incluida `vite build --mode
        // development`; usarlo aquí cerraba también la salida de emergencia
        // documentada en el mensaje de error (comprobado: la build de
        // desarrollo en `mock` fallaba con el texto de producción). Dentro
        // del bundle sí vale, porque allí `import.meta.env.PROD` refleja el
        // modo real de compilación.
      };
      if (!esCompilacionDeProduccion(entorno)) return;
      // Lanza con el mensaje de `apiMode.ts`: una sola redacción del motivo.
      resolverModoApi(entorno);
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), guardaDeModoProductivo()],
  test: {
    environment: "jsdom",
    // El modo del panel se fija AQUÍ, explícitamente, en vez de heredarse.
    //
    // Al invertir el defecto a `real`, el banco de pruebas dejó de resolver
    // `apiClient` al adaptador de demostración por omisión y varias pantallas
    // empezaron a pintar errores de red de fondo (se vio en `HomePage`, donde
    // aparecieron alertas que la prueba no esperaba). Eso NO es un fallo del
    // producto: es que las pruebas de pantalla dependían de un valor ambiental
    // que nadie había escrito. Se escribe. Las pruebas que quieran el
    // adaptador real lo piden con `vi.spyOn`, como ya hacen.
    env: { VITE_API_MODE: "mock" },
    // 5 s (el defecto) NO alcanza en esta máquina cuando la suite corre
    // entera y en paralelo: `CredencialMqttCard.test.tsx` agota el plazo en la
    // tanda completa y pasa en 0,6 s cuando se ejecuta el fichero solo
    // (medido: `npx vitest run <fichero> --testTimeout=30000` → 5/5 en 17,9 s,
    // de los cuales 0,588 s son de prueba y el resto arranque del entorno).
    // Es coste de arranque de jsdom bajo carga, no una espera del producto.
    // Se sube el plazo en vez de quitar la prueba o darle un `retry`: un
    // reintento habría escondido una carrera de verdad el día que la haya.
    testTimeout: 20_000,
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
