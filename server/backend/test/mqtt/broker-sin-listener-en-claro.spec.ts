import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
// js-yaml, declarado en devDependencies: parser de verdad en vez de una regex
// por línea. Se carga con require para no depender de @types/js-yaml.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { load: parseYaml } = require('js-yaml') as { load: (s: string) => unknown };

/**
 * P0-2 · Regresión: el broker de producción no escucha en claro EN NINGÚN
 * SITIO.
 *
 * Por qué existe esta prueba y por qué mira ficheros de infraestructura desde
 * los tests del backend: durante P0-2 la configuración del broker afirmó por
 * escrito, dos veces, que no existía listener en claro mientras existía uno.
 * Una afirmación que nadie puede poner roja no es una garantía, es una nota.
 *
 * Por qué VUELVE ahora al árbol: estuvo deliberadamente fuera mientras el
 * `listener 1883` vivía como «perfil de transición» —se habría puesto roja por
 * diseño, y un test rojo permanente se acaba desactivando—. La premisa de esa
 * excepción (la decisión D1: el firmware llevaba `mqtt://%s:1883` cableado y no
 * sabía hablar TLS) ha dejado de ser cierta: el firmware construye la URI con
 * esquema `mqtts://` y puerto 8883 por defecto, y el módulo físico `module-01`
 * conecta contra `mqtts://<host>:8883` validando CA y nombre de servidor.
 * Cerrado el 1883, la prueba entra y se queda.
 *
 * Cubre las mitades, porque cerrar una sola no cierra nada:
 *   - `mosquitto.conf`: ningún `listener` sin material TLS. Un 1883 interno no
 *     se publica al host, pero sigue siendo un camino en claro para cualquier
 *     contenedor de la red de Docker.
 *   - `compose.yml` / `compose.dev.yml`: ningún puerto 1883 publicado al host,
 *     que es el camino por el que se leyeron credenciales de la LAN (H7-03).
 *   - `04-firewall.sh`: ninguna regla que abra el 1883.
 *   - Las dos direcciones del aislamiento del broker de pruebas.
 *
 * MUTACIÓN QUE DEBE PONERLA ROJA: añadir `listener 1883` a mosquitto.conf, o
 * `- "1883:1883"` al bloque de puertos de mosquitto en compose.yml.
 */

const RAIZ = join(__dirname, '..', '..', '..', '..');
const CONF = join(RAIZ, 'infrastructure', 'mosquitto', 'mosquitto.conf');
const COMPOSE = join(RAIZ, 'compose.yml');
const COMPOSE_DEV = join(RAIZ, 'compose.dev.yml');
const CONF_TEST = join(RAIZ, 'infrastructure', 'mosquitto', 'mosquitto.test.conf');
const FIREWALL = join(RAIZ, 'infrastructure', 'provisioning', '04-firewall.sh');

