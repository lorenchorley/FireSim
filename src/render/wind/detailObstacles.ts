/**
 * What the detailed streaks flow around (0.7.0, docs/plans/0.7.0/D-CONTRACT-070-detail-looks.md sections 2.1 and 2.2): the canopy they ride on, the tree
 * crowns that stand in their way and the eddies that curl behind the proud ones, ridges' lee slopes and the fire's plume. Pure: no Three.js, no DOM, no
 * `Math.random`. Display only: it bends the DIRECTION of a traced line and says how near an obstacle the line is; the speed (so the colour) is never touched.
 * Same input, same answer: every number is a function of the world (the crown's own place and size, the canopy, the wind) and the view's projection
 * only through which crowns are big enough on the screen to count.
 *
 * Crowns. A tree is an obstacle where the stroke's height cuts its crown: the crown is an ellipsoid (centre at `centreShare` of the tree's height, half
 * height `halfShare` of it), the stroke runs at `max(base lift, topShare x canopy height x cover weight)` over the ground, and the obstacle is the
 * ellipsoid's cross-section at that height, a disc at the trunk. A stroke under the crown's base passes the trunk; one over its top flies over. The disc is
 * the soft doublet of potential flow past a cylinder (in the frame of the unperturbed wind, speed 1: `du = -r^2 (x^2 - y^2) / (x^2 + y^2 + a^2)^2` along,
 * `dv = -2 r^2 x y / (...)^2` across, `a = soften x r`), faded to 0 at `reach x r`; the tracer takes `normalize(wind + perturbation)` as its direction.
 *
 * Eddies. A site (a proud crown standing free, a ridge's lee, the plume) has a pair of counter-rotating Rankine vortices `downwind x r` behind it and
 * `lateral x r` either side of its axis: the upper one (to the left of the wind) clockwise, the lower anticlockwise, so that on the axis the flow runs
 * back to the obstacle. Tangential speed `kappa x rv / a` inside the core (`a = core x r`) and `kappa x a / rv` outside, faded to 0 at `reach x r`.
 *
 * No allocation after the constructor, and (as in the builder) no double through an argument or a return value: the calls read and write `io`.
 */
import type { GridSpec } from '../../core/grid';
import type { FuelMap } from '../../core/types';
import type { CrownSet, DetailRelief } from './glyphTypes';

const U32 = 4294967296;
/** The most crowns, eddy sites and grid cells the scratch holds, whatever `DETAIL_RELIEF` says. */
export const MAX_CROWNS_CAP = 1024;
export const MAX_SITES_CAP = 40;
const GRID_MAX = 64;
/** The grid's node pool: a crown overlaps at most four cells (the cell is at least twice its reach). */
const POOL = 4 * MAX_CROWNS_CAP;

// Slots of `io` (inputs and outputs of the calls below).
export const IO_X = 0;
export const IO_Y = 1;
export const IO_DX = 2;
export const IO_DY = 3;
/** Out of `perturb`: the perturbation (the wind is the unit vector (dx, dy)). */
export const IO_PX = 4;
export const IO_PY = 5;
/** Out of `perturb`: 0 to 1, how near the point is to an obstacle (the line's pin). */
export const IO_NEAR = 6;
/** Out of `perturb`: 1 when the point is inside a crown's rim (the line stops). */
export const IO_HIT = 7;
/** In to `perturb`: 0 the whole field, 1 the rim test only. */
export const IO_MODE = 8;
/** Out of `canopyAt`: the height (m over the ground) of the stroke's plane. */
export const IO_ZC = 9;
/** In to `addSite`: the site's radius (m), its strength (1 is the whole), its height (world y of the ground there, for the size test). */
export const IO_R = 10;
export const IO_K = 11;
export const IO_Z = 12;
/** Out of `blocked`: 1 when the point is inside a crown's seed block. */
export const IO_BLOCK = 13;
const IO_LEN = 16;

