/**
 * T1.5 (b), (c): the standard tier's four air kernels (EllipticSolver.relax / gradient / divergence in src/atmosphere/solver.ts, dynamics.advect in src/atmosphere/dynamics.ts) as
 * RANGE FORMS run by `Pool` on the SAME CHUNKS as the C# `Parallel.For` forms of T1.4a (`Fs.Kernel/Air/*.cs`):
 *   relax      a pass = the lines of one colour, a chunk = 2 rows (all k, forward then back), a barrier between passes; levels under 8,192 cells run serially (a rule about the level)
 *   gradient   phase 1: one plane m per chunk (m = 1 .. nz-1); the top plane serially; barrier; phase 2: one plane k per chunk
 *   divergence phase 1: one plane m per chunk; barrier; phase 2: one plane k per chunk (float32 and Float64 inputs are two job sets: monomorphic code)
 *   advect     a chunk = 16 consecutive output rows (kF, jF)
 * There is no reduction in these four kernels, so "combined in chunk order" is vacuous (as in C#): every output element is written by one chunk and the bits cannot depend on the thread count.
 * The loop bodies are the app's TypeScript text (src/atmosphere/solver.ts, dynamics.ts) cut to a row or plane range; the app's kernel text itself is the single-thread reference (`air-app.ts`).
 * All arrays live in one arena (SharedArrayBuffer) so that every thread sees them.
 */
import { makeArena, type Arena, type ArenaEntry, type ChunkFn, type Pool, type TypedAny } from './pool';
import type { Fixture } from './fixture';

export const RELAX_ROWS_PER_CHUNK = 2;
export const ADVECT_ROWS_PER_CHUNK = 16;
export const RELAX_MIN_PARALLEL_CELLS = 8192;

export interface AirMeta {
  nx: number; ny: number; nz: number; plane: number; n: number; nU: number; nV: number; nW: number; dx: number; Hp: number;
  topActive: boolean;
  levels: { nx: number; ny: number; nz: number }[];
  relaxCalls: { level: number; sweeps: number; reverse: boolean }[];
}

export function airMeta(fx: Fixture): AirMeta {
  const h = fx.header as unknown as { grid: AirMeta; topActive: boolean; levels: AirMeta['levels']; relaxCalls: AirMeta['relaxCalls'] };
  return { ...h.grid, topActive: h.topActive, levels: h.levels, relaxCalls: h.relaxCalls };
}

const GRID = ['dzeta', 'dzetaW', 'J', 'Ju', 'Jv', 'zsx', 'zsy'] as const;

/** every array of the standard-tier problem (names are the thread-side API) */
export function airEntries(m: AirMeta): ArenaEntry[] {
  const e: ArenaEntry[] = [];
  const f = (name: string, length: number): void => void e.push({ name, type: 'f64', length });
  const s = (name: string, length: number): void => void e.push({ name, type: 'f32', length });
  e.push({ name: 'ctl', type: 'i32', length: 16 });
  f('P', 32);
  f('g.dzeta', m.nz); f('g.dzetaW', m.nz + 1); f('g.J', m.plane); f('g.Ju', (m.nx + 1) * m.ny); f('g.Jv', m.nx * (m.ny + 1)); f('g.zsx', m.plane); f('g.zsy', m.plane); f('g.fzeta', m.nz + 1);
  e.push({ name: 'activeU', type: 'u8', length: m.nU }, { name: 'activeV', type: 'u8', length: m.nV });
  f('phi', m.n); f('sx', m.nW); f('sy', m.nW); f('wt', m.nW); f('gu', m.nU); f('gv', m.nV); f('gw', m.nW); f('out', m.n);
  s('u', m.nU); s('v', m.nV); s('w', m.nW);
  f('fu', m.nU); f('fv', m.nV); f('fw', m.nW);
  s('Dx', m.n); s('Dy', m.n); s('Dz', m.n); s('th', m.n); s('sm', m.n);
  const maxF = Math.max(m.nU, m.nV, m.nW, m.n);
  s('sA', maxF); s('sB', maxF); s('tA', maxF); s('tB', maxF);
  s('du', m.nU); s('dv', m.nV); s('dw', m.nW); s('dth', m.n); s('dsm', m.n);
  m.levels.forEach((d, l) => {
    const pl = d.nx * d.ny;
    s(`L${l}.cx`, (d.nx + 1) * d.ny * d.nz); s(`L${l}.cy`, d.nx * (d.ny + 1) * d.nz); s(`L${l}.cz`, pl * (d.nz + 1)); s(`L${l}.tInv`, pl * d.nz); s(`L${l}.tC`, pl * d.nz);
  });
  m.relaxCalls.forEach((c, i) => {
    const d = m.levels[c.level]!;
    s(`C${i}.b`, d.nx * d.ny * d.nz); s(`C${i}.x`, d.nx * d.ny * d.nz); s(`C${i}.xIn`, d.nx * d.ny * d.nz);
  });
  return e;
}

