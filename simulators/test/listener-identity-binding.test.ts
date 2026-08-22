import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * MP0-C · F-02, barrera 1 vigilada POR LISTENER.
 *
 * `use_username_as_clientid` es una opción POR LISTENER y NO la gobierna
 * `per_listener_settings`. Declararla una sola vez la activa únicamente en el
 * listener que la precede; el resto quedan sin ella.
 *
 * Por eso esta prueba NO comprueba «la directiva aparece en el fichero»: esa
 * comprobación seguiría verde el día que alguien la borre de uno solo de los
 * listeners, que es exactamente el defecto que encontramos. Se parte el fichero
 * en bloques por listener y se exige la propiedad en CADA uno.
 */

const aqui = dirname(fileURLToPath(import.meta.url));
const CONF = resolve(aqui, '../../infrastructure/mosquitto/mosquitto.conf');

interface Bloque {
  puerto: string;
  lineas: string[];
}

/** Divide la configuración en el preámbulo y un bloque por cada `listener`. */
export function partirPorListener(texto: string): { preambulo: string[]; bloques: Bloque[] } {
  const preambulo: string[] = [];
  const bloques: Bloque[] = [];
  for (const cruda of texto.split('\n')) {
    const linea = cruda.trim();
    const abre = /^listener\s+(\d+)/.exec(linea);
    if (abre) {
      bloques.push({ puerto: abre[1], lineas: [] });
      continue;
    }
    (bloques.length === 0 ? preambulo : bloques[bloques.length - 1].lineas).push(linea);
  }
  return { preambulo, bloques };
}

/** Sólo cuenta si está activa: una línea comentada no configura nada. */
function activa(lineas: string[], directiva: string): boolean {
  return lineas.some((l) => new RegExp(`^${directiva}\\s+true$`).test(l));
}

describe('F-02 · barrera 1 vigilada por listener', () => {
  const conf = readFileSync(CONF, 'utf8');
  const { preambulo, bloques } = partirPorListener(conf);

  it('la configuración declara al menos dos listeners', () => {
    // Sin esto la prueba podría pasar de forma vacía si el fichero cambiase de
    // forma y dejase de tener listeners que revisar.
    expect(bloques.length).toBeGreaterThanOrEqual(2);
  });

  it.each([['1883'], ['9001']])(
    'el listener %s enlaza el client_id a la identidad autenticada',
    (puerto) => {
      const bloque = bloques.find((b) => b.puerto === puerto);
      expect(bloque, `no existe un listener ${puerto} en mosquitto.conf`).toBeDefined();
      expect(
        activa(bloque!.lineas, 'use_username_as_clientid'),
        `el listener ${puerto} no declara use_username_as_clientid: la barrera 1 de F-02 ` +
          `queda ausente ahí. Es una opción POR LISTENER; declararla en otro no la hereda.`,
      ).toBe(true);
    },
  );

  it('TODOS los listeners la declaran, no sólo los dos conocidos', () => {
    const sinBarrera = bloques
      .filter((b) => !activa(b.lineas, 'use_username_as_clientid'))
      .map((b) => b.puerto);
    expect(sinBarrera, `listeners sin la barrera 1: ${sinBarrera.join(', ')}`).toEqual([]);
  });

  it('no se declara antes del primer listener', () => {
    // Colocarla en el preámbulo hace que mosquitto 2.0 cree un «listener por
    // defecto» en 1883 que después choca con `listener 1883` y aborta el
    // arranque. Además daría la falsa impresión de ser global.
    expect(activa(preambulo, 'use_username_as_clientid')).toBe(false);
  });

  it('la ACL no autoriza por client_id (barrera 2, independiente)', () => {
    const acl = readFileSync(resolve(aqui, '../../infrastructure/mosquitto/acl'), 'utf8');
    const reglas = acl.split('\n').filter((l) => /^\s*(topic|pattern)\s/.test(l.trim()));
    expect(reglas.length).toBeGreaterThan(0);
    const conComodinDeIdentidad = reglas.filter((l) => l.includes('%c') || l.includes('%u'));
    expect(
      conComodinDeIdentidad,
      'la ACL volvería a autorizar por client_id/usuario interpolado: barrera 2 perdida',
    ).toEqual([]);
  });
});
