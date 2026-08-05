/// <reference types="node" />
// Las pruebas de guardarraíl leen el árbol de ficheros y compilan casos con el
// compilador de TypeScript, así que necesitan los tipos de Node. Se piden con
// una directiva local en vez de tocar `tsconfig.app.json`, que es territorio
// compartido con los demás carriles.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import * as ts from "typescript";

/**
 * La puerta es una puerta DE TIPOS: no falla en ejecución, falla al compilar.
 * Por eso no se puede comprobar con una prueba normal — hay que COMPILAR y
 * mirar los diagnósticos. Eso es lo que hace esto.
 *
 * No se comprueba una copia de la lógica: se lee `typedRequest.ts` TAL CUAL del
 * disco y se compila contra un contrato SINTÉTICO con dos rutas —una que calla
 * la forma (el estado de hoy: 0 de 112 rutas anotadas) y otra que la declara
 * (el estado al que hay que llegar)—. Así se puede comprobar hoy el
 * comportamiento futuro sin anotar el backend.
 *
 * Cada caso lleva su control: uno que DEBE compilar y uno que DEBE fallar. Si
 * la maquinaria de tipos se rompiese y dejara de rechazar nada, los casos
 * «debe fallar» se pondrían rojos en vez de dar verde eterno.
 */

const AQUI = resolve(fileURLToPath(import.meta.url), "..");

const ESQUEMA_SINTETICO = `
export interface paths {
  /** Ruta SIN \`@ApiResponse({ type })\`: es lo que emite Nest hoy en las 112. */
  "/api/calla": {
    get: { responses: { 200: { content?: never } } };
  };
  /** Ruta YA anotada: el futuro al que debe llevar anotar los controladores. */
  "/api/habla": {
    get: { responses: { 200: { content: { "application/json": { total: number } } } } };
    post: { responses: { 201: { content: { "application/json": { id: string } } } } };
  };
  "/api/solo-get": {
    get: { responses: { 200: { content?: never } } };
  };
  "/api/recurso/{id}": {
    get: { responses: { 200: { content?: never } } };
  };
}
`;

const STUB_CLIENT = `
export class ApiError extends Error {
  readonly userMessage: string;
  constructor(userMessage: string) { super(userMessage); this.userMessage = userMessage; }
}
`;

const STUB_TOKEN = `export function getToken(): string | null { return null; }`;

const AMBIENTE = `
interface ImportMetaEnv { readonly VITE_API_BASE_URL?: string }
interface ImportMeta { readonly env: ImportMetaEnv }
`;

let raiz: string;

function escribir(rel: string, contenido: string): void {
  const destino = join(raiz, rel);
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, contenido);
}

/** Compila el caso y devuelve los mensajes de error (vacío = compila). */
function erroresDe(caso: string): string[] {
  escribir("src/api/caso.ts", caso);
  const opciones: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  };
  const programa = ts.createProgram(
    [join(raiz, "src/api/caso.ts"), join(raiz, "src/ambiente.d.ts")],
    opciones,
  );
  return ts
    .getPreEmitDiagnostics(programa)
    .filter((d) => d.file?.fileName.endsWith("caso.ts"))
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "));
}

beforeAll(() => {
  raiz = mkdtempSync(join(tmpdir(), "diana-puerta-"));
  // typedRequest.ts VERBATIM: se comprueba la maquinaria real, no una copia.
  escribir("src/api/typedRequest.ts", readFileSync(join(AQUI, "typedRequest.ts"), "utf8"));
  escribir("src/api/generated/schema.d.ts", ESQUEMA_SINTETICO);
  escribir("src/api/client.ts", STUB_CLIENT);
  escribir("src/auth/tokenStore.ts", STUB_TOKEN);
  escribir("src/ambiente.d.ts", AMBIENTE);
});

const IMPORTA = `import { apiRequest, apiRequestAs } from "./typedRequest";\n`;