/** Allocates the arena and fills the constant arrays (grid, masks, level coefficients) and the timing data from the fixture. Runs on the main thread, outside any timing. */
export function buildAirArena(fx: Fixture): { arena: Arena; meta: AirMeta } {
  const meta = airMeta(fx);
  const arena = makeArena(airEntries(meta));
  fillAirResident(arena, fx, meta);
  return { arena, meta };
}

type V = Record<string, TypedAny>;
function setIn(v: V, name: string, src: ArrayLike<number>): void {
  (v[name] as Float64Array).set(src as ArrayLike<number>);
}

/** (re)loads the real state into the arena: the constant arrays and the timing inputs. Driver or main thread, outside timing. */
export function fillAirResident(arena: Arena, fx: Fixture, m: AirMeta, views?: V): void {
  const v = views ?? (Object.fromEntries(Object.entries(arena.table).map(([n, [t, off, len]]) => [n, new ({ f32: Float32Array, f64: Float64Array, u8: Uint8Array, i32: Int32Array })[t](arena.sab as unknown as ArrayBuffer, off, len)])) as V);
  for (const g of GRID) setIn(v, `g.${g}`, fx.get(`grid.${g}`) as Float64Array);
  setIn(v, 'g.fzeta', fx.get('solver.fzeta') as Float64Array);
  setIn(v, 'activeU', fx.get('masks.activeU'));
  setIn(v, 'activeV', fx.get('masks.activeV'));
  setIn(v, 'phi', fx.get('field.phi'));
  setIn(v, 'u', fx.get('field.u')); setIn(v, 'v', fx.get('field.v')); setIn(v, 'w', fx.get('field.w'));
  setIn(v, 'fu', fx.get('derived.gu')); setIn(v, 'fv', fx.get('derived.gv')); setIn(v, 'fw', fx.get('derived.gw'));
  setIn(v, 'Dx', fx.get('derived.Dx')); setIn(v, 'Dy', fx.get('derived.Dy')); setIn(v, 'Dz', fx.get('derived.Dz'));
  setIn(v, 'th', fx.get('field.th')); setIn(v, 'sm', fx.get('field.sm'));
  m.levels.forEach((_d, l) => { for (const k of ['cx', 'cy', 'cz', 'tInv', 'tC']) setIn(v, `L${l}.${k}`, fx.get(`level${l}.${k}`)); });
  m.relaxCalls.forEach((_c, i) => { setIn(v, `C${i}.b`, fx.get(`call${i}.b`)); setIn(v, `C${i}.xIn`, fx.get(`call${i}.x`)); setIn(v, `C${i}.x`, fx.get(`call${i}.x`)); });
}

