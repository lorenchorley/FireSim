/**
 * T1.5: the replay of the fast-tier fixtures (T1.4b) for ANY implementation that has the members of `LevelSetCore` / `PyrogenicPotential` that `Fs.Bench/ts/fast/lib.ts` reads: this file is a
 * copy of that file's frame builder and result functions (lib.ts imports `node:crypto` and `node:fs`, so a browser worker cannot use it), generalised by a FACTORY (`() => ls`) so that the
 * app's own classes (unmodified, `fast-app.ts`) and the pool forms (`fast-pool.ts`) are replayed by the same code. Variants (poison recipes, replay hook) are those of lib.ts; the expected
 * results are the `variants[].result` of the fixture's header.json (= Fs.Tests/golden/fast-k6f-*.json).
 */
import { bitsHex, hash, type Typed } from './sha';
import type { Fixture } from './fixture';
import type { FastMeta, Hooks } from './fast-pool';

export const COEF = ['sA2', 'sB2', 'sC', 'sEx', 'sEy', 'sVls'] as const;
export const FLOAT_STATE = ['sA2', 'sB2', 'sC', 'sEx', 'sEy', 'sVls', 'sJun', 'sBurnt', 'sTx', 'sTy'] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LS = any;
export interface Case { id: string; kind: 'evaluate' | 'reinit' | 'advance' | 'pyro'; [k: string]: unknown }
export type LSFactory = (m: FastMeta) => LS;
export type PyroFactory = (m: FastMeta, fireNx: number, fireNy: number, cell: number) => LS;

export function poisonBand(arr: Float32Array | Float64Array, band: Int32Array, count: number, nanMod: number, nanOff: number, negMod: number, negOff: number): void {
  for (let a = 0; a < count; a++) {
    const k = band[a]!;
    if (nanMod > 0 && a % nanMod === nanOff) arr[k] = NaN;
    if (negMod > 0 && a % negMod === negOff) arr[k] = -0;
  }
}

export interface LSFrame {
  ls: LS;
  hookSeq: number[];
  arrivals: { k: number; tA: number; r: number; nx: number; ny: number }[];
}

/** A LevelSetCore-like object holding the state of a recorded frame, with the replay hook installed. `variant` applies a poison recipe. (`fast/lib.ts` buildLS) */
export function buildLS(fx: Fixture, m: FastMeta, c: Case, variant: string, factory: LSFactory): LSFrame {
  const arrays = c.arrays as Record<string, string>;
  const ls = factory(m);
  const count = c.count as number;
  const f64 = (role: string): Float64Array => fx.get(arrays[role]!) as Float64Array;
  const f32 = (role: string): Float32Array => fx.get(arrays[role]!) as Float32Array;
  ls.phi.set(f64('phi'));
  ls.phiS.set(arrays.phiS ? f64('phiS') : f64('phi'));
  for (const name of FLOAT_STATE) (ls[name] as Float32Array).set(f32(name));
  ls.prepStamp.set(fx.get(arrays.prepStamp!) as Int32Array);
  const band = fx.get(arrays.band!) as Int32Array;
  ls.band.set(band.subarray(0, count));
  ls.bandCount = count;
  if (arrays.inBand) ls.inBand.set(fx.get(arrays.inBand) as Uint8Array);
  if (arrays.touched) ls.touched.set(fx.get(arrays.touched) as Uint8Array);
  ls.stamp = c.stamp as number;
  ls.lazy = c.lazy as boolean;
  ls.subCount = (c.subCount as number) ?? 0;
  const bandNow = ls.band as Int32Array;
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
  const hookK = hk ? (fx.get(hk.k) as Int32Array) : new Int32Array(0);
  const hookV = hk ? (fx.get(hk.vals) as Float32Array) : new Float32Array(0);
  const index = new Map<number, number>();
  for (let i = 0; i < hookK.length; i++) index.set(hookK[i]!, i);
  const hooks: Hooks = {
    ensureSpeed: (k: number): void => {
      hookSeq.push(k);
      const i = index.get(k);
      if (i !== undefined) COEF.forEach((name, j) => ((ls[name] as Float32Array)[k] = hookV[6 * i + j]!));
      ls.prepStamp[k] = ls.stamp;
    },
    onArrival: (k, tA, r, nx, ny) => {
      arrivals.push({ k, tA, r, nx, ny });
    },
  };
  ls.hooks = hooks;
  ls.ensureScratch();
  return { ls, hookSeq, arrivals };
}

