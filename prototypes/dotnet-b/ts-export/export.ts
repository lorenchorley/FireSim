/**
 * Fixture exporter (option B prototype, stage 3a). Runs the app's own solver (`Simulation`, exactly as src/sim/desktopDetail.determinism.test.ts
 * and the desktop host drive it) on one named scenario and writes the files a C# reader needs. Built and started by run.mjs; see README.md in
 * this folder for the formats and the commands.
 *
 *   node run.mjs export NAME [--out DIR] [--seed N] [--to SECONDS] [--dir NAME] [--perturb EPS] [--noise SEED] [--noise-scale F] [--keep LIST] [--interval S]
 *
 * --noise SEED: for the duration of the run (from the solver's construction to its last step; the scenario is built clean, so init.bin is the
 *   one of the noise-free fixture) the transcendental `Math` functions carry libm-sized per-call noise (noise.ts). --noise-scale F multiplies
 *   every mismatch rate (0 = the wrapper installed but never moving a result: a check that it is transparent).
 * --keep LIST: which snap-<t>.bin files to write: `all` (default), `none`, `last`, or comma-separated simulated seconds (the last one is always
 *   written with `last`). hashes.json and arrival.f32 are complete either way; meta.json lists `snapshotsWritten`.
 * --interval S: snapshot cadence, overriding the scenario's.
 *
 * It reads the app's code and never edits it.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { setNodePublicDir } from '../../../src/data/assets';
import { join } from 'node:path';
import { cpus, platform, release } from 'node:os';
import type { ScenarioData, SimSnapshot } from '../../../src/core/types';
import { withoutContext } from '../../../src/sim/client';
import { encodeMessage } from '../../../src/sim/remote/codec';
import { resolveOptions } from '../../../src/scenario/build';
import { Simulation } from '../../../src/sim/simulation';
import { snapshotHash } from '../../../src/sim/testing/hash';
import { demoScenario, pointIgnition, withIgnitions } from '../../../src/sim/testing/scenarios';
import type { Ignition } from '../../../src/core/types';
import { installNoise, type NoiseHandle } from './noise';
import { SCENARIOS, scenarioByName, type ScenarioDef } from './scenarios';

// The bundle does not sit next to src/, so the asset loader's default (relative to its own module) misses the repository's public/ and the
// builder would silently fall back to synthetic terrain. run.mjs passes the repository root; an absent demo bundle is an error, not a fallback.
const repoRoot = process.env.FS_REPO_ROOT ?? process.cwd();
setNodePublicDir(join(repoRoot, 'public') + '/');
if (!existsSync(join(repoRoot, 'public', 'demo', 'katoomba', 'manifest.json'))) {
  console.error(`public/demo/katoomba not found under ${repoRoot}: set FS_REPO_ROOT to the repository root`);
  process.exit(2);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const name = process.argv[2];
const def: ScenarioDef | undefined = name ? scenarioByName(name) : undefined;
if (!def) {
  console.error(`usage: export NAME [--out DIR] [--seed N] [--to S] [--dir NAME] [--perturb EPS]\nNAMEs: ${SCENARIOS.map((s) => s.name).join(', ')}`);
  process.exit(2);
}
const seed = arg('seed') !== undefined ? Number(arg('seed')) : def.seed;
const runTo = arg('to') !== undefined ? Number(arg('to')) : def.runTo;
/**
 * --perturb EPS: multiplies the 10 m wind speed and the temperature of every weather hour by (1 + EPS), a stand-in for the last-bit differences
 * between V8 and .NET (exp, pow, sin): the study's question is how far a change of a few ulps in the inputs moves the burnt cells (EPS 1e-15 is
 * about 4.5 ulp of a double). Everything else is as the named scenario.
 */
const perturb = arg('perturb') !== undefined ? Number(arg('perturb')) : 0;
const noiseSeed = arg('noise') !== undefined ? Number(arg('noise')) : undefined;
if (noiseSeed !== undefined && !Number.isInteger(noiseSeed)) {
  console.error('--noise needs an integer seed');
  process.exit(2);
}
const noiseScale = arg('noise-scale') !== undefined ? Number(arg('noise-scale')) : 1;
const interval = arg('interval') !== undefined ? Number(arg('interval')) : def.snapshotInterval;
const keepArg = arg('keep') ?? 'all';
const keepTimes = new Set(keepArg === 'all' || keepArg === 'none' || keepArg === 'last' ? [] : keepArg.split(',').map(Number));
const dirName = arg('dir') ?? (seed !== def.seed ? `${def.name}-seed${seed}` : perturb ? `${def.name}-pert${arg('perturb')}` : def.name) + (noiseSeed !== undefined ? `-noise${noiseSeed}` : '');
const outRoot = arg('out');
if (!outRoot) {
  console.error('--out DIR is required (the fixtures root; the fixture goes to DIR/<name>/)');
  process.exit(2);
}
const dir = join(outRoot, dirName);

