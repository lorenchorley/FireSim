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
 * A line never ends at a crown and never runs over one: a step that would end inside the circle of `rim` x r slides along it instead (`slide`: a head-on
 * line takes the side its tiny lateral offset says, and goes on along the circle until the wind carries it off), and a seed inside the circle is moved onto
 * it (`relocate`), so that the lines a crown covers are not lost (0.7.0, the verifier's third finding: seeds dropped inside crowns and lines ended at
 * their rims took a third of the picture in a forest, and left whole stands bare).
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
/**
 * The most crowns, eddy sites and grid cells the scratch holds, whatever `DETAIL_RELIEF` says. The bound is the screen only loosely: a disc of the least size
 * (4 px of radius) covers 50 px, so a 412 x 891 view could hold thousands (the contract's "about 700" was wrong: a ridge seen from 300 m held 2,529). When more
 * than `maxCrowns` qualify the smallest on the screen are left out, everywhere and not in one place (`scan`); the room above `maxCrowns` (1,536) is for the hash
 * sample of the one bucket of radii that only some of fit, whose count is the share asked for within its spread.
 */
export const MAX_CROWNS_CAP = 2048;
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
/** In to `slide`: where the step started. */
export const IO_FX = 7;
export const IO_FY = 8;
/** Out of `canopyAt`: the height (m over the ground) of the stroke's plane. */
export const IO_ZC = 9;
/** In to `addSite`: the site's radius (m), its strength (1 is the whole), its height (world y of the ground there, for the size test). */
export const IO_R = 10;
export const IO_K = 11;
export const IO_Z = 12;
/** Out of `relocate` and `slide`: 1 when the point was moved, else 0 (and out of `addSite`: 1 when the site was added). */
export const IO_BLOCK = 13;
/** In to `canopyAt`: the drawn height (world y) of the ground under the point, for the plane's cap under the eye. */
export const IO_G = 14;
/** In to `leave`: how far (m) one try goes (`io[IO_FX]`, `io[IO_FY]` is where from, `io[IO_DX]`, `io[IO_DY]` the heading). */
const IO_L = 15;
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
const K_RING = 13;
/** The least radius (px) a crown must have on the screen in this pass of the scan: `minRadiusPx`, or, in the second pass, the floor of the bucket that only some of fit. */
const K_MIN_NOW = 14;
const K_PIN_REACH = 15;
const K_E_DOWN = 16;
const K_E_LAT = 17;
const K_E_CORE = 18;
const K_E_KAPPA = 19;
const K_E_REACH = 20;
const K_E_FADE = 21;
const K_E_MIN_PX = 22;
const K_E_KEEP = 24;
/** The second pass keeps every crown of at least this radius (px), and those between `K_MIN_NOW` and it with the probability `K_PKEEP`. */
const K_FLOOR_HI = 23;
const K_PKEEP = 31;
const K_E_PROUD = 25;
const K_E_FREE = 26;
const K_GATE_M = 27;
const K_GATE_PX = 28;
const K_CLOCK = 29;
const K_FADE = 30;
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
/** The eye (world axes: x east, y up, z south) for the trees faded out under a steep view; 0, 0, 0 (unset) is no fade. */
export const P_EX = 11;
export const P_EY = 12;
export const P_EZ = 13;
/** The highest the canopy plane may be over the ground (m); 0 is no cap. */
export const P_ZCAP = 14;
/** The share of the eye's height over the ground under a point that the plane may rise to there (`DetailRelief.canopy.eyeShare`); 0 is no cap. */
export const P_ESHARE = 15;

const SALT_PROUD = 0x51a1;
const SALT_CROWN = 0x3c70;
/** The radii (px) of the crowns that qualify are counted in `HIST_PER_OCTAVE` buckets to an octave from `minRadiusPx` up, to choose the floor when there are too many. */
const HIST_PER_OCTAVE = 4;
const HIST_BINS = 64;
/**
 * How much faster than linear the nearness (the pin's depth) rises toward an obstacle: 1 at `1 / PIN_GAIN` of the way in from `pinReach` radii. The shader's
 * low octave of meander carries a whole line sideways by several metres at the closest zoom (20 m x 0.44), more than a crown's radius, so a line that was bent
 * round a crown must be nearly still within about one and a half radii of it (looked at on the real picture: with a linear pin the lines run through the crowns).
 */
