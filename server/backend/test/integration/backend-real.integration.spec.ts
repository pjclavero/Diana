import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { connect, MqttClient } from 'mqtt';

import { CrudService } from '../../src/common/crud/crud.service';
import { DtoValidationPipe } from '../../src/common/crud/dto-validation.pipe';
import { CreateModuleDto, UpdateModuleDto } from '../../src/modules/modules/dto/module.dto';
import {
  MODULE_CREATABLE_FIELDS,
  MODULE_UPDATABLE_FIELDS,
} from '../../src/modules/modules/modules.service';
import { ModuleConfigService } from '../../src/modules/modules/module-config.service';
import { ModuleConfigReportedService } from '../../src/modules/modules/module-config-reported.service';
import { MqttIdentityService } from '../../src/modules/provisioning/mqtt-identity.service';
import { CanonicalIdentitySource } from '../../src/modules/provisioning/canonical-identity.source';
import { MosquittoPasswdStore } from '../../src/modules/provisioning/mosquitto-passwd.store';
import {
  classifyConnectivityAll,
  summarizeConnectivity,
} from '../../src/domain/modules/connectivity';

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * INTEGRACIÓN REAL · PostgreSQL de verdad + Mosquitto de verdad con TLS 8883.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Contenedores EFÍMEROS, creados y destruidos por esta suite. NUNCA producción
 * ni la VM 109, y nunca `compose.yml`.
 *
 * Lo que sólo se puede afirmar aquí y no con dobles:
 *
 *  1. Que la MIGRACIÓN se aplica y que sus CHECK cortan de verdad. Una
 *     restricción que nadie ha visto fallar es una restricción que quizá no
 *     existe: cada una se prueba intentando escribir la fila que debe rechazar.
 *  2. Que un PATCH con `slug`/`configVersion` no cambia NADA EN LA BASE. Un 400
 *     es un código de estado; la evidencia es la fila.
 *  3. Que la reserva de `desired_config_version` es atómica DE VERDAD: dos
 *     empujones concurrentes contra el mismo PostgreSQL se llevan números
 *     distintos. Con un doble esto se prueba solo.
 *  4. Que la credencial emitida AUTENTICA contra Mosquitto por TLS 8883 y que
 *     la ACL canónica la confina a su subárbol. Un cliente MQTT real no es un
 *     mock.
 *  5. Que con CERO dispositivos conectados hay CERO módulos ONLINE, leído de
 *     la base al final de todo.
 *
 * ── Lo que esta suite NO hace, a propósito ───────────────────────────────────
 * No publica ni un `presence`, ni un `telemetry`, ni un `provision/state`. No
 * hay ningún dispositivo detrás, así que fabricar esos mensajes convertiría la
 * prueba en una demostración de que sabemos escribir JSON. La ingesta de
 * `config/reported` se ejercita llamando al servicio, no publicando en el
 * broker como si fuéramos un módulo.
 *
 * ── El aviso medido de P0-2 ──────────────────────────────────────────────────
 * Una denegación de ACL EN PUBLICACIÓN devuelve rc=0 en el cliente con un
 * `Warning: ... Not authorized`. Sólo la autenticación da 135 en el CONNACK.
 * Aquí NO se usa el rc para distinguirlas: se mira el `reasonCode` del PUBACK
 * y el del SUBACK.
 */

const MOSQUITTO_IMAGE = 'eclipse-mosquitto:2';
const POSTGRES_IMAGE = 'postgres:16-alpine';
const REPO = path.resolve(__dirname, '../../../..');
const GENERATOR = path.join(REPO, 'infrastructure/mosquitto/generate-identities.mjs');
const CANONICAL_ACL = path.join(REPO, 'infrastructure/mosquitto/acl');

/** Identidades REALES de la fuente única. No se inventan. */
const MIO = 'module-07';
const AJENO = 'module-08';
const ROOT = 'targets/v1';

function dockerDisponible(): boolean {
  return spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;
}

function puertoLibre(base: number): number {
  for (let i = 0; i < 40; i += 1) {
    const c = base + Math.floor(Math.random() * 900);
    const salida = execFileSync(
      'sh',
      ['-c', `ss -ltn 2>/dev/null | grep -c ':${c} ' || true`],
      { encoding: 'utf8' },
    ).trim();
    if (salida === '0') return c;
  }
  throw new Error('no se encontró puerto libre');
}

const hayDocker = dockerDisponible();
const suite = hayDocker ? describe : describe.skip;
if (!hayDocker) {
  // eslint-disable-next-line no-console
  console.warn(
    '[integración] NO HAY DOCKER: el bloque BACKEND-REAL queda NO MEDIDO. ' +
      'Un salto no es un aprobado.',
  );
}

