/**
 * T1.5 (b), (c): the fast tier's kernels (LevelSetCore.evaluate and reinit, src/fire/spread/levelSet.ts; PyrogenicPotential.solve, src/atmosphere/pyrogenic.ts) as RANGE FORMS run by `Pool`
 * on the SAME CHUNKS as the C# `Parallel.For` forms of T1.4b (`Fs.Kernel/LevelSet/LevelSetCore.cs`, `Fs.Kernel/Pyrogenic/PyrogenicKernel.cs`):
 *   evaluate  band positions in chunks of 256 (a serial pass in band order first calls the lazy speed hook, exactly the decisions of the TypeScript, so that its random draws keep their order);
 *             the one reduction, the CFL maximum, is combined from per-chunk maxima IN CHUNK ORDER; serial below 1,024 band cells
 *   reinit    bounding box serial; crossing test and initial distance in chunks of 8 box rows; the fast sweeps (Gauss-Seidel) as a BLOCKED WAVEFRONT of 32 x 32 tiles, the tiles of one
 *             tile anti-diagonal in parallel (a barrier per diagonal), used from 16,384 box cells; write-back and band rebuild by row chunks: a count per chunk, a prefix sum in chunk order, a fill
 *   solve     six phases (coarsen + forward x, y + eigenvalue division, inverse y, inverse x, coarse gradient, bilinear to the fire grid), a barrier between phases, chunks of 4 rows
 * Same bits as the TypeScript at every thread count: the sweeps update every cell with the neighbour values of the serial sweep, every output element is written by one chunk, the only
 * reduction is a maximum of non-NaN doubles. The loop bodies are the app's TypeScript text cut to ranges. The classes mimic the members that the replay code of `Fs.Bench/ts/fast/lib.ts`
 * reads (`phi`, `band`, `evaluate(src, out, stage1)`, `reinit()`, `advance()`, `dist`, ...), so that ONE replay serves the app's classes and these.
 */
import { makeArena, type Arena, type ArenaEntry, type Pool, type TypedAny } from './pool';

export const EVAL_CHUNK = 256;
export const ROWS_PER_CHUNK = 8;
export const TILE = 32;
export const MIN_PARALLEL_BAND = 1024;
export const MIN_PARALLEL_BOX = 16384;
export const PYRO_CHUNK_ROWS = 4;

export interface LevelSetParams {
  nu: number; cflSafety: number; cflGuard: number; rosMaxMs: number; bandCells: number; farCells: number; lazyPrepareCells: number;
  reinitEvery: number; burntExtension: boolean; burntExtensionMaxExtraCells: number; sweepIterations: number; normalEps: number;
}
export interface FastMeta {
  grid: { nx: number; ny: number; cellSize: number };
  levelSet: LevelSetParams;
  pyro: { k: number; max: number };
  pyroGrid: { nx: number; ny: number; cell: number };
}
export interface Hooks { ensureSpeed: (k: number) => void; onArrival: (k: number, tA: number, r: number, nx: number, ny: number) => void }
export const NO_HOOKS: Hooks = { ensureSpeed: () => undefined, onArrival: () => undefined };

type V = Record<string, TypedAny>;
const F32_NAMES = ['sA2', 'sB2', 'sC', 'sEx', 'sEy', 'sVls', 'sJun', 'sBurnt', 'sTx', 'sTy'] as const;

/** number of LevelSetPar instances in the arena: 0 = stage-1 frame, 1 = stage-2 frame, 2 = reinit frame (timing), 3 = replay */
export const LS_INSTANCES = 4;

export function fastEntries(m: FastMeta): ArenaEntry[] {
  const e: ArenaEntry[] = [];
  const { nx, ny } = m.grid;
  const n = nx * ny;
  e.push({ name: 'ctl', type: 'i32', length: 16 });
  for (let i = 0; i < LS_INSTANCES; i++) {
    const p = `ls${i}.`;
    e.push({ name: p + 'P', type: 'f64', length: 32 });
    for (const a of ['phi', 'phiS', 'tend1', 'tend2', 'outS', 'arrP0', 'arrPn', 'distW']) e.push({ name: p + a, type: 'f64', length: n });
    for (const a of [...F32_NAMES, 'r1', 'n1x', 'n1y', 'dist']) e.push({ name: p + a, type: 'f32', length: n });
    for (const a of ['prepStamp', 'band', 'arrA']) e.push({ name: p + a, type: 'i32', length: n });
    for (const a of ['inBand', 'touched', 'edge', 'fixed']) e.push({ name: p + a, type: 'u8', length: n });
    e.push({ name: p + 'chunkMax', type: 'f64', length: Math.ceil(n / EVAL_CHUNK) + 2 });
    e.push({ name: p + 'chunkCount', type: 'i32', length: Math.ceil(ny / ROWS_PER_CHUNK) + 2 });
    e.push({ name: p + 'diagTiles', type: 'i32', length: (Math.ceil(nx / TILE) + 1) * (Math.ceil(ny / TILE) + 1) });
  }
  const pg = m.pyroGrid;
  const cx = Math.ceil(pg.nx / 2), cy = Math.ceil(pg.ny / 2);
  const nc = cx * cy;
  const f = (name: string, length: number): void => void e.push({ name: 'py.' + name, type: 'f64', length });
  f('P', 32); f('sx', cx * cx); f('sxT', cx * cx); f('invNx', cx); f('lamX', cx);
  if (cy !== cx) { f('sy', cy * cy); f('invNy', cy); f('lamY', cy); }
  f('psi', nc); f('tmp', nc); f('q', nc); f('gx', nc); f('gy', nc);
  e.push({ name: 'py.up', type: 'f32', length: pg.nx * pg.ny }, { name: 'py.vp', type: 'f32', length: pg.nx * pg.ny }, { name: 'py.qIn', type: 'f32', length: pg.nx * pg.ny });
  e.push({ name: 'py.rowHas', type: 'u8', length: cy }, { name: 'py.chunkAny', type: 'u8', length: Math.ceil(cy / PYRO_CHUNK_ROWS) + 1 });
  return e;
}