export const PIN_GAIN = 2;
/** The least share of a step that a line sliding along a crown's circle advances along it (a line that meets the crown head-on has none of its heading along the circle). */
export const SLIDE_MIN = 0.6;
/** A point put on a crown's circle is on it to the rounding of a Float32 position: inside is under this share of the circle's radius. */
const ON_RIM = 0.9999;
/** The directions tried, in this order, from the heading, when a point has to leave a lens of crowns: straight on, then 35 degrees either side, 70 and 105 (cosine, sine, of the anticlockwise one, then the clockwise one). */
const LEAVE_COS = new Float64Array([1, 0.819152, 0.819152, 0.34202, 0.34202, -0.258819, -0.258819]);
const LEAVE_SIN = new Float64Array([0, 0.573576, -0.573576, 0.939693, -0.939693, 0.965926, -0.965926]);
/** How far (in steps of the length asked) it tries in each direction. */
const LEAVE_REACH = new Float64Array([1, 1.7, 2.6]);
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

/**
 * The stroke's plane over the ground at (`x`, `y`) for a canopy: what `Obstacles.canopyAt` gives (`topShare` x canopy height x cover weight; bilinear, clamped
 * to the grid's edge), as a plain function for the layer, which needs it once a frame at the middle of the screen (to keep the lines as far apart on the
 * screen as they were when they ran along the ground: a stroke on the canopy is nearer the eye, so its lattice looks coarser). 0 for a grid that is no use.
 */
export function canopyPlane(fuel: FuelMap, x: number, y: number, canopy: DetailRelief['canopy'], cap = 0): number {
  const g: GridSpec = fuel.grid;
  const n = g.nx * g.ny;
  if (!(g.nx >= 2 && g.ny >= 2 && g.cellSize > 0 && fuel.canopyHeight.length >= n && fuel.canopyCover.length >= n)) return 0;
  const mx = g.nx - 1;
  const my = g.ny - 1;
  let fx = (x - g.x0) / g.cellSize;
  let fy = (y - g.y0) / g.cellSize;
  fx = fx < 0 ? 0 : fx > mx ? mx : fx;
  fy = fy < 0 ? 0 : fy > my ? my : fy;
  let i0 = fx | 0;
  let j0 = fy | 0;
  if (i0 >= mx) i0 = mx - 1;
  if (j0 >= my) j0 = my - 1;
  const tx = fx - i0;
  const ty = fy - j0;
  const q = j0 * g.nx + i0;
  const nx = g.nx;
  const h = fuel.canopyHeight;
  const c = fuel.canopyCover;
  let hh = (h[q]! * (1 - tx) + h[q + 1]! * tx) * (1 - ty) + (h[q + nx]! * (1 - tx) + h[q + nx + 1]! * tx) * ty;
  const cover = (c[q]! * (1 - tx) + c[q + 1]! * tx) * (1 - ty) + (c[q + nx]! * (1 - tx) + c[q + nx + 1]! * tx) * ty;
  if (!(hh > 0)) hh = 0;
  else if (hh > canopy.maxHeightM) hh = canopy.maxHeightM;
  let cw = cover / canopy.coverFull;
  if (!(cw > 0)) cw = 0;
  else if (cw > 1) cw = 1;
  const zc = canopy.topShare * hh * cw;
  return cap > 0 && zc > cap ? cap : zc;
}

export class Obstacles {
  readonly io = new Float64Array(IO_LEN);
  /** Projection x view of the picture, column-major (what the builder holds). */
  readonly view = new Float64Array(16);
  /** The picture's numbers: pixels a metre covers at distance 1, the smallest clip w, the screen bounds (NDC, with the margin), the base lift (m), the exaggeration, the m a pixel at the middle, the box of the seeds (grown). */
  readonly p = new Float64Array(16);
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
  /** How many crowns qualified and were left out because more than `maxCrowns` did, the smallest on the screen (0: every crown that counts is here). */
  overflow = 0;
  /** The scan's pass (0 counts and keeps the first `maxCrowns`; 1 keeps the largest on the screen when more qualified), how many qualified, and their radii by bucket. */
  private pass = 0;
  private total = 0;
  private readonly hist = new Int32Array(HIST_BINS);
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
    k[K_RING] = w.ringPx;
    k[K_PIN_REACH] = w.pinReach;
    k[K_E_DOWN] = e.downwind;
    k[K_E_LAT] = e.lateral;
    k[K_E_CORE] = e.core;
    k[K_E_KAPPA] = e.kappa;
    k[K_E_REACH] = e.reach;
    k[K_E_FADE] = e.fadeFromCores;
    k[K_E_MIN_PX] = e.minCorePx;
    this.maxSites = Math.min(MAX_SITES_CAP, e.maxEddies);
    k[K_E_KEEP] = e.keep;
    k[K_E_PROUD] = e.proudM;
    k[K_E_FREE] = e.freeReach;
    k[K_GATE_M] = w.gateCrownM;
    k[K_GATE_PX] = w.gatePx;
    k[K_CLOCK] = w.clockEvery;
    k[K_FADE] = w.fadeSin;
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

