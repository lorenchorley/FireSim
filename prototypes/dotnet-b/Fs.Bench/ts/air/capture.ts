/**
 * T1.4a fixture capture. Runs the app's own `Simulation` on a scenario of ts-export/scenarios.ts (default katoomba3-standard: 3 km, standard tier, 100 m air
 * cells, 30 x 30 x 20; seed 13), spins the 3-D air up (900 s) and advances the fire to `--to` seconds (default 900), then takes the REAL state of the
 * atmosphere (its private fields, read from outside; nothing in src/ is edited or wrapped) and runs the REAL kernels on it:
 *   EllipticSolver.gradient / divergence / relax (src/atmosphere/solver.ts) and dynamics.advect (src/atmosphere/dynamics.ts).
 * Writes OUT/data.bin + OUT/header.json (grid, masks, the fields, the multigrid levels, every case with its input recipe and the canonical hash of every output)
 * and OUT/golden.json (the same cases without the arrays: what Fs.Tests/golden/air-*.json commits).
 *
 *   node capture.mjs OUT_DIR [--scenario katoomba3-standard] [--extent M] [--tier fast|standard|high] [--tier-only] [--seed 13] [--to 900]
 * Build: node ../build.mjs BUILD_DIR air/capture.ts air/bench.ts   (needs node_modules reachable from the repository root)
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setNodePublicDir } from '../../../../../src/data/assets';
import type { ScenarioData } from '../../../../../src/core/types';
import { resolveOptions } from '../../../../../src/scenario/build';
import { Simulation } from '../../../../../src/sim/simulation';
import { demoScenario, pointIgnition, withIgnitions } from '../../../../../src/sim/testing/scenarios';
import { scenarioByName, type ScenarioDef } from '../../../ts-export/scenarios';
import { advect, canonHash, divergence, gradient, makeShell, poison, relax, type Typed } from './lib';

const repoRoot = process.env.FS_REPO_ROOT ?? process.cwd();
setNodePublicDir(join(repoRoot, 'public') + '/');
if (!existsSync(join(repoRoot, 'public', 'demo', 'katoomba', 'manifest.json'))) throw new Error(`public/demo/katoomba not found under ${repoRoot}: set FS_REPO_ROOT`);
const argv = process.argv.slice(2);
const outDir = argv[0]!;
const opt = (n: string): string | undefined => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
if (!outDir) throw new Error('usage: capture.mjs OUT_DIR [--scenario NAME] [--extent M] [--tier T] [--tier-only] [--seed N] [--to S]');
mkdirSync(outDir, { recursive: true });

const def0 = scenarioByName(opt('scenario') ?? 'katoomba3-standard') as ScenarioDef;
const def: ScenarioDef = {
  ...def0,
  extent: opt('extent') ? Number(opt('extent')) : def0.extent,
  tier: (opt('tier') as ScenarioDef['tier'] | undefined) ?? def0.tier,
  grid: argv.includes('--tier-only') ? 'tier-only' : def0.grid,
};
const seed = opt('seed') ? Number(opt('seed')) : 13;
const runTo = opt('to') ? Number(opt('to')) : 900;

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

const t0 = performance.now();
const sim = new Simulation(await build(def), { minSnapshotWallMs: 0, hooks: { snapshot: () => undefined } });
sim.spinUp();
sim.advance(runTo);
console.log(`simulation to ${runTo} s: ${(performance.now() - t0).toFixed(0)} ms, tier ${sim.tier}`);

// ── the real state, read from the private fields ────────────────────────────────────────────────────────────────────────────────────────────
interface Level { nx: number; ny: number; nz: number; plane: number; n: number; cx: Float32Array; cy: Float32Array; cz: Float32Array; tInv: Float32Array; tC: Float32Array; x: Float32Array; b: Float32Array }
interface Solver { levels: Level[]; fzeta: Float64Array; masks: { activeU: Uint8Array; activeV: Uint8Array; topActive: boolean }; Rh: number; Rv: number; precondition(r: Float64Array, z: Float64Array): void; relax(L: Level, s: number, r: boolean): void }
interface Atm {
  grid: Record<string, unknown> & { nx: number; ny: number; nz: number; plane: number; n: number; nU: number; nV: number; nW: number; dx: number; Hp: number };
  proj: Solver;
  u: Float32Array; v: Float32Array; w: Float32Array; th: Float32Array; sm: Float32Array;
  phi: Float64Array; rhs: Float64Array;
  Ui: Float32Array; Vi: Float32Array; Wi: Float32Array;
  smokeActive: boolean;
}
const atm = (sim as unknown as { atm: Atm }).atm;
const g = atm.grid;
const solver = atm.proj;
const { nx, ny, nz } = g;

const chunks: Uint8Array[] = [];
const table: { name: string; type: 'float32' | 'float64' | 'uint8'; length: number; byteOffset: number }[] = [];
let off = 0;
const add = (name: string, a: Typed): void => {
  const pad = (8 - (off % 8)) % 8;
  if (pad) { chunks.push(new Uint8Array(pad)); off += pad; }
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  chunks.push(bytes.slice());
  table.push({ name, type: a instanceof Float32Array ? 'float32' : a instanceof Float64Array ? 'float64' : 'uint8', length: a.length, byteOffset: off });
  off += bytes.byteLength;
};
const arrays = new Map<string, Typed>();
const reg = (name: string, a: Typed): void => {
  arrays.set(name, a);
  add(name, a);
};

for (const k of ['dzeta', 'dzetaW', 'J', 'Ju', 'Jv', 'zsx', 'zsy', 'zetaF', 'zetaC'] as const) reg(`grid.${k}`, g[k] as Float64Array);
reg('masks.activeU', solver.masks.activeU);
reg('masks.activeV', solver.masks.activeV);
reg('solver.fzeta', solver.fzeta);
const fields: Record<string, Typed> = { u: atm.u, v: atm.v, w: atm.w, th: atm.th, sm: atm.sm, phi: atm.phi, Ui: atm.Ui, Vi: atm.Vi, Wi: atm.Wi };
for (const [k, a] of Object.entries(fields)) reg(`field.${k}`, a);
solver.levels.forEach((L, l) => {
  for (const k of ['cx', 'cy', 'cz', 'tInv', 'tC'] as const) reg(`level${l}.${k}`, L[k]);
});

// ── cases ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
interface Out { role: string; hash: string }
interface Spec { id: string; kernel: string; params: Record<string, unknown>; inputs: { role: string; array: string; poison?: number }[]; outputs: Out[]; inputHashes: Record<string, string> }
const cases: Spec[] = [];
const input = (name: string, salt?: number): Typed => {
  const a = arrays.get(name)!;
  const c = (a instanceof Float32Array ? new Float32Array(a) : a instanceof Float64Array ? new Float64Array(a) : new Uint8Array(a)) as Typed;
  if (salt !== undefined) poison(c as Float32Array | Float64Array, salt);
  return c;
};
function record(id: string, kernel: string, params: Record<string, unknown>, ins: { role: string; array: string; poison?: number }[], outs: Record<string, Typed>): void {
  const inputHashes: Record<string, string> = {};
  for (const i of ins) inputHashes[i.role] = canonHash(input(i.array, i.poison));
  const outputs = Object.entries(outs).map(([role, a]) => {
    add(`out.${id}.${role}`, a);
    return { role, hash: canonHash(a) };
  });
  cases.push({ id, kernel, params, inputs: ins, outputs, inputHashes });
}

// A shell identical to the solver for the three methods (they read only g, masks, fzeta and their scratch).
const shell = makeShell({
  header: { arrays: [], grid: { nx, ny, nz, plane: g.plane, n: g.n, nU: g.nU, nV: g.nV, nW: g.nW, dx: g.dx, Hp: g.Hp }, topActive: solver.masks.topActive },
  get: (n) => arrays.get(n)!,
});

// gradient: the real potential (3 masks: the real outflow masks, a recipe with inactive faces and an inactive top, the real masks with NaN and -0 in phi)
const maskRecipe = (): { activeU: Uint8Array; activeV: Uint8Array } => {
  const au = new Uint8Array(g.nU);
  const av = new Uint8Array(g.nV);
  for (let f = 0; f < au.length; f++) au[f] = f % 3 === 0 ? 0 : 1;
  for (let f = 0; f < av.length; f++) av[f] = f % 5 === 0 ? 0 : 1;
  return { activeU: au, activeV: av };
};
const realMasks = { ...shell.masks };
function runGradient(id: string, maskMode: 'real' | 'recipe', topActive: boolean, salt?: number): void {
  if (maskMode === 'recipe') {
    const m = maskRecipe();
    shell.self.masks = { activeU: m.activeU, activeV: m.activeV, topActive };
  } else shell.self.masks = { ...realMasks, topActive };
  const r = gradient(shell, input('field.phi', salt) as Float64Array);
  record(id, 'gradient', { maskMode, topActive }, [{ role: 'phi', array: 'field.phi', poison: salt }], { gu: r.gu.slice(), gv: r.gv.slice(), gw: r.gw.slice() });
}
runGradient('gradient/real', 'real', realMasks.topActive);
runGradient('gradient/recipe-masks-top-active', 'recipe', true);
runGradient('gradient/edge-nan-negzero', 'real', realMasks.topActive, 3);
shell.self.masks = { ...realMasks };
const gReal = gradient(shell, input('field.phi') as Float64Array);
reg('derived.gu', gReal.gu.slice());
reg('derived.gv', gReal.gv.slice());
reg('derived.gw', gReal.gw.slice());

// divergence: velocities (Float32, scale 1, as project() calls it), fluxes (Float64, R scales, as applyFull calls it), other scales, edge cases
function runDiv(id: string, ar: [string, string, string], params: { scaleU: number; scaleW: number }, salts?: [number, number, number]): void {
  const ins = ar.map((a, i) => ({ role: ['u', 'v', 'w'][i]!, array: a, poison: salts?.[i] }));
  const [u, v, w] = ins.map((i) => input(i.array, i.poison)) as [Float32Array, Float32Array, Float32Array];
  const out = new Float64Array(g.n);
  divergence(shell, u, v, w, out, params.scaleU, params.scaleW);
  record(id, 'divergence', params, ins, { out });
}
runDiv('divergence/f32-real', ['field.u', 'field.v', 'field.w'], { scaleU: 1, scaleW: 1 });
runDiv('divergence/f64-flux', ['derived.gu', 'derived.gv', 'derived.gw'], { scaleU: solver.Rh, scaleW: solver.Rv });
runDiv('divergence/f32-scaled', ['field.u', 'field.v', 'field.w'], { scaleU: 2.5, scaleW: 0.3125 });
runDiv('divergence/f32-edge-nan-negzero', ['field.u', 'field.v', 'field.w'], { scaleU: 1, scaleW: 1 }, [1, 4, 6]);
runDiv('divergence/f64-edge-nan-negzero', ['derived.gu', 'derived.gv', 'derived.gw'], { scaleU: 1, scaleW: 1 }, [2, 5, 8]);

// advect: the four calls of Atmosphere.step (u, v, w, then th with the smoke field) on displacements made by the real `displacements`
import { displacements } from '../../../../../src/atmosphere/dynamics';
const DT = 9.5;
const Dx = new Float32Array(g.n);
const Dy = new Float32Array(g.n);
const Dz = new Float32Array(g.n);
displacements(g as never, atm.Ui, atm.Vi, atm.Wi, DT, Dx, Dy, Dz);
reg('derived.Dx', Dx);
reg('derived.Dy', Dy);
reg('derived.Dz', Dz);
const fieldSize = (nxF: number, nyF: number, nzF: number): number => nxF * nyF * nzF;
function runAdvect(id: string, src: string, src2: string | null, nxF: number, nyF: number, nzF: number, ox: number, oy: number, oz: number, salts?: { d?: number; s?: number }): void {
  const ins = [
    { role: 'dx', array: 'derived.Dx', poison: salts?.d },
    { role: 'dy', array: 'derived.Dy' },
    { role: 'dz', array: 'derived.Dz' },
    { role: 'src', array: src, poison: salts?.s },
    ...(src2 ? [{ role: 'src2', array: src2 }] : []),
  ];
  const [dx, dy, dz, s1, s2] = ins.map((i) => input(i.array, i.poison)) as Float32Array[];
  const dst = new Float32Array(fieldSize(nxF, nyF, nzF));
  const dst2 = src2 ? new Float32Array(fieldSize(nxF, nyF, nzF)) : null;
  advect(g as never, dx!, dy!, dz!, s1!, dst, nxF, nyF, nzF, ox, oy, oz, src2 ? s2! : null, dst2);
  record(id, 'advect', { nxF, nyF, nzF, ox, oy, oz, dual: !!src2 }, ins, { dst, ...(dst2 ? { dst2 } : {}) });
}
runAdvect('advect/u', 'field.u', null, nx + 1, ny, nz, 0.5, 0, 0);
runAdvect('advect/v', 'field.v', null, nx, ny + 1, nz, 0, 0.5, 0);
runAdvect('advect/w', 'field.w', null, nx, ny, nz + 1, 0, 0, 0.5);
runAdvect('advect/th-sm', 'field.th', 'field.sm', nx, ny, nz, 0, 0, 0);
runAdvect('advect/u-edge-nan-negzero', 'field.u', null, nx + 1, ny, nz, 0.5, 0, 0, { d: 2, s: 9 });
runAdvect('advect/th-edge-nan-negzero', 'field.th', null, nx, ny, nz, 0, 0, 0, { d: 5, s: 11 });

// relax: the calls of one real V(2,2) precondition (b, x in, x out of each), then variants on level 0
interface Call { level: number; sweeps: number; reverse: boolean; b: Float32Array; xIn: Float32Array; xOut: Float32Array }
const calls: Call[] = [];
const rax = solver.relax;
const proto = Object.getPrototypeOf(solver) as { relax: Solver['relax'] };
proto.relax = function (this: Solver, L: Level, s: number, r: boolean): void {
  const level = this.levels.indexOf(L);
  const b = L.b.slice();
  const xIn = L.x.slice();
  rax.call(this, L, s, r);
  calls.push({ level, sweeps: s, reverse: r, b, xIn, xOut: L.x.slice() });
};
const z = new Float64Array(g.n);
divergence(shell, atm.u, atm.v, atm.w, atm.rhs, 1, 1); // a real right-hand side
solver.precondition(atm.rhs, z);
proto.relax = rax;
console.log('relax calls in one V(2,2):', calls.map((c) => `L${c.level}x${c.sweeps}${c.reverse ? 'r' : ''}`).join(' '));
// Replay each recorded call from its recorded input on the real relax (a Level-shaped object with its own b and x), so the case needs no state beyond its inputs.
function runRelax(id: string, level: number, sweeps: number, reverse: boolean, bName: string, xName: string, salts?: { b?: number; x?: number }): void {
  const L = solver.levels[level]!;
  const ins = [
    { role: 'b', array: bName, poison: salts?.b },
    { role: 'x', array: xName, poison: salts?.x },
  ];
  const b = input(bName, salts?.b) as Float32Array;
  const x = input(xName, salts?.x) as Float32Array;
  relax({ ...L, b, x }, sweeps, reverse);
  record(id, 'relax', { level, sweeps, reverse }, ins, { x });
}
calls.forEach((c, i) => {
  reg(`call${i}.b`, c.b);
  reg(`call${i}.x`, c.xIn);
  runRelax(`relax/call${i}-L${c.level}x${c.sweeps}${c.reverse ? 'r' : ''}`, c.level, c.sweeps, c.reverse, `call${i}.b`, `call${i}.x`);
  const same = canonHash(arrays.get(`call${i}.x`)!) === canonHash(c.xIn);
  if (!same) throw new Error('input array was modified');
  // the replay must equal what the real precondition produced
  const replayed = cases[cases.length - 1]!.outputs[0]!.hash;
  if (replayed !== canonHash(c.xOut)) throw new Error(`replay of call ${i} differs from the recorded call`);
});
const c0 = calls[0]!;
runRelax('relax/L0-sweeps1', 0, 1, false, 'call0.b', 'call0.x');
runRelax('relax/L0-sweeps3-reverse-warm', 0, 3, true, 'call0.b', `call${calls.length - 1}.x`);
runRelax('relax/L0-edge-nan-negzero', 0, 2, false, 'call0.b', 'call0.x', { b: 3, x: 12 });
void c0;

const header = {
  kernel: 'T1.4a air kernels: EllipticSolver.gradient/divergence/relax, dynamics.advect on the real state of the standard tier',
  endianness: 'little',
  scenario: def.name,
  extentM: def.extent,
  tier: def.tier,
  tierOnly: def.grid === 'tier-only',
  seed,
  simTimeS: runTo,
  node: process.version,
  grid: { nx, ny, nz, plane: g.plane, n: g.n, nU: g.nU, nV: g.nV, nW: g.nW, dx: g.dx, Hp: g.Hp },
  topActive: solver.masks.topActive,
  dt: DT,
  levels: solver.levels.map((L) => ({ nx: L.nx, ny: L.ny, nz: L.nz })),
  relaxCalls: calls.map((c) => ({ level: c.level, sweeps: c.sweeps, reverse: c.reverse })),
  smokeActive: atm.smokeActive,
  arrays: table,
  cases,
  dataFile: 'data.bin',
};
writeFileSync(`${outDir}/data.bin`, Buffer.concat(chunks));
writeFileSync(`${outDir}/header.json`, JSON.stringify(header));
const golden = { ...header, arrays: undefined, dataFile: undefined, nArrays: table.length };
writeFileSync(`${outDir}/golden.json`, JSON.stringify(golden, null, 1));
console.log(`wrote ${cases.length} cases, ${table.length} arrays, ${off} bytes to ${outDir}`);
process.exit(0);