// Slots of the copied constants.
const K_TOP = 0;
const K_COVER_FULL = 1;
const K_MAX_H = 2;
const K_MAX_GROUP = 3;
const K_CLEAR = 4;
const K_CENTRE = 5;
const K_HALF = 6;
const K_MIN_R_PX = 7;
const K_MAX_CROWNS = 8;
const K_GRID_M = 9;
const K_REACH = 10;
const K_SOFT = 11;
const K_RIM = 12;
const K_BLOCK = 13;
const K_PIN_DEPTH = 14;
const K_PIN_REACH = 15;
const K_E_DOWN = 16;
const K_E_LAT = 17;
const K_E_CORE = 18;
const K_E_KAPPA = 19;
const K_E_REACH = 20;
const K_E_FADE = 21;
const K_E_MIN_PX = 22;
const K_E_MAX = 23;
const K_E_KEEP = 24;
const K_E_PROUD = 25;
const K_E_FREE = 26;
const K_GATE_M = 27;
const K_GATE_PX = 28;
const K_CLOCK = 29;
const K_PIN_MIN = 30;
const K_LEN = 32;

// Slots of `p`, the picture's numbers the builder hands over.
export const P_PXM1 = 0;
export const P_WMIN = 1;
export const P_MX = 2;
export const P_MY = 3;
export const P_ZBASE = 4;
export const P_VEX = 5;
export const P_MPPC = 6;
/** The ground the picture's seeds come from, grown by the reach of a line: a tree outside it cannot be in the way and is passed over before it is projected. */
export const P_BX0 = 7;
export const P_BY0 = 8;
export const P_BX1 = 9;
export const P_BY1 = 10;

const SALT_PROUD = 0x51a1;
/**
 * How much faster than linear the nearness (the pin's depth) rises toward an obstacle: 1 at `1 / PIN_GAIN` of the way in from `pinReach` radii. The shader's
 * low octave of meander carries a whole line sideways by several metres at the closest zoom (20 m x 0.44), more than a crown's radius, so a line that was bent
 * round a crown must be nearly still within about one and a half radii of it (looked at on the real picture: with a linear pin the lines run through the crowns).
 */
export const PIN_GAIN = 2;
/**
 * The radius (m) of the disc a crown of `height` and `width` shows at a stroke `zs` metres over its trunk's foot, or 0 when the stroke passes under the
 * crown's base or over its top: the cross-section of the ellipsoid whose centre is at `centre` x height and whose half height is `half` x height.
 */
export function crownDiscRadius(height: number, width: number, zs: number, centre: number, half: number): number {
  if (!(height > 0) || !(width > 0)) return 0;
  const t = (zs - centre * height) / (half * height);
  if (!(t > -1 && t < 1)) return 0;
  return 0.5 * width * Math.sqrt(1 - t * t);
}

export class Obstacles {
  readonly io = new Float64Array(IO_LEN);
  /** Projection x view of the picture, column-major (what the builder holds). */
  readonly view = new Float64Array(16);
  /** The picture's numbers: pixels a metre covers at distance 1, the smallest clip w, the screen bounds (NDC, with the margin), the base lift (m), the exaggeration, the m a pixel at the middle, the box of the seeds (grown). */
  readonly p = new Float64Array(12);
  private readonly k = new Float64Array(K_LEN);
  private readonly hv = new Uint32Array(1);
  private readonly pv = new Float64Array(1);

  /** The canopy (by reference) and its grid. */
  private ch: Float32Array = new Float32Array(0);
  private cc: Float32Array = new Float32Array(0);
  private cnx = 0;
  private cny = 0;
  private cx0 = 0;
  private cy0 = 0;
  private cinv = 0;
  private canopy = false;

  // The crowns that count: place, radius at the stroke, flag 1 = proud (stands over the stand).
  readonly cx = new Float32Array(MAX_CROWNS_CAP);
  readonly cy = new Float32Array(MAX_CROWNS_CAP);
  readonly cr = new Float32Array(MAX_CROWNS_CAP);
  private readonly cf = new Uint8Array(MAX_CROWNS_CAP);
  nCrowns = 0;
  /** Crowns that were big enough and on the screen but did not fit `maxCrowns`. */
  overflow = 0;
  private sets: readonly CrownSet[] = [];
  private si = 0;
  private ti = 0;

