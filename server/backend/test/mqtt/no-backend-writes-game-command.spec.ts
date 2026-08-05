import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import * as ts from 'typescript';

/**
 * Guardarraíl de CLASE, no de caso: el backend NUNCA escribe en el tópico de
 * JUEGO `targets/v1/module/{id}/command`.
 *
 * La decisión del operador fue literal: «no introduzcas ningún puente que
 * permita al backend escribir en el tópico de juego», y añadió «ni siquiera
 * apagado». La autoridad se reparte por DOMINIO: el coordinador gobierna el
 * juego, el backend el mantenimiento (`module/{id}/maintenance/command`). El
 * contrato v1.1 lo selló retirando `"backend"` del enum `issuer` de
 * `module-command.schema.json`, así que cualquier mensaje que el backend
 * construyera para ese canal sería inválido por definición.
 *
 * POR QUÉ ESTA PRUEBA CAMBIÓ DE FORMA. La versión anterior era un barrido de
 * TEXTO sobre TRES ficheros concretos de F6, y dejaba fuera —declarándolo,
 * pero dejándolo fuera— el paso genérico `POST /mqtt/modules/:id/command` de
 * `mqtt.module.ts`, que seguía vivo, autenticado y publicando en el canal de
 * juego. Un barrido de ficheros nombrados a mano no cubre el código que
 * alguien escriba mañana en otro sitio. Ahora se recorre el AST de TODO
 * `src/` con el compilador de TypeScript, igual que
 * `no-floating-mqtt-promises.spec.ts`, y se falla señalando fichero y línea.
 *
 * La ACL del broker sigue existiendo, pero es defensa de SEGUNDA línea: una
 * errata de despliegue, un reinicio con configuración vieja o una migración
 * de broker la anulan sin tocar una línea de código. Ésta es la de primera
 * línea, en el propio código de aplicación.
 *
 * ═══ LO QUE DETECTA ═══
 *  1. Cualquier llamada a `sendModuleCommand` (el publicador retirado) o a
 *     `moduleCommand` (constructor del tópico y del sobre de juego), sobre
 *     cualquier receptor: `topics.moduleCommand(id)`,
 *     `this.commands.moduleCommand(...)`, `svc.sendModuleCommand(...)`.
 *  2. La misma llamada tras DESESTRUCTURAR: `const { moduleCommand } = topics;`
 *     y luego `moduleCommand(id)` — se vigila también el identificador suelto.
 *  3. La misma llamada por NOTACIÓN DE CORCHETES con literal:
 *     `topics['moduleCommand'](id)`, `svc["sendModuleCommand"](...)`.
 *  4. El tópico de juego ESCRITO A MANO, saltándose los ayudantes: el literal
 *     `'targets/v1/module/mod-a/command'` o la plantilla
 *     `` `${TOPIC_ROOT}/module/${id}/command` ``.
 *
 * ═══ LO QUE SE LE ESCAPA (declarado, no disimulado) ═══
 * Es un análisis SINTÁCTICO, sin comprobador de tipos. Lo sortean:
 *  · el ALIAS con otro nombre: `const f = topics.moduleCommand; f(id);` — el
 *    nombre vigilado desaparece del punto de llamada;
 *  · el acceso por corchetes con clave DINÁMICA (`topics[nombre](id)`) y
 *    cualquier reflexión (`Reflect.get`, `Object.entries`);
 *  · el tópico compuesto en TIEMPO DE EJECUCIÓN por partes:
 *    `'targets/v1/module/' + id + '/command'`, o
 *    `[raiz, 'module', id, 'command'].join('/')`;
 *  · un tópico que llegara de FUERA del código (configuración, base de datos,
 *    cuerpo de una petición) y se publicara sin mirarlo.
 * Contra esa última familia la defensa real no es sintáctica, sino la ACL del
 * broker y el validador de contrato de salida. Hoy no existe en `src/` ninguna
 * construcción de estas formas; no se finge lo contrario.
 */

const SRC = resolve(__dirname, '../../src');

