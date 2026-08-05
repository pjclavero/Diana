/// <reference types="node" />
// Las pruebas de guardarraíl leen el árbol de ficheros y compilan casos con el
// compilador de TypeScript, así que necesitan los tipos de Node. Se piden con
// una directiva local en vez de tocar `tsconfig.app.json`, que es territorio
// compartido con los demás carriles.
import { readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as ts from "typescript";

import { RUTAS_AUSENTES_DEL_BACKEND } from "./realAdapter";

/**
 * GUARDARRAÍL DE CLASE, no de caso: nadie puede nacer FUERA de la puerta.
 *
 * La causa de fondo de las once pantallas rotas no fue una ruta mal escrita,
 * fue que cada cliente nuevo se traía su propia función de `fetch` y por tanto
 * nadie comprobaba nunca si la ruta existía. Poner la puerta y migrar clientes
 * arregla lo de hoy; no impide que el cliente número catorce vuelva a nacer por
 * fuera. Esto sí lo impide.
 *
 * Este proyecto NO tiene ESLint configurado (no hay `.eslintrc*` ni
 * `eslint.config*`), así que no hay regla que activar sin meter herramienta
 * nueva. Se sigue el precedente del carril B
 * (`server/backend/test/mqtt/no-floating-mqtt-promises.spec.ts`): recorrer el
 * AST con el compilador de TypeScript, que YA es dependencia, y fallar
 * señalando fichero y línea.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LÍMITE HONESTO. LÉASE ENTERO ANTES DE FIARSE DE ESTA PUERTA.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * La comprobación es SINTÁCTICA, sin comprobador de tipos: reconoce FORMAS DE
 * ESCRITURA, no el hecho de salir a la red. Eso NO es un matiz de dos casos
 * raros — es un agujero ancho, y conviene decir cuán ancho antes de que alguien
 * decida apoyarse en esto. Se atacó a propósito con ocho vías de fuga; el
 * detector caza cuatro y se le escapan cuatro.
 *
 * LO QUE SÍ CAZA (con control positivo cada una, más abajo):
 *   1. `fetch(...)` a secas.
 *   2. `window.fetch(...)`, `globalThis.fetch(...)`, `self.fetch(...)`.
 *   3. La misma llamada en NOTACIÓN CON CORCHETES: `window["fetch"](...)`.
 *      Añadida porque es la vía más plausible de aparecer sin mala intención
 *      (código generado, acceso dinámico) y es barata de cubrir.
 *   4. `new XMLHttpRequest()`. Igual de barata, y es el otro transporte que un
 *      desarrollador puede alcanzar sin instalar nada.
 *
 * LO QUE NO CAZA, y está COMPROBADO que no lo caza (ver el bloque de pruebas
 * «fugas conocidas», que fija cada una para que este comentario no envejezca
 * en silencio):
 *   a. Alias por variable: `const f = window.fetch; f("/api/x")`. Un fichero
 *      real escrito así pasa la suite EN VERDE, sin un aviso.
 *   b. Desestructuración: `const { fetch } = window; fetch("/api/x")`.
 *   c. Alias del objeto global: `const g = globalThis; g.fetch("/api/x")`.
 *   d. `fetch` recibido como PARÁMETRO de una función y llamado dentro.
 *   e. `import()` dinámico de un módulo que haga la petición.
 *   f. Cualquier biblioteca HTTP de terceros (`axios`, `ky`, `superagent`…) si
 *      algún día entrase en el `package.json`. Hoy no hay ninguna.
 *
 * En resumen: esto detiene al que escribe un cliente nuevo de la forma NORMAL,
 * que es exactamente como nacieron los trece de este directorio y las once
 * pantallas rotas. NO detiene a quien rodee la regla, ni a propósito ni por
 * casualidad. No se ha forzado el detector más allá: perseguir alias exigiría
 * el comprobador de tipos y un análisis de flujo, y un detector frágil que
 * pretenda verlo todo es peor que uno honesto sobre lo que no ve.
 *
 * Contrapeso a esa ceguera, y por eso importa: el barrido comprueba además,
 * por una vía independiente (texto plano, no AST), que encuentra TODAS las
 * llamadas que hay hoy en `src/`; y la lista de deuda sólo puede encoger.
 */

const AQUI = resolve(fileURLToPath(import.meta.url), "..");
const SRC = resolve(AQUI, "..");
const RAIZ_REPO = resolve(AQUI, "../../../..");

/**
 * Ficheros que TODAVÍA llaman a `fetch` por su cuenta. Es DEUDA DECLARADA, con
 * fecha y motivo, no una excepción permanente. La prueba de abajo exige que
 * cada entrada siga teniendo un `fetch` de verdad: una entrada que sobre hace
 * fallar la prueba, así que la lista sólo puede ENCOGER.
 *
 * Estado a 2026-08-05: migrados a la puerta 7 de 13 clientes — `modulesApi`
 * (muestra), `realAdapter` (el que concentraba las rutas inexistentes) y los
 * cinco que desenvuelven `{items}` de un listado, que son los que producen el
 * fallo silencioso de tabla vacía: `playersApi`, `viewsApi`, `participantsApi`,
 * `scoreboardApi`, `firmwareApi`.
 */
const DEUDA_DECLARADA: Record<string, string> = {
  "api/typedRequest.ts": "LA PUERTA. Es el único `fetch` legítimo del panel.",
  "api/invitationsApi.ts": "No desenvuelve listados; sin fallo silencioso conocido. Pendiente.",
  "api/presetsApi.ts": "Devuelve `{items,ownCount,maxOwn}` tal cual, sin desenvolver. Pendiente.",
  "api/topologyApi.ts": "Devuelve `{items}` sin desenvolver, así que no vacía tablas en silencio. Pendiente.",
  "api/resilienceApi.ts": "Sin listados. Pendiente.",
  "api/managerActivationApi.ts": "Devuelve `{items}` sin desenvolver. Pendiente.",
  "api/diagnosticsApi.ts": "Sin listados desenvueltos. Pendiente.",
  "auth/authApi.ts":
    "Autenticación: corre ANTES de que haya token y tiene su propio manejo de 401. Migrarla toca el arranque de sesión; fuera del alcance de este carril.",
};

interface LlamadaFetch {
  ubicacion: string;
  fichero: string;
  forma: string;
}

function ficherosFuente(dir: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) {
      salida.push(...ficherosFuente(ruta));
    } else if (/\.tsx?$/.test(entrada) && !/\.d\.ts$/.test(entrada)) {
      salida.push(ruta);
    }
  }
  return salida;
}

