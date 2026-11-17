/**
 * Stage 1 profile driver: Katoomba demo scenario (6 km, seed 11, civil start 2025-12-20 12:00, 310 m ignition line,
 * snapshot every 60 s) run on `Simulation` to RUN_TO seconds of fire.
 *   node profile.mjs TIER [RUN_TO] [PROFILE_OUT.cpuprofile]
 * With an output path, the V8 CPU profiler (the engine behind `node --cpu-prof`, here started in-process so scenario building and
 * the moisture / atmosphere spin-up are left out) samples only `sim.advance(RUN_TO)`, the 1800 s of fire.
 */
import { Session } from 'node:inspector';
import { writeFileSync } from 'node:fs';
import { Simulation } from '../../../../src/sim/simulation';
import { demoScenario, withIgnitions } from '../../../../src/sim/testing/scenarios';

const tier = (process.argv[2] ?? 'fast') as 'fast' | 'standard';
const runTo = Number(process.argv[3] ?? 1800);
const out = process.argv[4];
const base = await demoScenario({ startCivil: [2025, 12, 20, 12], extent: 6000, tier, duration: 3600 });
const scenario = withIgnitions(base, [{ id: 'line', kind: 'line', points: [[-570, -450], [-350, -230]], time: 0, origin: 'observed' }], { snapshotInterval: 60, tier, seed: 11 });
let snaps = 0;
const sim = new Simulation(scenario, { tier, hooks: { snapshot: () => { snaps++; } } });
const t0 = performance.now();
const spun = sim.spinUp();
const t1 = performance.now();

const post = (s: Session, m: string, p?: object): Promise<any> => new Promise((res, rej) => s.post(m, p as never, (e, r) => (e ? rej(e) : res(r))));
let session: Session | null = null;
if (out) {
  session = new Session();
  session.connect();
  await post(session, 'Profiler.enable');
  await post(session, 'Profiler.setSamplingInterval', { interval: 200 });
  await post(session, 'Profiler.start');
}
const t2 = performance.now();
sim.advance(runTo);
const t3 = performance.now();
if (session && out) {
  const { profile } = await post(session, 'Profiler.stop');
  writeFileSync(out, JSON.stringify(profile));
}
const g = scenario.terrain.grid;
console.log(JSON.stringify({ tier, grid: `${g.nx}x${g.ny}@${g.cellSize}`, spun, spinUpMs: Math.round(t1 - t0), advanceMs: Math.round(t3 - t2), simTime: sim.time, snapshots: snaps, profiled: !!out, perf: sim.perf() }));
process.exit(0);