  // The uniform grid over the crowns: every crown is in the (at most four) cells its reach touches.
  private readonly heads = new Int16Array(GRID_MAX * GRID_MAX);
  private readonly nodeId = new Int16Array(POOL);
  private readonly nodeNext = new Int16Array(POOL);
  private gnx = 0;
  private gny = 0;
  private gx0 = 0;
  private gy0 = 0;
  private ginv = 0;

  // The eddy sites: place, radius, the unit wind there, strength.
  readonly sx = new Float32Array(MAX_SITES_CAP);
  readonly sy = new Float32Array(MAX_SITES_CAP);
  readonly sr = new Float32Array(MAX_SITES_CAP);
  readonly sdx = new Float32Array(MAX_SITES_CAP);
  readonly sdy = new Float32Array(MAX_SITES_CAP);
  readonly sk = new Float32Array(MAX_SITES_CAP);
  nSites = 0;
  private maxSites = 0;

  /** Copy the constants of the look; the canopy when there is a usable one. */
  configure(relief: DetailRelief, canopy: FuelMap | undefined): void {
    const k = this.k;
    const c = relief.canopy;
    const w = relief.crowns;
    const e = relief.eddies;
    k[K_TOP] = c.topShare;
    k[K_COVER_FULL] = c.coverFull;
    k[K_MAX_H] = c.maxHeightM;
    k[K_MAX_GROUP] = w.maxGroup;
    k[K_CLEAR] = w.clearM;
    k[K_CENTRE] = w.centreShare;
    k[K_HALF] = w.halfShare;
    k[K_MIN_R_PX] = w.minRadiusPx;
    k[K_MAX_CROWNS] = Math.min(MAX_CROWNS_CAP, w.maxCrowns);
    k[K_GRID_M] = w.gridM;
    k[K_REACH] = w.reach;
    k[K_SOFT] = w.soften;
    k[K_RIM] = w.rim;
    k[K_BLOCK] = w.seedBlock;
    k[K_PIN_DEPTH] = w.pinDepth;
    k[K_PIN_MIN] = w.pinMin;
    k[K_PIN_REACH] = w.pinReach;
    k[K_E_DOWN] = e.downwind;
    k[K_E_LAT] = e.lateral;
    k[K_E_CORE] = e.core;
    k[K_E_KAPPA] = e.kappa;
    k[K_E_REACH] = e.reach;
    k[K_E_FADE] = e.fadeFromCores;
    k[K_E_MIN_PX] = e.minCorePx;
    k[K_E_MAX] = Math.min(MAX_SITES_CAP, e.maxEddies);
    k[K_E_KEEP] = e.keep;
    k[K_E_PROUD] = e.proudM;
    k[K_E_FREE] = e.freeReach;
    k[K_GATE_M] = w.gateCrownM;
    k[K_GATE_PX] = w.gatePx;
    k[K_CLOCK] = w.clockEvery;
    this.maxSites = k[K_E_MAX]!;
    this.canopy = false;
    this.nCrowns = 0;
    this.nSites = 0;
    this.overflow = 0;
    this.gnx = 0;
    this.gny = 0;
    if (canopy) {
      const g: GridSpec = canopy.grid;
      const n = g.nx * g.ny;
      if (g.nx >= 2 && g.ny >= 2 && g.cellSize > 0 && canopy.canopyHeight.length >= n && canopy.canopyCover.length >= n) {
        this.ch = canopy.canopyHeight;
        this.cc = canopy.canopyCover;
        this.cnx = g.nx;
        this.cny = g.ny;
        this.cx0 = g.x0;
        this.cy0 = g.y0;
        this.cinv = 1 / g.cellSize;
        this.canopy = true;
      }
    }
  }

  /** Is there a canopy to ride on? */
  get hasCanopy(): boolean {
    return this.canopy;
  }

  /** The crowns count at this zoom: a crown of `gateCrownM` metres would be at least `gatePx` pixels across at the middle of the screen. */
  crownsWanted(): boolean {
    const k = this.k;
    const mpp = this.p[P_MPPC]!;
    return mpp > 0 && k[K_GATE_M]! / mpp >= k[K_GATE_PX]!;
  }

