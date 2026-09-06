/**
 * El MÓDULO del escenario: el firmware D1b compilado en host, gobernado como
 * proceso de larga vida.
 *
 * `feed()` no simula nada: mete el payload que llegó por el broker en
 * `diana_prov_message()`, que es el camino de runtime completo del firmware
 * (parser → máquina de estados → NVS). Lo que devuelve incluye el veredicto,
 * la TRAZA de pasos ejecutados y —lo que de verdad importa para los negativos—
 * el estado PERSISTIDO y el contador de escrituras a NVS.
 *
 * Lo que este proceso NO es: silicio. Ver `README.md` del carril.
 */
import { ChildProcessWithoutNullStreams, execFileSync, spawn } from 'node:child_process';
import * as path from 'node:path';

export interface DeviceSnapshot {
  state: string;
  activeEpoch: string;
  pendingEpoch: string;
  lastProvSeq: number;
  lastRotation: string;
  lastDelegSeq: number;
  hasOpKey: boolean;
  hasDelegFingerprint: boolean;
  fingerprint: string;
  /** Escrituras a NVS acumuladas. ES el efecto observable del plano. */
  kvWrites: number;
  reboots: number;
}

export interface DeviceOutcome {
  publish: boolean;
  result: string;
  state: string;
  reason: string;
  applied: boolean;
  authorityChanged: boolean;
  newEpoch: string;
  bootstraps: number;
  trace: string[];
  /** `module-provision-state` serializado POR EL FIRMWARE, si procede. */
  stateJson: Record<string, unknown> | null;
  snapshot: DeviceSnapshot;
}

function parseFields(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of line.split(';')) {
    const i = pair.indexOf('=');
    if (i > 0) out[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return out;
}

function toSnapshot(line: string): DeviceSnapshot {
  const f = parseFields(line);
  return {
    state: f.state,
    activeEpoch: f.active_epoch === '-' ? '' : f.active_epoch,
    pendingEpoch: f.pending_epoch === '-' ? '' : f.pending_epoch,
    lastProvSeq: Number(f.last_prov_seq),
    lastRotation: f.last_rotation === '-' ? '' : f.last_rotation,
    lastDelegSeq: Number(f.last_deleg_seq),
    hasOpKey: f.has_op_key === '1',
    hasDelegFingerprint: f.has_deleg_fp === '1',
    fingerprint: f.fingerprint,
    kvWrites: Number(f.kv_writes),
    reboots: Number(f.reboots),
  };
}

/** Compila el runner. Devuelve la ruta del binario; lanza si no se produjo. */
export function buildRunner(): string {
  const script = path.resolve(__dirname, '../tools/build-runner.sh');
  const out = execFileSync(script, { encoding: 'utf8' }).trim();
  if (!out) throw new Error('build-runner.sh no devolvió la ruta del binario');
  return out;
}

export class HostDevice {
  private readonly proc: ChildProcessWithoutNullStreams;
  private buffer = '';
  private pending: ((lines: string[]) => void) | null = null;
  private queue: string[] = [];

  private constructor(binary: string) {
    this.proc = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk: string) => this.onData(chunk));
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const nl = this.buffer.indexOf('\n');
      if (nl < 0) break;
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      if (line === 'END') {
        const lines = this.queue;
        this.queue = [];
        const resolve = this.pending;
        this.pending = null;
        resolve?.(lines);
      } else {
        this.queue.push(line);
      }
    }
  }

  private send(line: string): Promise<string[]> {
    if (this.pending) throw new Error('hay una orden del dispositivo en vuelo');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`el dispositivo no respondió a: ${line.slice(0, 40)}`)),
        15000,
      );
      this.pending = (lines) => {
        clearTimeout(timer);
        resolve(lines);
      };
      this.proc.stdin.write(`${line}\n`);
    });
  }

  static async start(options: {
    binary: string;
    deviceId: string;
    systemId: string;
    fingerprint: string;
    /** Punto SEC1 base64url de la raíz, o `null` para un módulo SIN raíz. */
    rootPublicKeySec1: string | null;
    rootKeyId: string;
  }): Promise<HostDevice> {
    const device = new HostDevice(options.binary);
    const root = options.rootPublicKeySec1 ?? 'NONE';
    const lines = await device.send(
      `INIT ${options.deviceId} ${options.systemId} ${options.fingerprint} ${root} ${options.rootKeyId}`,
    );
    const err = lines.find((l) => l.startsWith('ERR '));
    if (err) throw new Error(`INIT del dispositivo falló: ${err}`);
    return device;
  }

  /** Mete un payload por el camino de runtime del firmware. */
  async feed(payload: Buffer | string, retained: boolean): Promise<DeviceOutcome> {
    const b64 = Buffer.from(payload).toString('base64url');
    const lines = await this.send(`MSG ${retained ? 1 : 0} ${b64}`);
    const err = lines.find((l) => l.startsWith('ERR '));
    if (err) throw new Error(`el dispositivo devolvió ${err}`);

    const outLine = lines.find((l) => l.startsWith('OUT '));
    const stateLine = lines.find((l) => l.startsWith('STATE '));
    const snapLine = lines.find((l) => l.startsWith('SNAP '));
    if (!outLine || !snapLine) throw new Error(`respuesta incompleta: ${lines.join(' | ')}`);

    const f = parseFields(outLine.slice(4));
    return {
      publish: f.publish === '1',
      result: f.result,
      state: f.state,
      reason: f.reason === '-' ? '' : f.reason,
      applied: f.applied === '1',
      authorityChanged: f.authority_changed === '1',
      newEpoch: f.new_epoch === '-' ? '' : f.new_epoch,
      bootstraps: Number(f.bootstraps),
      trace: f.trace ? f.trace.split('|').filter(Boolean) : [],
      stateJson: stateLine
        ? (JSON.parse(
            Buffer.from(stateLine.slice(6), 'base64url').toString('utf8'),
          ) as Record<string, unknown>)
        : null,
      snapshot: toSnapshot(snapLine.slice(5)),
    };
  }

  async snapshot(): Promise<DeviceSnapshot> {
    const lines = await this.send('SNAP');
    const snap = lines.find((l) => l.startsWith('SNAP '));
    if (!snap) throw new Error(`SNAP sin respuesta: ${lines.join(' | ')}`);
    return toSnapshot(snap.slice(5));
  }

  /** Reinicio real: contexto nuevo, NVS intacta. */
  async reboot(): Promise<DeviceSnapshot> {
    const lines = await this.send('REBOOT');
    const snap = lines.find((l) => l.startsWith('SNAP '));
    if (!snap) throw new Error(`REBOOT sin respuesta: ${lines.join(' | ')}`);
    return toSnapshot(snap.slice(5));
  }

  stop(): void {
    try {
      this.proc.stdin.write('QUIT\n');
    } catch {
      /* ya muerto */
    }
    this.proc.kill('SIGKILL');
  }
}
