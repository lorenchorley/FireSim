/**
 * What one session costs in memory (0.9.0 contract 4.2, item 3): `SimHost` on a real scenario in a process of its own, measured with a
 * forced garbage collection after the scenario is built, after init, after the 3-D spin-up and after a run. It is the tool behind the
 * figures in desktop/README.md ("What it costs") and the table in sessionEstimate.test.ts. Run it with the runner, which builds it
 * (the simulation is TypeScript that Node cannot load as it is) and starts it with `--expose-gc`:
 *
 *   node desktop/measure.mjs EXTENT_M TIER RUN_TO_S [CELL_M]
 *
 * EXTENT_M the side of the domain (3000, 6000, 9000); TIER fast, standard or high; RUN_TO_S how far to run (seconds of fire); CELL_M, when
 * given, the fire cell of a synthetic scenario (10 for 10 m; without it the scenario is the Katoomba demo site, 30 m, or 20 m for `high` up
 * to 6 km). Prints one line of JSON: the message size, the grids, the size of one snapshot, the wall time and the readings (MiB).
 */
import { SimHost } from '../src/sim/host';
import { withoutContext } from '../src/sim/client';
import { encodeMessage } from '../src/sim/remote/codec';
import { demoScenario, pointIgnition, syntheticScenario, withIgnitions } from '../src/sim/testing/scenarios';

const [extentArg, tierArg, runArg, cellArg] = process.argv.slice(2);
const extent = Number(extentArg);
const tier = tierArg as 'fast' | 'standard' | 'high';
const runTo = Number(runArg ?? 1800);
if (!Number.isFinite(extent) || !['fast', 'standard', 'high'].includes(tier) || !Number.isFinite(runTo)) {
  console.error('usage: node desktop/measure.mjs EXTENT_M TIER RUN_TO_S [CELL_M]   (TIER: fast, standard or high)');
  process.exit(2);
}

const maybeGc = (globalThis as unknown as { gc?: () => void }).gc;
if (!maybeGc) {
  console.error('Run it with node --expose-gc (desktop/measure.mjs does).');
  process.exit(2);
}
const gc: () => void = maybeGc;
const mib = (n: number): number => Math.round((n / 1048576) * 10) / 10;
function reading(label: string): Record<string, number | string> {
  gc();
  gc();
  const m = process.memoryUsage();
  return { label, rss: mib(m.rss), heap: mib(m.heapUsed), arrayBuffers: mib(m.arrayBuffers), external: mib(m.external) };
}

const scenario = cellArg
  ? syntheticScenario({ extent, cellSize: Number(cellArg), duration: 3600, ignitions: [pointIgnition('a', -extent / 6, 0, 0, 60)], options: { snapshotInterval: 60, tier, maxEmbers: 2000, seed: 11 } })
  : withIgnitions(await demoScenario({ startCivil: [2025, 12, 20, 14], extent, tier, duration: 3600 }), [pointIgnition('escarpment', -extent / 3, 900, 0, 60)], { snapshotInterval: 60, tier, seed: 11 });
const frameBytes = encodeMessage({ type: 'init', scenario: withoutContext(scenario) }).byteLength;
const grid = scenario.terrain.grid;
const rows = [reading('scenario built')];

let ready = false;
let status = { time: 0, running: false };
let snapshots = 0;
let snapshotBytes = 0;
const host = new SimHost(
  {
    post: (m) => {
      if (m.type === 'ready') ready = true;
      else if (m.type === 'status') status = m;
      else if (m.type === 'snapshot') {
        snapshots++;
        if (snapshots === 3) snapshotBytes = encodeMessage(m).byteLength;
      } else if (m.type === 'error') console.error('ERROR', m.message);
    },
  },
  { transfer: false, schedule: (fn) => setImmediate(fn), simulation: { minSnapshotWallMs: 0 } },
);
const idle = (until: number): boolean => status.time >= until - 1e-6 && !status.running;
const t0 = Date.now();
host.handle({ type: 'init', scenario: withoutContext(scenario) });
while (!ready) await new Promise((r) => setTimeout(r, 20));
rows.push(reading('after init (ready)'));
// the 3-D spin-up and the auto-tune finish before a run starts: a run message waits behind them
host.handle({ type: 'run', until: 60 });
while (!idle(60)) await new Promise((r) => setTimeout(r, 50));
rows.push(reading('after spin-up and 60 s'));
host.handle({ type: 'run', until: runTo });
while (!idle(runTo)) await new Promise((r) => setTimeout(r, 100));
rows.push(reading(`after ${runTo} s`));

console.log(
  JSON.stringify({
    extent,
    tier,
    frameMiB: mib(frameBytes),
    fire: `${grid.nx}x${grid.ny} @ ${grid.cellSize} m = ${grid.nx * grid.ny}`,
    snapshotMiB: mib(snapshotBytes),
    wallS: (Date.now() - t0) / 1000,
    rows,
  }),
);
host.dispose();
process.exit(0);