  /** The stroke's plane over the ground at (`io[IO_X]`, `io[IO_Y]`), into `io[IO_ZC]`: `topShare` x canopy height x cover weight (0 without a canopy). Bilinear, clamped to the edge. */
  canopyAt(): void {
    const io = this.io;
    if (!this.canopy) {
      io[IO_ZC] = 0;
      return;
    }
    const k = this.k;
    const mx = this.cnx - 1;
    const my = this.cny - 1;
    let fx = (io[IO_X]! - this.cx0) * this.cinv;
    let fy = (io[IO_Y]! - this.cy0) * this.cinv;
    fx = fx < 0 ? 0 : fx > mx ? mx : fx;
    fy = fy < 0 ? 0 : fy > my ? my : fy;
    let i0 = fx | 0;
    let j0 = fy | 0;
    if (i0 >= mx) i0 = mx - 1;
    if (j0 >= my) j0 = my - 1;
    const tx = fx - i0;
    const ty = fy - j0;
    const q = j0 * this.cnx + i0;
    const nx = this.cnx;
    const h = this.ch;
    const c = this.cc;
    let hh = (h[q]! * (1 - tx) + h[q + 1]! * tx) * (1 - ty) + (h[q + nx]! * (1 - tx) + h[q + nx + 1]! * tx) * ty;
    const cover = (c[q]! * (1 - tx) + c[q + 1]! * tx) * (1 - ty) + (c[q + nx]! * (1 - tx) + c[q + nx + 1]! * tx) * ty;
    if (!(hh > 0)) hh = 0;
    else if (hh > k[K_MAX_H]!) hh = k[K_MAX_H]!;
    let cw = cover / k[K_COVER_FULL]!;
    if (!(cw > 0)) cw = 0;
    else if (cw > 1) cw = 1;
    io[IO_ZC] = k[K_TOP]! * hh * cw;
  }

  // ───────────────────────── the crowns ─────────────────────────

  /** Start choosing the crowns that count out of the placed trees. */
  beginScan(sets: readonly CrownSet[]): void {
    this.sets = sets;
    this.si = 0;
    this.ti = 0;
    this.nCrowns = 0;
    this.nSites = 0;
    this.overflow = 0;
    this.gnx = 0;
    this.gny = 0;
  }