/** An `Exec` is what the driver needs of the pool: run a job over n chunks. */
export class AirPar {
  readonly m: AirMeta;
  readonly v: V;
  readonly pool: Pool;
  readonly P: Float64Array;
  /** relax levels smaller than this run serially (tests set it to 0 to force chunked passes on every level) */
  minParallelCells = RELAX_MIN_PARALLEL_CELLS;

  private readonly jGradP1: number; private readonly jGradP2: number;
  private readonly jDivF32: [number, number]; private readonly jDivF64: [number, number];
  private readonly jAdvect: number[] = [];
  private readonly jRelax: number[] = [];

  /** advect bindings: 0 = the staging arrays (cases), 1..4 = the four calls of one atmosphere step on the resident fields */
  static readonly ADVECT_STAGING = 0;
  static readonly ADVECT_U = 1;
  static readonly ADVECT_V = 2;
  static readonly ADVECT_W = 3;
  static readonly ADVECT_THSM = 4;

  constructor(m: AirMeta, v: V, pool: Pool) {
    this.m = m; this.v = v; this.pool = pool;
    this.P = v.P as Float64Array;
    const P = this.P;
    const f64 = (n: string): Float64Array => v[n] as Float64Array;
    const f32 = (n: string): Float32Array => v[n] as Float32Array;
    const u8 = (n: string): Uint8Array => v[n] as Uint8Array;
    // ---- gradient (the TypeScript's text, one plane per chunk) ----
    const { nx, ny, nz, plane, dx } = m;
    const nx1 = nx + 1;
    const fzeta = f64('g.fzeta'), dzetaW = f64('g.dzetaW'), dzeta = f64('g.dzeta');
    const zsx = f64('g.zsx'), zsy = f64('g.zsy'), J = f64('g.J'), Ju = f64('g.Ju'), Jv = f64('g.Jv');
    const sx = f64('sx'), sy = f64('sy'), gu = f64('gu'), gv = f64('gv'), gw = f64('gw'), phi = f64('phi'), wt = f64('wt'), out = f64('out');
    const activeU = u8('activeU'), activeV = u8('activeV');
    const inv2dx = 2 / dx;
    const invdx = 1 / dx;
    this.jGradP1 = pool.register((idx) => {
      const mm = idx + 1;
      const fz = fzeta[mm]!;
      const dzw = dzetaW[mm]!;
      const o = mm * plane;
      const ob = (mm - 1) * plane;
      for (let c = 0; c < plane; c++) {
        const d = phi[o + c]! - phi[ob + c]!;
        sx[o + c] = zsx[c]! * fz * d;
        sy[o + c] = zsy[c]! * fz * d;
        gw[o + c] = d / (J[c]! * dzw);
      }
    });
    this.jGradP2 = pool.register((k) => {
      const dzk = dzeta[k]!;
      const o = k * plane;
      const o1 = (k + 1) * plane;
      for (let j = 0; j < ny; j++) {
        const row = j * nx;
        const fr = (k * ny + j) * nx1;
        const jr = j * nx1;
        {
          const f = fr;
          if (activeU[f]) {
            const cR = row;
            const cross = 0.25 * (sx[o + cR]! + sx[o1 + cR]!);
            gu[f] = phi[o + cR]! * inv2dx - cross / (Ju[jr]! * dzk * 0.5);
          } else gu[f] = 0;
        }
        for (let iu = 1; iu < nx; iu++) {
          const cL = row + iu - 1;
          const cR = cL + 1;
          const cross = 0.25 * (sx[o + cL]! + sx[o1 + cL]! + sx[o + cR]! + sx[o1 + cR]!);
          gu[fr + iu] = (phi[o + cR]! - phi[o + cL]!) * invdx - cross / (Ju[jr + iu]! * dzk);
        }
        {
          const f = fr + nx;
          if (activeU[f]) {
            const cL = row + nx - 1;
            const cross = 0.25 * (sx[o + cL]! + sx[o1 + cL]!);
            gu[f] = -phi[o + cL]! * inv2dx - cross / (Ju[jr + nx]! * dzk * 0.5);
          } else gu[f] = 0;
        }
      }
      for (let jv = 0; jv <= ny; jv++) {
        const fr = (k * (ny + 1) + jv) * nx;
        const jr = jv * nx;
        if (jv === 0 || jv === ny) {
          const cRow = jv === 0 ? 0 : (ny - 1) * nx;
          const sgn = jv === 0 ? 1 : -1;
          for (let i = 0; i < nx; i++) {
            const f = fr + i;
            if (!activeV[f]) {
              gv[f] = 0;
              continue;
            }
            const c = cRow + i;
            const cross = 0.25 * (sy[o + c]! + sy[o1 + c]!);
            gv[f] = sgn * phi[o + c]! * inv2dx - cross / (Jv[jr + i]! * dzk * 0.5);
          }
        } else {
          const rowS = (jv - 1) * nx;
          const rowN = jv * nx;
          for (let i = 0; i < nx; i++) {
            const cS = rowS + i;
            const cN = rowN + i;
            const cross = 0.25 * (sy[o + cS]! + sy[o1 + cS]! + sy[o + cN]! + sy[o1 + cN]!);
            gv[fr + i] = (phi[o + cN]! - phi[o + cS]!) * invdx - cross / (Jv[jr + i]! * dzk);
          }
        }
      }
    });
    // ---- divergence ----
    const mkDiv = (u: ArrayLike<number>, vv: ArrayLike<number>, w: ArrayLike<number>): [number, number] => {
      const p1 = pool.register((idx) => {
        const scaleU = P[0]!;
        const scaleW = P[1]!;
        const mm = idx + 1;
        const fz = fzeta[mm]!;
        const kb = mm - 1;
        const o = mm * plane;
        for (let j = 0; j < ny; j++) {
          const ub = (kb * ny + j) * nx1;
          const ua = (mm * ny + j) * nx1;
          const vb = (kb * (ny + 1) + j) * nx;
          const va = (mm * (ny + 1) + j) * nx;
          for (let i = 0; i < nx; i++) {
            const c = j * nx + i;
            const uS = u[ub + i]! + u[ub + i + 1]! + u[ua + i]! + u[ua + i + 1]!;
            const vS = vv[vb + i]! + vv[vb + i + nx]! + vv[va + i]! + vv[va + i + nx]!;
            wt[o + c] = scaleW * w[o + c]! - 0.25 * scaleU * fz * (zsx[c]! * uS + zsy[c]! * vS);
          }
        }
      });
      const area = dx * dx;
      const p2 = pool.register((k) => {
        const scaleU = P[0]!;
        const dzk = dzeta[k]!;
        const hx = dx * dzk * scaleU;
        const o = k * plane;
        const o1 = (k + 1) * plane;
        for (let j = 0; j < ny; j++) {
          const fu = (k * ny + j) * nx1;
          const ju = j * nx1;
          const fv = (k * (ny + 1) + j) * nx;
          const jv = j * nx;
          for (let i = 0; i < nx; i++) {
            const c = j * nx + i;
            out[o + c] =
              hx * (Ju[ju + i + 1]! * u[fu + i + 1]! - Ju[ju + i]! * u[fu + i]!) +
              hx * (Jv[jv + i + nx]! * vv[fv + i + nx]! - Jv[jv + i]! * vv[fv + i]!) +
              area * (wt[o1 + c]! - wt[o + c]!);
          }
        }
      });
      return [p1, p2];
    };
    this.jDivF32 = mkDiv(f32('u'), f32('v'), f32('w'));
    this.jDivF64 = mkDiv(f64('fu'), f64('fv'), f64('fw'));
    // ---- advect ----
    const Dx = f32('Dx'), Dy = f32('Dy'), Dz = f32('Dz');
    const bindings: [Float32Array, Float32Array, Float32Array | null, Float32Array | null][] = [
      [f32('sA'), f32('tA'), f32('sB'), f32('tB')],
      [f32('u'), f32('du'), null, null],
      [f32('v'), f32('dv'), null, null],
      [f32('w'), f32('dw'), null, null],
      [f32('th'), f32('dth'), f32('sm'), f32('dsm')],
    ];
    for (const [src, dst, src2, dst2] of bindings) {
      this.jAdvect.push(pool.register((c) => {
        const nxF = P[0]! | 0, nyF = P[1]! | 0, nzF = P[2]! | 0, ox = P[3]!, oy = P[4]!, oz = P[5]!;
        const dual = P[6]! !== 0;
        const rows = nyF * nzF;
        const r0 = c * ADVECT_ROWS_PER_CHUNK;
        const r1 = Math.min(rows, r0 + ADVECT_ROWS_PER_CHUNK);
        const planeF = nxF * nyF;
        const xFmax = nxF - 1, yFmax = nyF - 1, zFmax = nzF - 1;
        const xF2 = nxF - 2, yF2 = nyF - 2, zF2 = nzF - 2;
        const sxo = ox > 0 ? 1 : 0, syo = oy > 0 ? 1 : 0, szo = oz > 0 ? 1 : 0;
        for (let r = r0; r < r1; r++) {
          const kF = (r / nyF) | 0;
          const jF = r - kF * nyF;
          const z = kF - oz;
          const k1 = kF < nz ? kF : nz - 1;
          const k0 = kF - szo < 0 ? 0 : kF - szo > nz - 1 ? nz - 1 : kF - szo;
          const y = jF - oy;
          const j1 = jF < ny ? jF : ny - 1;
          const j0 = jF - syo < 0 ? 0 : jF - syo > ny - 1 ? ny - 1 : jF - syo;
          const rowF = kF * planeF + jF * nxF;
          const rr0 = k0 * plane + j0 * nx;
          const rr1 = k1 * plane + j1 * nx;
          for (let iF = 0; iF < nxF; iF++) {
            const i1 = iF < nx ? iF : nx - 1;
            const i0 = iF - sxo < 0 ? 0 : iF - sxo > nx - 1 ? nx - 1 : iF - sxo;
            const c0 = rr0 + i0;
            const c1 = rr1 + i1;
            let xd = iF - 0.5 * (Dx[c0]! + Dx[c1]!);
            let yd = y + oy - 0.5 * (Dy[c0]! + Dy[c1]!);
            let zd = z + oz - 0.5 * (Dz[c0]! + Dz[c1]!);
            xd = xd < 0 ? 0 : xd > xFmax ? xFmax : xd;
            yd = yd < 0 ? 0 : yd > yFmax ? yFmax : yd;
            zd = zd < 0 ? 0 : zd > zFmax ? zFmax : zd;
            let I = xd | 0;
            if (I > xF2) I = xF2;
            let Jj = yd | 0;
            if (Jj > yF2) Jj = yF2;
            let K = zd | 0;
            if (K > zF2) K = zF2;
            const tx = xd - I;
            const ty = yd - Jj;
            const tz = zd - K;
            const q = K * planeF + Jj * nxF + I;
            const a = q + 1;
            const b = q + nxF;
            const cc = b + 1;
            const d = q + planeF;
            const e = d + 1;
            const f = d + nxF;
            const h = f + 1;
            const sx1 = 1 - tx;
            const sy1 = 1 - ty;
            const sz1 = 1 - tz;
            const w00 = sx1 * sy1;
            const w10 = tx * sy1;
            const w01 = sx1 * ty;
            const w11 = tx * ty;
            dst[rowF + iF] = sz1 * (w00 * src[q]! + w10 * src[a]! + w01 * src[b]! + w11 * src[cc]!) + tz * (w00 * src[d]! + w10 * src[e]! + w01 * src[f]! + w11 * src[h]!);
            if (dual) dst2![rowF + iF] = sz1 * (w00 * src2![q]! + w10 * src2![a]! + w01 * src2![b]! + w11 * src2![cc]!) + tz * (w00 * src2![d]! + w10 * src2![e]! + w01 * src2![f]! + w11 * src2![h]!);
          }
        }
      }));
    }
    // ---- relax: one job per recorded call (its own b and x arrays and the level's coefficients) ----
    m.relaxCalls.forEach((call, i) => {
      const d = m.levels[call.level]!;
      const lnx = d.nx, lny = d.ny, lnz = d.nz, lplane = lnx * lny;
      const lnx1 = lnx + 1;
      const strideU = lny * lnx1;
      const strideV = (lny + 1) * lnx;
      const nxm = lnx - 1;
      const cx = f32(`L${call.level}.cx`), cy = f32(`L${call.level}.cy`), cz = f32(`L${call.level}.cz`), tInv = f32(`L${call.level}.tInv`), tC = f32(`L${call.level}.tC`);
      const b = f32(`C${i}.b`), x = f32(`C${i}.x`);
      this.jRelax.push(pool.register((c) => {
        const colour = P[0]! | 0;
        const j0 = c * RELAX_ROWS_PER_CHUNK;
        const j1 = Math.min(lny, j0 + RELAX_ROWS_PER_CHUNK);
        relaxRows(lnx, lny, lnz, lplane, lnx1, strideU, strideV, nxm, cx, cy, cz, b, x, tInv, tC, colour, j0, j1);
      }));
    });
  }

