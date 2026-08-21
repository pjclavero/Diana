import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, copyFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, relative, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * MP0-A — META-PRUEBA: la identidad MQTT tiene UNA sola autoridad y F-02 no
 * se puede reabrir.
 *
 * F-02 (crítico, CERRADO el 2026-07-21, ver docs/security/findings.md): la ACL
 * autorizaba por `%c` (el client_id, que elige el propio cliente), así que con
 * las credenciales de un módulo cualquiera y el client_id de otro se
 * suplantaba a ese otro. Se cerró con `use_username_as_clientid true` y
 * usuario == module_id exacto.
 *
 * Esta rama conserva ese cierre y le añade una segunda barrera independiente:
 * la ACL generada no contiene `%c` ni `%u` en absoluto, sino una regla
 * explícita por identidad autenticada con el module_id literal en el tópico.
 * Las pruebas de abajo vigilan LAS DOS barreras por separado, de modo que
 * retirar cualquiera de ellas pone la suite en rojo.
 *
 * Varias pruebas son CONTROLES POSITIVOS: ejecutan el generador contra una
 * fuente mutada en un directorio temporal y exigen que ABORTE. Sin ellas,
 * "el generador valida" sería una afirmación sin evidencia.
 */

const REPO = resolve(__dirname, '../..');
const MOSQ = resolve(REPO, 'infrastructure/mosquitto');
const GEN = resolve(MOSQ, 'generate-identities.mjs');
const SOURCE_PATH = resolve(MOSQ, 'identities.json');

type Source = {
  topic_root: string;
  identity_equals_module_id: boolean;
  modules: Array<{ username: string; module_id: string }>;
};
const source = JSON.parse(readFileSync(SOURCE_PATH, 'utf-8')) as Source;
const acl = readFileSync(resolve(MOSQ, 'acl'), 'utf-8');
const conf = readFileSync(resolve(MOSQ, 'mosquitto.conf'), 'utf-8');

const sinComentarios = (t: string) =>
  t
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('#'))
    .join('\n');

/** Ejecuta el generador con una fuente mutada; devuelve {rc, stderr}. */
function generarCon(mutar: (s: Source) => void, extraArgs: string[] = []): { rc: number; err: string } {
  const dir = mkdtempSync(join(tmpdir(), 'mp0a-'));
  const s = JSON.parse(readFileSync(SOURCE_PATH, 'utf-8')) as Source;
  mutar(s);
  const src = join(dir, 'identities.json');
  writeFileSync(src, JSON.stringify(s, null, 2));
  try {
    execFileSync(
      'node',
      [GEN, '--source', src, '--out', dir, '--sim-out', join(dir, 'fixtures.json'), ...extraArgs],
      { stdio: 'pipe', encoding: 'utf-8' },
    );
    return { rc: 0, err: '' };
  } catch (e) {
    const err = e as { status: number; stderr: string };
    return { rc: err.status, err: String(err.stderr) };
  }
}

