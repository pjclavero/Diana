import { RealTimeClock } from '../src/clock.js';
import { Simulation } from '../src/simulation.js';
async function main() {
  const sim = new Simulation({ systemId: 'system-real', seed: 1, clock: new RealTimeClock(), mqtt: { url: 'mqtt://127.0.0.1:18830' } });
  const [m] = sim.addDefaultModules(1);
  await sim.bootAll();
  console.log('booted');
  await new Promise(r => setTimeout(r, 3000));
}
main().catch(e => { console.error('ERR', e); process.exit(1); });