/** Líneas efectivas: sin comentarios (donde SÍ se habla del 1883 histórico). */
function lineasVivas(ruta: string): string[] {
  return readFileSync(ruta, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
}

describe('P0-2: el broker no tiene ningún camino MQTT/TCP en claro', () => {
  /**
   * El título dice MQTT/TCP y no «ningún camino en claro» porque lo segundo
   * sería mentira: el listener 9001 (WebSockets) sigue sin TLS. Una versión
   * anterior lo eximía con un `p !== 9001` mudo dentro del filtro, de forma
   * que la prueba se llamaba como la propiedad fuerte y comprobaba la débil.
   * La exención pasa a ser una aserción explícita: si alguien pone TLS al 9001,
   * este test se rompe y hay que venir a borrar la deuda a mano.
   */
  it('el 9001 WebSockets SIGUE en claro: deuda declarada, no camino olvidado', () => {
    const vivas = lineasVivas(CONF);
    expect(vivas).toContain('listener 9001');
    const trasWs = vivas.slice(vivas.indexOf('listener 9001'));
    expect(trasWs.some((l) => l.startsWith('certfile '))).toBe(false);
  });

  it('mosquitto.conf declara listeners, y ninguno de ellos es MQTT sin TLS', () => {
    const vivas = lineasVivas(CONF);
    const listeners = vivas
      .filter((l) => /^listener\s+\d+/.test(l))
      .map((l) => Number(l.split(/\s+/)[1]));

    // Si esto falla, el parseo se ha quedado ciego y el resto no vale nada.
    expect(listeners.length).toBeGreaterThan(0);

    const tieneMaterialTls =
      vivas.some((l) => l.startsWith('certfile ')) && vivas.some((l) => l.startsWith('keyfile '));
    expect(tieneMaterialTls).toBe(true);

    // El 9001 es WebSockets y está EXENTO a propósito (ver la prueba anterior,
    // que fija su estado real). El resto debe ser el 8883.
    const mqttEnClaro = listeners.filter((p) => p !== 8883 && p !== 9001);
    expect(mqttEnClaro).toEqual([]);
    expect(listeners).not.toContain(1883);
  });

  it('mosquitto.conf no reintroduce el 1883 por ninguna vía', () => {
    expect(lineasVivas(CONF).filter((l) => l.includes('1883'))).toEqual([]);
  });

  /**
   * F-02 no se degrada al cerrar el 1883: `use_username_as_clientid` es una
   * opción POR LISTENER, así que retirar un listener no puede dejar a otro sin
   * la barrera 1. Se comprueba que CADA listener vivo la lleva, y que la ACL
   * canónica no tiene ni una regla activa con `%c`.
   */
  it('F-02 preservada: cada listener lleva use_username_as_clientid y la ACL no usa %c', () => {
    const vivas = lineasVivas(CONF);
    const indices = vivas.map((l, i) => (/^listener\s+\d+/.test(l) ? i : -1)).filter((i) => i >= 0);
    expect(indices.length).toBeGreaterThan(0);
    for (let n = 0; n < indices.length; n += 1) {
      const desde = indices[n];
      const hasta = n + 1 < indices.length ? indices[n + 1] : vivas.length;
      const bloque = vivas.slice(desde, hasta);
      expect({
        listener: vivas[desde],
        tieneBarrera1: bloque.includes('use_username_as_clientid true'),
      }).toEqual({ listener: vivas[desde], tieneBarrera1: true });
    }

    const acl = lineasVivas(join(RAIZ, 'infrastructure', 'mosquitto', 'acl'));
    expect(acl.filter((l) => l.includes('%c'))).toEqual([]);
    // Control de que la ACL canónica sigue ahí y no se ha vaciado: sus bloques
    // nominales `user <module_id>` son lo que hace innecesario el patrón %c.
    expect(acl.filter((l) => /^user\s+\S+/.test(l)).length).toBeGreaterThan(0);
  });

  /**
   * Puertos publicados al host, resueltos con un parser YAML de verdad y
   * FALLANDO CERRADO ante cualquier campo que no sepa interpretar.
   *
   * Dos versiones anteriores de esta función fueron esquivables, y las dos por
   * la misma razón: descartaban en silencio lo que no encajaba en su idea de
   * cómo se escribe un puerto.
   *
   *   1ª (regex por línea): esquivada por la sintaxis larga
   *      `- target: 1883 / published: 1883`.
   *   2ª (YAML + Number()): esquivada por un RANGO — `- "1880-1890:1880-1890"`
   *      publica el 1883 y `Number("1880-1890")` da NaN, que un
   *      `.filter(!isNaN)` tiraba a la basura. Verde con el puerto abierto.
   *
   * Por eso ahora un campo no interpretable LANZA en vez de ignorarse: si
   * aparece una forma nueva de declarar puertos, esta prueba se rompe y
   * alguien la mira, que es exactamente lo que debe pasar.
   */
  function expandir(campo: string | number): number[] {
    const texto = String(campo).trim();
    const rango = /^(\d+)-(\d+)$/.exec(texto);
    if (rango) {
      const [desde, hasta] = [Number(rango[1]), Number(rango[2])];
      if (hasta < desde || hasta - desde > 65535) throw new Error(`Rango imposible: ${texto}`);
      return Array.from({ length: hasta - desde + 1 }, (_, i) => desde + i);
    }
    if (/^\d+$/.test(texto)) return [Number(texto)];
    throw new Error(
      `Campo de puerto no interpretable: "${texto}". Si es una forma legítima, ` +
        'enséñale a esta función a expandirla; NO la ignores: ignorar en silencio ' +
        'es como se coló un rango que publicaba el 1883.',
    );
  }

  function puertosPublicados(ruta: string): number[] {
    const doc = parseYaml(readFileSync(ruta, 'utf8')) as {
      services?: Record<
        string,
        { ports?: Array<string | { target?: number | string; published?: number | string }> }
      >;
    };
    const puertos: number[] = [];
    for (const servicio of Object.values(doc.services ?? {})) {
      for (const entrada of servicio.ports ?? []) {
        if (typeof entrada === 'string' || typeof entrada === 'number') {
          // [IP:][HOST:]CONTENEDOR, con posibles rangos e interpolación.
          const limpio = String(entrada)
            .replace(/\$\{[^}]*:-([^}]*)\}/g, '$1')
            .replace(/\$\{[^}]*\}/g, '0');
          const campos = limpio
            .split(':')
            .filter((c) => !/^\d+\.\d+\.\d+\.\d+$/.test(c) && c !== '');
          for (const campo of campos) puertos.push(...expandir(campo));
        } else {
          if (entrada.target !== undefined) puertos.push(...expandir(entrada.target));
          if (entrada.published !== undefined) puertos.push(...expandir(entrada.published));
        }
      }
    }
    return puertos;
  }

  it('no existe un compose.override.yml sin vigilar', () => {
    // docker compose lo aplica AUTOMÁTICAMENTE si existe. Un 1883 ahí quedaría
    // publicado sin que ninguna de las comprobaciones de arriba lo mirase.
    expect(existsSync(join(RAIZ, 'compose.override.yml'))).toBe(false);
    expect(existsSync(join(RAIZ, 'compose.override.yaml'))).toBe(false);
  });

  it.each([
    ['compose.yml', COMPOSE],
    ['compose.dev.yml', COMPOSE_DEV],
  ])('%s no publica ningún 1883 al host (parseado como YAML)', (_nombre, ruta) => {
    const puertos = puertosPublicados(ruta);
    // Control de que el parseo ve algo: si devolviera [] por un cambio de
    // formato, la aserción siguiente pasaría sin mirar nada.
    expect(puertos.length).toBeGreaterThan(0);
    expect(puertos).not.toContain(1883);
  });

  /**
   * El firewall del host. Docker publica por su cadena forward y NO pasa por
   * esta cadena input, así que esta regla nunca fue lo que abría el broker —
   * pero dejarla es un agujero latente el día que algo se ate al puerto del
   * host directamente, y sobre todo hace que el fichero mienta.
   *
   * MUTACIÓN QUE DEBE PONERLA ROJA: devolver `tcp dport 1883 accept`.
   */
  it('04-firewall.sh abre el 8883 y NO abre el 1883', () => {
    const reglas = readFileSync(FIREWALL, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'))
      .filter((l) => /\bdport\b/.test(l));
    expect(reglas.some((l) => /tcp\s+dport\s+8883\b.*\baccept\b/.test(l))).toBe(true);
    expect(reglas.filter((l) => /\bdport\s+1883\b/.test(l))).toEqual([]);
  });

  /**
   * La mitad que faltaba, y que convertía todo lo anterior en la corrección
   * del ejemplar en vez de la clase: `mosquitto.test.conf` SÍ declara un
   * listener en claro —es legítimo, es el broker efímero de la suite— pero
   * mientras compartió la red `internal` con producción, activar el perfil
   * `test` ponía un broker sin cifrar al alcance de cualquier contenedor
   * productivo. Un broker en claro sólo es aceptable si está AISLADO.
   *
   * MUTACIÓN QUE DEBE PONERLA ROJA: devolver `mosquitto-test` a la red
   * `internal` en compose.yml.
   */
  it('el broker de pruebas habla en claro, y por eso NO toca la red de producción', () => {
    expect(lineasVivas(CONF_TEST).some((l) => /^listener\s+1883/.test(l))).toBe(true);

    const doc = parseYaml(readFileSync(COMPOSE, 'utf8')) as {
      services?: Record<string, { profiles?: string[]; networks?: string[] }>;
    };
    const testBroker = (doc.services ?? {})['mosquitto-test'];
    expect(testBroker).toBeDefined();
    expect(testBroker.profiles ?? []).toContain('test');
    expect(testBroker.networks ?? []).toContain('testnet');
    expect(testBroker.networks ?? []).not.toContain('internal');
  });

  /**
   * El sentido contrario, que faltaba: la comprobación de arriba impedía llevar
   * el broker en claro a la red de producción, pero NO impedía traer un
   * servicio de producción a la red del broker en claro. Añadir `testnet` a las
   * redes del backend dejaba la suite en verde con el backend sentado en la red
   * del broker sin cifrar. Una regla vigilada en una sola dirección no es una
   * regla, es un comentario.
   *
   * MUTACIÓN QUE DEBE PONERLA ROJA: añadir `- testnet` a las redes de backend,
   * worker, mosquitto o postgres.
   */
  it('ningún servicio de producción está en la red del broker en claro', () => {
    const doc = parseYaml(readFileSync(COMPOSE, 'utf8')) as {
      services?: Record<string, { profiles?: string[]; networks?: string[] }>;
    };
    const intrusos = Object.entries(doc.services ?? {})
      .filter(([, s]) => !(s.profiles ?? []).includes('test'))
      .filter(([, s]) => (s.networks ?? []).includes('testnet'))
      .map(([nombre]) => nombre);
    expect(intrusos).toEqual([]);
  });
});