/** the sine tables of `Dst` in pyrogenic.ts (the TypeScript's own lines, so Math.sin of the engine that runs them) */
function dstTables(n: number): { S: Float64Array; invNorm: Float64Array; lam: Float64Array } {
  const S = new Float64Array(n * n);
  const invNorm = new Float64Array(n);
  const lam = new Float64Array(n);
  for (let p = 0; p < n; p++) {
    for (let i = 0; i < n; i++) S[p * n + i] = Math.sin((Math.PI * (p + 1) * (i + 0.5)) / n);
    invNorm[p] = p === n - 1 ? 1 / n : 2 / n;
    lam[p] = 4 * Math.sin((Math.PI * (p + 1)) / (2 * n)) ** 2;
  }
  return { S, invNorm, lam };
}

export function buildFastArena(m: FastMeta): { arena: Arena; views: V } {
  const arena = makeArena(fastEntries(m));
  const views: V = {};
  for (const [name, [type, off, len]] of Object.entries(arena.table)) views[name] = new ({ f32: Float32Array, f64: Float64Array, u8: Uint8Array, i32: Int32Array })[type](arena.sab as unknown as ArrayBuffer, off, len);
  const { nx, ny } = m.grid;
  for (let i = 0; i < LS_INSTANCES; i++) {
    const edge = views[`ls${i}.edge`] as Uint8Array;
    for (let j = 0; j < ny; j++) for (let ii = 0; ii < nx; ii++) if (ii === 0 || j === 0 || ii === nx - 1 || j === ny - 1) edge[j * nx + ii] = 1;
  }
  const cx = Math.ceil(m.pyroGrid.nx / 2), cy = Math.ceil(m.pyroGrid.ny / 2);
  const dx = dstTables(cx);
  (views['py.sx'] as Float64Array).set(dx.S);
  (views['py.invNx'] as Float64Array).set(dx.invNorm);
  (views['py.lamX'] as Float64Array).set(dx.lam);
  const sxT = views['py.sxT'] as Float64Array;
  for (let p = 0; p < cx; p++) for (let i = 0; i < cx; i++) sxT[i * cx + p] = dx.S[p * cx + i]!;
  if (cy !== cx) {
    const dy = dstTables(cy);
    (views['py.sy'] as Float64Array).set(dy.S);
    (views['py.invNy'] as Float64Array).set(dy.invNorm);
    (views['py.lamY'] as Float64Array).set(dy.lam);
  }
  return { arena, views };
}

// ═════════════════════════════════════════════════ the level set ═════════════════════════════════════════════════

export class LevelSetPar {
  readonly nx: number; readonly ny: number; readonly n: number; readonly h: number;
  readonly P: LevelSetParams;
  readonly phi: Float64Array; readonly phiS: Float64Array;
  readonly sA2: Float32Array; readonly sB2: Float32Array; readonly sC: Float32Array; readonly sEx: Float32Array; readonly sEy: Float32Array; readonly sVls: Float32Array;
  readonly sJun: Float32Array; readonly sBurnt: Float32Array; readonly sTx: Float32Array; readonly sTy: Float32Array;
  readonly prepStamp: Int32Array; readonly band: Int32Array; readonly inBand: Uint8Array; readonly touched: Uint8Array;
  readonly r1: Float32Array; readonly n1x: Float32Array; readonly n1y: Float32Array;
  readonly tend1: Float64Array; readonly tend2: Float64Array;
  readonly fixed: Uint8Array;
  /** the distance array of reinit: float32 as the TypeScript's, or `distW` (Float64) after `setWide` (a test instrument of T1.4b) */
  dist: Float32Array | Float64Array;
  stamp = 1;
  bandCount = 0;
  subCount = 0;
  lastBound = Infinity;
  lazy = true;
  hooks: Hooks = NO_HOOKS;
  minParallelBand = MIN_PARALLEL_BAND;
  minParallelBox = MIN_PARALLEL_BOX;

  private readonly v: V; private readonly pool: Pool; private readonly pre: string;
  private readonly ip: Float64Array;
  private readonly edge: Uint8Array; private readonly outS: Float64Array;
  private readonly arrA: Int32Array; private readonly arrP0: Float64Array; private readonly arrPn: Float64Array;
  private readonly chunkMax: Float64Array; private readonly chunkCount: Int32Array; private readonly diagTiles: Int32Array;
  private wide = false;
  private readonly jEval: number;
  private readonly jReinit: { step1: number; count: number; fill: number; tile: number }[] = [];

