/**
 * Shared by capture.ts and bench.ts (card T1.4b, the fast tier's level set and pyrogenic solve). A fixture is a folder: header.json (grid, parameters, the array table and
 * the cases) and data.bin (little-endian typed arrays, each 8-byte aligned), the format of Fs.Bench/ts/air/lib.ts. Everything the REAL, UNMODIFIED TypeScript kernels need is
 * rebuilt from it: a real `LevelSetCore` (constructed on the grid, its arrays filled from the frame) and a real `PyrogenicPotential`. Private members are read and set from
 * outside; nothing in src/ is edited or wrapped by this file. (capture.ts wraps prototype methods to RECORD frames, as the earlier captures do; a replay never wraps.)
 *
 * Variants (named recipes, repeated exactly in Fs.Tests/FastCaseRunner.cs):
 *   plain           the recorded frame
 *   nan-src         NaN at every 13th band cell's value of the field the kernel reads from (offset 3) and -0 at every 17th (offset 5): the second pass wins an overlap
 *   nan-coef        NaN / -0 in the speed coefficients of band cells: sA2 NaN at a % 41 == 4, -0 at a % 29 == 6; sEx NaN at a % 37 == 2; sVls NaN at a % 53 == 7, -0 at a % 31 == 9;
 *                   sTx NaN at a % 43 == 1; sBurnt NaN at a % 47 == 8 (a = band position)
 * The replay hook of a stage-1 frame writes the six coefficients that the REAL hook wrote for cell k (recorded) and the prepStamp, for the cells the real call asked about, and
 * only the prepStamp for any other cell (a poisoned frame can ask for cells the real call did not).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { GridSpec } from '../../../../../src/core/grid';
import { LevelSetCore, type LevelSetHooks } from '../../../../../src/fire/spread/levelSet';
import { SPREAD_PARAMS } from '../../../../../src/fire/spread/params';
import { PyrogenicPotential } from '../../../../../src/atmosphere/pyrogenic';
import { canonHash, loadFixture, type Fixture, type Typed } from '../air/lib';

export { canonHash, loadFixture, type Fixture, type Typed };
export type TypedAny = Typed | Int32Array;

export const COEF = ['sA2', 'sB2', 'sC', 'sEx', 'sEy', 'sVls'] as const; // what a speed request writes
export const FLOAT_STATE = ['sA2', 'sB2', 'sC', 'sEx', 'sEy', 'sVls', 'sJun', 'sBurnt', 'sTx', 'sTy'] as const;

export function hash(a: TypedAny): string {
  return a instanceof Int32Array ? createHash('sha256').update(a).digest('hex').slice(0, 32) : canonHash(a as Typed);
}
export function bitsHex(x: number): string {
  const f = new Float64Array([x]);
  const u = new BigUint64Array(f.buffer);
  return u[0]!.toString(16).padStart(16, '0');
}
export function bitsOfNumber(x: number): bigint {
  return new BigUint64Array(new Float64Array([x]).buffer)[0]!;
}

export interface FrameArrays { [role: string]: string }
export interface Meta {
  grid: { nx: number; ny: number; cellSize: number };
  levelSet: typeof SPREAD_PARAMS.levelSet;
  pyro: { k: number; max: number };
}
export interface Case { id: string; kind: 'evaluate' | 'reinit' | 'advance' | 'pyro'; [k: string]: unknown }

export function paramsOf(m: Meta): typeof SPREAD_PARAMS.levelSet {
  return m.levelSet;
}

/** Poison the value at band positions `a` of `arr`, the named recipes above. */
export function poisonBand(arr: Float32Array | Float64Array, band: Int32Array, count: number, nanMod: number, nanOff: number, negMod: number, negOff: number): void {
  for (let a = 0; a < count; a++) {
    const k = band[a]!;
    if (nanMod > 0 && a % nanMod === nanOff) arr[k] = NaN;
    if (negMod > 0 && a % negMod === negOff) arr[k] = -0;
  }
}

export interface LSFrame {
  ls: LevelSetCore;
  /** `hook.k[i]` asked, `hook.vals[6 i..6 i + 5]` the coefficients the real hook gave; the replay hook's sequence is logged in `hookSeq`. */
  hookSeq: number[];
  arrivals: { k: number; tA: number; r: number; nx: number; ny: number }[];
  restoreHookCells: () => void;
}