  /**
   * Go on choosing the crowns (the placed trees of `group` up to `maxGroup`): a tree counts when it is on the screen (with the line margin), stands over the
   * stroke by `clearM`, its crown reaches the stroke (the stroke is over its base, under its top) and the disc it shows is at least `minRadiusPx` across on
   * the screen. True when all trees are done, false when the clock ran out (`now() >= deadline`); the cursor is kept. At most `maxCrowns` are kept, in the
   * order of the trees (the bound is the screen: a crown covers 50 px at least, so a screen holds about 700).
   */
  scan(now: () => number, deadline: number, every: number): boolean {
    const k = this.k;
    const v = this.view;
    const p = this.p;
    const io = this.io;
    const sets = this.sets;
    const maxGroup = k[K_MAX_GROUP]!;
    const clear = k[K_CLEAR]!;
    const centre = k[K_CENTRE]!;
    const half = k[K_HALF]!;
    const minPx = k[K_MIN_R_PX]!;
    const proud = k[K_E_PROUD]!;
    const maxCrowns = k[K_MAX_CROWNS]!;
    const pxm1 = p[P_PXM1]!;
    const wmin = p[P_WMIN]!;
    const mxs = p[P_MX]!;
    const mys = p[P_MY]!;
    const zb = p[P_ZBASE]!;
    const vex = p[P_VEX]!;
    const bx0 = p[P_BX0]!;
    const by0 = p[P_BY0]!;
    const bx1 = p[P_BX1]!;
    const by1 = p[P_BY1]!;
    const hMin = zb + clear;
    const cxA = this.cx;
    const cyA = this.cy;
    const crA = this.cr;
    const cfA = this.cf;
    let nc = this.nCrowns;
    let si = this.si;
    let ti = this.ti;
    let check = every;
    while (si < sets.length) {
      const set = sets[si]!;
      if (set.group > maxGroup) {
        si++;
        ti = 0;
        continue;
      }
      const pos = set.position;
      const size = set.size;
      const count = set.count;
      while (ti < count) {
        if (--check <= 0) {
          check = every;
          if (now() >= deadline) {
            this.si = si;
            this.ti = ti;
            this.nCrowns = nc;
            return false;
          }
        }
        const t = ti++;
        const x = pos[3 * t]!;
        const y = pos[3 * t + 1]!;
        if (x < bx0 || x > bx1 || y < by0 || y > by1) continue; // nowhere near the picture's seeds
        const h = size[2 * t]!;
        if (!(h >= hMin)) continue;
        const gz = pos[3 * t + 2]! * vex;
        // On the screen (the tree at half its height; the margin is a whole line long, so a crown's own radius does not matter here).
        const zw = -y;
        const w0 = v[3]! * x + v[7]! * (gz + 0.5 * h) + v[11]! * zw + v[15]!;
        if (!(w0 > wmin)) continue;
        if (Math.abs(v[0]! * x + v[4]! * (gz + 0.5 * h) + v[8]! * zw + v[12]!) > mxs * w0) continue;
        if (Math.abs(v[1]! * x + v[5]! * (gz + 0.5 * h) + v[9]! * zw + v[13]!) > mys * w0) continue;
        // Where the stroke runs over this tree, and what its crown shows there.
        io[IO_X] = x;
        io[IO_Y] = y;
        this.canopyAt();
        const zc = io[IO_ZC]!;
        const zs = zc > zb ? zc : zb;
        if (!(h >= zs + clear)) continue;
        const tt = (zs - centre * h) / (half * h);
        if (!(tt > -1 && tt < 1)) continue;
        const r = 0.5 * size[2 * t + 1]! * Math.sqrt(1 - tt * tt);
        if (!(r * pxm1 >= minPx * w0)) continue; // r px = r x pxm1 / w
        if (nc >= maxCrowns) {
          this.overflow++;
          continue;
        }
        cxA[nc] = x;
        cyA[nc] = y;
        crA[nc] = r;
        cfA[nc] = h - zs >= proud ? 1 : 0;
        nc++;
      }
      si++;
      ti = 0;
    }
    this.si = si;
    this.ti = ti;
    this.nCrowns = nc;
    return true;
  }

  /** Put the crowns in the grid (the cell is at least twice the longest reach, at least `gridM`, and the grid at most 64 x 64). */
  buildGrid(): void {
    const n = this.nCrowns;
    this.gnx = 0;
    this.gny = 0;
    if (n === 0) return;
    const k = this.k;
    const reachF = k[K_REACH]!;
    const cx = this.cx;
    const cy = this.cy;
    const cr = this.cr;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let rmax = 0;
    for (let i = 0; i < n; i++) {
      if (cx[i]! < x0) x0 = cx[i]!;
      if (cx[i]! > x1) x1 = cx[i]!;
      if (cy[i]! < y0) y0 = cy[i]!;
      if (cy[i]! > y1) y1 = cy[i]!;
      if (cr[i]! > rmax) rmax = cr[i]!;
    }
    const reachMax = reachF * rmax;
    const extent = Math.max(x1 - x0, y1 - y0) + 2 * reachMax;
    let cell = Math.max(k[K_GRID_M]!, 2 * reachMax);
    if (extent / cell > GRID_MAX - 2) cell = extent / (GRID_MAX - 2);
    const gx0 = x0 - reachMax - 1e-3;
    const gy0 = y0 - reachMax - 1e-3;
    const inv = 1 / cell;
    const gnx = Math.min(GRID_MAX, Math.floor((x1 + reachMax - gx0) * inv) + 1);
    const gny = Math.min(GRID_MAX, Math.floor((y1 + reachMax - gy0) * inv) + 1);
    this.gx0 = gx0;
    this.gy0 = gy0;
    this.ginv = inv;
    this.gnx = gnx;
    this.gny = gny;
    const heads = this.heads;
    heads.fill(-1, 0, gnx * gny);
    const nodeId = this.nodeId;
    const nodeNext = this.nodeNext;
    let used = 0;
    for (let i = 0; i < n; i++) {
      const reach = reachF * cr[i]!;
      let i0 = Math.floor((cx[i]! - reach - gx0) * inv);
      let i1 = Math.floor((cx[i]! + reach - gx0) * inv);
      let j0 = Math.floor((cy[i]! - reach - gy0) * inv);
      let j1 = Math.floor((cy[i]! + reach - gy0) * inv);
      if (i0 < 0) i0 = 0;
      if (j0 < 0) j0 = 0;
      if (i1 >= gnx) i1 = gnx - 1;
      if (j1 >= gny) j1 = gny - 1;
      for (let j = j0; j <= j1; j++) {
        for (let q = i0; q <= i1; q++) {
          if (used >= POOL) continue;
          const c = j * gnx + q;
          nodeId[used] = i;
          nodeNext[used] = heads[c]!;
          heads[c] = used;
          used++;
        }
      }
    }
  }