  constructor(index: number, m: FastMeta, v: V, pool: Pool) {
    this.v = v; this.pool = pool;
    const pre = `ls${index}.`;
    this.pre = pre;
    this.nx = m.grid.nx; this.ny = m.grid.ny; this.n = this.nx * this.ny; this.h = m.grid.cellSize; this.P = m.levelSet;
    const f64 = (a: string): Float64Array => v[pre + a] as Float64Array;
    const f32 = (a: string): Float32Array => v[pre + a] as Float32Array;
    const i32 = (a: string): Int32Array => v[pre + a] as Int32Array;
    const u8 = (a: string): Uint8Array => v[pre + a] as Uint8Array;
    this.ip = f64('P');
    this.phi = f64('phi'); this.phiS = f64('phiS');
    this.sA2 = f32('sA2'); this.sB2 = f32('sB2'); this.sC = f32('sC'); this.sEx = f32('sEx'); this.sEy = f32('sEy'); this.sVls = f32('sVls'); this.sJun = f32('sJun'); this.sBurnt = f32('sBurnt'); this.sTx = f32('sTx'); this.sTy = f32('sTy');
    this.prepStamp = i32('prepStamp'); this.band = i32('band'); this.inBand = u8('inBand'); this.touched = u8('touched'); this.edge = u8('edge'); this.fixed = u8('fixed');
    this.r1 = f32('r1'); this.n1x = f32('n1x'); this.n1y = f32('n1y'); this.tend1 = f64('tend1'); this.tend2 = f64('tend2'); this.outS = f64('outS');
    this.arrA = i32('arrA'); this.arrP0 = f64('arrP0'); this.arrPn = f64('arrPn');
    this.chunkMax = f64('chunkMax'); this.chunkCount = i32('chunkCount'); this.diagTiles = i32('diagTiles');
    this.dist = f32('dist');
    const ip = this.ip;
    const srcOf = (sel: number): Float64Array => (sel === 0 ? this.phi : this.phiS);
    const outOf = (sel: number): Float64Array | null => (sel === 0 ? null : sel === 1 ? this.tend1 : sel === 2 ? this.tend2 : this.outS);
    // ---- evaluate chunks ----
    this.jEval = pool.register((c) => {
      const a0 = c * EVAL_CHUNK;
      const a1 = Math.min(ip[0]! | 0, a0 + EVAL_CHUNK);
      this.chunkMax[c] = this.evalRange(a0, a1, srcOf(ip[1]!), outOf(ip[2]!), ip[3]! !== 0);
    });
    // ---- reinit chunks, once for the float32 distance array and once for the Float64 one (separate job sets: each loop monomorphic) ----
    for (const dist of [f32('dist'), f64('distW')] as (Float32Array | Float64Array)[]) {
      const step1 = pool.register((c) => {
        const ja = (ip[6]! | 0) + c * ROWS_PER_CHUNK;
        const jb = Math.min(ip[7]! | 0, ja + ROWS_PER_CHUNK - 1);
        this.step1Rows(dist, ja, jb);
      });
      const count = pool.register((c) => {
        const ja = (ip[6]! | 0) + c * ROWS_PER_CHUNK;
        const jb = Math.min(ip[7]! | 0, ja + ROWS_PER_CHUNK - 1);
        const bandMax = this.P.bandCells * this.h;
        const i0 = ip[4]! | 0, i1 = ip[5]! | 0, nx = this.nx;
        let cnt = 0;
        for (let j = ja; j <= jb; j++) for (let i = i0; i <= i1; i++) if (dist[j * nx + i]! <= bandMax) cnt++;
        this.chunkCount[c] = cnt;
      });
      const fill = pool.register((c) => {
        const ja = (ip[6]! | 0) + c * ROWS_PER_CHUNK;
        const jb = Math.min(ip[7]! | 0, ja + ROWS_PER_CHUNK - 1);
        this.writeBackRows(dist, ja, jb, this.chunkCount[c]!);
      });
      const tile = pool.register((c) => {
        const idx = this.diagTiles[c]!;
        const nTi = ip[9]! | 0, nTj = ip[10]! | 0;
        const tj = Math.floor(idx / nTi), ti = idx - tj * nTi;
        const o = ip[8]! | 0;
        const i0 = ip[4]! | 0, i1 = ip[5]! | 0, j0 = ip[6]! | 0, j1 = ip[7]! | 0;
        const gi = (o & 1) !== 0 ? nTi - 1 - ti : ti;
        const gj = (o & 2) !== 0 ? nTj - 1 - tj : tj;
        const ia = i0 + gi * TILE, ib = Math.min(i1, ia + TILE - 1);
        const ja = j0 + gj * TILE, jb = Math.min(j1, ja + TILE - 1);
        this.sweepRect(dist, o, ia, ib, ja, jb);
      });
      this.jReinit.push({ step1, count, fill, tile });
    }
  }

  /** the arrays that `reset` and the replay's `buildLS` start from: a fresh `new LevelSetCore(...)` */
  reset(): void {
    const far = this.P.farCells * this.h;
    this.phi.fill(far); this.phiS.fill(far);
    for (const a of [this.sA2, this.sB2, this.sC, this.sEx, this.sVls, this.sBurnt, this.sTx, this.sTy]) a.fill(0);
    this.sEy.fill(1); this.sJun.fill(1);
    this.prepStamp.fill(0); this.band.fill(0); this.inBand.fill(0); this.touched.fill(0); this.fixed.fill(0);
    this.r1.fill(0); this.n1x.fill(0); this.n1y.fill(0); this.tend1.fill(0); this.tend2.fill(0);
    (this.v[this.pre + 'dist'] as Float32Array).fill(0); (this.v[this.pre + 'distW'] as Float64Array).fill(0);
    this.dist = this.v[this.pre + 'dist'] as Float32Array;
    this.wide = false;
    this.stamp = 1; this.bandCount = 0; this.subCount = 0; this.lastBound = Infinity; this.lazy = true; this.hooks = NO_HOOKS;
    this.minParallelBand = MIN_PARALLEL_BAND; this.minParallelBox = MIN_PARALLEL_BOX;
  }

  ensureScratch(): void { /* the scratch arrays are allocated at full size in the arena */ }

  /** the replay's test instrument: reinit with a Float64 distance array (the double the sweeps computed) */
  setWide(): void {
    this.wide = true;
    this.dist = this.v[this.pre + 'distW'] as Float64Array;
  }

