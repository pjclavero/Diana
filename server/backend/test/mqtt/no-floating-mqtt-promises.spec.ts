import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import * as ts from 'typescript';

/**
 * Guardarraíl de CLASE, no de caso.
 *
 * `MqttService.publish` y los cinco métodos que la envuelven pasaron de
 * síncronos a `async`. Ese cambio de firma es de gran alcance y silencioso: el
 * compilador NO se queja de una llamada cuyo valor se descarta, así que un
 * llamador que no espere la promesa compila, pasa la suite, devuelve `{}` al
 * cliente en vez de `delivered`/`denied` y, si la promesa RECHAZA, tumba el
 * proceso de Node por unhandled rejection. Así apareció el defecto de
 * `maintenance.module.ts`, en un fichero que el carril nunca tocó.
 *
 * Este proyecto NO tiene ESLint configurado (no hay `.eslintrc*` ni
 * `eslint.config*` en el repositorio) y añadir el toolchain de
 * `@typescript-eslint/no-floating-promises` no está en el alcance de este
 * carril. En su lugar, la regla se aplica aquí, recorriendo el AST de TODO
 * `src/`: cualquier llamador futuro que suelte la promesa hace fallar esta
 * prueba, con fichero y línea.
 *
 * Límite honesto de esta comprobación: es SINTÁCTICA, sin comprobador de
 * tipos. Reconoce las llamadas por el NOMBRE del método sobre un acceso a
 * propiedad (`this.mqtt.sendModuleCommand(...)`, `svc.publishModuleConfig(...)`).
 * Un llamador que invocase el método a través de un alias con otro nombre
 * (`const f = this.mqtt.sendModuleCommand; f(...)`) escaparía. No se finge lo
 * contrario; hoy no existe ninguna llamada así en `src/` (todas las que
 * hay en `src/` hoy pasan por un acceso a propiedad y quedan cubiertas).
 */
const METODOS_ASINCRONOS = new Set([
  'publish',
  'sendModuleCommand',
  'sendModuleMaintenanceCommand',
  'sendSystemCommand',
  'sendOtaCommand',
  'publishSystemStatus',
  'publishModuleConfig',
]);

const SRC = resolve(__dirname, '../../src');

/**
 * `publish` es un nombre genérico: el gateway de WebSockets tiene el suyo,
 * síncrono. Sólo se vigilan los accesos sobre un receptor que sea el servicio
 * MQTT (`this.mqtt`, `mqtt`, `mqttService`, `this.client` no cuenta).
 */
const RECEPTORES_MQTT = /^(this\.)?mqtt(Service)?$/;

function ficherosTs(dir: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) {
      salida.push(...ficherosTs(ruta));
    } else if (entrada.endsWith('.ts')) {
      salida.push(ruta);
    }
  }
  return salida;
}

interface Llamada {
  ubicacion: string;
  metodo: string;
  esperada: boolean;
  forma: string;
}

/** ¿El valor de esta llamada se espera, se devuelve o se encadena? */
function veredicto(llamada: ts.CallExpression): { esperada: boolean; forma: string } {
  let nodo: ts.Node = llamada;
  let padre = nodo.parent;
  let conCatch = false;
  while (padre) {
    if (ts.isAwaitExpression(padre)) return { esperada: true, forma: 'await' };
    if (ts.isReturnStatement(padre)) return { esperada: true, forma: 'return' };
    if (ts.isVoidExpression(padre)) return { esperada: true, forma: 'void (fuego y olvido explícito)' };
    if (ts.isArrowFunction(padre) && padre.body === nodo) {
      return { esperada: true, forma: 'cuerpo conciso de flecha (la devuelve)' };
    }
    // `.then(...)` / `.catch(...)` / `.finally(...)` encadenados: el rechazo
    // no queda suelto. Se sube por la cadena hasta el veredicto final.
    if (
      ts.isPropertyAccessExpression(padre) &&
      padre.expression === nodo &&
      ['then', 'catch', 'finally'].includes(padre.name.text)
    ) {
      if (padre.name.text !== 'then') conCatch = true;
      nodo = padre;
      padre = padre.parent;
      continue;
    }
    if (ts.isCallExpression(padre) && padre.expression === nodo) {
      nodo = padre;
      padre = padre.parent;
      continue;
    }
    // Argumento de `Promise.all([...])` / `Promise.allSettled([...])`.
    if (ts.isArrayLiteralExpression(padre)) {
      nodo = padre;
      padre = padre.parent;
      continue;
    }
    if (ts.isParenthesizedExpression(padre) || ts.isAsExpression(padre)) {
      nodo = padre;
      padre = padre.parent;
      continue;
    }
    break;
  }
  // Una cadena terminada en `.catch()`/`.finally()` no deja el rechazo suelto,
  // aunque nadie espere el resultado: es fuego y olvido con red.
  if (conCatch) return { esperada: true, forma: 'cadena con .catch()' };
  return { esperada: false, forma: padre ? ts.SyntaxKind[padre.kind] : 'suelta' };
}