/** A LevelSetCore seen from outside: its private members (evaluate, ensureScratch, r1, n1x, n1y, dist, fixed, tend1, tend2, P, edge) are read and set (TypeScript's `private` is not enforced at run time). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LS = LevelSetCore & any;

export function gridOf(m: Meta): GridSpec {
  return { nx: m.grid.nx, ny: m.grid.ny, cellSize: m.grid.cellSize } as unknown as GridSpec;
}

/** A real LevelSetCore holding the state of a recorded frame, with the replay hook installed. `variant` applies a poison recipe. */
export function buildLS(fx: Fixture, m: Meta, c: Case, variant: string): LSFrame {
  const arrays = c.arrays as FrameArrays;
  const ls = new LevelSetCore(gridOf(m), m.levelSet) as LS;
  const count = c.count as number;
  const f64 = (role: string): Float64Array => fx.get(arrays[role]!) as Float64Array;
  const f32 = (role: string): Float32Array => fx.get(arrays[role]!) as Float32Array;
  ls.phi.set(f64('phi'));
  ls.phiS.set(arrays.phiS ? f64('phiS') : f64('phi'));
  for (const name of FLOAT_STATE) (ls[name] as Float32Array).set(f32(name));
  ls.prepStamp.set(fx.get(arrays.prepStamp!) as unknown as Int32Array);
  const band = fx.get(arrays.band!) as unknown as Int32Array;
  ls.band.set(band.subarray(0, count));
  ls.bandCount = count;
  if (arrays.inBand) ls.inBand.set(fx.get(arrays.inBand) as Uint8Array);
  if (arrays.touched) ls.touched.set(fx.get(arrays.touched) as Uint8Array);
  ls.stamp = c.stamp as number;
  ls.lazy = c.lazy as boolean;
  ls.subCount = (c.subCount as number) ?? 0;
  const bandNow = ls.band;
  if (variant === 'nan-src') {
    poisonBand(ls.phi, bandNow, count, 13, 3, 17, 5);
    if (arrays.phiS) poisonBand(ls.phiS, bandNow, count, 13, 3, 17, 5);
    else ls.phiS.set(ls.phi);
  } else if (variant === 'nan-coef') {
    poisonBand(ls.sA2, bandNow, count, 41, 4, 29, 6);
    poisonBand(ls.sEx, bandNow, count, 37, 2, 0, 0);
    poisonBand(ls.sVls, bandNow, count, 53, 7, 31, 9);
    poisonBand(ls.sTx, bandNow, count, 43, 1, 0, 0);
    poisonBand(ls.sBurnt, bandNow, count, 47, 8, 0, 0);
  } else if (variant !== 'plain') throw new Error(`unknown variant ${variant}`);

  const hookSeq: number[] = [];
  const arrivals: LSFrame['arrivals'] = [];
  const hk = c.hook as { k: string; vals: string } | null;
  const hookK = hk ? (fx.get(hk.k) as unknown as Int32Array) : new Int32Array(0);
  const hookV = hk ? (fx.get(hk.vals) as Float32Array) : new Float32Array(0);
  const index = new Map<number, number>();
  for (let i = 0; i < hookK.length; i++) index.set(hookK[i]!, i);
  const prepBefore = new Map<number, number>();
  const hooks: LevelSetHooks = {
    ensureSpeed: (k: number): void => {
      hookSeq.push(k);
      if (!prepBefore.has(k)) prepBefore.set(k, ls.prepStamp[k]!);
      const i = index.get(k);
      if (i !== undefined) {
        COEF.forEach((name, j) => ((ls[name] as Float32Array)[k] = hookV[6 * i + j]!));
      }
      ls.prepStamp[k] = ls.stamp;
    },
    onArrival: (k, tA, r, nx, ny) => {
      arrivals.push({ k, tA, r, nx, ny });
    },
  };
  ls.hooks = hooks;
  ls.ensureScratch();
  return { ls, hookSeq, arrivals, restoreHookCells: () => { for (const [k, v] of prepBefore) ls.prepStamp[k] = v; prepBefore.clear(); } };
}

export function evaluateResult(f: LSFrame, c: Case): Record<string, string> {
  const ls = f.ls;
  const count = ls.bandCount;
  const mode = c.mode as string;
  const src = (c.srcField as string) === 'phiS' ? ls.phiS : ls.phi;
  const out = new Float64Array(count);
  const maxC = ls.evaluate(src, mode === 'bound' ? null : out, mode !== 'e2');
  const r: Record<string, string> = { maxC: bitsHex(maxC) };
  if (mode !== 'bound') r.out = hash(out);
  if (mode === 'e1') {
    r.r1 = hash(ls.r1.subarray(0, count));
    r.n1x = hash(ls.n1x.subarray(0, count));
    r.n1y = hash(ls.n1y.subarray(0, count));
    r.hookSeq = hash(Int32Array.from(f.hookSeq));
    r.hookCount = String(f.hookSeq.length);
    r.prep = hash(ls.prepStamp);
    r.coef = hash(Float32Array.from(COEF.flatMap((n) => Array.from(ls[n] as Float32Array))));
  }
  return r;
}