  /** The radius (px) from which every crown that qualifies is kept, after a scan: `minRadiusPx`, or the floor of the second pass when more than `maxCrowns` qualified. */
  get keptFromPx(): number {
    return this.pass === 1 ? this.k[K_FLOOR_HI]! : this.k[K_MIN_NOW]!;
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
    let zc = k[K_TOP]! * hh * cw;
    const cap = this.p[P_ZCAP]!;
    if (cap > 0 && zc > cap) zc = cap;
    // Under the eye as well as at the middle of the screen: over ground that rises toward the camera (a hillside) the plane would otherwise reach the eye.
    const share = this.p[P_ESHARE]!;
    if (share > 0) {
      const room = share * (this.p[P_EY]! - io[IO_G]!);
      if (zc > room) zc = room > 0 ? room : 0;
    }
    io[IO_ZC] = zc;
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
    this.pass = 0;
    this.total = 0;
    this.hist.fill(0);
    this.k[K_MIN_NOW] = this.k[K_MIN_R_PX]!;
    this.k[K_FLOOR_HI] = 0;
    this.k[K_PKEEP] = 0;
    this.gnx = 0;
    this.gny = 0;
  }

  /**
   * Go on choosing the crowns (the placed trees of `group` up to `maxGroup`): a tree counts when it is on the screen (with the line margin), stands over the
   * stroke by `clearM`, its crown reaches the stroke (the stroke is over its base, under its top) and the disc it shows is at least `minRadiusPx` across on
   * the screen. True when all trees are done, false when the clock ran out (`now() >= deadline`); the cursor is kept. At most `maxCrowns` are kept. The first
   * pass keeps what qualifies in the order of the trees and counts every one of them by its radius on the screen; when more than `maxCrowns` qualified, a second
   * pass keeps the largest on the screen instead: every crown above the bucket where the count passes `maxCrowns`, and of that bucket (by a hash of the tree's
   * place, so no part of the picture is favoured) as many as fit. (Keeping the first `maxCrowns` in the order of the trees left a spatial part of the picture
   * bending round none: 1,505 of 2,529 crowns lost in a view of a ridge.) The work is two passes over the trees at the most, whatever there is.
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
    let pass = this.pass;
    let minPx = k[K_MIN_NOW]!;
    let floorHi = k[K_FLOOR_HI]!;
    let pKeep = k[K_PKEEP]!;
    const minR = k[K_MIN_R_PX]!;
    const hist = this.hist;
    let total = this.total;
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
    const ex = p[P_EX]!;
    const ey = p[P_EY]!;
    const ez = p[P_EZ]!;
    const fade2 = k[K_FADE]! * k[K_FADE]!;
    const hMin = zb + clear;
    const cxA = this.cx;
    const cyA = this.cy;
    const crA = this.cr;
    const cfA = this.cf;
    let nc = this.nCrowns;
    let si = this.si;
    let ti = this.ti;
    let check = every;
    scanning: while (si < sets.length) {
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
            this.total = total;
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
        // Not a tree that the view has faded out: the ray from its foot to the eye is steeper than `fadeSin` (a camera over it looking steeply down).
        const ddy = ey - gz;
        if (ddy > 0) {
          const ddx = ex - x;
          const ddz = ez + y;
          if (ddy * ddy > fade2 * (ddx * ddx + ddy * ddy + ddz * ddz)) continue;
        }
        // On the screen (the tree at half its height; the margin is a whole line long, so a crown's own radius does not matter here).
        const zw = -y;
        const w0 = v[3]! * x + v[7]! * (gz + 0.5 * h) + v[11]! * zw + v[15]!;
        if (!(w0 > wmin)) continue;
        if (Math.abs(v[0]! * x + v[4]! * (gz + 0.5 * h) + v[8]! * zw + v[12]!) > mxs * w0) continue;
        if (Math.abs(v[1]! * x + v[5]! * (gz + 0.5 * h) + v[9]! * zw + v[13]!) > mys * w0) continue;
        // Where the stroke runs over this tree, and what its crown shows there.
        io[IO_X] = x;
        io[IO_Y] = y;
        io[IO_G] = gz;
        this.canopyAt();
        const zc = io[IO_ZC]!;
        const zs = zc > zb ? zc : zb;
        if (!(h >= zs + clear)) continue;
        const tt = (zs - centre * h) / (half * h);
        if (!(tt > -1 && tt < 1)) continue;
        const r = 0.5 * size[2 * t + 1]! * Math.sqrt(1 - tt * tt);
        const rpx = (r * pxm1) / w0; // the radius on the screen (px)
        if (!(rpx >= minPx)) continue;
        if (pass === 0) {
          // Count it by its radius, and keep the first `maxCrowns` (all of them, when that is enough).
          let bin = Math.floor(HIST_PER_OCTAVE * Math.log2(rpx / minR));
          bin = bin < 0 ? 0 : bin >= HIST_BINS ? HIST_BINS - 1 : bin;
          hist[bin] = hist[bin]! + 1;
          total++;
          if (nc >= maxCrowns) continue;
        } else if (rpx < floorHi) {
          // The bucket that only some of fit: a hash of the tree's place says which (so the count is the cap within the sample's spread, and the room is there for it).
          this.priority(Math.floor(x * 8), Math.floor(y * 8), SALT_CROWN);
          if (!(this.pv[0]! < pKeep)) continue;
        }
        if (nc >= (pass === 0 ? maxCrowns : MAX_CROWNS_CAP)) continue;
        cxA[nc] = x;
        cyA[nc] = y;
        crA[nc] = r;
        cfA[nc] = h - zs >= proud ? 1 : 0;
        nc++;
      }
      si++;
      ti = 0;
      if (si >= sets.length && pass === 0 && total > maxCrowns) {
        // Too many qualified: the floor is where the count of the larger ones passes `maxCrowns`; look at every tree again for the largest.
        let kept = 0;
        let bin = HIST_BINS - 1;
        while (bin > 0 && kept + hist[bin]! <= maxCrowns) kept += hist[bin--]!;
        k[K_MIN_NOW] = minR * 2 ** (bin / HIST_PER_OCTAVE); // (the bucket's own floor)
        k[K_FLOOR_HI] = minR * 2 ** ((bin + 1) / HIST_PER_OCTAVE);
        k[K_PKEEP] = hist[bin]! > 0 ? (maxCrowns - kept) / hist[bin]! : 0;
        this.pass = pass = 1;
        minPx = k[K_MIN_NOW]!;
        floorHi = k[K_FLOOR_HI]!;
        pKeep = k[K_PKEEP]!;
        nc = 0;
        si = 0;
        ti = 0;
        continue scanning;
      }
    }
    this.si = si;
    this.ti = ti;
    this.nCrowns = nc;
    this.total = total;
    this.overflow = pass === 1 ? total - nc : 0;
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

  /**
   * A seed at (`io[IO_X]`, `io[IO_Y]`) that is inside the circle of a crown (`rim` x its radius) is moved onto the circle, straight out from the crown's
   * middle (to the west when it is at the middle): 1 into `io[IO_BLOCK]`, the crown's radius into `io[IO_R]` and the new place into
   * `io[IO_X]`, `io[IO_Y]`; else 0 and nothing changes. Up to three crowns are asked in turn (a place on one circle may be inside the next); a seed that
   * is left inside a circle after them (in a lens of crowns that overlap) goes to the nearest place round about that is outside them all (`leave`), and one
   * that has none is not drawn: 2 into `io[IO_BLOCK]`.
   */
  relocate(): void {
    const io = this.io;
    io[IO_BLOCK] = 0;
    if (this.gnx === 0) return;
    const rimF = this.k[K_RIM]!;
    for (let pass = 0; pass < 3; pass++) {
      const c = this.cellOfIo();
      if (c < 0) return;
      const x = io[IO_X]!;
      const y = io[IO_Y]!;
      // The crown the point is deepest in (relative to its circle) moves it: the same whatever the order the crowns are held in.
      let best = -1;
      let deepest = 1;
      for (let nd = this.heads[c]!; nd >= 0; nd = this.nodeNext[nd]!) {
        const i = this.nodeId[nd]!;
        const rx = x - this.cx[i]!;
        const ry = y - this.cy[i]!;
        const rim = rimF * ON_RIM * this.cr[i]!; // (a point put on a circle is outside it: no second turn of the same push)
        const depth = (rx * rx + ry * ry) / (rim * rim);
        if (depth < deepest || (depth === deepest && best >= 0 && this.cx[i]! < this.cx[best]!)) {
          deepest = depth;
          best = i;
        }
      }
      if (best < 0) return;
      const rx = x - this.cx[best]!;
      const ry = y - this.cy[best]!;
      const rim = rimF * this.cr[best]!;
      const d = Math.sqrt(rx * rx + ry * ry);
      // (At the middle there is no outward: west.)
      io[IO_X] = this.cx[best]! + (d > 1e-6 ? rx / d : -1) * rim;
      io[IO_Y] = this.cy[best]! + (d > 1e-6 ? ry / d : 0) * rim;
      io[IO_R] = this.cr[best]!;
      io[IO_BLOCK] = 1;
    }
    // Still inside a circle after three crowns: the seed is in a lens of crowns that overlap, with no way out by moving off one of them: look for one round about.
    if (this.insideAny()) {
      const x = io[IO_X]!;
      const y = io[IO_Y]!;
      io[IO_FX] = x;
      io[IO_FY] = y;
      io[IO_DX] = -1;
      io[IO_DY] = 0;
      io[IO_L] = 0.5 * this.k[K_RIM]! * io[IO_R]!;
      if (!this.leave()) {
        io[IO_X] = x;
        io[IO_Y] = y;
        io[IO_BLOCK] = 2;
      }
    }
  }