/** Nombres que, LLAMADOS, significan «canal de juego». */
const NOMBRES_PROHIBIDOS = new Set(['sendModuleCommand', 'moduleCommand']);

/**
 * El tópico de juego escrito a mano. Se exige la forma COMPLETA (raíz +
 * `/module/` + identificador + `/command`) para no confundirlo con la PROSA:
 * los mensajes de error al usuario mencionan `module/{id}/command` con llaves
 * literales para explicar por qué algo no está disponible, y eso es deseable,
 * no una violación.
 */
const LITERAL_TOPICO_JUEGO = /^targets\/v1\/module\/[^/\s]+\/command$/;
const PLANTILLA_TOPICO_JUEGO = /\/module\/\$\{[^}]+\}\/command$/;

/**
 * ÚNICA excepción permitida, y acotada al máximo: la definición del propio
 * constructor `topics.moduleCommand` en `src/contracts/topics.ts`. El tópico
 * de juego existe en el contrato (es del coordinador) y el backend lo nombra
 * para reconocerlo y para poder afirmar en pruebas que es DISTINTO del de
 * mantenimiento. Definirlo no es publicar en él. La exención se limita a la
 * asignación de propiedad llamada `moduleCommand` de ese fichero: un segundo
 * literal del tópico de juego en cualquier otro punto —del mismo fichero o de
 * otro— sí es violación.
 */
const FICHERO_DEFINICION = resolve(SRC, 'contracts/topics.ts');

interface Violacion {
  ubicacion: string;
  motivo: string;
  fragmento: string;
}

function ficherosTs(dir: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) salida.push(...ficherosTs(ruta));
    else if (entrada.endsWith('.ts')) salida.push(ruta);
  }
  return salida;
}

/** Nombre invocado en esta llamada, sea cual sea la forma sintáctica. */
function nombreInvocado(llamada: ts.CallExpression): string | null {
  const callee = llamada.expression;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text; // topics.moduleCommand(…)
  if (ts.isIdentifier(callee)) return callee.text; // moduleCommand(…) tras desestructurar
  if (ts.isElementAccessExpression(callee)) {
    const arg = callee.argumentExpression;
    if (ts.isStringLiteralLike(arg)) return arg.text; // topics['moduleCommand'](…)
  }
  return null;
}

/** ¿Este literal de tópico está en la definición exenta de `topics.ts`? */
function esDefinicionPermitida(nodo: ts.Node, fichero: string): boolean {
  if (fichero !== FICHERO_DEFINICION) return false;
  let actual: ts.Node | undefined = nodo;
  while (actual) {
    if (
      ts.isPropertyAssignment(actual) &&
      ts.isIdentifier(actual.name) &&
      actual.name.text === 'moduleCommand'
    ) {
      return true;
    }
    actual = actual.parent;
  }
  return false;
}