  // ───────────── driver side (orchestration) ─────────────

  /** `EllipticSolver.gradient`: phi -> gu, gv, gw (arena arrays `gu`, `gv`, `gw`) */
  gradient(topActive: boolean): void {
    const { nz, plane } = this.m;
    const v = this.v;
    const sx = v.sx as Float64Array, sy = v.sy as Float64Array, gw = v.gw as Float64Array;
    for (let c = 0; c < plane; c++) {
      sx[c] = 0;
      sy[c] = 0;
      gw[c] = 0;
      sx[nz * plane + c] = 0;
      sy[nz * plane + c] = 0;
    }
    this.pool.par(this.jGradP1, nz - 1);
    {
      const o = nz * plane;
      const ob = (nz - 1) * plane;
      const dzw = (v['g.dzetaW'] as Float64Array)[nz]!;
      const phi = v.phi as Float64Array, J = v['g.J'] as Float64Array;
      for (let c = 0; c < plane; c++) gw[o + c] = topActive ? -phi[ob + c]! / (J[c]! * dzw) : 0;
    }
    this.pool.par(this.jGradP2, nz);
  }

  /** `EllipticSolver.divergence` on the float32 inputs `u`, `v`, `w` (f32 = true) or the Float64 `fu`, `fv`, `fw`; result in `out` */
  divergence(f32: boolean, scaleU: number, scaleW: number): void {
    const { nz, plane } = this.m;
    const v = this.v;
    const wt = v.wt as Float64Array;
    const w = (f32 ? v.w : v.fw) as ArrayLike<number>;
    this.P[0] = scaleU;
    this.P[1] = scaleW;
    for (let c = 0; c < plane; c++) {
      wt[c] = 0;
      wt[nz * plane + c] = scaleW * w[nz * plane + c]!;
    }
    const [p1, p2] = f32 ? this.jDivF32 : this.jDivF64;
    this.pool.par(p1, nz - 1);
    this.pool.par(p2, nz);
  }