  /** The cell of the point (`io[IO_X]`, `io[IO_Y]`), as an index of `heads`, or -1 outside the grid. */
  private cellOfIo(): number {
    const io = this.io;
    const ci = Math.floor((io[IO_X]! - this.gx0) * this.ginv);
    const cj = Math.floor((io[IO_Y]! - this.gy0) * this.ginv);
    if (ci < 0 || cj < 0 || ci >= this.gnx || cj >= this.gny) return -1;
    return cj * this.gnx + ci;
  }

  /** 1 into `io[IO_BLOCK]` when the point (`io[IO_X]`, `io[IO_Y]`) is inside the seed block of a crown (`seedBlock` x its radius), else 0. */
  blocked(): void {
    const io = this.io;
    io[IO_BLOCK] = 0;
    if (this.gnx === 0) return;
    const c = this.cellOfIo();
    if (c < 0) return;
    const x = io[IO_X]!;
    const y = io[IO_Y]!;
    const bf = this.k[K_BLOCK]!;
    for (let nd = this.heads[c]!; nd >= 0; nd = this.nodeNext[nd]!) {
      const i = this.nodeId[nd]!;
      const dx = x - this.cx[i]!;
      const dy = y - this.cy[i]!;
      const rb = bf * this.cr[i]!;
      if (dx * dx + dy * dy < rb * rb) {
        io[IO_BLOCK] = 1;
        return;
      }
    }
  }

  // ───────────────────────── the eddy sites ─────────────────────────

  /** The hash of two whole numbers and a salt into `pv[0]`, a number of [0, 1) (a stateless priority). */
  private priority(a: number, b: number, salt: number): void {
    let h = (Math.imul(a | 0, 0x27d4eb2d) + Math.imul(b | 0, 0x165667b1) + Math.imul(salt | 0, 0x9e3779b1)) >>> 0;
    h ^= h >>> 16;
    h = Math.imul(h, 0x7feb352d);
    h ^= h >>> 15;
    h = Math.imul(h, 0x846ca68b);
    h ^= h >>> 16;
    this.hv[0] = h >>> 0;
    this.pv[0] = this.hv[0]! / U32;
  }

  /** A stateless priority of (x, y) in metres (to an eighth of a metre) for the site kind `salt`: 0 to 1, into `io[IO_K]`. */
  priorityAt(salt: number): void {
    const io = this.io;
    this.priority(Math.floor(io[IO_X]! * 8), Math.floor(io[IO_Y]! * 8), salt);
    io[IO_K] = this.pv[0]!;
  }

  /** Is there room for another site? */
  get siteRoom(): number {
    return this.maxSites - this.nSites;
  }

  /**
   * Add an eddy site: its place (`io[IO_X]`, `io[IO_Y]`), radius `io[IO_R]`, the unit wind there (`io[IO_DX]`, `io[IO_DY]`), strength `io[IO_K]` (0 to 1) and
   * the height of the ground there as world y (`io[IO_Z]`, for the size test). Used only when its core is at least `minCorePx` across on the screen and there
   * is room. 1 into `io[IO_BLOCK]` when it was added, else 0.
   */
  addSite(): void {
    const io = this.io;
    io[IO_BLOCK] = 0;
    const n = this.nSites;
    if (n >= this.maxSites) return;
    const k = this.k;
    const v = this.view;
    const x = io[IO_X]!;
    const y = io[IO_Y]!;
    const r = io[IO_R]!;
    const w = v[3]! * x + v[7]! * io[IO_Z]! + v[11]! * -y + v[15]!;
    if (!(w > this.p[P_WMIN]!)) return;
    if (!(2 * k[K_E_CORE]! * r * this.p[P_PXM1]! >= k[K_E_MIN_PX]! * w)) return;
    this.sx[n] = x;
    this.sy[n] = y;
    this.sr[n] = r;
    this.sdx[n] = io[IO_DX]!;
    this.sdy[n] = io[IO_DY]!;
    this.sk[n] = io[IO_K]!;
    this.nSites = n + 1;
    io[IO_BLOCK] = 1;
  }