describe('MP0-A · una sola autoridad de identidad, y F-02 sigue cerrado', () => {
  // ---------------------------------------------------------------- F-02 ---
  it('F-02 barrera 1: la ACL no autoriza por client_id (sin %c, %u ni pattern)', () => {
    const cuerpo = sinComentarios(acl);
    expect(cuerpo).not.toMatch(/%c/);
    expect(cuerpo).not.toMatch(/%u/);
    expect(cuerpo).not.toMatch(/^pattern /m);
  });

  it('F-02 barrera 2: mosquitto.conf mantiene use_username_as_clientid true', () => {
    // Fue el cierre original del hallazgo. Se conserva como defensa en
    // profundidad: si alguien reintrodujera un patrón %c en la ACL, esta
    // directiva sigue impidiendo que el cliente elija su client_id.
    expect(sinComentarios(conf)).toMatch(/^\s*use_username_as_clientid\s+true\s*$/m);
    expect(sinComentarios(conf)).toMatch(/^\s*allow_anonymous\s+false\s*$/m);
  });

  it('F-02 barrera 2: usuario == module_id en TODAS las identidades', () => {
    expect(source.identity_equals_module_id).toBe(true);
    for (const m of source.modules) expect(m.username).toBe(m.module_id);
  });

  it('CONTROL POSITIVO: el generador aborta si usuario != module_id', () => {
    const { rc, err } = generarCon((s) => {
      s.modules[0]!.module_id = 'm01';
    });
    expect(rc).toBe(1);
    expect(err).toContain('F-02');
  });

  // --------------------------------------------------------- unicidad ------
  it('no hay dos módulos con el mismo username ni el mismo module_id', () => {
    const u = source.modules.map((m) => m.username);
    const i = source.modules.map((m) => m.module_id);
    expect(new Set(u).size).toBe(u.length);
    expect(new Set(i).size).toBe(i.length);
  });

  it('CONTROL POSITIVO: el generador aborta si dos módulos comparten username', () => {
    const { rc, err } = generarCon((s) => {
      s.modules[1]!.username = s.modules[0]!.username;
      s.modules[1]!.module_id = s.modules[0]!.module_id;
    });
    expect(rc).toBe(1);
    expect(err).toMatch(/usuario duplicado|module_id duplicado/);
  });

  it('CONTROL POSITIVO: --check falla cuando un derivado tiene drift', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mp0a-drift-'));
    const src = join(dir, 'identities.json');
    copyFileSync(SOURCE_PATH, src);
    const args = ['--source', src, '--out', dir, '--sim-out', join(dir, 'fixtures.json')];
    execFileSync('node', [GEN, ...args], { stdio: 'pipe' });
    // Verde antes de la mutación.
    expect(
      execFileSync('node', [GEN, ...args, '--check'], { encoding: 'utf-8' }),
    ).toContain('OK');
    // Drift: una línea de ACL editada a mano.
    writeFileSync(join(dir, 'acl'), `${readFileSync(join(dir, 'acl'), 'utf-8')}\nuser colado\ntopic read #\n`);
    let rc = 0;
    let err = '';
    try {
      execFileSync('node', [GEN, ...args, '--check'], { stdio: 'pipe' });
    } catch (e) {
      const x = e as { status: number; stderr: string };
      rc = x.status;
      err = String(x.stderr);
    }
    expect(rc).toBe(1);
    expect(err).toContain('DRIFT');
  });

  // ------------------------------------------- una sola autoridad ----------
  it('ningún script de infraestructura lleva identidades escritas a mano', () => {
    // Un `-u m01` o un `user module-99` en un script es una SEGUNDA autoridad:
    // autentica contra el broker con una identidad que la fuente única no
    // conoce. Ese fue el falso verde real de test-acl.sh (usuarios m01/m02
    // inexistentes: el CONNECT fallaba con rc=135 y las pruebas negativas
    // pasaban por ausencia de mensaje, no por ACL).
    const declaradas = new Set([
      ...source.modules.map((m) => m.username),
      ...source.modules.map((m) => m.module_id),
      'backend',
      'healthcheck',
    ]);
    const infracciones: string[] = [];
    for (const f of readdirSync(MOSQ)) {
      if (!f.endsWith('.sh')) continue;
      const texto = readFileSync(resolve(MOSQ, f), 'utf-8');
      texto.split('\n').forEach((linea, i) => {
        if (linea.trimStart().startsWith('#')) return;
        const patrones = [/(?:^|\s)-u\s+([A-Za-z][\w-]*)/, /^user ([\w-]+)\s*$/];
        for (const re of patrones) {
          const m = re.exec(linea);
          if (!m) continue;
          const id = m[1];
          if (!id || id.startsWith('$') || id.startsWith('"')) continue; // variable, no literal
          if (!declaradas.has(id)) infracciones.push(`${f}:${i + 1} — identidad '${id}' fuera de la fuente única\n      ${linea.trim()}`);
        }
      });
    }
    expect(infracciones, `identidades fuera de la fuente única:\n${infracciones.join('\n')}`).toEqual([]);
  });

  it('sólo el generador y set-coordinator.sh escriben la ACL', () => {
    // Cualquier otro escritor sería una segunda autoridad sobre la ACL.
    const permitidos = new Set(['generate-identities.mjs', 'set-coordinator.sh']);
    const escritores: string[] = [];
    const barrer = (dir: string) => {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        const rel = relative(REPO, p);
        if (rel.includes('node_modules') || rel.startsWith('.git')) continue;
        if (statSync(p).isDirectory()) {
          barrer(p);
          continue;
        }
        if (!/\.(sh|mjs|js|ts)$/.test(e)) continue;
        const texto = readFileSync(p, 'utf-8');
        // Escritura sobre el fichero acl (redirección, mv, tee, writeFileSync).
        if (/(?:>|>>|\bmv\b[^\n]*|\btee\b[^\n]*|writeFileSync\([^)]*)\s*["']?\$?\{?\w*ACL_FILE\}?["']?/.test(texto) && !permitidos.has(e)) {
          escritores.push(rel);
        }
      }
    };
    barrer(resolve(REPO, 'infrastructure'));
    expect(escritores, `escritores de la ACL no autorizados: ${escritores.join(', ')}`).toEqual([]);
  });

  it('tests/fixtures/topology.json usa module_id declarados en la fuente única', () => {
    const topo = JSON.parse(
      readFileSync(resolve(REPO, 'tests/fixtures/topology.json'), 'utf-8'),
    ) as { principal: string; modules: Array<{ module_id: string }> };
    const ids = new Set(source.modules.map((m) => m.module_id));
    for (const m of topo.modules) {
      expect(ids.has(m.module_id), `${m.module_id} no está declarado en identities.json`).toBe(true);
    }
    expect(ids.has(topo.principal)).toBe(true);
  });
});