  /** `LevelSetCore.evaluate` for callers that bring their own `out` (the replay): the result is copied out of the arena's scratch. */
  evaluate(src: Float64Array, out: Float64Array | null, stage1: boolean): number {
    const maxC = this.evalInto(src === this.phi ? 0 : 1, out === null ? 0 : 3, stage1);
    if (out !== null) out.set(this.outS.subarray(0, this.bandCount));
    return maxC;
  }

  /** evaluate with arena arrays: src 0 = phi, 1 = phiS; out 0 = none, 1 = tend1, 2 = tend2, 3 = the scratch. */
  evalInto(srcSel: number, outSel: number, stage1: boolean): number {
    const count = this.bandCount;
    const src = srcSel === 0 ? this.phi : this.phiS;
    const lazy = stage1 && this.lazy && outSel !== 0;
    if (lazy) this.requestSpeeds(src);
    const ip = this.ip;
    if (this.pool.threads < 2 || count < this.minParallelBand || count <= EVAL_CHUNK) {
      return this.evalRange(0, count, src, outSel === 0 ? null : outSel === 1 ? this.tend1 : outSel === 2 ? this.tend2 : this.outS, stage1);
    }
    const chunks = Math.ceil(count / EVAL_CHUNK);
    ip[0] = count; ip[1] = srcSel; ip[2] = outSel; ip[3] = stage1 ? 1 : 0;
    this.pool.par(this.jEval, chunks);
    let maxC = 0;
    const cm = this.chunkMax;
    for (let c = 0; c < chunks; c++) if (cm[c]! > maxC) maxC = cm[c]!; // chunk order
    return maxC;
  }

  /** the serial pass: for each band position in order, the TypeScript's decision whether to call `ensureSpeed(k)`, and the call */
  private requestSpeeds(src: Float64Array): void {
    const { nx, band, edge, prepStamp, sBurnt } = this;
    const ny = this.ny;
    const ext = this.P.burntExtension;
    const lazyH = this.P.lazyPrepareCells * this.h;
    const stamp = this.stamp;
    const hooks = this.hooks;
    const count = this.bandCount;
    for (let a = 0; a < count; a++) {
      const k = band[a]!;
      const p = src[k]!;
      const burntExt = ext && !(p > 0);
      if (burntExt && sBurnt[k]! > 0) continue;
      let pl: number, pr: number, pd: number, pu: number;
      if (edge[k] === 0) {
        pl = src[k - 1]!; pr = src[k + 1]!; pd = src[k - nx]!; pu = src[k + nx]!;
      } else {
        const i = k % nx;
        const j = (k - i) / nx;
        const hasL = i > 0, hasR = i < nx - 1, hasD = j > 0, hasU = j < ny - 1;
        pl = hasL ? src[k - 1]! : hasR ? 2 * p - src[k + 1]! : p;
        pr = hasR ? src[k + 1]! : hasL ? 2 * p - src[k - 1]! : p;
        pd = hasD ? src[k - nx]! : hasU ? 2 * p - src[k + nx]! : p;
        pu = hasU ? src[k + nx]! : hasD ? 2 * p - src[k - nx]! : p;
      }
      if (prepStamp[k] !== stamp) {
        if (p > 0) {
          let m = pl < pr ? pl : pr;
          if (pd < m) m = pd;
          if (pu < m) m = pu;
          if (m <= lazyH) hooks.ensureSpeed(k);
        } else if (prepStamp[k] === 0) hooks.ensureSpeed(k);
      }
    }
  }