const RECEPTORES_GLOBALES = /^(window|globalThis|self)$/;

/**
 * ¿Esta expresión es una petición HTTP hecha a mano, fuera de la puerta?
 * Devuelve la forma reconocida, o `null`. Ver el bloque de límites de arriba
 * para lo que deliberadamente NO reconoce.
 */
function esLlamadaFetch(nodo: ts.Node, fuente: ts.SourceFile): string | null {
  // `new XMLHttpRequest()`: el otro transporte alcanzable sin instalar nada.
  if (ts.isNewExpression(nodo) && ts.isIdentifier(nodo.expression) && nodo.expression.text === "XMLHttpRequest") {
    return "new XMLHttpRequest()";
  }
  if (!ts.isCallExpression(nodo)) return null;
  const callee = nodo.expression;
  if (ts.isIdentifier(callee) && callee.text === "fetch") return "fetch(...)";
  if (ts.isPropertyAccessExpression(callee) && callee.name.text === "fetch") {
    const receptor = callee.expression.getText(fuente);
    if (RECEPTORES_GLOBALES.test(receptor)) return `${receptor}.fetch(...)`;
  }
  // Notación con corchetes: `window["fetch"](...)`, `globalThis['fetch'](...)`.
  if (ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression)) {
    if (callee.argumentExpression.text === "fetch") {
      const receptor = callee.expression.getText(fuente);
      if (RECEPTORES_GLOBALES.test(receptor)) return `${receptor}["fetch"](...)`;
    }
  }
  return null;
}

