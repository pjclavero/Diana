import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * T4 · EL PANEL NO FABRICA NI GUARDA CREDENCIALES.
 *
 * Dos reglas, y las dos se comprueban leyendo el árbol en vez de recordarlas:
 *
 *  1. **No las genera.** Una contraseña, un código de un solo uso o una clave
 *     que nazca en el navegador es una credencial que el servidor no ha
 *     autorizado, que no puede revocar y cuya calidad depende del generador de
 *     números del navegador. Quien crea credenciales es el backend.
 *  2. **No las persiste.** Si el backend entrega un secreto UNA vez, se enseña
 *     una vez y se avisa de que no volverá a verse. No va a `localStorage`, ni
 *     a `sessionStorage`, ni a la URL — de donde saldría en el historial, en
 *     los registros del proxy y en el `Referer` de la siguiente petición.
 *
 * Excepciones declaradas, con motivo. La lista sólo puede encoger, y la prueba
 * falla si sobra una entrada: una excepción que ya no hace falta es una puerta
 * abierta que nadie vigila.
 */

const RAIZ = path.resolve(__dirname, "..");

/** Ficheros que SÍ pueden usar un generador aleatorio, y por qué. */
const ALEATORIEDAD_PERMITIDA: Record<string, string> = {
  "pages/demo/demoLogic.ts":
    "Secuencia de dianas de la demostración: es un sorteo de juego, no una credencial. " +
    "Además recibe el generador por parámetro para poder fijarlo en las pruebas.",
};

/** Ficheros que SÍ pueden escribir en el almacenamiento del navegador, y por qué. */
const ALMACENAMIENTO_PERMITIDO: Record<string, string> = {
  "auth/tokenStore.ts":
    "El token de SESIÓN (JWT emitido por el backend, caducable y revocable). Es la sesión, " +
    "no una credencial reutilizable, y vive en un único fichero para poder auditarlo.",
  "pages/demo/demoLogic.ts": "Marcas de tiempo de la demostración; se pierden al cerrar la pestaña.",
};

function fuentes(): Array<{ rel: string; texto: string }> {
  const recorrer = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return recorrer(full);
      if (!/\.tsx?$/.test(e.name)) return [];
      if (/\.test\.tsx?$/.test(e.name)) return [];
      if (full.includes(`${path.sep}generated${path.sep}`)) return [];
      return [full];
    });
  return recorrer(RAIZ).map((f) => ({
    rel: path.relative(RAIZ, f).split(path.sep).join("/"),
    texto: fs.readFileSync(f, "utf8"),
  }));
}

/** Comentarios fuera: hablar de `Math.random` en una nota no es usarlo. */
function sinComentarios(texto: string): string {
  return texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("el panel no genera credenciales", () => {
  // Sin exigir el paréntesis a propósito: `Math.random` pasado como valor
  // (`rand: () => number = Math.random`) es exactamente igual de capaz de
  // fabricar una credencial que `Math.random()`, y así es como está escrito
  // hoy en la demostración. Pedir la llamada dejaba fuera esa forma.
  const GENERADORES = /\b(Math\.random|crypto\.getRandomValues|crypto\.randomUUID|randomUUID)\b/;

  it("ningún fichero fuera de la lista declarada usa un generador aleatorio", () => {
    const infractores = fuentes()
      .filter(({ rel }) => !(rel in ALEATORIEDAD_PERMITIDA))
      .filter(({ texto }) => GENERADORES.test(sinComentarios(texto)))
      .map(({ rel }) => rel);
    expect(infractores).toEqual([]);
  });

  it("las excepciones declaradas siguen existiendo y siguen usando el generador", () => {
    // Si una deja de necesitarlo, se quita de la lista. No se dejan vivas.
    for (const rel of Object.keys(ALEATORIEDAD_PERMITIDA)) {
      const fichero = path.join(RAIZ, rel);
      expect(fs.existsSync(fichero), `${rel} ya no existe: sobra en la lista`).toBe(true);
      expect(GENERADORES.test(sinComentarios(fs.readFileSync(fichero, "utf8"))), `${rel} ya no usa generador: sobra en la lista`).toBe(true);
    }
  });
});

describe("el panel no persiste secretos", () => {
  const ESCRITURA = /\b(localStorage|sessionStorage)\s*\.\s*setItem\s*\(/;

  it("sólo los ficheros declarados escriben en el almacenamiento del navegador", () => {
    const infractores = fuentes()
      .filter(({ rel }) => !(rel in ALMACENAMIENTO_PERMITIDO))
      .filter(({ texto }) => ESCRITURA.test(sinComentarios(texto)))
      .map(({ rel }) => rel);
    expect(infractores).toEqual([]);
  });

  it("las excepciones de almacenamiento siguen existiendo y siguen escribiendo", () => {
    for (const rel of Object.keys(ALMACENAMIENTO_PERMITIDO)) {
      const fichero = path.join(RAIZ, rel);
      expect(fs.existsSync(fichero), `${rel} ya no existe: sobra en la lista`).toBe(true);
      expect(ESCRITURA.test(sinComentarios(fs.readFileSync(fichero, "utf8"))), `${rel} ya no escribe: sobra en la lista`).toBe(true);
    }
  });

  it("ninguna pantalla mete una contraseña o un secreto en la URL", () => {
    // Lo que va en la URL acaba en el historial del navegador, en el registro
    // del proxy y en la cabecera `Referer` de la petición siguiente.
    const EN_LA_URL = /[?&](password|passwd|secret|api_?key|access_?token)=/i;
    const infractores = fuentes()
      .filter(({ texto }) => EN_LA_URL.test(sinComentarios(texto)))
      .map(({ rel }) => rel);
    expect(infractores).toEqual([]);
  });

  it("`tokenStore` es el ÚNICO sitio que nombra la clave de almacenamiento de la sesión", () => {
    const conLaClave = fuentes()
      .filter(({ texto }) => /diana[._-]?(auth|token)/i.test(sinComentarios(texto)))
      .map(({ rel }) => rel);
    expect(conLaClave).toEqual(["auth/tokenStore.ts"]);
  });
});