  /**
   * From (`io[IO_FX]`, `io[IO_FY]`) go `io[IO_L]` metres, then a little more, along the heading (`io[IO_DX]`, `io[IO_DY]`) turned by 0, 35, 70 and 105 degrees
   * either side, and take the first place that is outside every circle: the way out of a lens of crowns that overlap, which no push away from one crown finds.
   * True with the place in `io[IO_X]`, `io[IO_Y]`; false when every one is inside a circle, a place nothing flows out of (the point is then left at the last one tried).
   */
  private leave(): boolean {
    const io = this.io;
    const ox = io[IO_FX]!;
    const oy = io[IO_FY]!;
    const hx = io[IO_DX]!;
    const hy = io[IO_DY]!;
    for (let reach = 0; reach < LEAVE_REACH.length; reach++) {
      const l = io[IO_L]! * LEAVE_REACH[reach]!;
      for (let t = 0; t < LEAVE_COS.length; t++) {
        const c = LEAVE_COS[t]!;
        const s = LEAVE_SIN[t]!;
        io[IO_X] = ox + l * (hx * c - hy * s);
        io[IO_Y] = oy + l * (hx * s + hy * c);
        if (!this.insideAny()) return true;
      }
    }
    return false;
  }

  /** True when the point (`io[IO_X]`, `io[IO_Y]`) is inside the circle (`rim` x radius) of a crown. */
  private insideAny(): boolean {
    const io = this.io;
    const c = this.cellOfIo();
    if (c < 0) return false;
    const x = io[IO_X]!;
    const y = io[IO_Y]!;
    const rimF = this.k[K_RIM]! * ON_RIM;
    for (let nd = this.heads[c]!; nd >= 0; nd = this.nodeNext[nd]!) {
      const i = this.nodeId[nd]!;
      const rim = rimF * this.cr[i]!;
      const rx = x - this.cx[i]!;
      const ry = y - this.cy[i]!;
      if (rx * rx + ry * ry < rim * rim) return true;
    }
    return false;
  }