describe("el banco de compilación está sano", () => {
  it("CONTROL: un caso trivial y correcto compila sin errores", () => {
    expect(erroresDe(`${IMPORTA}export const x = apiRequest("/api/calla", "/api/calla");`)).toEqual([]);
  });

  it("CONTROL: un error de TypeScript cualquiera SÍ se detecta", () => {
    // Si el compilador estuviese mal montado (rutas, libs, skipLibCheck) y no
    // informara de nada, todos los casos «debe fallar» darían verde eterno.
    expect(erroresDe(`${IMPORTA}export const x: number = "no soy un número";`).length).toBeGreaterThan(0);
  });
});

describe("clases de fallo que la puerta SÍ atrapa hoy", () => {
  it("ruta inventada: no compila", () => {
    const errores = erroresDe(`${IMPORTA}export const x = apiRequest("/api/inventada", "/api/inventada");`);
    expect(errores.length).toBeGreaterThan(0);
    expect(errores.join(" ")).toContain("/api/inventada");
  });

  it("ruta renombrada (la vieja ya no está en el contrato): no compila", () => {
    expect(
      erroresDe(`${IMPORTA}export const x = apiRequest("/api/callaba", "/api/callaba");`).length,
    ).toBeGreaterThan(0);
  });

  it("URL que no casa con la plantilla declarada: no compila", () => {
    expect(
      erroresDe(`${IMPORTA}export const x = apiRequest("/api/recurso/{id}", "/api/otra-cosa/7");`).length,
    ).toBeGreaterThan(0);
  });

  it("CONTROL NEGATIVO: la URL interpolada correcta SÍ compila", () => {
    expect(
      erroresDe(`${IMPORTA}const id = "7";\nexport const x = apiRequest("/api/recurso/{id}", \`/api/recurso/\${id}\`);`),
    ).toEqual([]);
  });

  it("método no declarado para esa ruta: no compila", () => {
    expect(
      erroresDe(
        `${IMPORTA}export const x = apiRequest<"/api/solo-get", "post">("/api/solo-get", "/api/solo-get", { method: "POST" });`,
      ).length,
    ).toBeGreaterThan(0);
  });

  it("CONTROL NEGATIVO: un método que SÍ existe compila", () => {
    expect(
      erroresDe(
        `${IMPORTA}export const x = apiRequest<"/api/habla", "post">("/api/habla", "/api/habla", { method: "POST" });`,
      ),
    ).toEqual([]);
  });
});

describe("apiRequestAs se autodesactiva cuando el contrato empieza a hablar", () => {
  it("mientras el contrato calla, la anotación local es legítima y compila", () => {
    expect(
      erroresDe(`${IMPORTA}export const x = apiRequestAs<{ items: string[] }>()("/api/calla", "/api/calla");`),
    ).toEqual([]);
  });

  it("en cuanto el contrato declara la forma, la anotación local DEJA de compilar", () => {
    // Éste es el punto de la observación sobre los `as Promise<X>`: un `as`
    // seguiría tragándose el desajuste para siempre. Aquí no.
    const errores = erroresDe(
      `${IMPORTA}export const x = apiRequestAs<{ items: string[] }>()("/api/habla", "/api/habla");`,
    );
    expect(errores.length).toBeGreaterThan(0);
    expect(errores.join(" ")).toContain("El_contrato_YA_declara_la_forma_de_esta_ruta_use_apiRequest");
  });

  it("y también deja de compilar por método, no sólo por ruta", () => {
    expect(
      erroresDe(
        `${IMPORTA}export const x = apiRequestAs<{ id: string }>()<"/api/habla", "post">("/api/habla", "/api/habla", { method: "POST" });`,
      ).length,
    ).toBeGreaterThan(0);
  });

  it("la vía correcta cuando el contrato habla es apiRequest, y su tipo es el del contrato", () => {
    // Comprueba que el tipo NO es `unknown` ni `any`: si lo fuera, asignarlo a
    // un tipo incompatible compilaría y la puerta de forma no serviría.
    expect(
      erroresDe(`${IMPORTA}export const x: Promise<{ total: number }> = apiRequest("/api/habla", "/api/habla");`),
    ).toEqual([]);
    expect(
      erroresDe(`${IMPORTA}export const x: Promise<{ total: string }> = apiRequest("/api/habla", "/api/habla");`)
        .length,
    ).toBeGreaterThan(0);
  });
});