  /** `dynamics.advect` with binding `binding` (see ADVECT_*); sizes and offsets as the TypeScript's arguments */
  advect(binding: number, nxF: number, nyF: number, nzF: number, ox: number, oy: number, oz: number, dual: boolean): void {
    const P = this.P;
    P[0] = nxF; P[1] = nyF; P[2] = nzF; P[3] = ox; P[4] = oy; P[5] = oz; P[6] = dual ? 1 : 0;
    this.pool.par(this.jAdvect[binding]!, Math.ceil((nyF * nzF) / ADVECT_ROWS_PER_CHUNK));
  }

  /** `EllipticSolver.relax` of recorded call `call` (its own b and x arrays) */
  relax(call: number, sweeps: number, reverse: boolean): void {
    const c = this.m.relaxCalls[call]!;
    const d = this.m.levels[c.level]!;
    const lny = d.ny;
    const cells = d.nx * d.ny * d.nz;
    const parallel = this.pool.threads >= 2 && cells >= this.minParallelCells;
    const job = this.jRelax[call]!;
    const P = this.P;
    const chunks = Math.ceil(lny / RELAX_ROWS_PER_CHUNK);
    for (let s = 0; s < sweeps; s++) {
      for (let pass = 0; pass < 2; pass++) {
        const colour = reverse ? 1 - pass : pass;
        P[0] = colour;
        if (!parallel) {
          // serial: the whole level on this thread, in the TypeScript's order (one range 0..ny)
          this.relaxSerial(call, colour);
        } else this.pool.par(job, chunks);
      }
    }
  }