function analizar(fichero: string, codigo: string): Violacion[] {
  const violaciones: Violacion[] = [];
  const fuente = ts.createSourceFile(fichero, codigo, ts.ScriptTarget.ES2021, true);
  const ubicacionDe = (nodo: ts.Node): string => {
    const { line } = fuente.getLineAndCharacterOfPosition(nodo.getStart(fuente));
    const nombre = fichero.startsWith(SRC) ? relative(SRC, fichero) : fichero;
    return `${nombre}:${line + 1}`;
  };

  const visitar = (nodo: ts.Node): void => {
    if (ts.isCallExpression(nodo)) {
      const nombre = nombreInvocado(nodo);
      if (nombre && NOMBRES_PROHIBIDOS.has(nombre)) {
        violaciones.push({
          ubicacion: ubicacionDe(nodo),
          motivo: `llamada a ${nombre}() — canal de juego module/{id}/command`,
          fragmento: nodo.getText(fuente).slice(0, 80),
        });
      }
    }
    if (ts.isStringLiteralLike(nodo) && LITERAL_TOPICO_JUEGO.test(nodo.text)) {
      if (!esDefinicionPermitida(nodo, fichero)) {
        violaciones.push({
          ubicacion: ubicacionDe(nodo),
          motivo: 'literal del tópico de juego escrito a mano',
          fragmento: nodo.text,
        });
      }
    }
    if (ts.isTemplateExpression(nodo)) {
      const texto = nodo.getText(fuente).replace(/^`|`$/g, '');
      if (PLANTILLA_TOPICO_JUEGO.test(texto) && !esDefinicionPermitida(nodo, fichero)) {
        violaciones.push({
          ubicacion: ubicacionDe(nodo),
          motivo: 'plantilla del tópico de juego construida a mano',
          fragmento: texto.slice(0, 80),
        });
      }
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(fuente);
  return violaciones;
}

const FICHEROS = ficherosTs(SRC);
const VIOLACIONES = FICHEROS.flatMap((f) => analizar(f, readFileSync(f, 'utf8')));

describe('Ningún punto de src/ escribe en el tópico de juego module/{id}/command', () => {
  it('el barrido recorre src/ de verdad (si no, la prueba estaría vacía)', () => {
    // Si alguien mueve `src/` o rompe el recorrido, esto muere en vez de dar
    // un falso verde por «no he encontrado nada».
    expect(FICHEROS.length).toBeGreaterThanOrEqual(30);
    expect(FICHEROS).toContain(resolve(SRC, 'modules/mqtt/mqtt.service.ts'));
    expect(FICHEROS).toContain(resolve(SRC, 'modules/mqtt/mqtt.module.ts'));
    expect(FICHEROS).toContain(resolve(SRC, 'modules/modules/module-diagnostics.service.ts'));
    expect(FICHEROS).toContain(FICHERO_DEFINICION);
  });

  it('no hay ni una sola violación en todo src/', () => {
    expect(VIOLACIONES.map((v) => `${v.ubicacion} · ${v.motivo} · ${v.fragmento}`)).toEqual([]);
  });

  /**
   * El puente que este bloqueante venía a cerrar: `MqttService.sendModuleCommand`
   * y `POST /mqtt/modules/:id/command`. Se RETIRARON. Un método sin llamadas
   * hoy es el puente de mañana, así que se fija que ni siquiera queda declarado.
   */
  it('sendModuleCommand ya no existe como método de MqttService', () => {
    const fuente = readFileSync(resolve(SRC, 'modules/mqtt/mqtt.service.ts'), 'utf8');
    const ast = ts.createSourceFile('mqtt.service.ts', fuente, ts.ScriptTarget.ES2021, true);
    const metodos: string[] = [];
    const visitar = (n: ts.Node): void => {
      if (ts.isMethodDeclaration(n) && ts.isIdentifier(n.name)) metodos.push(n.name.text);
      ts.forEachChild(n, visitar);
    };
    visitar(ast);
    expect(metodos).not.toContain('sendModuleCommand');
    // Control de que la lista se llenó: si quedara vacía por un fallo del
    // recorrido, el `not.toContain` pasaría siempre.
    expect(metodos).toContain('sendModuleMaintenanceCommand');
  });

  it('la ruta HTTP hacia el canal de juego ya no está declarada', () => {
    const fuente = readFileSync(resolve(SRC, 'modules/mqtt/mqtt.module.ts'), 'utf8');
    const ast = ts.createSourceFile('mqtt.module.ts', fuente, ts.ScriptTarget.ES2021, true);
    const decoradores: string[] = [];
    const visitar = (n: ts.Node): void => {
      if (ts.isDecorator(n)) decoradores.push(n.getText(ast));
      ts.forEachChild(n, visitar);
    };
    visitar(ast);
    expect(decoradores.filter((d) => /^@Post\(/.test(d))).toEqual([]);
    // Control de que sí se leyeron decoradores (el controlador conserva @Get).
    expect(decoradores.some((d) => /^@Get\(/.test(d))).toBe(true);
  });

  it('el canal de mantenimiento SÍ se usa (no es que el backend haya dejado de publicar)', () => {
    const publicadores = FICHEROS.filter((f) =>
      /sendModuleMaintenanceCommand\s*\(/.test(readFileSync(f, 'utf8')),
    ).map((f) => relative(SRC, f));
    expect(publicadores).toEqual(
      expect.arrayContaining([
        join('modules', 'modules', 'module-diagnostics.service.ts'),
        join('modules', 'maintenance', 'maintenance.module.ts'),
      ]),
    );
  });

  // ─────────── Control del propio detector ───────────
  // Sin esto, un detector roto que no acusara NADA daría verde para siempre.

  const casos: Array<[string, string]> = [
    ['acceso por propiedad', 'async function f() { await this.mqtt.sendModuleCommand("m", "a"); }'],
    ['constructor del tópico', 'const t = topics.moduleCommand(moduleId);'],
    ['constructor del sobre', 'const c = this.commands.moduleCommand(id, "identify", {}, {});'],
    ['desestructuración', 'const { moduleCommand } = topics; const t = moduleCommand(id);'],
    ['notación de corchetes', 'const t = topics["moduleCommand"](id);'],
    ['corchetes sobre el publicador', "const p = svc['sendModuleCommand'](id, 'a');"],
    ['literal escrito a mano', 'await this.publish("targets/v1/module/mod-a/command", c);'],
    ['plantilla escrita a mano', 'await this.publish(`${TOPIC_ROOT}/module/${id}/command`, c);'],
    ['plantilla con raíz literal', 'await this.publish(`targets/v1/module/${id}/command`, c);'],
  ];

  it.each(casos)('control positivo · %s SÍ se detecta', (_etiqueta, codigo) => {
    expect(analizar('/ficticio/prueba.ts', codigo)).not.toEqual([]);
  });

  const inocentes: Array<[string, string]> = [
    [
      'prosa en un mensaje de error',
      "throw new Error('el backend no escribe en `module/{id}/command`');",
    ],
    ['canal de mantenimiento', 'await this.publish(topics.moduleMaintenanceCommand(id), c);'],
    [
      'plantilla del canal de mantenimiento',
      'const t = `${TOPIC_ROOT}/module/${id}/maintenance/command`;',
    ],
    ['comando de sistema', 'await this.mqtt.sendSystemCommand(sys, "pause_game");'],
    ['tópico de sistema', 'const t = "targets/v1/system/sys-1/command";'],
    ['comentario que lo menciona', '// nunca publicar en topics.moduleCommand(id)\nconst x = 1;'],
  ];

  it.each(inocentes)('control negativo · %s NO se marca', (_etiqueta, codigo) => {
    expect(analizar('/ficticio/prueba.ts', codigo)).toEqual([]);
  });

  it('la exención de topics.ts es ACOTADA: sólo la definición de moduleCommand', () => {
    const definicion =
      'export const topics = { moduleCommand: (id: string) => `${TOPIC_ROOT}/module/${id}/command` };';
    // La definición legítima no se marca…
    expect(analizar(FICHERO_DEFINICION, definicion)).toEqual([]);
    // …pero cualquier OTRO uso del tópico de juego en el mismo fichero, sí.
    const coladura =
      'export const topics = { otra: (id: string) => `${TOPIC_ROOT}/module/${id}/command` };';
    expect(analizar(FICHERO_DEFINICION, coladura)).not.toEqual([]);
    // Y la misma definición en OTRO fichero tampoco está exenta.
    expect(analizar(resolve(SRC, 'modules/mqtt/mqtt.service.ts'), definicion)).not.toEqual([]);
  });

  it('el detector señala fichero y línea, no sólo «hay algo»', () => {
    const codigo = ['const a = 1;', 'const b = 2;', 'const t = topics.moduleCommand(id);'].join(
      '\n',
    );
    const [violacion] = analizar('/ficticio/prueba.ts', codigo);
    expect(violacion.ubicacion).toBe('/ficticio/prueba.ts:3');
    expect(violacion.motivo).toMatch(/moduleCommand/);
  });
});