  /** the loop of `evaluate` (levelSet.ts) over band positions [a0, a1), with no hook in it; returns the maximum of the range */
  private evalRange(a0: number, a1: number, src: Float64Array, out: Float64Array | null, stage1: boolean): number {
    const { nx, band, edge, sA2, sB2, sC, sEx, sEy, sVls, sJun, sTx, sTy, sBurnt, r1, n1x, n1y } = this;
    const ny = this.ny;
    const ext = this.P.burntExtension;
    const h = this.h;
    const inv = 1 / h;
    const half = 0.5 * inv;
    const inv2 = inv * inv;
    const nu = this.P.nu;
    const nuH = nu * h;
    const nu4 = 4 * nu;
    const eps = this.P.normalEps;
    const rMax = this.P.rosMaxMs;
    let maxC = 0;
    for (let a = a0; a < a1; a++) {
      const k = band[a]!;
      const p = src[k]!;
      const burntExt = ext && !(p > 0);
      if (burntExt) {
        const sb = sBurnt[k]!;
        if (sb > 0) {
          if (out !== null) out[a] = -sb;
          if (stage1) {
            r1[a] = 0;
            n1x[a] = sEx[k]!;
            n1y[a] = sEy[k]!;
          }
          continue;
        }
      }
      let pl: number, pr: number, pd: number, pu: number;
      if (edge[k] === 0) {
        pl = src[k - 1]!; pr = src[k + 1]!; pd = src[k - nx]!; pu = src[k + nx]!;
      } else {
        const i = k % nx;
        const j = (k - i) / nx;
        const hasL = i > 0, hasR = i < nx - 1, hasD = j > 0, hasU = j < ny - 1;
        pl = hasL ? src[k - 1]! : hasR ? 2 * p - src[k + 1]! : p;
        pr = hasR ? src[k + 1]! : hasL ? 2 * p - src[k - 1]! : p;
        pd = hasD ? src[k - nx]! : hasU ? 2 * p - src[k + nx]! : p;
        pu = hasU ? src[k + nx]! : hasD ? 2 * p - src[k - nx]! : p;
      }
      const a2 = sA2[k]!;
      const b2 = sB2[k]!;
      const vr = sVls[k]!;
      if (a2 === 0 && b2 === 0 && vr === 0) {
        if (out !== null) out[a] = 0;
        if (stage1) {
          r1[a] = 0;
          n1x[a] = sEx[k]!;
          n1y[a] = sEy[k]!;
        }
        continue;
      }
      let cx: number, cy: number;
      if (vr > 0) {
        const dmx = (p - pl) * inv;
        const dpx = (pr - p) * inv;
        const dmy = (p - pd) * inv;
        const dpy = (pu - p) * inv;
        cx = dmx > 0 && dmx >= -dpx ? dmx : dpx < 0 ? dpx : 0;
        cy = dmy > 0 && dmy >= -dpy ? dmy : dpy < 0 ? dpy : 0;
      } else {
        cx = (pr - pl) * half;
        cy = (pu - pd) * half;
      }
      const cn = Math.sqrt(cx * cx + cy * cy);
      const ex = sEx[k]!;
      const ey = sEy[k]!;
      let nxv: number, nyv: number;
      if (cn > eps) {
        nxv = cx / cn;
        nyv = cy / cn;
      } else {
        nxv = ex;
        nyv = ey;
      }
      const cosp = nxv * ex + nyv * ey;
      const c2 = cosp * cosp;
      const s2 = 1 - c2;
      let R = sC[k]! * cosp + Math.sqrt(a2 * c2 + (s2 > 0 ? b2 * s2 : 0));
      if (vr > 0) {
        const tt = nxv * sTx[k]! + nyv * sTy[k]!;
        const rv = vr * (tt < 0 ? -tt : tt);
        if (rv > R) R = rv;
      }
      R *= sJun[k]!;
      if (R > rMax) R = rMax;
      if (burntExt) {
        if (out !== null) out[a] = -R;
        if (stage1) {
          r1[a] = R;
          n1x[a] = nxv;
          n1y[a] = nyv;
        }
        continue;
      }
      if (stage1) {
        const c = R * ((nxv < 0 ? -nxv : nxv) + (nyv < 0 ? -nyv : nyv) + nu4) * inv;
        if (c > maxC) maxC = c;
      }
      if (out === null) continue;
      const dmx = (p - pl) * inv;
      const dpx = (pr - p) * inv;
      const dmy = (p - pd) * inv;
      const dpy = (pu - p) * inv;
      let g2 = 0;
      if (dmx > 0) g2 += dmx * dmx;
      if (dpx < 0) g2 += dpx * dpx;
      if (dmy > 0) g2 += dmy * dmy;
      if (dpy < 0) g2 += dpy * dpy;
      const lap = (pl + pr + pd + pu - 4 * p) * inv2;
      out[a] = -R * Math.sqrt(g2) + (lap < 0 ? nuH * R * lap : 0);
      if (stage1) {
        r1[a] = R;
        n1x[a] = nxv;
        n1y[a] = nyv;
      }
    }
    return maxC;
  }

  /** `bound()` */
  bound(): number {
    const c = this.evalInto(0, 0, true);
    return c > 0 ? this.P.cflSafety / c : Infinity;
  }

  /** `advance(t, dtMax)` of levelSet.ts (the Heun sub-step; the serial parts are the TypeScript's, evaluate and reinit are the pool forms) */
  advance(t: number, dtMax: number): number {
    const c = this.evalInto(0, 1, true);
    const bound = c > 0 ? this.P.cflSafety / c : Infinity;
    this.lastBound = bound;
    const dt = dtMax < bound ? dtMax : bound;
    this.apply(t, dt);
    return dt;
  }

  private apply(t: number, dt: number): void {
    const { band, phi, phiS, tend1, tend2, arrA, arrP0, arrPn } = this;
    const count = this.bandCount;
    if (count === 0 || !(dt > 0)) return;
    for (let a = 0; a < count; a++) {
      const k = band[a]!;
      phiS[k] = phi[k]! + dt * tend1[a]!;
    }
    this.evalInto(1, 2, false);
    let nArr = 0;
    for (let a = 0; a < count; a++) {
      const k = band[a]!;
      const p0 = phi[k]!;
      let pn = 0.5 * (p0 + phiS[k]! + dt * tend2[a]!);
      if (pn > p0) pn = p0;
      phi[k] = pn;
      phiS[k] = pn;
      if (p0 > 0 && pn <= 0) {
        arrA[nArr] = a;
        arrP0[nArr] = p0;
        arrPn[nArr] = pn;
        nArr++;
      }
    }
    const hooks = this.hooks;
    for (let q = 0; q < nArr; q++) {
      const a = arrA[q]!;
      const p0 = arrP0[q]!;
      const tA = t + (dt * p0) / (p0 - arrPn[q]!);
      this.sBurnt[band[a]!] = this.r1[a]!;
      hooks.onArrival(band[a]!, tA, this.r1[a]!, this.n1x[a]!, this.n1y[a]!);
    }
    this.subCount++;
    if (this.subCount % this.P.reinitEvery === 0) this.reinit();
  }

  // ───────────── reinit ─────────────