function ignitionOf(d: ScenarioDef): Ignition {
  const g = d.ignition;
  if (g.kind === 'point') return pointIgnition(g.id, g.at[0], g.at[1], g.time, g.radius);
  return { id: g.id, kind: 'line', points: [g.from, g.to], time: g.time, origin: 'observed' };
}

async function build(d: ScenarioDef): Promise<ScenarioData> {
  const tierOnly = d.grid === 'tier-only';
  const base = await demoScenario({ ...(d.site ? { site: d.site } : {}), startCivil: d.startCivil, extent: d.extent, tier: tierOnly ? 'standard' : d.tier, duration: d.duration });
  let extra = {};
  if (tierOnly) {
    // The engine options the builder would resolve for this tier, with the fire cell left at the standard grid's.
    const o = resolveOptions({ options: { tier: d.tier } } as never, d.extent, base.options.fireCellSize);
    extra = { tier: d.tier, atmosCellSize: o.atmosCellSize, atmosLevels: o.atmosLevels, atmosDz1: o.atmosDz1, maxEmbers: o.maxEmbers };
  }
  return withIgnitions(base, [ignitionOf(d)], { snapshotInterval: interval, tier: d.tier, seed, ...extra, ...(d.options ?? {}) });
}

function gitCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

const wall = (): number => performance.now();
const T = { total0: wall(), scenarioMs: 0, constructMs: 0, spinUpMs: 0, advanceMs: 0, encodeMs: 0 };

rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

let t0 = wall();
let scenario = await build(def);
if (perturb) {
  const w = scenario.weather;
  scenario = { ...scenario, weather: { ...w, hours: w.hours.map((h) => ({ ...h, windSpeed10: h.windSpeed10 * (1 + perturb), temperature: h.temperature * (1 + perturb) })) } };
}
T.scenarioMs = wall() - t0;

// init.bin: the message exactly as the desktop host receives it from the page (SimClient.send strips `context`; the desktop transport encodes with the codec).
const initBytes = encodeMessage({ type: 'init', scenario: withoutContext(scenario) });
writeFileSync(join(dir, 'init.bin'), initBytes);
writeFileSync(join(dir, 'ignitions.json'), JSON.stringify(scenario.ignitions, null, 2));

const hashes: Record<string, number> = {};
const written: number[] = [];
const snapBytes: Record<string, number> = {};
let lastArrival: Float32Array | null = null;
let lastGrid = scenario.terrain.grid;
let lastTime = -1;
const onSnapshot = (s: SimSnapshot): void => {
  if (s.time > runTo + 1e-6) return;
  const k = String(s.time);
  const e0 = wall();
  const bytes = encodeMessage({ type: 'snapshot', snapshot: s });
  // 'last': the file of the latest snapshot is kept, and the one it replaces is removed (the run's last time is not known in advance).
  const write = keepArg === 'all' || keepTimes.has(s.time) || keepArg === 'last';
  if (write) {
    writeFileSync(join(dir, `snap-${s.time}.bin`), bytes);
    written.push(s.time);
    if (keepArg === 'last' && written.length > 1) rmSync(join(dir, `snap-${written.shift()}.bin`), { force: true });
  }
  T.encodeMs += wall() - e0;
  hashes[k] = snapshotHash(s);
  snapBytes[k] = bytes.byteLength;
  lastArrival = s.fire.arrivalTime;
  lastGrid = s.fire.grid;
  lastTime = s.time;
};

// The noise is on from the solver's construction to the end of the run; the scenario above was built without it.
let noise: NoiseHandle | undefined;
if (noiseSeed !== undefined) noise = installNoise(noiseSeed, noiseScale);
t0 = wall();
// Probes (run.mjs --probes, FS_PROBES=1; probes/install.ts): observation only, started before the solver is built, finished after the run.
let probes: { finish(sim: unknown): void } | undefined;
if (process.env.FS_PROBES) {
  const { startProbes } = await import('./probes/install');
  probes = startProbes({ outDir: join(dir, 'probes'), scenario: def.name, seed, runTo, tier: def.tier, embers: (scenario.options as { embers?: boolean }).embers !== false, initBytes });
}
const sim = new Simulation(scenario, { minSnapshotWallMs: 0, hooks: { snapshot: onSnapshot } });
T.constructMs = wall() - t0;
// What SimHost does at init: post the t0 picture.
onSnapshot(sim.snapshot());
t0 = wall();
sim.spinUp();
T.spinUpMs = wall() - t0;
t0 = wall();
sim.advance(runTo);
T.advanceMs = wall() - t0;
// A run that ends between two pictures gets a run-end snapshot, as the host asks for.
sim.emitRunEnd();
probes?.finish(sim);
const noiseReport = noise?.report();
noise?.restore();
const runMs = T.spinUpMs + T.advanceMs;
const tierNow = sim.tier;