function barrer(ficheros: string[]): LlamadaFetch[] {
  const llamadas: LlamadaFetch[] = [];
  for (const fichero of ficheros) {
    const fuente = ts.createSourceFile(
      fichero,
      readFileSync(fichero, "utf8"),
      ts.ScriptTarget.ES2022,
      true,
      /\.tsx$/.test(fichero) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visitar = (nodo: ts.Node): void => {
      const forma = esLlamadaFetch(nodo, fuente);
      if (forma) {
        const { line } = fuente.getLineAndCharacterOfPosition(nodo.getStart(fuente));
        const rel = relative(SRC, fichero).split("\\").join("/");
        llamadas.push({ ubicacion: `${rel}:${line + 1}`, fichero: rel, forma });
      }
      ts.forEachChild(nodo, visitar);
    };
    visitar(fuente);
  }
  return llamadas;
}

/** Ficheros de producción: fuera las pruebas, que sí pueden simular `fetch`. */
const FICHEROS = ficherosFuente(SRC).filter(
  (f) => !/\.test\.tsx?$/.test(f) && !relative(SRC, f).startsWith("test"),
);
const LLAMADAS = barrer(FICHEROS);

describe("ningún cliente REST nace fuera de la puerta del contrato", () => {
  it("el barrido no está mirando al vacío", () => {
    // Si alguien mueve `src/`, rompe el recorrido del AST o cambia la
    // extensión de los ficheros, el barrido devolvería cero y esta prueba
    // daría verde eterno sin comprobar nada. Aquí se le exige que encuentre
    // ficheros y llamadas de verdad.
    expect(FICHEROS.length).toBeGreaterThan(50);
    expect(LLAMADAS.length).toBeGreaterThanOrEqual(8);
    expect(LLAMADAS.some((l) => l.fichero === "api/typedRequest.ts")).toBe(true);
  });

  it("el recuento del AST cuadra con un recuento independiente por texto", () => {
    // Segundo control del barrido, por una vía distinta (texto plano, no AST):
    // si los dos recuentos de FICHEROS discrepan, uno de los dos está roto.
    const porTexto = new Set(
      FICHEROS.filter((f) => {
        const texto = readFileSync(f, "utf8");
        return (
          /(^|[^.\w])fetch\s*\(/.test(texto) ||
          /\[\s*["']fetch["']\s*\]\s*\(/.test(texto) ||
          /new\s+XMLHttpRequest\s*\(/.test(texto)
        );
      }).map((f) =>
        relative(SRC, f).split("\\").join("/"),
      ),
    );
    expect([...new Set(LLAMADAS.map((l) => l.fichero))].sort()).toEqual([...porTexto].sort());
  });

  it("nadie llama a fetch fuera de la puerta salvo la deuda declarada", () => {
    const intrusos = LLAMADAS.filter((l) => !(l.fichero in DEUDA_DECLARADA)).map(
      (l) => `${l.ubicacion} · ${l.forma} — use apiRequest/apiRequestAs de src/api/typedRequest.ts`,
    );
    expect(intrusos).toEqual([]);
  });

  it("la lista de deuda no tiene entradas caducadas (sólo puede encoger)", () => {
    const conFetch = new Set(LLAMADAS.map((l) => l.fichero));
    const sobran = Object.keys(DEUDA_DECLARADA).filter((f) => !conFetch.has(f));
    expect(sobran).toEqual([]);
  });
});

describe("controles del propio detector (un detector roto daría verde eterno)", () => {
  function detectaEn(codigo: string): string[] {
    const fuente = ts.createSourceFile("ficticio.ts", codigo, ts.ScriptTarget.ES2022, true);
    const hallazgos: string[] = [];
    const visitar = (nodo: ts.Node): void => {
      const forma = esLlamadaFetch(nodo, fuente);
      if (forma) hallazgos.push(forma);
      ts.forEachChild(nodo, visitar);
    };
    visitar(fuente);
    return hallazgos;
  }

  it("CONTROL POSITIVO: acusa la llamada directa y sobre los globales", () => {
    expect(detectaEn('const r = await fetch("/api/x");')).toEqual(["fetch(...)"]);
    expect(detectaEn('window.fetch("/api/x");')).toEqual(["window.fetch(...)"]);
    expect(detectaEn('globalThis.fetch("/api/x");')).toEqual(["globalThis.fetch(...)"]);
    expect(detectaEn('self.fetch("/api/x");')).toEqual(["self.fetch(...)"]);
  });

  it("CONTROL POSITIVO: acusa la notación con corchetes", () => {
    expect(detectaEn('window["fetch"]("/api/x");')).toEqual(['window["fetch"](...)']);
    expect(detectaEn("globalThis['fetch']('/api/x');")).toEqual(['globalThis["fetch"](...)']);
  });

  it("CONTROL POSITIVO: acusa XMLHttpRequest", () => {
    expect(detectaEn('const x = new XMLHttpRequest(); x.open("GET", "/api/x");')).toEqual([
      "new XMLHttpRequest()",
    ]);
  });

  it("CONTROL NEGATIVO: no acusa a quien pasa por la puerta ni a homónimos", () => {
    expect(detectaEn('apiRequest("/api/modules", "/api/modules");')).toEqual([]);
    expect(detectaEn("const fetchDatos = 1; console.log(fetchDatos);")).toEqual([]);
    expect(detectaEn('cache.prefetch("/api/x");')).toEqual([]);
    expect(detectaEn('const t = "fetch(/api/x)";')).toEqual([]);
    // `this.fetch` de un objeto propio no es el fetch del navegador.
    expect(detectaEn('this.fetch("/api/x");')).toEqual([]);
    // Un mapa con una clave "fetch" que no se LLAMA tampoco es una petición.
    expect(detectaEn('const conf = { fetch: false }; usar(conf["fetch"]);')).toEqual([]);
  });
});

/**
 * FUGAS CONOCIDAS, fijadas por prueba.
 *
 * Estas comprobaciones NO defienden el código: documentan, de forma
 * ejecutable, qué se le escapa al detector. Existen para que el bloque de
 * límites de la cabecera no envejezca en silencio, que es como un comentario
 * honesto se convierte con el tiempo en un comentario falso.
 *
 * SI ALGUNA DE ESTAS PRUEBAS SE PONE ROJA, no hay nada roto: significa que
 * alguien ha reforzado el detector y esa vía ya SÍ se caza. Lo correcto
 * entonces es mover el caso al bloque de controles positivos y actualizar la
 * lista de la cabecera — no relajar la prueba.
 */
describe("fugas conocidas del detector (documentadas, no defendidas)", () => {
  function detectaEn(codigo: string): string[] {
    const fuente = ts.createSourceFile("ficticio.ts", codigo, ts.ScriptTarget.ES2022, true);
    const hallazgos: string[] = [];
    const visitar = (nodo: ts.Node): void => {
      const forma = esLlamadaFetch(nodo, fuente);
      if (forma) hallazgos.push(forma);
      ts.forEachChild(nodo, visitar);
    };
    visitar(fuente);
    return hallazgos;
  }

  it("(a) alias por variable: SE ESCAPA", () => {
    expect(detectaEn('const f = window.fetch; f("/api/x");')).toEqual([]);
  });

  it("(b) desestructuración del global: SE ESCAPA", () => {
    expect(detectaEn('const { fetch: pedir } = window; pedir("/api/x");')).toEqual([]);
  });

  it("(c) alias del propio objeto global: SE ESCAPA", () => {
    expect(detectaEn('const g = globalThis; g.fetch("/api/x");')).toEqual([]);
  });

  it("(d) fetch recibido como parámetro: SE ESCAPA", () => {
    expect(detectaEn('function pedir(f: typeof fetch) { return f("/api/x"); }')).toEqual([]);
  });

  it("(e) import() dinámico de un módulo que pide: SE ESCAPA", () => {
    expect(detectaEn('const m = await import("./otro"); await m.pedir("/api/x");')).toEqual([]);
  });

  it("(f) una biblioteca HTTP de terceros: SE ESCAPA", () => {
    expect(detectaEn('import axios from "axios"; axios.get("/api/x");')).toEqual([]);
  });

  it("hoy NO hay ninguna biblioteca HTTP de terceros en el panel", () => {
    // Único freno real a la fuga (f): si entra una, esto se pone rojo y obliga
    // a decidir si pasa por la puerta o se declara como deuda.
    const pkg = JSON.parse(readFileSync(join(SRC, "../package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const todas = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(todas.filter((d) => /^(axios|ky|got|superagent|node-fetch|request|undici)$/.test(d))).toEqual([]);
  });

  it("un fichero real escrito con alias pasaría el barrido sin avisar", () => {
    // La afirmación más incómoda del bloque de límites, comprobada de verdad
    // sobre el barrido COMPLETO y no sólo sobre el reconocedor: se le pasa el
    // fichero por el mismo camino que a los de `src/` y no sale nada.
    const ficheroTrampa = join(tmpdir(), `diana-fuga-${process.pid}.ts`);
    writeFileSync(
      ficheroTrampa,
      'const f = window.fetch;\nexport async function colarse() {\n  return (await f("/api/inventada")).json();\n}\n',
    );
    try {
      expect(barrer([ficheroTrampa])).toEqual([]);
    } finally {
      rmSync(ficheroTrampa, { force: true });
    }
  });
});

describe("los huecos declarados de realAdapter siguen siendo huecos de verdad", () => {
  const contrato = JSON.parse(
    readFileSync(join(RAIZ_REPO, "contracts/api/openapi.json"), "utf8"),
  ) as { paths: Record<string, unknown> };
  const rutasDelContrato = Object.keys(contrato.paths);

  it("el contrato leído es el de verdad (control de que no se lee un fichero vacío)", () => {
    expect(rutasDelContrato.length).toBeGreaterThan(100);
    expect(rutasDelContrato).toContain("/api/modules");
  });

  it("ninguna ruta del registro de ausentes existe ya en el contrato", () => {
    // Si el backend implementa cualquiera de ellas, esta prueba se pone roja y
    // obliga a migrarla en `realAdapter.ts` en vez de dejar el hueco muerto.
    const yaExisten = Object.entries(RUTAS_AUSENTES_DEL_BACKEND)
      .filter(([, ruta]) => rutasDelContrato.includes(ruta))
      .map(([op, ruta]) => `${op} → ${ruta} YA existe en el contrato: migre la llamada`);
    expect(yaExisten).toEqual([]);
  });

  it("el registro no está vacío (X-21 sigue abierto y se dice cuánto)", () => {
    expect(Object.keys(RUTAS_AUSENTES_DEL_BACKEND).length).toBeGreaterThan(0);
  });
});