export function evaluateResult(f: LSFrame, c: Case): Record<string, string> {
  const ls = f.ls;
  const count = ls.bandCount as number;
  const mode = c.mode as string;
  const src = (c.srcField as string) === 'phiS' ? ls.phiS : ls.phi;
  const out = new Float64Array(count);
  const maxC = ls.evaluate(src, mode === 'bound' ? null : out, mode !== 'e2') as number;
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

export function boxOf(ls: LS, grow: number): [number, number, number, number] {
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

export function reinitResult(f: LSFrame, m: FastMeta, wide: boolean): Record<string, string> {
  const ls = f.ls;
  if (wide) {
    if (typeof ls.setWide === 'function') ls.setWide();
    else ls.dist = new Float64Array(ls.n);
  }
  const box = boxOf(ls, m.levelSet.farCells + 1);
  ls.reinit();
  const bc = ls.bandCount as number;
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

export function advanceResult(f: LSFrame, c: Case): Record<string, unknown> {
  const ls = f.ls;
  const steps = c.steps as number;
  const dtMax = c.dtMax as number;
  let t = c.t as number;
  const per: { dt: string; phi: string; bandCount: number; band: string }[] = [];
  for (let s = 0; s < steps; s++) {
    const dt = ls.advance(t, dtMax) as number;
    t += dt;
    per.push({ dt: bitsHex(dt), phi: hash(ls.phi), bandCount: ls.bandCount, band: hash(ls.band.subarray(0, ls.bandCount)) });
  }
  const log = new Float64Array(f.arrivals.length * 5);
  f.arrivals.forEach((a, i) => log.set([a.k, a.tA, a.r, a.nx, a.ny], 5 * i));
  return { steps: per, arrivals: hash(log), arrivalCount: f.arrivals.length, hookSeq: hash(Int32Array.from(f.hookSeq)), sBurnt: hash(ls.sBurnt), subCount: ls.subCount };
}

export function pyroTables(p: LS): Record<string, string> {
  return { sx: hash(p.dx.S), invNx: hash(p.dx.invNorm), lamX: hash(p.dx.lam), sy: hash(p.dy.S), invNy: hash(p.dy.invNorm), lamY: hash(p.dy.lam) };
}

export function pyroResult(p: LS, q: Float32Array): Record<string, string> {
  p.solve(q);
  return { psi: hash(p.psi), up: hash(p.up), vp: hash(p.vp), gx: hash(p.gx), gy: hash(p.gy) };
}

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

export interface FastCaseResult { id: string; kind: string; checks: number; mismatches: string[]; actual: unknown }

function diff(want: unknown, got: unknown, path: string, out: string[]): number {
  if (want !== null && typeof want === 'object') {
    let n = 0;
    for (const [k, w] of Object.entries(want as Record<string, unknown>)) n += diff(w, (got as Record<string, unknown> | undefined)?.[k], `${path}.${k}`, out);
    return n;
  }
  if (String(want) !== String(got)) out.push(`${path}: ${String(got)} != ${String(want)}`);
  return 1;
}

/** Replays every golden case of a fast-tier fixture (all variants) on the implementation made by the two factories, and compares with the golden results. */
export function runFastCases(fx: Fixture, lsFactory: LSFactory, pyroFactory: PyroFactory): FastCaseResult[] {
  const h = fx.header as unknown as { meta: FastMeta & { pyro: { k: number; max: number } }; cases: (Case & { variants: { name: string; result: unknown }[]; tables?: Record<string, string> })[] };
  const meta = h.meta;
  const results: FastCaseResult[] = [];
  for (const c of h.cases) {
    const mism: string[] = [];
    const actual: unknown[] = [];
    let checks = 0;
    const cmp = (name: string, want: unknown, got: unknown): void => {
      actual.push([name, got]);
      checks += diff(want, got, name, mism);
    };
    if (c.kind === 'evaluate') {
      for (const v of c.variants) cmp(v.name, v.result, evaluateResult(buildLS(fx, meta, c, v.name, lsFactory), c));
    } else if (c.kind === 'advance') {
      for (const v of c.variants) cmp(v.name, v.result, advanceResult(buildLS(fx, meta, c, v.name, lsFactory), c));
    } else if (c.kind === 'reinit') {
      for (const v of c.variants) {
        const want = v.result as { float: unknown; wide: unknown };
        cmp(`${v.name}.float`, want.float, reinitResult(buildLS(fx, meta, c, v.name, lsFactory), meta, false));
        cmp(`${v.name}.wide`, want.wide, reinitResult(buildLS(fx, meta, c, v.name, lsFactory), meta, true));
      }
    } else {
      const q = fx.get(c.q as string) as Float32Array;
      const nx = c.fireNx as number, ny = c.fireNy as number, cell = c.cellSize as number;
      cmp('tables', c.tables, pyroTables(pyroFactory(meta, nx, ny, cell)));
      for (const v of c.variants) cmp(v.name, v.result, pyroResult(pyroFactory(meta, nx, ny, cell), pyroInput(q, v.name)));
    }
    results.push({ id: c.id, kind: c.kind, checks, mismatches: mism, actual });
  }
  return results;
}