  /**
   * The proud crowns that stand free (nothing else within `freeReach` x their radius) and win their stateless priority become eddy sites: for each, `visit(i)`
   * is called with the crown's index (`cx[i]`, `cy[i]`, `cr[i]`) so that the caller can read the wind there and `addSite`. At most `room` of them, the ones
   * with the lowest priorities. Returns how many were offered.
   */
  proudCandidates(out: Int16Array, room: number): number {
    const n = this.nCrowns;
    if (n === 0 || room <= 0) return 0;
    const k = this.k;
    const io = this.io;
    const freeF = k[K_E_FREE]!;
    let keep = k[K_E_KEEP]!;
    // Candidates under the priority `keep`; when there are more than the room, `keep` comes down until they fit.
    let m = 0;
    for (let pass = 0; pass < 24; pass++) {
      m = 0;
      for (let i = 0; i < n; i++) {
        if (this.cf[i] === 0) continue;
        io[IO_X] = this.cx[i]!;
        io[IO_Y] = this.cy[i]!;
        this.priority(Math.floor(io[IO_X]! * 8), Math.floor(io[IO_Y]! * 8), SALT_PROUD);
        if (this.pv[0]! >= keep) continue;
        if (pass === 0 && !this.free(i, freeF)) {
          this.cf[i] = 2; // proud, but not free: not asked again
          continue;
        }
        if (this.cf[i] === 2) continue;
        if (m < out.length) out[m] = i;
        m++;
      }
      if (m <= room) break;
      keep *= 0.8;
    }
    return Math.min(m, room, out.length);
  }

  /** No other crown within `f` x the radius of crown `i`'s centre (the grid is asked, so a neighbour that is much smaller than `i` may be missed). */
  private free(i: number, f: number): boolean {
    if (this.gnx === 0) return true;
    const io = this.io;
    io[IO_X] = this.cx[i]!;
    io[IO_Y] = this.cy[i]!;
    const c = this.cellOfIo();
    if (c < 0) return true;
    const lim = f * this.cr[i]!;
    for (let nd = this.heads[c]!; nd >= 0; nd = this.nodeNext[nd]!) {
      const j = this.nodeId[nd]!;
      if (j === i) continue;
      const dx = this.cx[j]! - this.cx[i]!;
      const dy = this.cy[j]! - this.cy[i]!;
      if (dx * dx + dy * dy < lim * lim) return false;
    }
    return true;
  }

  // ───────────────────────── the field ─────────────────────────