suite('BACKEND-REAL · PostgreSQL y Mosquitto de verdad', () => {
  jest.setTimeout(300_000);

  let dir: string;
  let pgContainer: string;
  let mqContainer: string;
  let pgPort: number;
  let mqPort: number;
  let databaseUrl: string;
  let prisma: PrismaClient;
  let identidades: MqttIdentityService;
  let passwdFile: string;
  const clientes: MqttClient[] = [];

  /** Espera ACTIVA por una condición, nunca un `sleep` fijo. */
  async function esperar(que: () => boolean, queCosa: string, msMax = 90_000): Promise<void> {
    const t0 = Date.now();
    let intentos = 0;
    while (Date.now() - t0 < msMax) {
      intentos += 1;
      if (que()) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`Se agotó la espera de ${queCosa} tras ${intentos} intentos.`);
  }

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'diana-backend-real-'));
    // 0700 impediría al usuario del contenedor (uid 1883) atravesar el
    // directorio: el broker arrancaría, no encontraría su config y moriría, y
    // desde fuera eso se ve como ECONNREFUSED, que no apunta a la causa.
    chmodSync(dir, 0o755);

    // ── PostgreSQL ──────────────────────────────────────────────────────────
    pgPort = puertoLibre(25_000);
    pgContainer = `diana-real-pg-${pgPort}`;
    execFileSync('docker', [
      'run', '-d', '--rm',
      '--name', pgContainer,
      '-e', 'POSTGRES_PASSWORD=efimero',
      '-e', 'POSTGRES_DB=diana_test',
      '-p', `${pgPort}:5432`,
      POSTGRES_IMAGE,
    ]);
    await esperar(
      () =>
        spawnSync('docker', ['exec', pgContainer, 'pg_isready', '-U', 'postgres', '-h', '127.0.0.1'], {
          stdio: 'ignore',
        }).status === 0,
      'que PostgreSQL acepte conexiones',
    );
    databaseUrl = `postgresql://postgres:efimero@127.0.0.1:${pgPort}/diana_test`;

    // La MIGRACIÓN se aplica de verdad. Si fallara, esta suite no arranca, que
    // es exactamente lo que debe pasar: una migración que no aplica no es una
    // migración.
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      cwd: path.resolve(__dirname, '../..'),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'pipe',
    });
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await prisma.$connect();

    // ── PKI efímera para TLS 8883 ───────────────────────────────────────────
    const ca = path.join(dir, 'ca.crt');
    const caKey = path.join(dir, 'ca.key');
    const srvKey = path.join(dir, 'server.key');
    const srvCsr = path.join(dir, 'server.csr');
    const srvCrt = path.join(dir, 'server.crt');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', caKey, '-out', ca, '-days', '2', '-subj', '/CN=Diana Test CA']);
    execFileSync('openssl', ['req', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', srvKey, '-out', srvCsr, '-subj', '/CN=localhost']);
    // Las extensiones van a un FICHERO y no por `/dev/stdin`: bajo Jest la
    // entrada estándar del proceso hijo no es un fichero abrible, y openssl
    // falla con «No such device or address», que no apunta a la causa.
    const ext = path.join(dir, 'server.ext');
    writeFileSync(ext, 'subjectAltName=DNS:localhost,IP:127.0.0.1\n');
    execFileSync('openssl', ['x509', '-req', '-in', srvCsr, '-CA', ca, '-CAkey', caKey,
      '-CAcreateserial', '-out', srvCrt, '-days', '2', '-extfile', ext]);
    for (const f of [ca, srvCrt, srvKey]) chmodSync(f, 0o644);

    // ── ACL: la CANÓNICA del repositorio, sin retocar ───────────────────────
    // Copiar la de verdad es lo que hace que esta prueba diga algo sobre el
    // sistema. Una ACL escrita aquí a mano probaría que sabemos escribir ACL.
    const acl = readFileSync(CANONICAL_ACL, 'utf8');
    // Se comprueban las REGLAS, no el texto del fichero. `%c` y `%u` aparecen
    // en la cabecera de comentarios explicando por qué NO se usan; un
    // `expect(acl).not.toContain('%c')` sobre el fichero entero da rojo por la
    // documentación y verde si alguien la borra. Lo que autoriza son las
    // líneas que no empiezan por `#`.
    const reglas = acl
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));
    expect(reglas).toContain(`user ${MIO}`);
    expect(reglas.some((r) => r.includes('%c') || r.includes('%u'))).toBe(false);
    // Y la regla de este módulo nombra su module_id LITERAL.
    expect(reglas).toContain(`topic write ${ROOT}/module/${MIO}/presence`);
    writeFileSync(path.join(dir, 'acl'), acl, { mode: 0o644 });

    writeFileSync(
      path.join(dir, 'mosquitto.conf'),
      [
        'listener 8883 0.0.0.0',
        'cafile /mosquitto/config/ca.crt',
        'certfile /mosquitto/config/server.crt',
        'keyfile /mosquitto/config/server.key',
        'allow_anonymous false',
        'password_file /mosquitto/config/passwd',
        'acl_file /mosquitto/config/acl',
        // F-02, segunda barrera: el broker IMPONE client_id = usuario.
        'use_username_as_clientid true',
        'persistence false',
        'log_type warning',
        '',
      ].join('\n'),
      { mode: 0o644 },
    );

    // El passwd nace vacío: lo va a llenar el BACKEND al emitir credenciales.
    // Ese es el punto de la prueba — si estuviera precargado, no se estaría
    // midiendo la autoridad del servidor sino la del que escribió el fichero.
    passwdFile = path.join(dir, 'passwd');
    writeFileSync(passwdFile, '', { mode: 0o644 });

    mqPort = puertoLibre(28_000);
    mqContainer = `diana-real-mq-${mqPort}`;

    // El backend escribe en el passwd con `mosquitto_passwd` DENTRO de un
    // contenedor efímero: el host no tiene el binario. El secreto viaja por
    // stdin del `docker run -i`, nunca por argv.
    // El directorio se monta en la MISMA ruta dentro del contenedor. Así el
    // almacén ve exactamente el mismo fichero que el binario, y su
    // comprobación de existencia (que decide si hay que CREAR el passwd o
    // añadirle una entrada) mira la ruta correcta. Montarlo en otra ruta hacía
    // que el almacén creyera que no existía y pasara `-c`, que TRUNCA: en
    // producción eso habría borrado las credenciales de los otros ocho
    // módulos en cada emisión.
    const bin = path.join(dir, 'mosquitto_passwd_shim');
    writeFileSync(
      bin,
      ['#!/bin/sh',
       'exec docker run --rm -i \\',
       `  -v ${dir}:${dir} \\`,
       '  --entrypoint mosquitto_passwd \\',
       `  ${MOSQUITTO_IMAGE} "$@"`,
       ''].join('\n'),
      { mode: 0o755 },
    );

    identidades = new MqttIdentityService(
      prisma as never,
      new CanonicalIdentitySource(GENERATOR),
      new MosquittoPasswdStore(passwdFile, bin),
    );
  });

  afterAll(async () => {
    for (const c of clientes) {
      try {
        c.end(true);
      } catch {
        /* el cliente ya estaba cerrado */
      }
    }
    await prisma?.$disconnect().catch(() => undefined);
    if (mqContainer) spawnSync('docker', ['rm', '-f', mqContainer], { stdio: 'ignore' });
    if (pgContainer) spawnSync('docker', ['rm', '-f', pgContainer], { stdio: 'ignore' });
  });

  /** Arranca el broker con el passwd tal y como esté AHORA. */
  function arrancarBroker(): void {
    // ── Permisos del fixture, y por qué divergen de producción ──────────────
    // `MosquittoPasswdStore` deja el passwd en 0640 a propósito: el broker lo
    // lee por GRUPO. En producción eso funciona porque backend y broker
    // comparten el gid 1883 sobre un volumen (ver `compose.yml` y
    // `server/backend/Dockerfile`). Aquí el fichero vive en un directorio
    // temporal del HOST, propiedad del usuario que ejecuta la suite, y no hay
    // forma de meter al uid 1883 del contenedor en ese grupo sin privilegios.
    // Con 0640, mosquitto arranca y muere con `Unable to open pwfile`.
    //
    // Se abre a 0644 SÓLO para este fixture efímero, y se deja dicho: la
    // invariante «0640, ni más ni menos» se mide donde el montaje es el de
    // verdad, en `tests/e2e/modules-ui` (paso 8, `modoPasswd`).
    chmodSync(passwdFile, 0o644);
    spawnSync('docker', ['rm', '-f', mqContainer], { stdio: 'ignore' });
    execFileSync('docker', [
      'run', '-d', '--rm',
      '--name', mqContainer,
      '-p', `${mqPort}:8883`,
      '-v', `${dir}:/mosquitto/config`,
      MOSQUITTO_IMAGE,
    ]);
  }

  interface Conexion {
    conectado: boolean;
    codigo: number | null;
    cliente: MqttClient | null;
  }

  function conectar(username: string, password: string, clientId?: string): Promise<Conexion> {
    return new Promise((resolve) => {
      const c = connect(`mqtts://127.0.0.1:${mqPort}`, {
        username,
        password,
        clientId: clientId ?? `probe-${Math.random().toString(36).slice(2)}`,
        protocolVersion: 5,
        ca: readFileSync(path.join(dir, 'ca.crt')),
        rejectUnauthorized: true,
        servername: 'localhost',
        reconnectPeriod: 0,
        connectTimeout: 10_000,
      });
      let resuelto = false;
      const fin = (r: Conexion) => {
        if (resuelto) return;
        resuelto = true;
        resolve(r);
      };
      c.on('connect', () => {
        clientes.push(c);
        fin({ conectado: true, codigo: 0, cliente: c });
      });
      // En MQTT 5 un CONNACK de rechazo llega como `error` con reasonCode.
      c.on('error', (e: Error & { code?: number }) => {
        c.end(true);
        fin({ conectado: false, codigo: e.code ?? null, cliente: null });
      });
      c.on('close', () => fin({ conectado: false, codigo: null, cliente: null }));
    });
  }

  /** Publica y devuelve el reasonCode del PUBACK, que es lo único que
   *  distingue una denegación de ACL de un envío correcto (medido en P0-2). */
  function publicar(c: MqttClient, topic: string): Promise<number | null> {
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(null), 8_000);
      c.publish(topic, JSON.stringify({ sonda: true }), { qos: 1 }, (err, packet) => {
        clearTimeout(t);
        const rc = (packet as { reasonCode?: number } | undefined)?.reasonCode;
        resolve(rc ?? (err ? -1 : 0));
      });
    });
  }

  /** Se suscribe y devuelve el código de retorno del SUBACK por tópico. */
  function suscribir(c: MqttClient, topic: string): Promise<number | null> {
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(null), 8_000);
      c.subscribe(topic, { qos: 1 }, (err, granted) => {
        clearTimeout(t);
        if (err) {
          resolve(-1);
          return;
        }
        resolve(granted?.[0]?.qos ?? null);
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // T2 · la migración, contra la base viva
  // ═══════════════════════════════════════════════════════════════════════════
  describe('T2 · el esquema separa deseada de reportada, y la base lo IMPONE', () => {
    it('las columnas existen y `config_version` ya no', async () => {
      const cols = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'modules'`,
      );
      const nombres = cols.map((c) => c.column_name);
      expect(nombres).toEqual(
        expect.arrayContaining([
          'desired_config_version',
          'reported_config_version',
          'config_state',
          'config_applied_at',
        ]),
      );
      // La vieja se RENOMBRÓ: si siguiera existiendo habría dos fuentes de
      // verdad y algún código antiguo podría seguir escribiendo en ella.
      expect(nombres).not.toContain('config_version');
    });

    it('un módulo nuevo nace `pending`, con reportada NULL', async () => {
      const m = await prisma.module.create({ data: { slug: 'module-01' } });
      expect(m.desiredConfigVersion).toBe(0);
      expect(m.reportedConfigVersion).toBeNull();
      expect(m.configState).toBe('pending');
      expect(m.configAppliedAt).toBeNull();
    });

    it('CALIBRACIÓN · la base RECHAZA `applied` sin reporte del módulo', async () => {
      // Sin esta prueba, el CHECK podría no existir y nadie se enteraría.
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE modules SET config_state = 'applied' WHERE slug = 'module-01'`,
        ),
      ).rejects.toThrow();
    });

    it('CALIBRACIÓN · la base RECHAZA `applied` con reportada != deseada', async () => {
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE modules SET config_state = 'applied', reported_config_version = 3,
             desired_config_version = 9 WHERE slug = 'module-01'`,
        ),
      ).rejects.toThrow();
    });

    it('CALIBRACIÓN · la base RECHAZA un estado fuera del repertorio', async () => {
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE modules SET config_state = 'inventado' WHERE slug = 'module-01'`,
        ),
      ).rejects.toThrow();
    });

    it('CALIBRACIÓN · la base RECHAZA una versión negativa', async () => {
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE modules SET desired_config_version = -1 WHERE slug = 'module-01'`,
        ),
      ).rejects.toThrow();
    });

    it('CONTROL POSITIVO · la escritura legítima SÍ pasa', async () => {
      // Si todo lo de arriba fallara por un motivo ajeno (permisos, conexión),
      // esto también fallaría. Que pase separa «el CHECK cortó» de «nada
      // escribe en esta tabla».
      const n = await prisma.$executeRawUnsafe(
        `UPDATE modules SET desired_config_version = 4, reported_config_version = 4,
           config_state = 'applied', config_applied_at = NOW() WHERE slug = 'module-01'`,
      );
      expect(n).toBe(1);
      const m = await prisma.module.findUnique({ where: { slug: 'module-01' } });
      expect(m?.configState).toBe('applied');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // T1 · autoridad, comprobada EN LA BASE
  // ═══════════════════════════════════════════════════════════════════════════
  describe('T1 · un PATCH no puede tocar identidad ni versión', () => {
    const crud = () =>
      new CrudService(
        (prisma as never as { module: never }).module,
        'module',
        [...MODULE_CREATABLE_FIELDS],
        undefined,
        MODULE_UPDATABLE_FIELDS,
      );

    it('el pipe rechaza el cuerpo y NADA cambia en PostgreSQL', async () => {
      const antes = await prisma.module.findUnique({ where: { slug: 'module-01' } });
      const pipe = new DtoValidationPipe(UpdateModuleDto);

      expect(() => pipe.transform({ slug: 'module-99', configVersion: 999 })).toThrow();

      const despues = await prisma.module.findUnique({ where: { slug: 'module-01' } });
      expect(despues!.slug).toBe(antes!.slug);
      expect(despues!.desiredConfigVersion).toBe(antes!.desiredConfigVersion);
    });

    it('aunque se salte el pipe, el servicio no escribe `slug` en la fila', async () => {
      const antes = await prisma.module.findUnique({ where: { slug: 'module-01' } });
      await crud().update(antes!.id, {
        friendlyName: 'Renombrada',
        slug: 'module-99',
        configVersion: 999,
      } as never);

      // LA EVIDENCIA: la fila releída de PostgreSQL.
      const despues = await prisma.module.findUnique({ where: { id: antes!.id } });
      expect(despues!.slug).toBe('module-01');
      expect(despues!.friendlyName).toBe('Renombrada'); // lo legítimo SÍ se aplicó
      expect(despues!.desiredConfigVersion).toBe(antes!.desiredConfigVersion);
      // Y no existe ninguna fila con el slug que se intentó imponer.
      expect(await prisma.module.findUnique({ where: { slug: 'module-99' } })).toBeNull();
    });

    it('el alta SÍ fija el slug (y sólo el alta)', async () => {
      const pipe = new DtoValidationPipe(CreateModuleDto);
      const body = pipe.transform({ slug: 'module-02', friendlyName: 'Dos' });
      const creado: { id: string } = await crud().create(body as never);
      const fila = await prisma.module.findUnique({ where: { id: creado.id } });
      expect(fila!.slug).toBe('module-02');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // T2 · el empujón sube la versión UNA vez, comprobado en la base
  // ═══════════════════════════════════════════════════════════════════════════
  describe('T2 · config/push contra PostgreSQL real', () => {
    const mqttFalso = {
      publishModuleConfig: jest.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 20));
        return { delivered: true, denied: false };
      }),
    } as never;

    /**
     * Un módulo LISTO para recibir configuración: nueve dianas, cada una con
     * su calibración, creadas en PostgreSQL de verdad.
     *
     * Antes estas pruebas creaban el módulo pelado y empujaban. Funcionaba
     * porque el doble de MQTT no mira el mensaje — pero el contrato exige
     * `calibration` con nueve elementos, así que en el despliegue real ese
     * mismo empujón era un 500. Ahora `push` rechaza el módulo sin calibrar
     * con un 400, y estas pruebas tienen que partir del estado que de verdad
     * permite empujar.
     */
    async function moduloCalibrado(slug: string): Promise<{ id: string }> {
      const m = await prisma.module.create({ data: { slug } });
      for (let i = 1; i <= 9; i += 1) {
        const t = await prisma.target.create({ data: { moduleId: m.id, targetIndex: i } });
        await prisma.sensorCalibration.create({
          data: {
            targetId: t.id,
            threshold: 1200,
            hysteresis: 80,
            noiseFloor: 40,
            blankingUs: 5000,
            groupWindowUs: 2000,
            neighbourRatio: 0.35,
          },
        });
      }
      return m;
    }

    it('un módulo SIN las nueve dianas calibradas se rechaza con 400 y sin efectos', async () => {
      // El caso del módulo recién dado de alta, contra PostgreSQL real: es lo
      // que le pasa al primer ESP32 que alguien intente configurar antes de
      // calibrarlo, y tiene que ser un error de entrada, no un 500.
      const m = await prisma.module.create({ data: { slug: 'module-05' } });
      const svc = new ModuleConfigService(prisma as never, mqttFalso);

      await expect(svc.push(m.id)).rejects.toMatchObject({ status: 400 });

      // Y no ha consumido versión: comprobado EN LA FILA, no en la excepción.
      const fila = await prisma.module.findUnique({ where: { id: m.id } });
      expect(fila!.desiredConfigVersion).toBe(0);
      expect(fila!.configState).toBe('pending');
    });

    it('un empujón sube la deseada EXACTAMENTE en 1', async () => {
      const m = await moduloCalibrado('module-03');
      const svc = new ModuleConfigService(prisma as never, mqttFalso);

      const r = await svc.push(m.id);

      const fila = await prisma.module.findUnique({ where: { id: m.id } });
      expect(fila!.desiredConfigVersion).toBe(1);
      expect(r.published.config_version).toBe(1);
      expect(fila!.configState).toBe('pending');
    });

    it('CINCO empujones concurrentes NO repiten número (reserva atómica)', async () => {
      // Esto es lo que un doble no puede demostrar: la atomicidad la da
      // PostgreSQL, no el código de Node.
      const m = await moduloCalibrado('module-04');
      const svc = new ModuleConfigService(prisma as never, mqttFalso);

      const resultados = await Promise.all([
        svc.push(m.id), svc.push(m.id), svc.push(m.id), svc.push(m.id), svc.push(m.id),
      ]);
      const numeros = resultados.map((r) => r.published.config_version).sort((a, b) => a - b);

      expect(numeros).toEqual([1, 2, 3, 4, 5]);
      expect(new Set(numeros).size).toBe(5);
      const fila = await prisma.module.findUnique({ where: { id: m.id } });
      expect(fila!.desiredConfigVersion).toBe(5);
    });

    it('publicar NO deja el módulo en `applied`: eso lo dice el módulo', async () => {
      const fila = await prisma.module.findUnique({ where: { slug: 'module-04' } });
      expect(fila!.configState).toBe('pending');
      expect(fila!.reportedConfigVersion).toBeNull();
      expect(fila!.configAppliedAt).toBeNull();
    });

    it('un config/reported real lleva la fila a `applied`', async () => {
      const sink = new ModuleConfigReportedService(prisma as never);
      const antes = await prisma.module.findUnique({ where: { slug: 'module-04' } });

      const r = await sink.record('module-04', antes!.desiredConfigVersion, null, new Date());
      expect(r.outcome).toBe('applied');

      const despues = await prisma.module.findUnique({ where: { slug: 'module-04' } });
      expect(despues!.reportedConfigVersion).toBe(antes!.desiredConfigVersion);
      expect(despues!.configState).toBe('applied');
      expect(despues!.configAppliedAt).not.toBeNull();
    });

    it('una versión ANTERIOR no retrocede la fila', async () => {
      const sink = new ModuleConfigReportedService(prisma as never);
      const antes = await prisma.module.findUnique({ where: { slug: 'module-04' } });

      const r = await sink.record('module-04', 1, null, new Date());
      expect(r.outcome).toBe('rejected');

      const despues = await prisma.module.findUnique({ where: { slug: 'module-04' } });
      expect(despues!.reportedConfigVersion).toBe(antes!.reportedConfigVersion);
    });

    it('un empujón nuevo devuelve la fila a `pending`', async () => {
      const m = await prisma.module.findUnique({ where: { slug: 'module-04' } });
      await new ModuleConfigService(prisma as never, mqttFalso).push(m!.id);

      const fila = await prisma.module.findUnique({ where: { id: m!.id } });
      expect(fila!.configState).toBe('pending');
      expect(fila!.configAppliedAt).toBeNull();
      expect(fila!.desiredConfigVersion).toBe(6);
      expect(fila!.reportedConfigVersion).toBe(5); // la reportada NO se toca
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // T4 · identidad individual contra Mosquitto REAL por TLS 8883
  // ═══════════════════════════════════════════════════════════════════════════
  describe('T4 · la credencial que emite el backend autentica en TLS 8883', () => {
    let secretoMio = '';
    let secretoAjeno = '';
    let moduloMio: { id: string };

    it('el backend emite la credencial y la escribe en el passwd del broker', async () => {
      moduloMio = await prisma.module.create({ data: { slug: MIO } });
      const emitida = await identidades.issue(moduloMio.id, { username: 'admin-test' });
      secretoMio = emitida.secret;

      expect(emitida.username).toBe(MIO);
      expect(emitida.clientId).toBe(MIO);

      // EFECTO OBSERVABLE: el fichero del broker tiene ahora esa identidad.
      expect(existsSync(passwdFile)).toBe(true);
      const passwd = readFileSync(passwdFile, 'utf8');
      expect(passwd).toContain(`${MIO}:`);
      // Y NO contiene el secreto en claro: `mosquitto_passwd` guarda un hash.
      expect(passwd).not.toContain(secretoMio);
    });

    it('EN LA BASE queda un hash bcrypt y una huella, jamás el secreto', async () => {
      const fila = await prisma.moduleMqttCredential.findUnique({
        where: { moduleId: moduloMio.id },
      });
      expect(fila).not.toBeNull();
      expect(fila!.username).toBe(MIO);
      expect(fila!.secretHash).toMatch(/^\$2[aby]\$/);
      expect(fila!.fingerprint).toMatch(/^[0-9a-f]{16}$/);
      expect(fila!.generation).toBe(1);
      expect(fila!.issuedByUsername).toBe('admin-test');
      // Barrido sobre la FILA ENTERA leída de PostgreSQL.
      expect(JSON.stringify(fila)).not.toContain(secretoMio);
    });

    it('el secreto no está en NINGUNA columna de texto de la base', async () => {
      // No se comprueba sólo la tabla que sospechamos: se barre `audit_log`
      // también, que es donde acabaría si alguien volcara el objeto emitido.
      const filas = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM audit_log WHERE after::text LIKE $1`,
        `%${secretoMio}%`,
      );
      expect(Number(filas[0].n)).toBe(0);
    });

    it('una segunda emisión sin rotar se RECHAZA (no hay «volver a verla»)', async () => {
      await expect(identidades.issue(moduloMio.id)).rejects.toThrow(/rotar|ROTAR/i);
    });

    it('un módulo NO declarado en identities.json no obtiene credencial', async () => {
      const fantasma = await prisma.module.create({ data: { slug: 'module-77' } });
      await expect(identidades.issue(fantasma.id)).rejects.toThrow(/fuente única/i);
      // Y la base no tiene fila para él.
      expect(
        await prisma.moduleMqttCredential.findUnique({ where: { moduleId: fantasma.id } }),
      ).toBeNull();
    });

    it('la credencial del vecino se emite aparte, con OTRO secreto', async () => {
      const m8 = await prisma.module.create({ data: { slug: AJENO } });
      const e = await identidades.issue(m8.id);
      secretoAjeno = e.secret;
      expect(secretoAjeno).not.toBe(secretoMio);
    });

    it('AUTENTICA contra Mosquitto real por TLS 8883', async () => {
      arrancarBroker();
      await esperar(
        () =>
          spawnSync('docker', ['exec', mqContainer, 'sh', '-c', 'test -f /mosquitto/config/passwd'], {
            stdio: 'ignore',
          }).status === 0,
        'que el broker levante con su configuración',
      );
      // Espera activa a que el listener TLS acepte: cada intento es una
      // conexión real, no un sleep.
      let ok: Awaited<ReturnType<typeof conectar>> | null = null;
      const t0 = Date.now();
      while (Date.now() - t0 < 60_000) {
        ok = await conectar(MIO, secretoMio);
        if (ok.conectado) break;
        await new Promise((r) => setTimeout(r, 700));
      }
      expect(ok!.conectado).toBe(true);
    });

    // Los controles negativos comprueban PRIMERO que la credencial correcta
    // sigue conectando. Sin eso, con el broker caído «no conectó» sale verde
    // por la razón equivocada y la prueba deja de poder ponerse roja.
    it('CONTROL NEGATIVO · una contraseña equivocada NO autentica', async () => {
      expect((await conectar(MIO, secretoMio)).conectado).toBe(true);
      const r = await conectar(MIO, `${secretoMio}-mal`);
      expect(r.conectado).toBe(false);
    });

    it('CONTROL NEGATIVO · el secreto del vecino no vale para esta identidad', async () => {
      expect((await conectar(MIO, secretoMio)).conectado).toBe(true);
      const r = await conectar(MIO, secretoAjeno);
      expect(r.conectado).toBe(false);
    });

    it('F-02 · el broker IMPONE client_id = usuario, lo declare el cliente o no', async () => {
      // Se conecta declarando el client_id del VECINO. Si el client_id
      // autorizase algo, esto sería una suplantación.
      const r = await conectar(MIO, secretoMio, AJENO);
      expect(r.conectado).toBe(true);
      // Y sus permisos siguen siendo los suyos, no los del client_id declarado:
      const rc = await publicar(r.cliente!, `${ROOT}/module/${AJENO}/presence`);
      expect(rc).toBe(135);
    });
  });

  describe('T4 · la ACL canónica confina la identidad a su subárbol', () => {
    let mio: MqttClient;
    let backend: MqttClient;
    const BACKEND_PW = 'backend-efimero-de-prueba';

    beforeAll(async () => {
      const fila = await prisma.moduleMqttCredential.findUnique({
        where: { username: MIO },
      });
      expect(fila).not.toBeNull();
      // El secreto no se puede releer: se ROTA para tener uno con el que
      // conectar. Que haya que hacer esto ES la garantía funcionando.
      const m = await prisma.module.findUnique({ where: { slug: MIO } });
      const rotada = await identidades.issue(m!.id, {}, true);

      // Credencial del BACKEND. No pasa por MqttIdentityService a propósito:
      // `backend` es una identidad de SERVICIO en la fuente única, no un
      // módulo, y ese servicio sólo emite credenciales de módulo. Aquí es
      // utillaje, y se dice: lo que se está midiendo es el confinamiento del
      // módulo, no cómo nace la credencial del backend.
      await new MosquittoPasswdStore(passwdFile, path.join(dir, 'mosquitto_passwd_shim')).upsert(
        'backend',
        BACKEND_PW,
      );

      arrancarBroker();
      let r: Awaited<ReturnType<typeof conectar>> | null = null;
      const t0 = Date.now();
      while (Date.now() - t0 < 60_000) {
        r = await conectar(MIO, rotada.secret);
        if (r.conectado) break;
        await new Promise((res) => setTimeout(res, 700));
      }
      expect(r!.conectado).toBe(true);
      mio = r!.cliente!;

      const b = await conectar('backend', BACKEND_PW);
      expect(b.conectado).toBe(true);
      backend = b.cliente!;
    });

    it('SUSCRIPCIÓN a su propio canal de órdenes: CONCEDIDA', async () => {
      const qos = await suscribir(mio, `${ROOT}/module/${MIO}/command`);
      expect(qos).toBe(1);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // HALLAZGO MEDIDO AQUÍ · el SUBACK NO delata una suscripción denegada.
    //
    // Se esperaba 135 (Not authorized) y Mosquitto 2 devuelve QoS 1 CONCEDIDA
    // para un tópico que la ACL no deja leer. La suscripción se acepta y
    // sencillamente no se entrega nada. Es el gemelo exacto del aviso ya
    // conocido en publicación: el código de retorno no separa «autorizado» de
    // «denegado», y quien lo use para eso concluirá lo contrario de la verdad.
    //
    // Por eso el confinamiento de LECTURA se mide por el EFECTO: alguien
    // autorizado publica y se comprueba quién recibe.
    // ─────────────────────────────────────────────────────────────────────────
    it('el SUBACK de una suscripción DENEGADA es indistinguible de una concedida', async () => {
      const ajeno = await suscribir(mio, `${ROOT}/module/${AJENO}/command`);
      const todo = await suscribir(mio, '#');
      // No se afirma que valgan 135: se deja escrito que NO valen 135, que es
      // lo medido, para que nadie vuelva a apoyarse en este código.
      expect(ajeno).not.toBe(135);
      expect(todo).not.toBe(135);
    });

    it('EFECTO · un config/desired del vecino NO llega a este módulo', async () => {
      // El emisor es el BACKEND con su propia credencial —su regla de ACL
      // `topic write targets/v1/module/+/config/desired` es real y canónica— y
      // no un módulo simulado: no se fabrica ningún mensaje de dispositivo.
      const recibidos: string[] = [];
      mio.on('message', (t) => recibidos.push(t));

      expect(await suscribir(mio, `${ROOT}/module/${AJENO}/config/desired`)).not.toBeNull();
      expect(await suscribir(mio, `${ROOT}/module/${MIO}/config/desired`)).not.toBeNull();

      const rcAjeno = await publicar(backend, `${ROOT}/module/${AJENO}/config/desired`);
      const rcMio = await publicar(backend, `${ROOT}/module/${MIO}/config/desired`);
      expect(rcAjeno).toBe(0); // el backend SÍ puede publicar en los dos
      expect(rcMio).toBe(0);

      // Espera activa hasta que llegue el propio (control positivo).
      const t0 = Date.now();
      while (Date.now() - t0 < 10_000) {
        if (recibidos.some((t) => t.includes(`/${MIO}/`))) break;
        await new Promise((r) => setTimeout(r, 200));
      }

      // CONTROL POSITIVO: el suyo llega. Sin esto, «no llegó el ajeno» podría
      // significar sencillamente que la entrega no funciona.
      expect(recibidos.some((t) => t === `${ROOT}/module/${MIO}/config/desired`)).toBe(true);
      // LA GARANTÍA: el del vecino NO llega, pese a que la suscripción se
      // «concedió» y el backend lo publicó de verdad.
      expect(recibidos.some((t) => t === `${ROOT}/module/${AJENO}/config/desired`)).toBe(false);
    });

    it('PUBLICAR en el subárbol del VECINO: PUBACK 135', async () => {
      const rc = await publicar(mio, `${ROOT}/module/${AJENO}/hit`);
      expect(rc).toBe(135);
    });

    it('PUBLICAR su propio `config/desired` (que es SÓLO LECTURA): PUBACK 135', async () => {
      // Un comodín `module/<id>/#` en la ACL habría dejado a un módulo
      // comprometido escribirse su propia configuración. La ACL canónica va
      // tópico a tópico justamente para impedirlo.
      const rc = await publicar(mio, `${ROOT}/module/${MIO}/config/desired`);
      expect(rc).toBe(135);
    });

    it('PUBLICAR su propia orden de aprovisionamiento: PUBACK 135', async () => {
      const rc = await publicar(mio, `${ROOT}/module/${MIO}/provision`);
      expect(rc).toBe(135);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // MATIZ MEDIDO · quién ve la denegación de publicación depende del cliente.
    //
    // El aviso conocido («rc=0 con Warning: Not authorized») se midió con
    // `mosquitto_pub`, la herramienta de línea de órdenes. Con la librería
    // `mqtt` de Node en protocolVersion 5 NO es así: el callback SÍ recibe un
    // `ErrorWithReasonCode: Publish error: Not authorized`.
    //
    // La conclusión operativa no cambia, se refuerza: lo fiable en los dos
    // casos es el `reasonCode` del PUBACK. El código de retorno depende de la
    // herramienta, y una comprobación que se apoye en él acertará con un
    // cliente y mentirá con otro.
    // ─────────────────────────────────────────────────────────────────────────
    it('MATIZ MEDIDO · el reasonCode es fiable; el error del cliente depende del cliente', async () => {
      const denegado: { err: unknown; rc: number | undefined } = await new Promise((resolve) => {
        mio.publish(`${ROOT}/module/${AJENO}/telemetry`, '{}', { qos: 1 }, (err, packet) => {
          resolve({
            err,
            rc:
              (packet as { reasonCode?: number } | undefined)?.reasonCode ??
              (err as { code?: number } | undefined)?.code,
          });
        });
      });
      // Lo que SIEMPRE vale: el reasonCode dice 135.
      expect(denegado.rc).toBe(135);
      // Y se deja constancia de lo medido con ESTE cliente, que contradice lo
      // observado con mosquitto_pub.
      expect(denegado.err).toBeTruthy();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // T3 · la garantía, leída de la base al final de todo
  // ═══════════════════════════════════════════════════════════════════════════
  describe('T3 · con 0 dispositivos conectados, 0 módulos ONLINE', () => {
    it('ningún módulo tiene señal de vida: nada la ha fabricado', async () => {
      const filas = await prisma.module.findMany({
        select: { slug: true, online: true, lastSeenAt: true, offlineSince: true },
      });
      expect(filas.length).toBeGreaterThan(0);
      for (const f of filas) {
        expect(f.online).toBe(false);
        expect(f.lastSeenAt).toBeNull();
        expect(f.offlineSince).toBeNull();
      }
    });

    it('emitir credenciales y conectar clientes MQTT no puso a nadie ONLINE', async () => {
      // Han pasado por aquí varias conexiones TLS reales, publicaciones y
      // suscripciones. Ninguna era un módulo, y la base lo refleja.
      const filas = await prisma.module.findMany({
        select: { slug: true, online: true, lastSeenAt: true },
      });
      const veredictos = classifyConnectivityAll(filas, new Date());
      const resumen = summarizeConnectivity(veredictos);

      expect(resumen.online).toBe(0);
      expect(resumen.stale).toBe(0);
      expect(resumen.offline).toBe(0);
      expect(resumen.pending).toBe(filas.length);
    });

    it('un módulo con credencial emitida sigue en PENDING', async () => {
      const fila = await prisma.module.findUnique({
        where: { slug: MIO },
        select: { slug: true, online: true, lastSeenAt: true },
      });
      const [v] = classifyConnectivityAll([fila!], new Date());
      expect(v.connectivity).toBe('PENDING');
    });
  });
});