/** the bounding box that reinit will use, recomputed from the band exactly as reinit does */
export function boxOf(ls: LevelSetCore, grow: number): [number, number, number, number] {
  let i0 = ls.nx, i1 = -1, j0 = ls.ny, j1 = -1;
  for (let a = 0; a < ls.bandCount; a++) {
    const k = ls.band[a]!;
    const i = k % ls.nx;
    const j = (k - i) / ls.nx;
    if (i < i0) i0 = i;
    if (i > i1) i1 = i;
    if (j < j0) j0 = j;
    if (j > j1) j1 = j;
  }
  return [Math.max(0, i0 - grow), Math.min(ls.nx - 1, i1 + grow), Math.max(0, j0 - grow), Math.min(ls.ny - 1, j1 + grow)];
}

export function boxHash(a: Float32Array | Float64Array | Uint8Array, nx: number, box: [number, number, number, number]): string {
  const [i0, i1, j0, j1] = box;
  const out = new (a.constructor as { new (n: number): Float32Array | Float64Array | Uint8Array })((i1 - i0 + 1) * (j1 - j0 + 1));
  let p = 0;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) out[p++] = a[j * nx + i]!;
  return hash(out as Typed);
}

/** Runs the real reinit on a built frame; `wide` swaps the (private, float32) distance array for a Float64Array so that the double the sweeps computed is stored. */
export function reinitResult(f: LSFrame, m: Meta, wide: boolean): Record<string, string> {
  const ls = f.ls;
  if (wide) ls.dist = new Float64Array(ls.n);
  const box = boxOf(ls, m.levelSet.farCells + 1);
  ls.reinit();
  const bc = ls.bandCount;
  return {
    box: box.join(','),
    phi: hash(ls.phi),
    phiS: hash(ls.phiS),
    bandCount: String(bc),
    band: hash(ls.band.subarray(0, bc)),
    inBand: hash(ls.inBand),
    touched: hash(ls.touched),
    dist: boxHash(ls.dist, ls.nx, box),
    fixed: boxHash(ls.fixed, ls.nx, box),
  };
}

export function advanceResult(f: LSFrame, c: Case, m: Meta): Record<string, unknown> {
  const ls = f.ls;
  const steps = c.steps as number;
  const dtMax = c.dtMax as number;
  let t = c.t as number;
  const per: { dt: string; phi: string; bandCount: number; band: string }[] = [];
  for (let s = 0; s < steps; s++) {
    const dt = ls.advance(t, dtMax);
    t += dt;
    per.push({ dt: bitsHex(dt), phi: hash(ls.phi), bandCount: ls.bandCount, band: hash(ls.band.subarray(0, ls.bandCount)) });
  }
  void m;
  const log = new Float64Array(f.arrivals.length * 5);
  f.arrivals.forEach((a, i) => log.set([a.k, a.tA, a.r, a.nx, a.ny], 5 * i));
  return { steps: per, arrivals: hash(log), arrivalCount: f.arrivals.length, hookSeq: hash(Int32Array.from(f.hookSeq)), sBurnt: hash(ls.sBurnt), subCount: ls.subCount };
}

// ── pyrogenic ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

type PyroPrivate = PyrogenicPotential & { gx: Float64Array; gy: Float64Array; dx: { S: Float64Array; invNorm: Float64Array; lam: Float64Array }; dy: { S: Float64Array; invNorm: Float64Array; lam: Float64Array } };

export function makePyro(m: Meta, fireNx: number, fireNy: number, cell: number): PyroPrivate {
  return new PyrogenicPotential({ nx: fireNx, ny: fireNy, cellSize: cell } as unknown as GridSpec) as PyroPrivate;
}

export function pyroTables(p: PyroPrivate): Record<string, string> {
  return { sx: hash(p.dx.S), invNx: hash(p.dx.invNorm), lamX: hash(p.dx.lam), sy: hash(p.dy.S), invNy: hash(p.dy.invNorm), lamY: hash(p.dy.lam) };
}

export function pyroResult(p: PyroPrivate, q: Float32Array): Record<string, string> {
  p.solve(q);
  return { psi: hash(p.psi), up: hash(p.up), vp: hash(p.vp), gx: hash(p.gx), gy: hash(p.gy) };
}

/** q variants: plain, nan-negzero-inf (NaN at every 331st from 3, -0 at every 211th from 10, +Infinity at every 997th from 5; NaN, -0 and negative values are skipped by `v > 0`, +Infinity is not), none (all zero), single (one cell) */
export function pyroInput(q: Float32Array, variant: string): Float32Array {
  const c = new Float32Array(q);
  if (variant === 'plain') return c;
  if (variant === 'nan-negzero-inf') {
    for (let i = 3; i < c.length; i += 331) c[i] = NaN;
    for (let i = 10; i < c.length; i += 211) c[i] = -0;
    for (let i = 5; i < c.length; i += 997) c[i] = Infinity;
    return c;
  }
  if (variant === 'none') return new Float32Array(c.length);
  if (variant === 'single') {
    const s = new Float32Array(c.length);
    s[(c.length >> 1) + 37] = 81;
    return s;
  }
  throw new Error(`unknown q variant ${variant}`);
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}