function todasLasLlamadas(): Llamada[] {
  const llamadas: Llamada[] = [];
  for (const fichero of ficherosTs(SRC)) {
    const esElServicio = fichero.endsWith(join('mqtt', 'mqtt.service.ts'));
    const fuente = ts.createSourceFile(
      fichero,
      readFileSync(fichero, 'utf8'),
      ts.ScriptTarget.ES2021,
      true,
    );
    const visitar = (nodo: ts.Node): void => {
      if (ts.isCallExpression(nodo) && ts.isPropertyAccessExpression(nodo.expression)) {
        const metodo = nodo.expression.name.text;
        const receptor = nodo.expression.expression.getText(fuente);
        const esReceptorMqtt = esElServicio ? receptor === 'this' : RECEPTORES_MQTT.test(receptor);
        if (METODOS_ASINCRONOS.has(metodo) && esReceptorMqtt) {
          const { line } = fuente.getLineAndCharacterOfPosition(nodo.getStart(fuente));
          const { esperada, forma } = veredicto(nodo);
          llamadas.push({ ubicacion: `${relative(SRC, fichero)}:${line + 1}`, metodo, esperada, forma });
        }
      }
      ts.forEachChild(nodo, visitar);
    };
    visitar(fuente);
  }
  return llamadas;
}

describe('Ningún llamador de los métodos MQTT asíncronos suelta la promesa', () => {
  const llamadas = todasLasLlamadas();

  it('el barrido encuentra llamadas de verdad (si no, la prueba sería vacía)', () => {
    // Control de que el recorrido no está mirando al vacío: si alguien mueve
    // `src/` o rompe el AST, esto muere en vez de dar un falso verde.
    expect(llamadas.length).toBeGreaterThanOrEqual(10);
    expect(llamadas.some((l) => l.ubicacion.startsWith('modules/maintenance/'))).toBe(true);
    expect(llamadas.some((l) => l.ubicacion.startsWith('modules/games/'))).toBe(true);
  });

  it('todas se esperan (await), se devuelven (return) o se encadenan', () => {
    const sueltas = llamadas.filter((l) => !l.esperada);
    expect(
      sueltas.map((l) => `${l.ubicacion} · ${l.metodo}() sin await/return (${l.forma})`),
    ).toEqual([]);
  });

  function veredictoDe(codigo: string): { esperada: boolean; forma: string } {
    const fuente = ts.createSourceFile('ficticio.ts', codigo, ts.ScriptTarget.ES2021, true);
    const vistos: Array<{ esperada: boolean; forma: string }> = [];
    const visitar = (nodo: ts.Node): void => {
      if (
        ts.isCallExpression(nodo) &&
        ts.isPropertyAccessExpression(nodo.expression) &&
        nodo.expression.name.text === 'sendModuleCommand'
      ) {
        vistos.push(veredicto(nodo));
      }
      ts.forEachChild(nodo, visitar);
    };
    visitar(fuente);
    expect(vistos).toHaveLength(1);
    return vistos[0];
  }

  it('el veredicto sabe distinguir: una llamada suelta SÍ se detecta (control positivo)', () => {
    // Control del propio detector: si estuviera roto y marcase todo como
    // esperado, daría verde para siempre. Aquí se le exige que acuse.
    expect(
      veredictoDe('async function f() { const c = this.mqtt.sendModuleCommand("m", "a"); return c; }')
        .esperada,
    ).toBe(false);
  });

  it('el veredicto no da falsos positivos sobre llamadas correctamente esperadas', () => {
    expect(
      veredictoDe('async function f() { const c = await this.mqtt.sendModuleCommand("m", "a"); return c; }')
        .esperada,
    ).toBe(true);
    expect(veredictoDe('function f() { return this.mqtt.sendModuleCommand("m", "a"); }').esperada).toBe(
      true,
    );
    expect(
      veredictoDe('function f() { void this.mqtt.sendModuleCommand("m", "a").catch(() => {}); }')
        .esperada,
    ).toBe(true);
  });
});
