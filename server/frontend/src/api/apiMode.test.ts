import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ConfiguracionDeModoInvalida,
  MODO_POR_DEFECTO,
  esCompilacionDeProduccion,
  resolverModoApi,
} from "./apiMode";

const RAIZ_REPO = path.resolve(__dirname, "..", "..", "..", "..");
const RAIZ_PANEL = path.resolve(__dirname, "..", "..");

describe("resolución del modo del panel", () => {
  it("sin configuración, el modo es `real` (el defecto ya no es demostración)", () => {
    expect(resolverModoApi({})).toBe("real");
    expect(MODO_POR_DEFECTO).toBe("real");
  });

  it("`mock` sigue disponible como herramienta de desarrollo", () => {
    expect(resolverModoApi({ VITE_API_MODE: "mock", MODE: "development" })).toBe("mock");
    expect(resolverModoApi({ VITE_API_MODE: "mock" })).toBe("mock");
  });

  it("`mock` en una compilación de producción LANZA, no degrada", () => {
    for (const produccion of [{ PROD: true }, { MODE: "production" }, { NODE_ENV: "production" }]) {
      expect(() => resolverModoApi({ VITE_API_MODE: "mock", ...produccion })).toThrow(
        ConfiguracionDeModoInvalida,
      );
    }
  });

  it("el mensaje dice QUÉ pasaría, no sólo que está mal", () => {
    let mensaje = "";
    try {
      resolverModoApi({ VITE_API_MODE: "mock", PROD: true });
    } catch (e) {
      mensaje = (e as Error).message;
    }
    expect(mensaje).toContain("VITE_API_MODE=mock");
    expect(mensaje).toContain("DEMOSTRACIÓN");
    expect(mensaje).toContain("VITE_API_MODE=real");
  });

  it("una errata NO cae en la rama de demostración: lanza", () => {
    // Éste era el fallo real del `as \"mock\" | \"real\"`: cualquier valor
    // distinto de `real` acababa sirviendo datos falsos. `REAL` con mayúsculas
    // habría bastado.
    for (const errata of ["REAL", "Real", "prod", "true", "1", "mocK"]) {
      expect(() => resolverModoApi({ VITE_API_MODE: errata })).toThrow(ConfiguracionDeModoInvalida);
    }
  });

  it("una cadena vacía o sólo espacios es ausencia, no un modo raro", () => {
    expect(resolverModoApi({ VITE_API_MODE: "" })).toBe("real");
    expect(resolverModoApi({ VITE_API_MODE: "   " })).toBe("real");
    expect(resolverModoApi({ VITE_API_MODE: "  ", PROD: true })).toBe("real");
  });

  it("`real` en producción es correcto y no molesta", () => {
    expect(resolverModoApi({ VITE_API_MODE: "real", PROD: true })).toBe("real");
  });

  it("las tres señales de producción se reconocen por separado", () => {
    expect(esCompilacionDeProduccion({})).toBe(false);
    expect(esCompilacionDeProduccion({ MODE: "development", NODE_ENV: "development" })).toBe(false);
    expect(esCompilacionDeProduccion({ PROD: true })).toBe(true);
    expect(esCompilacionDeProduccion({ MODE: "production" })).toBe(true);
    expect(esCompilacionDeProduccion({ NODE_ENV: "production" })).toBe(true);
  });
});

/**
 * El defecto no vivía en el código, vivía en TRES ficheros de despliegue a la
 * vez. Comprobarlo leyendo los ficheros es lo único que impide que uno de los
 * tres vuelva a `mock` sin que nadie se entere.
 */
describe("el defecto declarado en los ficheros de despliegue", () => {
  const casos: Array<{ fichero: string; patron: RegExp }> = [
    { fichero: path.join(RAIZ_PANEL, "Dockerfile"), patron: /^ARG VITE_API_MODE=(\S+)$/m },
    { fichero: path.join(RAIZ_PANEL, ".env.example"), patron: /^VITE_API_MODE=(\S+)$/m },
    { fichero: path.join(RAIZ_REPO, "compose.yml"), patron: /VITE_API_MODE:\s*\$\{VITE_API_MODE:-(\S+?)\}/ },
  ];

  it.each(casos)("$fichero declara `real` por defecto", ({ fichero, patron }) => {
    const contenido = fs.readFileSync(fichero, "utf8");
    const m = patron.exec(contenido);
    expect(m, `no se encontró la declaración de VITE_API_MODE en ${fichero}`).not.toBeNull();
    expect(m![1]).toBe("real");
  });
});

/**
 * El guardián de compilación tiene que estar ENCHUFADO, no sólo escrito: un
 * complemento definido y no listado en `plugins` no corre nunca. Se comprueba
 * sobre el fichero porque `vite.config.ts` no se puede importar aquí sin
 * arrastrar el arranque de Vite.
 */
describe("el guardián de compilación está enchufado", () => {
  const config = fs.readFileSync(path.join(RAIZ_PANEL, "vite.config.ts"), "utf8");

  it("`vite.config.ts` define el guardián y lo incluye en `plugins`", () => {
    expect(config).toMatch(/function guardaDeModoProductivo\(\)/);
    expect(config).toMatch(/plugins:\s*\[[^\]]*guardaDeModoProductivo\(\)/);
  });

  it("el guardián reutiliza la regla de `apiMode.ts` en vez de reescribirla", () => {
    // La extensión `.js` la exige `moduleResolution: node16` del proyecto de
    // Node (`tsconfig.node.json`), que es el que compila `vite.config.ts`.
    expect(config).toMatch(/from "\.\/src\/api\/apiMode(\.js)?"/);
    expect(config).toMatch(/resolverModoApi\(/);
  });
});
