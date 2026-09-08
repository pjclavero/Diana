import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { OPERACIONES, SIN_ATENDER, resumen, type Veredicto } from "./rutasDelPanel";

/**
 * La clasificación se COMPRUEBA contra el contrato, no se recuerda.
 *
 * Un informe anterior decía «faltan 13 rutas». Trece es el número, sí — pero
 * el número solo no vale para nada, porque metía en el mismo saco una ruta que
 * el backend tiene con otro nombre, una que ya nadie usa y una que hay que
 * escribir. Estas pruebas verifican las tres cosas por separado y contra
 * ficheros reales:
 *
 *   1. Cuántas son, contadas sobre el registro (no sobre la memoria de nadie).
 *   2. Que la ruta que el panel pedía NO existe en `contracts/api/openapi.json`
 *      — si algún día aparece, el veredicto caduca y esto se pone rojo.
 *   3. Que la ruta real con la que se resuelve SÍ existe en el contrato.
 *   4. Que los consumidores declarados existen en el árbol y que las
 *      operaciones declaradas sin consumidores no aparecen en ninguna pantalla.
 */

const RAIZ = path.resolve(__dirname, "..", "..", "..", "..");
const contrato = JSON.parse(
  fs.readFileSync(path.join(RAIZ, "contracts", "api", "openapi.json"), "utf8"),
) as { paths: Record<string, Record<string, unknown>> };

/** "PATCH /api/x/{id}" o "/api/x/{id}" → { metodo, ruta }. */
function partir(referencia: string): { metodo: string | null; ruta: string } {
  const m = /^([A-Z]+)\s+(.*)$/.exec(referencia);
  return m ? { metodo: m[1].toLowerCase(), ruta: m[2] } : { metodo: null, ruta: referencia };
}

function paginas(): string[] {
  const raiz = path.resolve(__dirname, "..");
  const recorrer = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return recorrer(full);
      return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : [];
    });
  return recorrer(path.join(raiz, "pages"));
}

describe("clasificación de las rutas que el panel pedía y el backend no expone", () => {
  it("son 13, contadas sobre el registro", () => {
    // El recuento sale del fichero, no de un informe. Si alguien añade o cierra
    // una operación, esta prueba obliga a actualizar el número a conciencia.
    expect(Object.keys(OPERACIONES)).toHaveLength(13);
  });

  it("el reparto por veredicto es el declarado y suma el total", () => {
    const r = resumen();
    expect(r.PORT_FRONTEND.sort()).toEqual(
      [
        "getGameResult",
        "getGameState",
        "getModuleConfig",
        "listIncidents",
        "listModules",
        "resolveIncident",
      ].sort(),
    );
    expect(r.IMPLEMENT_BACKEND.sort()).toEqual(
      ["getModuleTelemetry", "startGame", "updateModuleConfig"].sort(),
    );
    expect(r.OBSOLETE.sort()).toEqual(["getTopology", "saveTopology"].sort());
    expect(r.DUPLICATE).toEqual(["listPresets"]);
    expect(r.NOT_NEEDED).toEqual(["listDiagnostics"]);

    const total = (Object.keys(r) as Veredicto[]).reduce((acc, k) => acc + r[k].length, 0);
    expect(total).toBe(Object.keys(OPERACIONES).length);
  });

  it.each(Object.entries(OPERACIONES))(
    "%s · la ruta que el panel pedía NO existe en el contrato",
    (_nombre, op) => {
      const { ruta } = partir(op.rutaPedida);
      expect(Object.keys(contrato.paths)).not.toContain(ruta);
    },
  );

  it.each(Object.entries(OPERACIONES).filter(([, o]) => o.rutaReal))(
    "%s · la ruta real con la que se resuelve SÍ existe, con su método",
    (_nombre, op) => {
      const { metodo, ruta } = partir(op.rutaReal!);
      expect(Object.keys(contrato.paths)).toContain(ruta);
      if (metodo) expect(Object.keys(contrato.paths[ruta])).toContain(metodo);
    },
  );

  it("las operaciones sin consumidores declarados no las llama ninguna pantalla", () => {
    const fuentes = paginas().map((f) => fs.readFileSync(f, "utf8"));
    for (const [nombre, op] of Object.entries(OPERACIONES)) {
      if (op.consumidores.length > 0) continue;
      const llamada = new RegExp(`apiClient\\s*\\.\\s*${nombre}\\b`);
      const quienes = paginas().filter((_f, i) => llamada.test(fuentes[i]));
      // Si aparece un consumidor nuevo, el veredicto («nadie la usa») deja de
      // ser cierto y hay que revisarlo: no se puede dejar caducar en silencio.
      expect({ operacion: nombre, quienes }).toEqual({ operacion: nombre, quienes: [] });
    }
  });

  it("los consumidores declarados existen y llaman de verdad a esa operación", () => {
    for (const [nombre, op] of Object.entries(OPERACIONES)) {
      for (const rel of op.consumidores) {
        const fichero = path.resolve(__dirname, "..", rel);
        expect(fs.existsSync(fichero), `${rel} no existe`).toBe(true);
        expect(fs.readFileSync(fichero, "utf8")).toMatch(new RegExp(`apiClient\\s*\\.\\s*${nombre}\\b`));
      }
    }
  });

  it("sólo siguen sin atenderse las que no son PORT_FRONTEND ni DUPLICATE", () => {
    expect(SIN_ATENDER.sort()).toEqual(
      [
        "getModuleTelemetry",
        "updateModuleConfig",
        "getTopology",
        "saveTopology",
        "startGame",
        "listDiagnostics",
      ].sort(),
    );
  });
});