  /**
   * The end of a step, (`io[IO_X]`, `io[IO_Y]`), for a line that left (`io[IO_FX]`, `io[IO_FY]`) along the unit heading (`io[IO_DX]`, `io[IO_DY]`): when it is
   * inside the circle of a crown (`rim` x its radius) the line slides along the circle instead, from the angle it started at, to the side its heading
   * points (the side of a head-on line is the one its tiny lateral offset says), by the step's length times how much of the heading is along the circle,
   * but at least `SLIDE_MIN` of it so that a line that meets a crown head-on still gets round. 1 into `io[IO_BLOCK]` and the new end into `io[IO_X]`,
   * `io[IO_Y]` when it moved; else 0. Two crowns at most: a line that is still inside a circle after them (in a lens of crowns that overlap) takes a step
   * of its length from where it was, in the nearest direction to its heading that ends outside them all (`leave`); one with none (it is shut in) ends:
   * 2 into `io[IO_BLOCK]`, and the end is left where it was.
   */
  slide(): void {
    const io = this.io;
    io[IO_BLOCK] = 0;
    if (this.gnx === 0) return;
    const rimF = this.k[K_RIM]!;
    const fx = io[IO_FX]!;
    const fy = io[IO_FY]!;
    const dx = io[IO_DX]!;
    const dy = io[IO_DY]!;
    let step = Math.sqrt((io[IO_X]! - fx) * (io[IO_X]! - fx) + (io[IO_Y]! - fy) * (io[IO_Y]! - fy));
    for (let pass = 0; pass < 2; pass++) {
      const c = this.cellOfIo();
      if (c < 0) return;
      const x = io[IO_X]!;
      const y = io[IO_Y]!;
      let best = -1;
      let deepest = 1;
      for (let nd = this.heads[c]!; nd >= 0; nd = this.nodeNext[nd]!) {
        const i = this.nodeId[nd]!;
        const rim = rimF * ON_RIM * this.cr[i]!;
        const ex = x - this.cx[i]!;
        const ey = y - this.cy[i]!;
        const depth = (ex * ex + ey * ey) / (rim * rim);
        if (depth < deepest || (depth === deepest && best >= 0 && this.cx[i]! < this.cx[best]!)) {
          deepest = depth;
          best = i;
        }
      }
      if (best < 0) return;
      const rim = rimF * this.cr[best]!;
      // Where the line stood, as an angle about the crown (at the middle, the angle of the step's end).
      let px = fx - this.cx[best]!;
      let py = fy - this.cy[best]!;
      let pl = Math.sqrt(px * px + py * py);
      if (pl < 1e-6) {
        px = x - this.cx[best]!;
        py = y - this.cy[best]!;
        pl = Math.sqrt(px * px + py * py);
      }
      if (pl < 1e-6) {
        px = -dx;
        py = -dy;
        pl = 1;
      }
      px /= pl;
      py /= pl;
      const along = px * dy - py * dx; // the heading along the circle, anticlockwise when positive
      const side = along >= 0 ? 1 : -1;
      const advance = (step * Math.max(Math.abs(along), SLIDE_MIN)) / rim;
      const a = Math.atan2(py, px) + side * advance;
      io[IO_X] = this.cx[best]! + rim * Math.cos(a);
      io[IO_Y] = this.cy[best]! + rim * Math.sin(a);
      io[IO_BLOCK] = 1;
      step = Math.sqrt((io[IO_X]! - fx) * (io[IO_X]! - fx) + (io[IO_Y]! - fy) * (io[IO_Y]! - fy));
    }
    if (this.insideAny()) {
      const x = io[IO_X]!;
      const y = io[IO_Y]!;
      io[IO_FX] = fx;
      io[IO_FY] = fy;
      io[IO_DX] = dx;
      io[IO_DY] = dy;
      io[IO_L] = step > 1e-6 ? step : 1e-6;
      if (this.leave()) io[IO_BLOCK] = 1;
      else {
        io[IO_X] = x;
        io[IO_Y] = y;
        io[IO_BLOCK] = 2;
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
   * to that vector into `io[IO_PX]`, `io[IO_PY]`, and how near the point is to an obstacle (0 to 1: 1 from `1 / PIN_GAIN` of the way in, 0 at `pinReach` radii) into `io[IO_NEAR]`.
   */
  perturb(): void {
    const io = this.io;
    const k = this.k;
    const x = io[IO_X]!;
    const y = io[IO_Y]!;
    const dx = io[IO_DX]!;
    const dy = io[IO_DY]!;
    let px = 0;
    let py = 0;
    let near = 0;
    if (this.gnx > 0) {
      const c = this.cellOfIo();
      if (c >= 0) {
        const reachF = k[K_REACH]!;
        const soft = k[K_SOFT]!;
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
    if (this.nSites > 0) {
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
  }

}
