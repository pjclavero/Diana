import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * P0-2 · La raíz de confianza no se cambia por accidente.
 *
 * Por qué existe esta prueba. Al sacar `ca.key` del árbol de despliegue quedó
 * una trampa: `generate-certs.sh` creaba la CA en `CERT_DIR` cada vez que
 * llegaba a ese punto —certificado caducado o `FORCE=1`—, de modo que una
 * rotación rutinaria del certificado de servidor habría emitido EN SILENCIO
 * una CA distinta, invalidando la confianza de backend, simulador y firmware.
 *
 * Una rotación de servidor no puede convertirse en un cambio de raíz de
 * confianza. Y la comprobación no puede quedarse en «lo ejecuté una vez y se
 * portó bien»: hace falta algo capaz de ponerse rojo cuando alguien lo rompa.
 *
 * Las tres propiedades que fija, y las mutaciones que deben matarlas:
 *   1. CA ausente + sin NEW_CA  → ABORTA sin crear nada.
 *      Mutación: volver a crear la CA implícitamente.
 *   2. `ca.key` NUNCA en CERT_DIR.
 *      Mutación: escribir la clave de la CA junto al material de runtime.
 *   3. Una rotación normal REUTILIZA la CA; su hash no cambia.
 *      Mutación: regenerar la CA en cada pasada.
 */

const SCRIPT = join(__dirname, '..', '..', '..', '..', 'infrastructure', 'mosquitto', 'generate-certs.sh');

interface Resultado {
  rc: number;
  salida: string;
}

function ejecutar(certDir: string, caDir: string, extra: Record<string, string> = {}): Resultado {
  try {
    const salida = execFileSync('bash', [SCRIPT], {
      env: { ...process.env, CERT_DIR: certDir, CA_DIR: caDir, ...extra },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { rc: 0, salida };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { rc: e.status ?? 1, salida: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const sha = (ruta: string) => createHash('sha256').update(readFileSync(ruta)).digest('hex');

describe('P0-2 · PKI: la CA no se recrea por accidente', () => {
  let raiz: string;
  let certDir: string;
  let caDir: string;

  beforeEach(() => {
    raiz = mkdtempSync(join(tmpdir(), 'diana-pki-'));
    certDir = join(raiz, 'certs');
    caDir = join(raiz, 'ca');
  });

  afterEach(() => rmSync(raiz, { recursive: true, force: true }));

  it('CA ausente y sin NEW_CA: aborta y NO crea ninguna raíz de confianza', () => {
    const r = ejecutar(certDir, caDir, { FORCE: '1' });

    expect(r.rc).not.toBe(0);
    expect(r.salida).toMatch(/no hay CA/i);
    // Lo que de verdad importa: que no se haya inventado una CA.
    expect(existsSync(join(caDir, 'ca.key'))).toBe(false);
    expect(existsSync(join(certDir, 'ca.key'))).toBe(false);
  });

  it('NEW_CA=1: crea la raíz en CA_DIR y `ca.key` NO aparece en el árbol de despliegue', () => {
    const r = ejecutar(certDir, caDir, { FORCE: '1', NEW_CA: '1' });

    expect(r.rc).toBe(0);
    expect(existsSync(join(caDir, 'ca.key'))).toBe(true);
    // La clave privada de la CA jamás vive junto al material que se despliega.
    expect(existsSync(join(certDir, 'ca.key'))).toBe(false);
    // Y el runtime se queda con lo que necesita, ni más ni menos.
    for (const f of ['ca.crt', 'server.crt', 'server.key']) {
      expect(existsSync(join(certDir, f))).toBe(true);
    }
  }, 60_000);

  it('una rotación normal REUTILIZA la CA: su hash no cambia', () => {
    expect(ejecutar(certDir, caDir, { FORCE: '1', NEW_CA: '1' }).rc).toBe(0);
    const caAntes = sha(join(caDir, 'ca.key'));
    const servidorAntes = sha(join(certDir, 'server.crt'));

    const r = ejecutar(certDir, caDir, { FORCE: '1' });

    expect(r.rc).toBe(0);
    expect(r.salida).toMatch(/reutilizando la CA/i);
    // La raíz intacta…
    expect(sha(join(caDir, 'ca.key'))).toBe(caAntes);
    // …y el certificado de servidor sí renovado: la rotación hizo su trabajo.
    expect(sha(join(certDir, 'server.crt'))).not.toBe(servidorAntes);
  }, 90_000);

  it('guardarraíl SIN `FORCE`: la ruta idempotente también lo comprueba', () => {
    // El agujero que quedaba: el guardarraíl vivía al final del script y la
    // ruta idempotente sale por `exit 0` mucho antes. Como todas las demás
    // pruebas pasaban FORCE=1, ninguna ejercitaba la invocación por defecto
    // —`./generate-certs.sh` a secas— que es la que usa un operador a diario.
    // Reproducido antes de corregirlo: con `ca.key` copiada al árbol, el
    // script terminaba en verde y la clave seguía ahí.
    expect(ejecutar(certDir, caDir, { FORCE: '1', NEW_CA: '1' }).rc).toBe(0);
    writeFileSync(join(certDir, 'ca.key'), readFileSync(join(caDir, 'ca.key')));

    const r = ejecutar(certDir, caDir); // <- SIN FORCE, camino idempotente

    expect(r.rc).not.toBe(0);
    expect(r.salida).toMatch(/ha aparecido ca\.key/i);
  }, 90_000);

  it('`NEW_CA=1` NO sobrescribe una raíz existente', () => {
    // Trampa real armada el 2026-08-13: con `ca.key` presente y `ca.crt`
    // ausente, la puerta de reutilización no se cumple y el script mandaba al
    // operador a `NEW_CA=1`… que sobrescribía la única copia de la raíz.
    expect(ejecutar(certDir, caDir, { FORCE: '1', NEW_CA: '1' }).rc).toBe(0);
    const antes = sha(join(caDir, 'ca.key'));
    rmSync(join(caDir, 'ca.crt')); // el estado exacto en que quedó producción

    const r = ejecutar(certDir, caDir, { FORCE: '1', NEW_CA: '1' });

    expect(r.rc).not.toBe(0);
    expect(r.salida).toMatch(/sobrescribir|sobrescribiría/i);
    expect(sha(join(caDir, 'ca.key'))).toBe(antes); // la raíz, intacta
  }, 90_000);

  it('guardarraíl final: si `ca.key` aparece en CERT_DIR, el script falla', () => {
    expect(ejecutar(certDir, caDir, { FORCE: '1', NEW_CA: '1' }).rc).toBe(0);
    // Alguien copia la clave de la CA junto al material de runtime «para que
    // sea más cómodo». El script no puede terminar en verde con eso ahí.
    writeFileSync(join(certDir, 'ca.key'), readFileSync(join(caDir, 'ca.key')));

    const r = ejecutar(certDir, caDir, { FORCE: '1' });

    expect(r.rc).not.toBe(0);
    expect(r.salida).toMatch(/ha aparecido ca\.key/i);
  }, 90_000);
});
