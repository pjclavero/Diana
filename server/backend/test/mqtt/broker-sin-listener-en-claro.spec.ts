import { readFileSync } from 'node:fs';
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
 * Cubre las dos mitades, porque cerrar una sola no cierra nada:
 *   - `mosquitto.conf`: ningún `listener` sin material TLS. Un 1883 interno no
 *     se publica al host, pero sigue siendo un camino en claro para cualquier
 *     contenedor de la red de Docker.
 *   - `compose.yml`: ningún puerto 1883 publicado al host, que es el camino
 *     por el que se leyeron credenciales de la LAN (H7-03).
 *
 * MUTACIÓN QUE DEBE PONERLA ROJA: añadir `listener 1883` a mosquitto.conf, o
 * `- "1883:1883"` al bloque de puertos de mosquitto en compose.yml.
 */

const RAIZ = join(__dirname, '..', '..', '..', '..');
const CONF = join(RAIZ, 'infrastructure', 'mosquitto', 'mosquitto.conf');
const COMPOSE = join(RAIZ, 'compose.yml');
const COMPOSE_DEV = join(RAIZ, 'compose.dev.yml');
const CONF_TEST = join(RAIZ, 'infrastructure', 'mosquitto', 'mosquitto.test.conf');

/** Líneas efectivas: sin comentarios (donde SÍ se habla del 1883 histórico). */
function lineasVivas(ruta: string): string[] {
  return readFileSync(ruta, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
}

describe('P0-2: el broker no tiene ningún camino en claro', () => {
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

    // El 9001 es WebSockets interno tras el proxy; el resto debe ser el 8883.
    const mqttEnClaro = listeners.filter((p) => p !== 8883 && p !== 9001);
    expect(mqttEnClaro).toEqual([]);
    expect(listeners).not.toContain(1883);
  });

  it('mosquitto.conf no reintroduce el 1883 por ninguna vía', () => {
    expect(lineasVivas(CONF).filter((l) => l.includes('1883'))).toEqual([]);
  });

  /**
   * Puertos publicados al host, resueltos con un parser YAML DE VERDAD.
   *
   * La versión anterior de esta prueba usaba una expresión regular por línea y
   * era esquivable con sintaxis de compose plenamente válida:
   *
   *   ports:
   *     - target: 1883
   *       published: 1883
   *
   * Publicaba el 1883 al host y la suite seguía en verde — mientras
   * `mosquitto.conf` afirmaba por escrito que esta prueba se pondría roja.
   * Vigilar una propiedad con una regex de línea es vigilar una forma de
   * escribirla, no la propiedad.
   */
  function puertosPublicados(ruta: string): number[] {
    const doc = parseYaml(readFileSync(ruta, 'utf8')) as {
      services?: Record<string, { ports?: Array<string | { target?: number; published?: number | string }> }>;
    };
    const puertos: number[] = [];
    for (const servicio of Object.values(doc.services ?? {})) {
      for (const entrada of servicio.ports ?? []) {
        if (typeof entrada === 'string') {
          // [IP:][HOST:]CONTENEDOR — el interpolado ${VAR:-8883} contiene ':',
          // así que se toman los dos últimos campos tras quitar el valor por
          // defecto de la interpolación.
          const limpio = entrada.replace(/\$\{[^}]*:-([^}]*)\}/g, '$1');
          const campos = limpio.split(':');
          puertos.push(Number(campos[campos.length - 1]));
          if (campos.length >= 2) puertos.push(Number(campos[campos.length - 2]));
        } else {
          if (entrada.target !== undefined) puertos.push(Number(entrada.target));
          if (entrada.published !== undefined) puertos.push(Number(entrada.published));
        }
      }
    }
    return puertos.filter((p) => !Number.isNaN(p));
  }

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

    const compose = readFileSync(COMPOSE, 'utf8');
    const bloque = compose.slice(compose.indexOf('\n  mosquitto-test:'));
    const redes = bloque.slice(bloque.indexOf('networks:'), bloque.indexOf('healthcheck:'));
    expect(redes).toContain('testnet');
    expect(redes).not.toContain('internal');
  });
});
