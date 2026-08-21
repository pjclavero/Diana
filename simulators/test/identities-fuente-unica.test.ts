import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * MP0-A — FUENTE ÚNICA DE IDENTIDADES (IDENTITY_GENERATOR = UNIQUE).
 *
 * Las identidades MQTT estaban escritas a mano en varios sitios (la ACL,
 * generate-users.sh, los scripts de prueba del broker, los fixtures). Estas
 * pruebas comprueban que los CINCO artefactos derivados salen de
 * `identities.json` y siguen coherentes entre sí: el drift no puede volver en
 * silencio porque `--check` lo detecta y falla.
 *
 * Origen: adaptado de `ola/h2i` (448cd0a). La diferencia deliberada con esa
 * rama está anotada en docs/security/evidence/identity-generator.md.
 */
const REPO = resolve(__dirname, '../..');
const MOSQ = resolve(REPO, 'infrastructure/mosquitto');
const GEN = resolve(MOSQ, 'generate-identities.mjs');

const source = JSON.parse(readFileSync(resolve(MOSQ, 'identities.json'), 'utf-8')) as {
  topic_root: string;
  identity_equals_module_id: boolean;
  service_identities: Record<string, { username: string }>;
  modules: Array<{ username: string; module_id: string }>;
};
const acl = readFileSync(resolve(MOSQ, 'acl'), 'utf-8');
const users = readFileSync(resolve(MOSQ, 'users.generated.txt'), 'utf-8');
const modulesArtifact = JSON.parse(
  readFileSync(resolve(MOSQ, 'modules.generated.json'), 'utf-8'),
) as { modules: Array<{ username: string; module_id: string; expected_client_id: string }> };
const envExample = readFileSync(resolve(MOSQ, 'identities.generated.env.example'), 'utf-8');
const fixtures = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures/identities.generated.json'), 'utf-8'),
) as { identities: Array<{ username: string; moduleId: string; expectedClientId: string }> };

describe('fuente única de identidades MQTT', () => {
  it('--check no detecta drift: los 5 artefactos derivan de identities.json', () => {
    // Si alguien edita la ACL (o cualquier otro derivado) a mano, esto falla.
    const out = execFileSync('node', [GEN, '--check'], { encoding: 'utf-8' });
    expect(out).toContain('OK');
  });

  it('la fuente declara las 11 identidades medidas en el broker real', () => {
    const declaradas = users
      .split('\n')
      .filter((l) => l && !l.startsWith('#'))
      .sort();
    expect(declaradas).toEqual(
      [
        'backend',
        'healthcheck',
        ...Array.from({ length: 9 }, (_, i) => `module-0${i + 1}`),
      ].sort(),
    );
    expect(declaradas).toHaveLength(11);
  });

  it('los 5 artefactos declaran EXACTAMENTE las mismas identidades', () => {
    const esperado = source.modules.map((m) => `${m.username}→${m.module_id}`).sort();

    // 1. ACL
    const enAcl = source.modules
      .filter((m) => new RegExp(`^user ${m.username}$`, 'm').test(acl))
      .map((m) => `${m.username}→${m.module_id}`)
      .sort();
    expect(enAcl).toEqual(esperado);

    // 2. lista de usuarios
    const enUsers = users
      .split('\n')
      .filter((l) => l && !l.startsWith('#'))
      .sort();
    expect(enUsers).toEqual(
      [
        ...Object.values(source.service_identities).map((s) => s.username),
        ...source.modules.map((m) => m.username),
      ].sort(),
    );

    // 3. config del módulo
    expect(modulesArtifact.modules.map((m) => `${m.username}→${m.module_id}`).sort()).toEqual(
      esperado,
    );

    // 4. plantilla de entorno (nombres de variable, jamás valores)
    for (const m of source.modules) {
      const v = m.username.toUpperCase().replace(/-/g, '_');
      expect(envExample).toContain(`MQTT_USERNAME_${v}=${m.username}`);
    }
    expect(envExample).not.toMatch(/PASSWORD=(?!CAMBIAR)\S/);

    // 5. fixtures del simulador
    expect(fixtures.identities.map((m) => `${m.username}→${m.moduleId}`).sort()).toEqual(esperado);
  });

  it('cada usuario de la ACL sólo tiene permisos sobre SU module_id', () => {
    const bloques = acl.split(/^user /m).slice(1);
    for (const m of source.modules) {
      const bloque = bloques.find((b) => b.startsWith(`${m.username}\n`));
      expect(bloque, `falta el bloque de ${m.username}`).toBeDefined();
      const propios = `${source.topic_root}/module/${m.module_id}/`;
      const ajenos = source.modules
        .filter((o) => o.module_id !== m.module_id)
        .map((o) => `${source.topic_root}/module/${o.module_id}/`);
      for (const a of ajenos) expect(bloque).not.toContain(a);
      expect(bloque).toContain(propios);
    }
  });

  it('el módulo no puede escribir sus canales de sólo-lectura', () => {
    const bloques = acl.split(/^user /m).slice(1);
    for (const m of source.modules) {
      const bloque = bloques.find((b) => b.startsWith(`${m.username}\n`)) ?? '';
      for (const soloLectura of ['command', 'maintenance/command', 'config/desired', 'ota']) {
        expect(
          bloque,
          `${m.username} tiene escritura sobre ${soloLectura}`,
        ).not.toContain(`topic write ${source.topic_root}/module/${m.module_id}/${soloLectura}`);
      }
      // Nunca un comodín sobre el subárbol del módulo.
      expect(bloque).not.toContain(`${source.topic_root}/module/${m.module_id}/#`);
    }
  });

  it('el backend nunca tiene escritura sobre module/+/command (canal de juego)', () => {
    const bloqueBackend = acl.split(/^user /m).slice(1).find((b) => b.startsWith('backend\n')) ?? '';
    expect(bloqueBackend).not.toMatch(
      new RegExp(`topic write ${source.topic_root}/module/\\+/command\\s*$`, 'm'),
    );
  });

  it('la consulta de identidad se responde desde la fuente, no por convención', () => {
    for (const m of source.modules) {
      const got = execFileSync('node', [GEN, '--module-id-of', m.username], {
        encoding: 'utf-8',
      }).trim();
      expect(got).toBe(m.module_id);
      const back = execFileSync('node', [GEN, '--username-of', m.module_id], {
        encoding: 'utf-8',
      }).trim();
      expect(back).toBe(m.username);
    }
  });

  it('un usuario no declarado no obtiene module_id (no hay convención de nombres)', () => {
    expect(() =>
      execFileSync('node', [GEN, '--module-id-of', 'module-99'], { stdio: 'pipe' }),
    ).toThrow();
  });

  it('ningún artefacto generado contiene contraseñas', () => {
    for (const texto of [acl, users, envExample, JSON.stringify(modulesArtifact), JSON.stringify(fixtures)]) {
      expect(texto).not.toMatch(/\$(?:6|7|argon)\$/); // hashes de mosquitto_passwd
      expect(texto).not.toMatch(/PBKDF2/i);
    }
  });
});