  reinit(): void {
    const count = this.bandCount;
    if (count === 0) return;
    const { nx, ny, band, inBand } = this;
    const ip = this.ip;
    let i0 = nx, i1 = -1, j0 = ny, j1 = -1;
    for (let a = 0; a < count; a++) {
      const k = band[a]!;
      const i = k % nx;
      const j = (k - i) / nx;
      if (i < i0) i0 = i;
      if (i > i1) i1 = i;
      if (j < j0) j0 = j;
      if (j > j1) j1 = j;
      inBand[k] = 0;
    }
    const grow = this.P.farCells + 1;
    i0 = Math.max(0, i0 - grow);
    j0 = Math.max(0, j0 - grow);
    i1 = Math.min(nx - 1, i1 + grow);
    j1 = Math.min(ny - 1, j1 + grow);
    ip[4] = i0; ip[5] = i1; ip[6] = j0; ip[7] = j1;
    const rows = j1 - j0 + 1;
    const boxCells = rows * (i1 - i0 + 1);
    const threads = this.pool.threads;
    const par = threads >= 2 && boxCells >= Math.floor(this.minParallelBox / 4) && rows >= 2;
    const rowChunks = Math.ceil(rows / ROWS_PER_CHUNK);
    const jobs = this.jReinit[this.wide ? 1 : 0]!;
    const dist = this.dist;
    if (par) this.pool.par(jobs.step1, rowChunks);
    else this.step1Rows(dist, j0, j1);
    this.sweepAll(dist, jobs.tile, boxCells, i0, i1, j0, j1);
    if (!par) {
      this.bandCount = this.writeBackRows(dist, j0, j1, 0);
      return;
    }
    this.pool.par(jobs.count, rowChunks);
    let total = 0;
    const cc = this.chunkCount;
    for (let c = 0; c < rowChunks; c++) {
      const cnt = cc[c]!;
      cc[c] = total;
      total += cnt; // exclusive prefix sum in chunk order
    }
    this.pool.par(jobs.fill, rowChunks);
    this.bandCount = total;
  }

  private step1Rows(dist: Float32Array | Float64Array, ja: number, jb: number): void {
    const { nx, ny, phi, fixed } = this;
    const i0 = this.ip[4]! | 0, i1 = this.ip[5]! | 0;
    const far = this.P.farCells * this.h;
    for (let j = ja; j <= jb; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * nx + i;
        const p = phi[k]!;
        const neg = !(p > 0);
        const cross =
          (i > 0 && !(phi[k - 1]! > 0) !== neg) ||
          (i < nx - 1 && !(phi[k + 1]! > 0) !== neg) ||
          (j > 0 && !(phi[k - nx]! > 0) !== neg) ||
          (j < ny - 1 && !(phi[k + nx]! > 0) !== neg);
        if (cross) {
          fixed[k] = 1;
          dist[k] = neg ? -p : p;
        } else {
          fixed[k] = 0;
          dist[k] = far;
        }
      }
    }
  }

  private sweepAll(dist: Float32Array | Float64Array, tileJob: number, boxCells: number, i0: number, i1: number, j0: number, j1: number): void {
    const its = this.P.sweepIterations;
    const wave = this.pool.threads >= 2 && boxCells >= this.minParallelBox;
    const nTi = Math.floor((i1 - i0 + TILE) / TILE), nTj = Math.floor((j1 - j0 + TILE) / TILE);
    const ip = this.ip;
    ip[9] = nTi; ip[10] = nTj;
    const dt = this.diagTiles;
    for (let it = 0; it < its; it++) {
      for (let o = 0; o < 4; o++) {
        if (!wave) {
          this.sweepRect(dist, o, i0, i1, j0, j1);
          continue;
        }
        ip[8] = o;
        // blocked wavefront: tile (ti, tj) in sweep space depends on (ti - 1, tj) and (ti, tj - 1); the tiles of one anti-diagonal are independent
        for (let d = 0; d <= nTi + nTj - 2; d++) {
          let nn = 0;
          for (let tj = Math.max(0, d - nTi + 1); tj <= Math.min(nTj - 1, d); tj++) {
            const ti = d - tj;
            dt[nn++] = tj * nTi + ti;
          }
          this.pool.par(tileJob, nn);
        }
      }
    }
  }

  /** one ordering's sweep over the rectangle [ia, ib] x [ja, jb] in the TypeScript's order (the neighbour tests use the box) */
  private sweepRect(dist: Float32Array | Float64Array, o: number, ia: number, ib: number, ja: number, jb: number): void {
    const nx = this.nx;
    const ip = this.ip;
    const i0 = ip[4]! | 0, i1 = ip[5]! | 0, j0 = ip[6]! | 0, j1 = ip[7]! | 0;
    const h = this.h;
    const h2 = 2 * h * h;
    const iStart = o & 1 ? ib : ia;
    const iEnd = o & 1 ? ia - 1 : ib + 1;
    const di = o & 1 ? -1 : 1;
    const jStart = o & 2 ? jb : ja;
    const jEnd = o & 2 ? ja - 1 : jb + 1;
    const dj = o & 2 ? -1 : 1;
    const fixed = this.fixed;
    for (let j = jStart; j !== jEnd; j += dj) {
      const row = j * nx;
      for (let i = iStart; i !== iEnd; i += di) {
        const k = row + i;
        if (fixed[k] !== 0) continue;
        const l = i > i0 ? dist[k - 1]! : Infinity;
        const r = i < i1 ? dist[k + 1]! : Infinity;
        const d = j > j0 ? dist[k - nx]! : Infinity;
        const u = j < j1 ? dist[k + nx]! : Infinity;
        const aa = l < r ? l : r;
        const bb = d < u ? d : u;
        let dn: number;
        const diff = aa - bb;
        if (diff >= h || diff <= -h) dn = (aa < bb ? aa : bb) + h;
        else dn = 0.5 * (aa + bb + Math.sqrt(h2 - diff * diff));
        if (dn < dist[k]!) dist[k] = dn;
      }
    }
  }

  /** the write-back of box rows [ja, jb]: returns the band position after them */
  private writeBackRows(dist: Float32Array | Float64Array, ja: number, jb: number, nb0: number): number {
    const { nx, phi, phiS, fixed, band, inBand, touched, sBurnt } = this;
    const ip = this.ip;
    const i0 = ip[4]! | 0, i1 = ip[5]! | 0;
    const h = this.h;
    const far = this.P.farCells * h;
    const bandMax = this.P.bandCells * h;
    const ext = this.P.burntExtension;
    const extraH = this.P.burntExtensionMaxExtraCells * h;
    let nb = nb0;
    for (let j = ja; j <= jb; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * nx + i;
        const neg = !(phi[k]! > 0);
        const d = dist[k]!;
        let v: number;
        if (d <= bandMax) {
          if (fixed[k] === 1) {
            v = phi[k]!;
            if (neg && ext && sBurnt[k]! > 0 && v < -(h + extraH)) v = -(h + extraH);
          } else if (!neg) v = d;
          else if (ext && sBurnt[k]! > 0) {
            const lo = -(d + extraH);
            const pk = phi[k]! < -d ? phi[k]! : -d;
            v = pk < lo ? lo : pk;
          } else v = -d;
          band[nb++] = k;
          inBand[k] = 1;
          touched[k] = 1;
        } else v = neg ? -far : far;
        phi[k] = v;
        phiS[k] = v;
      }
    }
    return nb;
  }
}