if (!lastArrival) throw new Error('no snapshot was produced');
const arrival = lastArrival as Float32Array;
const out = new Float32Array(arrival.length);
let burnt = 0;
for (let i = 0; i < arrival.length; i++) {
  const a = arrival[i]!;
  if (Number.isFinite(a)) {
    out[i] = a;
    burnt++;
  } else out[i] = -1;
}
writeFileSync(join(dir, 'arrival.f32'), new Uint8Array(out.buffer));
writeFileSync(join(dir, 'hashes.json'), JSON.stringify(hashes, null, 2));

let hashCheck: { expected: string; actual: string; equal: boolean } | undefined;
if (def.expectedHashes) {
  const actual = Object.keys(hashes)
    .map(Number)
    .filter((t) => t > 0)
    .sort((a, b) => a - b)
    .map((t) => `${t}:${hashes[String(t)]}`)
    .join(' ');
  hashCheck = { expected: def.expectedHashes, actual, equal: actual === def.expectedHashes };
}

const times = Object.keys(snapBytes).map(Number).sort((a, b) => a - b);
const firstSnap = snapBytes['60'] ?? snapBytes[String(times[1] ?? times[0])]!;
const g = lastGrid;
const meta = {
  fixture: dirName,
  scenario: def.name,
  description: def.description,
  exportedAt: new Date().toISOString(),
  gitCommit: gitCommit(),
  node: process.version,
  machine: { cpu: cpus()[0]?.model ?? 'unknown', cores: cpus().length, os: `${platform()} ${release()}` },
  seed,
  perturbRelative: perturb || undefined,
  tier: def.tier,
  tierRunning: tierNow,
  gridMode: def.grid ?? 'builder',
  extentM: scenario.extent,
  startCivil: def.startCivil,
  startTimeUtcMs: scenario.startTime,
  durationS: scenario.duration,
  runToS: runTo,
  snapshotIntervalS: interval,
  snapshotTimesS: times,
  snapshotsWritten: [...written].sort((a, b) => a - b),
  noise: noiseReport && { ...noiseReport, powLowered: process.env.FS_POW_LOWERED === '1', note: 'noise.ts: per-call, measured V8 12.4 vs glibc 2.39 mismatch rates; on from the solver construction to the end of the run' },
  fireGrid: { nx: g.nx, ny: g.ny, cellSize: g.cellSize, x0: g.x0, y0: g.y0, origin: g.origin },
  terrainGridMatchesFireGrid: scenario.terrain.grid.nx === g.nx && scenario.terrain.grid.cellSize === g.cellSize,
  options: scenario.options,
  ignitions: scenario.ignitions,
  arrival: { file: 'arrival.f32', encoding: 'float32 little-endian, row-major (index = j*nx + i), -1 = unburnt', cells: arrival.length, burntCells: burnt, burntAreaM2: burnt * g.cellSize * g.cellSize, atTimeS: lastTime },
  sizesBytes: { initBin: initBytes.byteLength, snapshot60: firstSnap, snapshots: snapBytes },
  timingMs: {
    scenarioBuild: Math.round(T.scenarioMs),
    simConstruct: Math.round(T.constructMs),
    spinUp: Math.round(T.spinUpMs),
    advance: Math.round(T.advanceMs),
    spinUpPlusAdvance: Math.round(runMs),
    snapshotEncodeAndWrite: Math.round(T.encodeMs),
    processTotal: Math.round(wall() - T.total0),
    note: 'wall clock of one process on a shared container; indicative only',
  },
  expectedHashCheck: hashCheck,
};
writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
console.log(
  JSON.stringify({ fixture: dirName, ...(noiseSeed !== undefined ? { noise: noiseSeed } : {}), ok: hashCheck ? hashCheck.equal : true, snapshots: times.length, burntCells: burnt, cells: arrival.length, runMs: Math.round(runMs), initBytes: initBytes.byteLength, snapBytes: firstSnap }),
);
process.exit(hashCheck && !hashCheck.equal ? 3 : 0);
