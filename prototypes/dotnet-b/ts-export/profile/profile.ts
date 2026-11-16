/**
 * Stage 1 profiling harness (T1.1). Runs the app's `Simulation` on a named scenario of ts-export/scenarios.ts, the way export.ts does but
 * without writing fixtures, and prints one JSON line. Never edits src/. Built by profile/run.mjs (a preserveModules bundle, so a CPU profile's
 * urls are the source files) and started with Node.
 *
 *   FS_COUNT unset: timing run. Reports wall ms of construct / spin-up / advance, the number of steps, and the app's own module timers (`perf()`).
 *                   Meant to be started with `node --cpu-prof`.
 *   FS_COUNT=1    : counting run. Math.exp/log/pow/... are wrapped (mathwrap.ts, imported first); counts are split by the app's step laps
 *                   (PerfStats.addLap is wrapped for this: the lap name tells which part of the step has just finished).
 */
import { installMathCounters, counts, takeSamples, COUNTED } from './mathwrap';
const COUNT = process.env.FS_COUNT === '1';
if (COUNT) installMathCounters();

import { existsSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { join } from 'node:path';
import { setNodePublicDir } from '../../../../src/data/assets';
import type { ScenarioData } from '../../../../src/core/types';
import { resolveOptions } from '../../../../src/scenario/build';
import { Simulation } from '../../../../src/sim/simulation';
import { PerfStats } from '../../../../src/sim/perfStats';
import { demoScenario, pointIgnition, withIgnitions } from '../../../../src/sim/testing/scenarios';
import { scenarioByName, type ScenarioDef } from '../scenarios';

const repoRoot = process.env.FS_REPO_ROOT ?? process.cwd();
setNodePublicDir(join(repoRoot, 'public') + '/');
if (!existsSync(join(repoRoot, 'public', 'demo', 'katoomba', 'manifest.json'))) {
  console.error(`public/demo/katoomba not found under ${repoRoot}: set FS_REPO_ROOT`);
  process.exit(2);
}
const arg = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const def0 = scenarioByName(process.argv[2] ?? '') as ScenarioDef | undefined;
if (!def0) {
  console.error('usage: profile NAME [--seed N] [--to S] [--duration S]');
  process.exit(2);
}
// --duration S: a longer scenario (the named ones last 3600 s and `advance` stops there); only the sensitivity runs use it.
const def: ScenarioDef = arg('duration') !== undefined ? { ...def0, duration: Number(arg('duration')) } : def0;
const seed = arg('seed') !== undefined ? Number(arg('seed')) : def.seed;
const runTo = arg('to') !== undefined ? Number(arg('to')) : def.runTo;

// Same scenario as export.ts (that file runs on import, so the few lines are repeated, not imported).
async function build(d: ScenarioDef): Promise<ScenarioData> {
  const tierOnly = d.grid === 'tier-only';
  const base = await demoScenario({ startCivil: d.startCivil, extent: d.extent, tier: tierOnly ? 'standard' : d.tier, duration: d.duration });
  let extra = {};
  if (tierOnly) {
    const o = resolveOptions({ options: { tier: d.tier } } as never, d.extent, base.options.fireCellSize);
    extra = { tier: d.tier, atmosCellSize: o.atmosCellSize, atmosLevels: o.atmosLevels, atmosDz1: o.atmosDz1, maxEmbers: o.maxEmbers };
  }
  const g = d.ignition;
  const ign = g.kind === 'point' ? pointIgnition(g.id, g.at[0], g.at[1], g.time, g.radius) : { id: g.id, kind: 'line' as const, points: [g.from, g.to], time: g.time, origin: 'observed' as const };
  return withIgnitions(base, [ign], { snapshotInterval: d.snapshotInterval, tier: d.tier, seed, ...extra, ...(d.options ?? {}) });
}

// ── counting run: attribute counters to the lap that just ended ──────────────────────────────────────────────────────────────────
interface Tally {
  counts: Record<string, number>;
  sites: Record<string, Record<string, number>>;
}
const byPhase: Record<string, Tally> = {};
let base: Record<string, number> = { ...counts };
let inAdvance = false;
function attribute(phase: string): void {
  const t = (byPhase[phase] ??= { counts: {}, sites: {} });
  for (const k of COUNTED) {
    const d = counts[k]! - (base[k] ?? 0);
    if (d) t.counts[k] = (t.counts[k] ?? 0) + d;
  }
  const s = takeSamples();
  for (const [fn, m] of Object.entries(s)) {
    const dst = (t.sites[fn] ??= {});
    for (const [site, n] of Object.entries(m)) dst[site] = (dst[site] ?? 0) + n;
  }
  base = { ...counts };
}
if (COUNT) {
  const P = PerfStats.prototype as unknown as { addLap: (n: string, ms: number) => void; endStep: (...a: unknown[]) => void };
  const addLap = P.addLap;
  const endStep = P.endStep;
  P.addLap = function (this: unknown, name: string, ms: number): void {
    if (inAdvance) attribute(name);
    return addLap.call(this, name, ms);
  };
  P.endStep = function (this: unknown, ...a: unknown[]): void {
    if (inAdvance) attribute('(after last lap)');
    return endStep.apply(this, a);
  };
}

const wall = (): number => performance.now();
const load0 = loadavg();
let t0 = wall();
const scenario = await build(def);
const scenarioMs = wall() - t0;
t0 = wall();
const sim = new Simulation(scenario, { minSnapshotWallMs: 0, hooks: { snapshot: () => undefined } });
const constructMs = wall() - t0;
// Atmosphere steps are counted only in the counting run: a wrapper around `step` would be inlined into the profile of the timing run.
const atm = (sim as unknown as { atm: { step: (dt: number) => void } }).atm;
let atmSteps = 0;
if (COUNT) {
  const atmStep = atm.step.bind(atm);
  atm.step = (dt: number): void => {
    atmSteps++;
    atmStep(dt);
  };
}
const afterConstruct = { ...counts };
if (COUNT) attribute('(scenario build + construct)');
t0 = wall();
sim.spinUp();
const spinUpMs = wall() - t0;
const atmStepsSpin = atmSteps;
const afterSpin = { ...counts };
if (COUNT) attribute('(spinUp)');
sim.resetPerf();
const tAdv = wall();
inAdvance = true;
sim.advance(runTo);
inAdvance = false;
const advanceMs = wall() - tAdv;
const perf = sim.perf();
const arrival = sim.snapshot().fire.arrivalTime;
let burnt = 0;
for (let i = 0; i < arrival.length; i++) if (Number.isFinite(arrival[i]!)) burnt++;
const out = {
  scenario: def.name,
  seed,
  runTo,
  mode: COUNT ? 'count' : 'time',
  tier: sim.tier,
  node: process.version,
  cpu: cpus()[0]?.model ?? 'unknown',
  cores: cpus().length,
  loadBefore: load0,
  loadAfter: loadavg(),
  ms: { scenarioBuild: scenarioMs, simConstruct: constructMs, spinUp: spinUpMs, advance: advanceMs },
  steps: { advanceSteps: perf.steps, atmStepsSpinUp: atmStepsSpin, atmStepsAdvance: atmSteps - atmStepsSpin, simSeconds: perf.simSeconds },
  perfModulesMs: perf.modules,
  perfInitMs: perf.init,
  counts: COUNT ? { afterConstruct, afterSpin, total: { ...counts }, byLap: byPhase } : undefined,
  burntCells: burnt,
};
console.log(JSON.stringify(out));