// ═════════════════════════════════════════════════ the pyrogenic potential ═════════════════════════════════════════════════

export class PyroPar {
  readonly fireNx: number; readonly fireNy: number; readonly nx: number; readonly ny: number; readonly h: number;
  readonly psi: Float64Array; readonly up: Float32Array; readonly vp: Float32Array; readonly gx: Float64Array; readonly gy: Float64Array;
  /** the tables as pyrogenic.ts's `dx` and `dy` objects have them (the replay hashes them) */
  readonly dx: { S: Float64Array; invNorm: Float64Array; lam: Float64Array };
  readonly dy: { S: Float64Array; invNorm: Float64Array; lam: Float64Array };
  private readonly pool: Pool;
  private readonly qIn: Float32Array; private readonly rowHas: Uint8Array; private readonly chunkAny: Uint8Array;
  private readonly tmp: Float64Array; private readonly q: Float64Array;
  private readonly jobs: number[];
  private readonly chunksCoarse: number; private readonly chunksFire: number;

  constructor(m: FastMeta, v: V, pool: Pool) {
    this.pool = pool;
    const pg = m.pyroGrid;
    this.fireNx = pg.nx; this.fireNy = pg.ny;
    const nx = Math.ceil(pg.nx / 2), ny = Math.ceil(pg.ny / 2);
    this.nx = nx; this.ny = ny; this.h = 2 * pg.cell;
    const f64 = (a: string): Float64Array => v['py.' + a] as Float64Array;
    const same = ny === nx;
    this.dx = { S: f64('sx'), invNorm: f64('invNx'), lam: f64('lamX') };
    this.dy = same ? this.dx : { S: f64('sy'), invNorm: f64('invNy'), lam: f64('lamY') };
    this.psi = f64('psi'); this.tmp = f64('tmp'); this.q = f64('q'); this.gx = f64('gx'); this.gy = f64('gy');
    this.up = v['py.up'] as Float32Array; this.vp = v['py.vp'] as Float32Array; this.qIn = v['py.qIn'] as Float32Array;
    this.rowHas = v['py.rowHas'] as Uint8Array; this.chunkAny = v['py.chunkAny'] as Uint8Array;
    this.chunksCoarse = Math.ceil(ny / PYRO_CHUNK_ROWS);
    this.chunksFire = Math.ceil(pg.ny / PYRO_CHUNK_ROWS);
    const { psi, tmp, q, gx, gy, up, vp, rowHas, chunkAny, qIn } = this;
    const Sx = this.dx.S, Sy = this.dy.S, SxT = f64('sxT');
    const invNx = this.dx.invNorm, lamX = this.dx.lam, invNy = this.dy.invNorm, lamY = this.dy.lam;
    const fnx = pg.nx, fny = pg.ny;
    const hh = this.h;
    const kk = m.pyro.k;
    const cap = m.pyro.max;
    const rowsOf = (c: number, total: number): [number, number] => [c * PYRO_CHUNK_ROWS, Math.min(total, (c + 1) * PYRO_CHUNK_ROWS)];
    this.jobs = [
      // 1+2: coarsen and forward x transform of the same coarse rows
      pool.register((c) => {
        const [J0, J1] = rowsOf(c, ny);
        let any = false;
        for (let J = J0; J < J1; J++) {
          const cy = Math.min(2, fny - 2 * J);
          for (let I = 0; I < nx; I++) {
            const cx = Math.min(2, fnx - 2 * I);
            let s = 0;
            for (let dj = 0; dj < 2; dj++) {
              const j = 2 * J + dj;
              if (j >= fny) break;
              for (let di = 0; di < 2; di++) {
                const i = 2 * I + di;
                if (i >= fnx) break;
                const val = qIn[j * fnx + i]!;
                if (val > 0) {
                  s += val;
                  any = true;
                }
              }
            }
            q[J * nx + I] = (kk * s) / (cx * cy);
          }
        }
        chunkAny[c] = any ? 1 : 0;
        for (let J = J0; J < J1; J++) {
          const r = J * nx;
          let has = 0;
          tmp.fill(0, r, r + nx);
          for (let i = 0; i < nx; i++) {
            const qv = q[r + i]!;
            if (qv === 0) continue;
            has = 1;
            const o = i * nx;
            for (let p = 0; p < nx; p++) tmp[r + p] = tmp[r + p]! + qv * SxT[o + p]!;
          }
          rowHas[J] = has;
          if (has) for (let p = 0; p < nx; p++) tmp[r + p] = tmp[r + p]! * invNx[p]!;
        }
      }),
      // 3: y transform and division by the eigenvalues (output rows qy)
      pool.register((c) => {
        const [r0, r1] = rowsOf(c, ny);
        for (let qy = r0; qy < r1; qy++) {
          const ro = qy * nx;
          const so = qy * ny;
          psi.fill(0, ro, ro + nx);
          for (let J = 0; J < ny; J++) {
            if (!rowHas[J]) continue;
            const sv = Sy[so + J]!;
            const r = J * nx;
            for (let p = 0; p < nx; p++) psi[ro + p] = psi[ro + p]! + sv * tmp[r + p]!;
          }
          const f = invNy[qy]! * hh * hh;
          const ly = lamY[qy]!;
          for (let p = 0; p < nx; p++) psi[ro + p] = (psi[ro + p]! * f) / (lamX[p]! + ly);
        }
      }),
      // 4: inverse y (reads psi, writes tmp)
      pool.register((c) => {
        const [r0, r1] = rowsOf(c, ny);
        for (let J = r0; J < r1; J++) {
          const r = J * nx;
          tmp.fill(0, r, r + nx);
          for (let qy = 0; qy < ny; qy++) {
            const ro = qy * nx;
            const sv = Sy[qy * ny + J]!;
            for (let p = 0; p < nx; p++) tmp[r + p] = tmp[r + p]! + sv * psi[ro + p]!;
          }
        }
      }),
      // 5: inverse x (reads tmp, writes psi)
      pool.register((c) => {
        const [r0, r1] = rowsOf(c, ny);
        for (let J = r0; J < r1; J++) {
          const r = J * nx;
          psi.fill(0, r, r + nx);
          for (let p = 0; p < nx; p++) {
            const tv = tmp[r + p]!;
            const o = p * nx;
            for (let i = 0; i < nx; i++) psi[r + i] = psi[r + i]! + tv * Sx[o + i]!;
          }
        }
      }),
      // 6: coarse gradient
      pool.register((c) => {
        const [J0, J1] = rowsOf(c, ny);
        for (let J = J0; J < J1; J++) {
          for (let I = 0; I < nx; I++) {
            const cc = J * nx + I;
            const w = I > 0 ? psi[cc - 1]! : -psi[cc]!;
            const e = I < nx - 1 ? psi[cc + 1]! : -psi[cc]!;
            const s = J > 0 ? psi[cc - nx]! : -psi[cc]!;
            const n = J < ny - 1 ? psi[cc + nx]! : -psi[cc]!;
            gx[cc] = (e - w) / (2 * hh);
            gy[cc] = (n - s) / (2 * hh);
          }
        }
      }),
      // 7: bilinear to the fire grid with the cap
      pool.register((c) => {
        const [j0, j1] = rowsOf(c, fny);
        for (let j = j0; j < j1; j++) {
          const fy = Math.min(Math.max((j + 0.5) / 2 - 0.5, 0), ny - 1);
          const J0 = Math.min(Math.floor(fy), Math.max(0, ny - 2));
          const ty = fy - J0;
          for (let i = 0; i < fnx; i++) {
            const fx = Math.min(Math.max((i + 0.5) / 2 - 0.5, 0), nx - 1);
            const I0 = Math.min(Math.floor(fx), Math.max(0, nx - 2));
            const tx = fx - I0;
            const cc = J0 * nx + I0;
            const c1 = nx > 1 ? cc + 1 : cc;
            const c2 = ny > 1 ? cc + nx : cc;
            const c3 = nx > 1 && ny > 1 ? cc + nx + 1 : cc;
            let u = (gx[cc]! * (1 - tx) + gx[c1]! * tx) * (1 - ty) + (gx[c2]! * (1 - tx) + gx[c3]! * tx) * ty;
            let vv = (gy[cc]! * (1 - tx) + gy[c1]! * tx) * (1 - ty) + (gy[c2]! * (1 - tx) + gy[c3]! * tx) * ty;
            const sp = Math.sqrt(u * u + vv * vv);
            if (sp > cap) {
              u *= cap / sp;
              vv *= cap / sp;
            }
            const k = j * fnx + i;
            up[k] = u;
            vp[k] = vv;
          }
        }
      }),
    ];
  }