  private relaxSerial(call: number, colour: number): void {
    const c = this.m.relaxCalls[call]!;
    const d = this.m.levels[c.level]!;
    const v = this.v;
    const lnx = d.nx, lny = d.ny, lnz = d.nz, lplane = lnx * lny, lnx1 = lnx + 1;
    relaxRows(lnx, lny, lnz, lplane, lnx1, lny * lnx1, (lny + 1) * lnx, lnx - 1, v[`L${c.level}.cx`] as Float32Array, v[`L${c.level}.cy`] as Float32Array, v[`L${c.level}.cz`] as Float32Array,
      v[`C${call}.b`] as Float32Array, v[`C${call}.x`] as Float32Array, v[`L${c.level}.tInv`] as Float32Array, v[`L${c.level}.tC`] as Float32Array, colour, 0, lny);
  }
}

/** One colour pass over the z-lines of rows [j0, j1): the forward elimination up the column, then the back substitution down it (the TypeScript's loops of `relax`, cut to a row range). */
function relaxRows(
  nx: number, ny: number, nz: number, plane: number, nx1: number, strideU: number, strideV: number, nxm: number,
  cx: Float32Array, cy: Float32Array, cz: Float32Array, b: Float32Array, x: Float32Array, tInv: Float32Array, tC: Float32Array,
  colour: number, j0: number, j1: number,
): void {
  for (let k = 0; k < nz; k++) {
    const o = k * plane;
    const ou = k * strideU;
    const ov = k * strideV;
    const hasD = k > 0;
    for (let j = j0; j < j1; j++) {
      const hasS = j > 0;
      const hasN = j < ny - 1;
      const row = o + j * nx;
      const fuRow = ou + j * nx1;
      const fvRow = ov + j * nx;
      for (let i = (j + colour) & 1; i < nx; i += 2) {
        const idx = row + i;
        let rhs = b[idx]!;
        if (i > 0) rhs += cx[fuRow + i]! * x[idx - 1]!;
        if (i < nxm) rhs += cx[fuRow + i + 1]! * x[idx + 1]!;
        if (hasS) rhs += cy[fvRow + i]! * x[idx - nx]!;
        if (hasN) rhs += cy[fvRow + i + nx]! * x[idx + nx]!;
        if (hasD) rhs += cz[idx]! * x[idx - plane]!;
        x[idx] = rhs * tInv[idx]!;
      }
    }
  }
  for (let k = nz - 2; k >= 0; k--) {
    const o = k * plane;
    for (let j = j0; j < j1; j++) {
      const row = o + j * nx;
      for (let i = (j + colour) & 1; i < nx; i += 2) {
        const idx = row + i;
        x[idx] = x[idx]! + tC[idx]! * x[idx + plane]!;
      }
    }
  }
}

export type { ChunkFn };
