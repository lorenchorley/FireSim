/**
 * T1.4b fixture capture. Runs the app's own `Simulation` on `katoomba6-fast-4h` (6 km, fast tier, 200 x 200 fire cells at 30 m, seed 13; the plan's "katoomba6-fast", run for
 * 4 h so that a late fire exists), and records, in two windows (the first calls after 900 s and after 14,100 s), the REAL calls of `LevelSetCore.evaluate` (stage 1 with the real
 * lazy-speed hook, stage 2), `LevelSetCore.reinit` and `PyrogenicPotential.solve` (nothing in src/ is edited: prototype methods are wrapped from outside, the original runs and its
 * results are copied). Each recorded frame is the state those kernels read; a second pass replays every frame on a fresh real `LevelSetCore` / `PyrogenicPotential` for the
 * variants of lib.ts (plain; NaN and -0 in the field; NaN and -0 in the speed coefficients; reinit with a Float64 distance array), checking that the plain replay equals what the
 * real call produced. Writes OUT/fx-k6f-900 and OUT/fx-k6f-late: header.json + data.bin (the arrays) and golden.json (the same cases without arrays: what Fs.Tests/golden commits).
 *
 *   node capture.mjs OUT_DIR [--seed 13] [--windows 900,14100]
 * Build: node ../build.mjs BUILD_DIR fast/capture.ts fast/bench.ts   (needs node_modules reachable from the repository root)
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setNodePublicDir } from '../../../../../src/data/assets';
import type { ScenarioData } from '../../../../../src/core/types';
import { Simulation } from '../../../../../src/sim/simulation';
import { demoScenario, pointIgnition, withIgnitions } from '../../../../../src/sim/testing/scenarios';
import { LevelSetCore } from '../../../../../src/fire/spread/levelSet';
import { PyrogenicPotential } from '../../../../../src/atmosphere/pyrogenic';
import { ATMOS_PARAMS } from '../../../../../src/atmosphere/params';
import { scenarioByName, type ScenarioDef } from '../../../ts-export/scenarios';
import {
  COEF, FLOAT_STATE, advanceResult, boxHash, boxOf, buildLS, evaluateResult, hash, makePyro, pyroInput, pyroResult, pyroTables, reinitResult,
  type Case, type LS, type Meta, type TypedAny,
} from './lib';

const repoRoot = process.env.FS_REPO_ROOT ?? process.cwd();
setNodePublicDir(join(repoRoot, 'public') + '/');
if (!existsSync(join(repoRoot, 'public', 'demo', 'katoomba', 'manifest.json'))) throw new Error(`public/demo/katoomba not found under ${repoRoot}: set FS_REPO_ROOT`);
const argv = process.argv.slice(2);
const outDir = argv[0];
if (!outDir) throw new Error('usage: capture.mjs OUT_DIR [--seed N] [--windows 900,14100]');
const opt = (n: string): string | undefined => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const seed = opt('seed') ? Number(opt('seed')) : 13;
const windows = (opt('windows') ?? '900,14100').split(',').map(Number);
const names = windows.map((w, i) => (i === windows.length - 1 && windows.length > 1 ? 'late' : String(w)));
const def: ScenarioDef = scenarioByName('katoomba6-fast-4h') as ScenarioDef;
const runTo = Math.max(...windows) + 330;

async function build(d: ScenarioDef): Promise<ScenarioData> {
  const base = await demoScenario({ startCivil: d.startCivil, extent: d.extent, tier: d.tier, duration: d.duration });
  const g = d.ignition;
  const ign = g.kind === 'point' ? pointIgnition(g.id, g.at[0], g.at[1], g.time, g.radius) : { id: g.id, kind: 'line' as const, points: [g.from, g.to], time: g.time, origin: 'observed' as const };
  return withIgnitions(base, [ign], { snapshotInterval: d.snapshotInterval, tier: d.tier, seed, ...(d.options ?? {}) });
}

class Store {
  readonly chunks: Uint8Array[] = [];
  readonly table: { name: string; type: 'float32' | 'float64' | 'uint8' | 'int32'; length: number; byteOffset: number }[] = [];
  readonly arrays = new Map<string, TypedAny>();
  private off = 0;
  private readonly byHash = new Map<string, string>();
  add(a: TypedAny): string {
    const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const h = createHash('sha1').update(bytes).update(a.constructor.name).digest('hex');
    const known = this.byHash.get(h);
    if (known) return known;
    const name = `a${this.table.length}`;
    const pad = (8 - (this.off % 8)) % 8;
    if (pad) { this.chunks.push(new Uint8Array(pad)); this.off += pad; }
    this.chunks.push(bytes.slice());
    const type = a instanceof Float32Array ? 'float32' : a instanceof Float64Array ? 'float64' : a instanceof Int32Array ? 'int32' : 'uint8';
    this.table.push({ name, type, length: a.length, byteOffset: this.off });
    this.off += bytes.byteLength;
    this.arrays.set(name, a.slice() as TypedAny);
    this.byHash.set(h, name);
    return name;
  }
  get size(): number { return this.off; }
}

interface Win {
  name: string;
  from: number;
  store: Store;
  want: { e1: number; e2: number; reinit: number; pyro: number };
  cases: Case[];
  meta?: Meta;
  pyroGrid?: { nx: number; ny: number; cell: number };
}
const wins: Win[] = windows.map((from, i) => ({ name: names[i]!, from, store: new Store(), want: { e1: 2, e2: 2, reinit: 2, pyro: 1 }, cases: [] }));
let cur: Win | null = null;
let simRef: Simulation | null = null;
const now = (): number => simRef!.time;
function window_(): Win | null {
  if (!simRef) return null;
  const t = now();
  if (cur && (t > cur.from + 900 || (cur.want.e1 + cur.want.e2 + cur.want.reinit + cur.want.pyro === 0))) cur = null;
  if (!cur) cur = wins.find((w) => t >= w.from && t <= w.from + 900 && w.want.e1 + w.want.e2 + w.want.reinit + w.want.pyro > 0) ?? null;
  return cur;
}

// ── record: wrap the prototype methods from outside ─────────────────────────────────────────────────────────────────────────────────────────
type Rec = { evaluate: (src: Float64Array, out: Float64Array | null, stage1: boolean) => number; reinit: () => void };
const lsProto = LevelSetCore.prototype as unknown as Rec;
const origEvaluate = lsProto.evaluate;
const origReinit = lsProto.reinit;

function frameArrays(w: Win, ls: LS, srcIsPhiS: boolean, withInBand: boolean, withTouched: boolean): Record<string, string> {
  const a: Record<string, string> = { phi: w.store.add(ls.phi), prepStamp: w.store.add(ls.prepStamp), band: w.store.add(ls.band.slice(0, ls.bandCount)) };
  if (srcIsPhiS) a.phiS = w.store.add(ls.phiS);
  for (const n of FLOAT_STATE) a[n] = w.store.add(ls[n] as Float32Array);
  if (withInBand) a.inBand = w.store.add(ls.inBand);
  if (withTouched) a.touched = w.store.add(ls.touched);
  return a;
}

const recorded: { win: Win; c: Case; real: Record<string, string> }[] = [];

lsProto.evaluate = function (this: LS, src: Float64Array, out: Float64Array | null, stage1: boolean): number {
  const w = out === null ? null : window_();
  const kind = out === null ? 'bound' : stage1 ? 'e1' : 'e2';
  if (!w || kind === 'bound' || w.want[kind as 'e1' | 'e2'] <= 0) return origEvaluate.call(this, src, out, stage1);
  w.want[kind as 'e1' | 'e2']--;
  w.meta ??= { grid: { nx: this.nx, ny: this.ny, cellSize: this.h }, levelSet: { ...(this as unknown as { P: Meta['levelSet'] }).P }, pyro: { k: ATMOS_PARAMS.pyroK, max: ATMOS_PARAMS.pyroMax } };
  const srcIsPhiS = src === this.phiS;
  const arrays = frameArrays(w, this, srcIsPhiS, kind === 'e1', false);
  const count = this.bandCount;
  const c: Case = { id: `${w.name}/evaluate-${kind}-${recorded.filter((r) => r.win === w && r.c.mode === kind).length}`, kind: 'evaluate', mode: kind, t: now(), srcField: srcIsPhiS ? 'phiS' : 'phi', count, stamp: this.stamp, lazy: this.lazy, subCount: this.subCount, arrays, hook: null };
  const hooks = this.hooks as { ensureSpeed: (k: number) => void };
  const origHook = hooks.ensureSpeed;
  const askK: number[] = [];
  const askV: number[] = [];
  if (kind === 'e1') {
    hooks.ensureSpeed = (k: number): void => {
      origHook.call(hooks, k);
      askK.push(k);
      for (const n of COEF) askV.push((this[n] as Float32Array)[k]!);
    };
  }
  let ret: number;
  try {
    ret = origEvaluate.call(this, src, out, stage1);
  } finally {
    hooks.ensureSpeed = origHook;
  }
  if (kind === 'e1') c.hook = { k: w.store.add(Int32Array.from(askK)), vals: w.store.add(Float32Array.from(askV)) };
  const real: Record<string, string> = { maxC: bitsOf(ret), out: hash(out!.slice(0, count)) };
  if (kind === 'e1') {
    real.r1 = hash(this.r1.slice(0, count));
    real.n1x = hash(this.n1x.slice(0, count));
    real.n1y = hash(this.n1y.slice(0, count));
    real.hookSeq = hash(Int32Array.from(askK));
    real.hookCount = String(askK.length);
    real.prep = hash(this.prepStamp);
    real.coef = hash(Float32Array.from(COEF.flatMap((n) => Array.from(this[n] as Float32Array))));
  }
  recorded.push({ win: w, c, real });
  return ret;
};

function bitsOf(x: number): string {
  const u = new BigUint64Array(new Float64Array([x]).buffer);
  return u[0]!.toString(16).padStart(16, '0');
}

lsProto.reinit = function (this: LS): void {
  const w = window_();
  if (!w || w.want.reinit <= 0 || this.bandCount === 0) return origReinit.call(this);
  w.want.reinit--;
  const P = (this as unknown as { P: Meta['levelSet'] }).P;
  const box = boxOf(this, P.farCells + 1);
  const arrays = frameArrays(w, this, true, true, true);
  const count = this.bandCount;
  const c: Case = { id: `${w.name}/reinit-${recorded.filter((r) => r.win === w && r.c.kind === 'reinit').length}`, kind: 'reinit', t: now(), count, stamp: this.stamp, lazy: this.lazy, subCount: this.subCount, arrays, hook: null };
  origReinit.call(this);
  const bc = this.bandCount;
  const real = { box: box.join(','), phi: hash(this.phi), phiS: hash(this.phiS), bandCount: String(bc), band: hash(this.band.slice(0, bc)), inBand: hash(this.inBand), touched: hash(this.touched), dist: boxHash(this.dist, this.nx, box), fixed: boxHash(this.fixed, this.nx, box) };
  recorded.push({ win: w, c, real });
};

type PyroRec = { solve: (q: Float32Array) => void };
const pyProto = PyrogenicPotential.prototype as unknown as PyroRec;
const origSolve = pyProto.solve;
pyProto.solve = function (this: PyrogenicPotential, q: Float32Array): void {
  const w = window_();
  if (!w || w.want.pyro <= 0 || !q.some((v) => v > 0)) return origSolve.call(this, q);
  w.want.pyro--;
  w.pyroGrid = { nx: this.fire.nx, ny: this.fire.ny, cell: this.fire.cellSize };
  const name = w.store.add(q);
  origSolve.call(this, q);
  const p = this as unknown as { gx: Float64Array; gy: Float64Array };
  const real = { psi: hash(this.psi), up: hash(this.up), vp: hash(this.vp), gx: hash(p.gx), gy: hash(p.gy) };
  recorded.push({ win: w, c: { id: `${w.name}/pyro`, kind: 'pyro', t: now(), fireNx: this.fire.nx, fireNy: this.fire.ny, cellSize: this.fire.cellSize, q: name, arrays: {} }, real });
};

const t0 = performance.now();
const sim = new Simulation(await build(def), { minSnapshotWallMs: 0, hooks: { snapshot: () => undefined } });
simRef = sim;
sim.spinUp();
sim.advance(runTo);
console.log(`simulation to ${runTo} s: ${(performance.now() - t0).toFixed(0)} ms, tier ${sim.tier}`);
lsProto.evaluate = origEvaluate;
lsProto.reinit = origReinit;
pyProto.solve = origSolve;
for (const w of wins) console.log(`window ${w.name}: recorded ${recorded.filter((r) => r.win === w).length} calls, still wanted ${JSON.stringify(w.want)}`);

// ── replay every frame on fresh real objects, for every variant ──────────────────────────────────────────────────────────────────────────────
const VARIANTS = ['plain', 'nan-src', 'nan-coef'];
for (const w of wins) {
  const meta = w.meta;
  if (!meta) throw new Error(`window ${w.name} recorded no level-set call`);
  const fx = { header: {}, get: (n: string) => w.store.arrays.get(n)! } as unknown as Parameters<typeof buildLS>[0];
  const mine = recorded.filter((r) => r.win === w);
  const cases: Case[] = [];
  for (const r of mine) {
    const c = r.c;
    if (c.kind === 'evaluate') {
      const variants = VARIANTS.map((v) => {
        const f = buildLS(fx, meta, c, v);
        const res = evaluateResult(f, c);
        if (v === 'plain') for (const [k, val] of Object.entries(r.real)) if (res[k] !== val) throw new Error(`${c.id}: replay differs from the recorded real call in ${k}: ${res[k]} vs ${val}`);
        return { name: v, result: res };
      });
      c.variants = variants;
      cases.push(c);
      if ((c.mode as string) === 'e1') {
        // the same state with no output: the CFL bound alone (`bound()`), and a sequence of real sub-steps from it
        const b: Case = { ...c, id: c.id.replace('evaluate-e1', 'evaluate-bound'), mode: 'bound', hook: null, lazy: false, srcField: 'phi' };
        b.variants = VARIANTS.map((v) => ({ name: v, result: evaluateResult(buildLS(fx, meta, b, v), b) }));
        cases.push(b);
        if (!cases.some((x) => x.kind === 'advance')) {
          const a: Case = { ...c, id: c.id.replace('evaluate-e1', 'advance'), kind: 'advance', steps: 25, dtMax: 5 };
          delete a.mode;
          delete a.srcField;
          a.variants = [{ name: 'plain', result: advanceResult(buildLS(fx, meta, a, 'plain'), a, meta) }];
          cases.push(a);
        }
      }
    } else if (c.kind === 'reinit') {
      c.variants = VARIANTS.map((v) => {
        const res = { float: reinitResult(buildLS(fx, meta, c, v), meta, false), wide: reinitResult(buildLS(fx, meta, c, v), meta, true) };
        if (v === 'plain') for (const [k, val] of Object.entries(r.real)) if (res.float[k] !== val) throw new Error(`${c.id}: replay differs from the recorded real call in ${k}: ${res.float[k]} vs ${val}`);
        return { name: v, result: res };
      });
      cases.push(c);
    } else {
      const q = w.store.arrays.get(c.q as string) as Float32Array;
      const tables = pyroTables(makePyro(meta, c.fireNx as number, c.fireNy as number, c.cellSize as number));
      c.tables = tables;
      c.variants = ['plain', 'nan-negzero-inf', 'none', 'single'].map((v) => {
        const p = makePyro(meta, c.fireNx as number, c.fireNy as number, c.cellSize as number);
        const res = pyroResult(p, pyroInput(q, v));
        if (v === 'plain') for (const [k, val] of Object.entries(r.real)) if (res[k] !== val) throw new Error(`${c.id}: replay differs from the recorded real call in ${k}`);
        return { name: v, result: res };
      });
      // a second call on the same instance (state left by the first must not matter), with the q of the plain variant again
      cases.push(c);
    }
  }
  const dir = join(outDir, `fx-k6f-${w.name}`);
  mkdirSync(dir, { recursive: true });
  const header = {
    kernel: 'T1.4b: LevelSetCore.evaluate / reinit (src/fire/spread/levelSet.ts) and PyrogenicPotential.solve (src/atmosphere/pyrogenic.ts) on the real state of the fast tier',
    endianness: 'little', scenario: def.name, seed, window: w.name, windowFromS: w.from, extentM: def.extent, tier: def.tier, node: process.version,
    meta, arrays: w.store.table, cases, dataFile: 'data.bin',
  };
  writeFileSync(`${dir}/data.bin`, Buffer.concat(w.store.chunks));
  writeFileSync(`${dir}/header.json`, JSON.stringify(header));
  const golden = { ...header, arrays: undefined, dataFile: undefined, nArrays: w.store.table.length };
  writeFileSync(`${dir}/golden.json`, JSON.stringify(golden));
  console.log(`${w.name}: ${cases.length} cases, ${w.store.table.length} arrays, ${(w.store.size / 1e6).toFixed(1)} MB -> ${dir}`);
}
process.exit(0);