  /** a fresh `new PyrogenicPotential(...)`: every work array and output zero */
  reset(): void {
    for (const a of [this.psi, this.tmp, this.q, this.gx, this.gy]) a.fill(0);
    this.up.fill(0); this.vp.fill(0); this.rowHas.fill(0); this.chunkAny.fill(0);
  }

  /** `solve(qFire)` for callers with their own q (the replay) */
  solve(qFire: Float32Array): void {
    this.qIn.set(qFire);
    this.solveResident();
  }

  loadQ(qFire: Float32Array): void {
    this.qIn.set(qFire);
  }

  /** `solve` on the arena's `qIn` (timed form) */
  solveResident(): void {
    const j = this.jobs;
    const pool = this.pool;
    pool.par(j[0]!, this.chunksCoarse);
    let any = false;
    for (let c = 0; c < this.chunksCoarse; c++) any = any || this.chunkAny[c] !== 0;
    if (!any) {
      this.psi.fill(0);
      this.up.fill(0);
      this.vp.fill(0);
      return;
    }
    pool.par(j[1]!, this.chunksCoarse);
    pool.par(j[2]!, this.chunksCoarse);
    pool.par(j[3]!, this.chunksCoarse);
    pool.par(j[4]!, this.chunksCoarse);
    pool.par(j[5]!, this.chunksFire);
  }
}
