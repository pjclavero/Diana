#!/usr/bin/env node
/**
 * Genera `contracts/examples/publishable/` a partir de `contracts/examples/valid/`.
 *
 * POR QUÉ EXISTE (defecto real, no hipótesis)
 * -------------------------------------------
 * Los ejemplos de `valid/` llevan la clave meta `_schema` DENTRO del propio
 * payload. Todas las herramientas que los comprueban —`contracts/validate.py`
 * y `server/backend/test/helpers/examples.ts`— la RETIRAN antes de validar.
 * El backend real no la retira: los esquemas declaran
 * `additionalProperties: false`, así que el fichero tal cual está en disco se
 * rechaza con `schema_violation`. Y el rechazo sólo se ve en el log del
 * backend, porque el broker ya devolvió PUBACK al productor.
 *
 * Es decir: EL ARTEFACTO QUE SE VERIFICA NO ES EL QUE SE USA. Un productor
 * nuevo que copiase `valid/hit-event/valid-hit.json` publicaría un mensaje que
 * el backend tira a la basura, y creería que funciona.
 *
 * Este generador emite, para cada ejemplo válido, el mensaje EXACTO que un
 * productor debe publicar: los mismos campos, sin ninguna clave meta. Esos son
 * los ficheros que hay que copiar. `publishable/INDEX.json` conserva la
 * correspondencia fichero → esquema fuera del payload, que es donde debía
 * haber estado siempre.
 *
 * La garantía no es este script: es
 * `server/backend/test/contracts/publishable-examples.spec.ts`, que lee estos
 * ficheros DE DISCO, tal cual, y los mete por la ingesta real del backend —
 * y comprueba además que ninguno de `valid/` sobreviva a ese mismo camino.
 *
 * Uso:  node contracts/examples/generate-publishable.mjs [--check]
 *       --check no escribe nada; sale con 1 si el árbol está desincronizado.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const VALID = join(AQUI, 'valid');
const PUBLICABLE = join(AQUI, 'publishable');
/** Claves que son metadatos del repositorio, NO del mensaje. */
export const CLAVES_META = ['_schema', '_reason'];

function recorrer(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return recorrer(full);
    return e.name.endsWith('.json') ? [full] : [];
  });
}

/** Payload publicable + esquema declarado, a partir de un ejemplo de `valid/`. */
function derivar(fichero) {
  const doc = JSON.parse(readFileSync(fichero, 'utf8'));
  const esquema = doc._schema;
  if (typeof esquema !== 'string' || esquema.length === 0) {
    throw new Error(`${fichero}: falta la clave _schema; sin ella no se sabe contra qué se valida`);
  }
  const payload = {};
  for (const [k, v] of Object.entries(doc)) {
    if (!CLAVES_META.includes(k)) payload[k] = v;
  }
  // Ruta relativa con separador POSIX: el índice tiene que ser idéntico en
  // Linux y en Windows o la comparación `--check` daría un falso rojo.
  const rel = relative(VALID, fichero).split(sep).join('/');
  return { rel, esquema, payload };
}

function generar() {
  const entradas = recorrer(VALID).sort().map(derivar);
  const ficheros = new Map();
  const indice = {};
  for (const { rel, esquema, payload } of entradas) {
    ficheros.set(rel, `${JSON.stringify(payload, null, 2)}\n`);
    indice[rel] = esquema;
  }
  const cabecera = {
    _nota:
      'Mensajes PUBLICABLES tal cual: son los bytes que un productor manda por MQTT. ' +
      'Generado por contracts/examples/generate-publishable.mjs desde contracts/examples/valid/. ' +
      'No editar a mano: se edita el ejemplo de valid/ y se regenera.',
    _generado_desde: 'contracts/examples/valid',
    esquemas: indice,
  };
  ficheros.set('INDEX.json', `${JSON.stringify(cabecera, null, 2)}\n`);
  return ficheros;
}

function escribir(ficheros) {
  if (existsSync(PUBLICABLE)) rmSync(PUBLICABLE, { recursive: true });
  for (const [rel, contenido] of ficheros) {
    const destino = join(PUBLICABLE, rel);
    mkdirSync(dirname(destino), { recursive: true });
    writeFileSync(destino, contenido);
  }
}

function comprobar(ficheros) {
  const problemas = [];
  const enDisco = existsSync(PUBLICABLE)
    ? new Set(recorrer(PUBLICABLE).map((f) => relative(PUBLICABLE, f).split(sep).join('/')))
    : new Set();
  for (const [rel, contenido] of ficheros) {
    const destino = join(PUBLICABLE, rel);
    if (!existsSync(destino)) {
      problemas.push(`falta ${rel}`);
      continue;
    }
    if (readFileSync(destino, 'utf8') !== contenido) problemas.push(`difiere ${rel}`);
    enDisco.delete(rel);
  }
  for (const sobrante of enDisco) problemas.push(`sobra ${sobrante} (no existe en valid/)`);
  return problemas;
}

const ficheros = generar();
if (process.argv.includes('--check')) {
  const problemas = comprobar(ficheros);
  if (problemas.length > 0) {
    process.stderr.write(
      `publishable/ desincronizado con valid/:\n  ${problemas.join('\n  ')}\n` +
        'Regenera con: node contracts/examples/generate-publishable.mjs\n',
    );
    process.exit(1);
  }
  process.stdout.write(`publishable/ al día: ${ficheros.size - 1} mensajes + INDEX.json\n`);
} else {
  escribir(ficheros);
  process.stdout.write(`publishable/ regenerado: ${ficheros.size - 1} mensajes + INDEX.json\n`);
}