  /**
   * What the obstacles do to a line at (`io[IO_X]`, `io[IO_Y]`) where the unperturbed wind is the unit vector (`io[IO_DX]`, `io[IO_DY]`): the perturbation to add
   * to that vector into `io[IO_PX]`, `io[IO_PY]`, how near the point is to an obstacle (0 to 1: 1 from `1 / PIN_GAIN` of the way in, 0 at `pinReach` radii) into `io[IO_NEAR]`, and 1 into
   * `io[IO_HIT]` when it is inside a crown's rim (`rim` x its radius). With `io[IO_MODE]` 1 only the rim test is made (the end of a step).
   */
  perturb(): void {
    const io = this.io;
    const k = this.k;
    const x = io[IO_X]!;
    const y = io[IO_Y]!;
    const dx = io[IO_DX]!;
    const dy = io[IO_DY]!;
    const rimOnly = io[IO_MODE]! !== 0;
    let px = 0;
    let py = 0;
    let near = 0;
    let hit = 0;
    if (this.gnx > 0) {
      const c = this.cellOfIo();
      if (c >= 0) {
        const reachF = k[K_REACH]!;
        const soft = k[K_SOFT]!;
        const rimF = k[K_RIM]!;
        const pinF = k[K_PIN_REACH]!;
        const cx = this.cx;
        const cy = this.cy;
        const cr = this.cr;
        for (let nd = this.heads[c]!; nd >= 0; nd = this.nodeNext[nd]!) {
          const i = this.nodeId[nd]!;
          const rx = x - cx[i]!;
          const ry = y - cy[i]!;
          const r = cr[i]!;
          const d2 = rx * rx + ry * ry;
          const rim = rimF * r;
          if (d2 < rim * rim) {
            hit = 1;
            near = 1;
            break;
          }
          if (rimOnly) continue;
          const reach = reachF * r;
          if (d2 >= reach * reach) continue;
          const d = Math.sqrt(d2);
          const pin = PIN_GAIN * (1 - d / (pinF * r));
          if (pin > near) near = pin;
          // The soft doublet in the frame of the wind: `a` along it, `b` across it.
          const a = rx * dx + ry * dy;
          const b = -rx * dy + ry * dx;
          const q = a * a + b * b + soft * soft * r * r;
          const s = (r * r) / (q * q);
          let fade = 1 - d2 / (reach * reach);
          fade *= fade;
          const ua = -s * (a * a - b * b) * fade;
          const ub = -2 * s * a * b * fade;
          px += ua * dx - ub * dy;
          py += ua * dy + ub * dx;
        }
      }
    }
    if (!rimOnly && this.nSites > 0) {
      const kappa = k[K_E_KAPPA]!;
      const down = k[K_E_DOWN]!;
      const lat = k[K_E_LAT]!;
      const core = k[K_E_CORE]!;
      const reachF = k[K_E_REACH]!;
      const fadeF = k[K_E_FADE]!;
      const pinF = k[K_PIN_REACH]!;
      const outer = down + lat; // a vortex is at most this far (in radii) from its site, and its reach adds
      for (let j = 0; j < this.nSites; j++) {
        const r = this.sr[j]!;
        const sdx = this.sx[j]! - x;
        const sdy = this.sy[j]! - y;
        const far = (outer + reachF) * r;
        if (sdx * sdx + sdy * sdy > far * far) continue;
        const ex = this.sdx[j]!;
        const ey = this.sdy[j]!;
        const ks = kappa * this.sk[j]!;
        const a = core * r;
        const reach = reachF * r;
        const fadeFrom = fadeF * a;
        for (let side = -1; side <= 1; side += 2) {
          // The upper vortex (to the left of the wind, side 1) turns clockwise, the lower anticlockwise.
          const vx = this.sx[j]! + (down * ex - side * lat * ey) * r;
          const vy = this.sy[j]! + (down * ey + side * lat * ex) * r;
          const rx = x - vx;
          const ry = y - vy;
          const rv2 = rx * rx + ry * ry;
          if (rv2 >= reach * reach) continue;
          const rv = Math.sqrt(rv2);
          const pin = PIN_GAIN * (1 - rv / (pinF * r));
          if (pin > near) near = pin;
          if (rv < 1e-6) continue;
          let t = rv < a ? (ks * rv) / a : (ks * a) / rv;
          if (rv > fadeFrom) {
            const f = 1 - (rv - fadeFrom) / (reach - fadeFrom);
            t *= f * f;
          }
          // Anticlockwise (side -1) is (-ry, rx); clockwise (side 1) is (ry, -rx).
          const m = (-side * t) / rv;
          px += m * -ry;
          py += m * rx;
        }
      }
    }
    io[IO_PX] = px;
    io[IO_PY] = py;
    io[IO_NEAR] = near > 0 ? (near > 1 ? 1 : near) : 0;
    io[IO_HIT] = hit;
  }

  /** The depth of the pin: the factor the shader multiplies a line's meander by is `1 - pinDepth x near`, never under `pinMin` (1 free, `pinMin` near an obstacle). */
  get pinDepth(): number {
    return this.k[K_PIN_DEPTH]!;
  }

  get pinMin(): number {
    return this.k[K_PIN_MIN]!;
  }
}
