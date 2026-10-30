/**
 * The detailed wind streaks' builder (0.6.0, lane D-engine): what the most detailed level draws instead of the long flow lines. Pure:
 * no Three.js, no DOM, no `Math.random`. Same input and seed, same bytes; time never enters (the animation is the shader's, a pure
 * function of the view's clock).
 *
 * It is a fork of the glyph builder's seeding (`flowGlyphs.ts`), with a lattice that nests so that the picture does not pop when the zoom
 * crosses an octave (0.6.0, the verifier's second finding): the world points of a finest lattice of `lod.spacingM` = 2^j metres, and of every
 * coarser one of 2^(j+1), 2^(j+2) ... metres, which is a quarter as many and a subset of it. A point has one identity, the coarsest lattice
 * that holds it (its `birth` level a) and its indices there, and everything about it (where it is, whether it is thinned, its life, its place
 * in the caps) is an integer hash of that identity, so it is the same point at every zoom and after a pan. Its place is its lattice point
 * moved by up to `jitter` lattice spacings of its own level. The picture keeps every point born at a coarser level than j, and of those born
 * at j a share `thin` (by a hash priority): `thin` runs from 1/4 (the points of the next coarser lattice and no more) to 1 (the whole of
 * this lattice) as the zoom goes through an octave, so the number of lines follows the zoom continuously, and where the finest lattice
 * changes the picture is the same on both sides. Seeds are kept when their projection lies on the screen plus a margin in front of the near
 * plane, thinned toward the horizon of an orbit view, thinned to the caps by a second hash. What differs from the glyphs is the
 * line. A line runs downwind from its seed in `n = clamp(ceil(L / 9), 8, 24)` equal steps (RK2 midpoint on the unit direction field),
 * `L = clamp(16 px per m/s x speed, 90, 220)` px long, and each segment says where it sits along the line so that the shader can run
 * a pulse along it: `d = (s0, s1, L, seed)` in pixels, `e = (speed, turb, lift, tail)`. The five ingredients of the picture
 * (contract 3.1) are the shader's work on these numbers:
 *  - tapered fading tails: `tail` px of fade behind a head that travels the line (`pulseIntensity` is the formula);
 *  - random lifetimes: `seed` (0 to 1, a hash of the lattice cell and the input seed) sets each line's cycle, phase and dead gap;
 *  - gust bands: a brightness envelope along the flow, from `speed` and the position;
 *  - eddy noise that gains octaves as you zoom: its amplitude is `turb`, the 10 m ground's roughness and lee, bounded by the shader;
 *  - lift and lee: `lift` (the along-flow slope times the speed, -1 to 1) raises a segment up to 3 m, already baked into the y of `a`
 *    and `b`, and brightens it a little in the shader.
 * `turb` and `lift` come from `ground10` (the 10 m ground as received), about 30 reads a line, and fade with the height the wind is
 * read at (`DetailInput.heightM`, 10 m when absent): a 300 m wind does not care about the shape of the ground below. Without
 * `ground10`, `turb` is 0.5 and `lift` 0.
 *
 * A calm seed (under 0.3 m/s) draws nothing. A line that meets a wall steeper than `GLYPH_MAX_SLOPE` is cut at its foot or lip (a
 * line that starts on a wall is not drawn), one that falls under three segments is not drawn, and one with a vertex under 1.5 near
 * planes is dropped whole. How many lines fit the caps is worked out before tracing (the segments a line takes follow from the
 * wind at its seed), so the thinning is by hash over the whole screen and not by the order of the lattice.
 *
 * Cost, as in the glyph builder: the tracer reads rasters only, hash and lookups go through scratch arrays and no double travels
 * through an argument or a return value, state lives in typed arrays, so a rebuild allocates nothing even when V8 does not inline.
 * The job is cut into slices that stop on the clock and resume.
 *
 * The relief (0.7.0, `DetailInput.relief`; absent, or `enabled` false, is the picture above byte for byte): the lines ride on the canopy's top where
 * there is canopy (`canopy`), slide along the contour of a windward slope (a ridge) and part round the tree crowns that stand in their way and curl
 * behind the proud ones, a ridge's lee and the plume (`detailObstacles.ts`). All of it bends the DIRECTION of the traced line, a step at a time and at
 * most `maxTurnDeg`; the speed (the colour bin, the pulse's pace) is the model's, as before. A seed inside a crown's disc is not drawn (`out.blocked`),
 * a line that meets a crown's rim ends there, and each line carries a pin in its colour alpha (1 free, down to `pinMin` at an obstacle) that the shader
 * multiplies the meander by, so that the noise does not carry a line off the crown it was bent round.
 */
import {
  buildSpeedTable,
  GLYPH_CALM_MS,
  GLYPH_DENSITY_S2_MAX,
  GLYPH_LIFT_MIN_M,
  GLYPH_LIFT_PX,
  GLYPH_MAX_CELLS,
  GLYPH_MAX_SLOPE,
  GLYPH_NEAR_FACTOR,
  GLYPH_SCREEN_MARGIN,
  SPEED_TABLE_BINS,
  SPEED_TABLE_MAX_MS,
} from './flowGlyphs';
import { IO_BLOCK, IO_DX, IO_DY, IO_HIT, IO_K, IO_MODE, IO_NEAR, IO_PX, IO_PY, IO_R, IO_X, IO_Y, IO_Z, IO_ZC, MAX_SITES_CAP, Obstacles, P_BX0, P_BX1, P_BY0, P_BY1, P_MPPC, P_MX, P_MY, P_PXM1, P_VEX, P_WMIN, P_ZBASE } from './detailObstacles';
import { DETAIL_GEOMETRY, GLYPH_CAPS, type DetailBuilder, type DetailInput, type DetailOutput, type GlyphTier, type GroundRaster } from './glyphTypes';

/**
 * How bright a point `s` px along a line is when the pulse's head is at `head` px and its tail is `tail` px long: 1 at the head, falling
 * linearly to 0 a tail's length behind it, 0 ahead of it. The vertex shader's `pulse` written in TypeScript (the shader test pins the two
 * to each other at the same points).
 */
export function pulseIntensity(s: number, head: number, tail: number): number {
  if (!(s <= head)) return 0;
  if (!(tail > 0)) return 1;
  const v = 1 - (head - s) / tail;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// The rules of the glyph builder and the contract's geometry, copied once into constants of this module. A number that stays an imported
// binding is, where the modules are transformed one by one (the tests), a property read of an object, which V8 cannot fold into the
// code: a conditional that mixes it with a computed number then boxes the computed one, a heap number a call.
const CALM_MS = GLYPH_CALM_MS;
const DENSITY_S2_MAX = GLYPH_DENSITY_S2_MAX;
const LIFT_MIN_M = GLYPH_LIFT_MIN_M;
const LIFT_PX = GLYPH_LIFT_PX;
const MAX_SLOPE = GLYPH_MAX_SLOPE;
const NEAR_FACTOR = GLYPH_NEAR_FACTOR;
const SCREEN_MARGIN = GLYPH_SCREEN_MARGIN;
const MAX_CELLS = GLYPH_MAX_CELLS;
const SPEED_BINS = SPEED_TABLE_BINS;
const STEP_PX = DETAIL_GEOMETRY.stepPx;
const MIN_SEG = DETAIL_GEOMETRY.minSegments;
const MAX_SEG = DETAIL_GEOMETRY.maxSegments;
const MIN_LINE_SEG = 3;
// The numbers of `DETAIL_TAIL` and `DETAIL_TERRAIN` below (the exported tables are built from these, so that the two cannot differ).
const TAIL_PX_PER_MS = 6;
const TAIL_BASE_PX = 20;
const TAIL_MIN_PX = 24;
const TAIL_MAX_PX = 90;
const T_STEP_M = 10;
const T_ROUGH_M = 3;
const T_SLOPE_REACH_M = 30;
const T_LEE_SLOPE = 0.35;
const T_TURB_BASE = 0.25;
const T_NO_GROUND_TURB = 0.5;
const T_LIFT_MS = 3;
const T_LIFT_M = 3;
const T_MIN_ABOVE_M = 0.5;
const T_BASE_HEIGHT_M = 10;
const T_HEIGHT_SCALE_M = 300;

/** The fading tail of a line's pulse, in screen px: `6 px per m/s of speed + 20`, from 24 to 90 (longer when faster). */
export const DETAIL_TAIL = { pxPerMs: TAIL_PX_PER_MS, basePx: TAIL_BASE_PX, minPx: TAIL_MIN_PX, maxPx: TAIL_MAX_PX } as const;
/** A line of fewer segments than this (the raster's edge, a calm patch or a wall cut it) is not drawn. */
export const DETAIL_MIN_LINE_SEGMENTS = MIN_LINE_SEG;
/**
 * What the 10 m ground says about a line, first guesses to be tuned on a phone. The roughness is the spread of the heights in a 5 x 5
 * patch of `patchStepM` about their best plane (a plain slope is not rough), over `roughM`; the slope is read along the flow
 * `slopeReachM` either side of the seed; the lee is a fall along the flow, over `leeSlope`; `turb = turbBase + 0.5 (rough + lee) g` and
 * `lift = speed x slope x g / liftMs`, with `g = exp(-(height - baseHeightM) / heightScaleM)` above `baseHeightM`; a line is drawn up to
 * `liftM` higher at `lift` 1, and sinks the same in the lee, but never nearer the ground than `minAboveM`.
 */
export const DETAIL_TERRAIN = {
  patchStepM: T_STEP_M,
  roughM: T_ROUGH_M,
  slopeReachM: T_SLOPE_REACH_M,
  leeSlope: T_LEE_SLOPE,
  turbBase: T_TURB_BASE,
  noGroundTurb: T_NO_GROUND_TURB,
  liftMs: T_LIFT_MS,
  liftM: T_LIFT_M,
  minAboveM: T_MIN_ABOVE_M,
  baseHeightM: T_BASE_HEIGHT_M,
  heightScaleM: T_HEIGHT_SCALE_M,
} as const;

/** How much of the ground terms is left at a wind height (m above the ground): 1 at 10 m, 0.38 at 300 m, 0.04 at 1,000 m. */
export function detailGroundFactor(heightM: number): number {
  return heightM > DETAIL_TERRAIN.baseHeightM ? Math.exp(-(heightM - DETAIL_TERRAIN.baseHeightM) / DETAIL_TERRAIN.heightScaleM) : 1;
}

/** A vertex is drawn under the glyph's halo (a few px of it): seeds this much further out than the longest line still count. */
const REACH_EXTRA_PX = 3;
/** Keep this share of the segment cap when thinning to it, so the hard stop is rarely reached. */
const CAP_KEEP = 0.95;
const BIN_SCALE = (SPEED_TABLE_BINS - 1) / SPEED_TABLE_MAX_MS;
const U32 = 4294967296;
/** The hash of a seed is cut in this many buckets (the top 8 bits) to find the share of seeds that fits the caps. */
const BUCKETS = 256;
const BUCKET_SIZE = U32 / BUCKETS;

// Salts of the integer hash (`hash3` of render/fields.ts, written out below). A point is hashed by its identity (its indices at its birth
// level and that level), so each kind of hash has a range of salts, one for each level (`level + 16`, the level held to -16 to 48): the
// jitter one (32 to 161, as the glyph builder's lattice has it), the orbit density, the caps, the thinning priority and, far from
// them, the life salt.
const SALT_JITTER = 32;
const SALT_ORBIT = 512;
const SALT_CAP = 640;
const SALT_PRIO = 768;
const SALT_LIFE = 977;
const LEVEL_MIN = -16;
const LEVEL_MAX = 48;
/** The coarser lattices walked after the finest one: 2^0 to 2^PASSES times its spacing. The points born beyond are 4^-PASSES of the picture. */
const PASSES = 12;
/** A point born this many levels above the lattice that holds it counts as born there (the origin, which is on every lattice, is the only one that gets near). */
const MAX_REDUCE = 24;
/** The level `a` as the offset of its salts (0 to 64): the level held to -16 to 48, plus 16. */
const levelIndex = (a: number): number => (a < LEVEL_MIN ? LEVEL_MIN : a > LEVEL_MAX ? LEVEL_MAX : a) + 16;
/** 2^k as a double, for the spacing of a lattice k levels above the finest. */
const POW2 = new Float64Array(PASSES + MAX_REDUCE + 2).map((_, k) => 2 ** k);

const SPEED_TABLE = buildSpeedTable();

// Float state (f) and integer state (n) of the job. Typed arrays, so that no field of the builder holds a boxed number.
const F_PXM1 = 0;
const F_WMIN = 1;
const F_VEX = 2;
const F_S = 3;
const F_JIT = 4;
const F_LMIN = 5;
const F_LMAX = 6;
const F_PXMS = 7;
const F_MPPC = 8;
const F_RX0 = 9;
const F_RY0 = 10;
const F_RX1 = 11;
const F_RY1 = 12;
const F_RINV = 13;
const F_GX0 = 14;
const F_GY0 = 15;
const F_GINV = 16;
const F_MX = 17;
const F_MY = 18;
const F_MXT = 19;
const F_MYT = 20;
const F_TAU = 21;
const F_PKEEP = 22;
const F_DEADLINE = 23;
const F_BUDGET = 24;
const F_EX = 25;
const F_EY = 26;
const F_EZ = 27;
const F_AK = 28;
const F_HFX = 29;
const F_HFZ = 30;
const F_TX0 = 31;
const F_TY0 = 32;
const F_TINV = 33;
const F_GFAC = 34;
const F_BX0 = 35;
const F_BY0 = 36;
const F_BX1 = 37;
const F_BY1 = 38;
const F_PRIO = 39;
const F_RBETA = 40;
const F_RLO = 41;
const F_RHI = 42;
const F_RFWD = 43;
const F_COSCAP = 44;
const F_SINCAP = 45;
const F_PIN = 46;
const F_PINMIN = 47;
const F_LEN = 48;

const N_BUSY = 0;
const N_PHASE = 1;
const N_RNX = 2;
const N_RNY = 3;
const N_GNX = 4;
const N_GNY = 5;
const N_TNX = 6;
const N_TNY = 7;
const N_HAS10 = 8;
const N_I0 = 9;
const N_I1 = 10;
const N_J1 = 11;
const N_CI = 12;
const N_CJ = 13;
const N_LEVEL = 14;
const N_LIFE = 15;
const N_OUTER = 16;
const N_NSTORE = 17;
const N_MAXSTORE = 18;
const N_TI = 19;
const N_LINES = 20;
const N_SEG = 21;
const N_DROPPED = 22;
const N_CALM = 23;
const N_STEEP = 24;
const N_CAPG = 25;
const N_CAPS = 26;
const N_REBUILDS = 27;
const N_INTERVAL = 28;
const N_PASS = 29;
const N_RELIEF = 30;
const N_RIDGE = 31;
const N_CANOPY = 32;
const N_OBST = 33;
const N_BLOCKED = 34;
const N_LEN = 36;

// Phases of a job: set-up pending, walking the lattice, about to trace, tracing, done.
const PHASE_SETUP = 3;
const PHASE_CROWNS = 5;
const PHASE_WALK = 0;
const PHASE_TRACE_START = 4;
const PHASE_TRACE = 1;
const PHASE_DONE = 2;

/**
 * Lattice cells between two reads of the clock while walking the lattice, and lines between two reads while tracing. A builder is interpreted
 * for its first rebuilds (a cold line costs 0.3 ms, a warm one 3 us): the first `COLD_REBUILDS` read the clock after every 64 cells and every
 * line, the next two after 256 cells and 4 lines, the rest after 2048 and 16 (0.7.0: a cold slice used to run up to 5 ms over its budget).
 */
const CELL_CHECK = 2048;
const CELL_CHECK_WARMING = 256;
const CELL_CHECK_COLD = 64;
const COLD_REBUILDS = 2;
const WARMING_REBUILDS = 4;
const LINE_CHECK = 16;
const LINE_CHECK_WARMING = 4;
const LINE_CHECK_COLD = 1;
/** A wind high above the ground does not care about its ridges: under this share of the ground terms the ridge slide is off. */
const RELIEF_MIN_GFAC = 0.02;
/** The lee sites' lattice is at most this many cells a side, and its points are moved by up to this share of a spacing. */
const LEE_WINDOW = 22;
const LEE_JITTER = 0.35;
const RIDGE_SITES = 12;
const LEE_GFAC_MIN = 0.2;
const SALT_LEE = 0x1ee5;
const NO_CROWNS: readonly never[] = [];
/** The widest reach of a crown (3 radii of a crown of 8 m), added to the box of the trees the scan looks at. */
const REACH_CROWN_M = 24;
/** Trees between two reads of the clock while choosing the crowns (the contract's 4,096 when warm). */
const CROWN_CHECK_COLD = 256;
const CROWN_CHECK_WARMING = 1024;

class Builder implements DetailBuilder {
  readonly out: DetailOutput;
  private input: DetailInput | null = null;
  private readonly f = new Float64Array(F_LEN);
  private readonly n = new Int32Array(N_LEN);
  /** Projection x view, column-major (THREE's `Matrix4.elements`). */
  private readonly vp = new Float64Array(16);
  /**
   * Scratch: 0 x, 1 y, 2 drawn ground, 3 metres per pixel, 4 line length (px), 5 u, 6 v, 7 speed, 8..13 the segment being written,
   * 14 s0, 15 s1, 16 L, 17 seed, 18 speed, 19 turb, 20 lift, 21 tail (the rest of the segment), 22 x, 23 y of a 10 m ground read, 24 its height;
   * of the relief: 26, 27 the heading of the line (unit), 28 how near an obstacle it has been (0 to 1), 29 the base lift (m), 30 the metres over it
   * that the canopy asks for at the last vertex.
   */
  private readonly s = new Float64Array(36);
  private readonly hv = new Uint32Array(1);
  /** The stored seeds' identities, three ints each: the indices at the birth level, then the level. */
  private readonly cand: Int32Array;
  private readonly candH: Uint32Array;
  /** The segments a stored seed's line takes at most (8 to 24; calm seeds are not stored). */
  private readonly candN: Uint8Array;
  private readonly histS = new Int32Array(BUCKETS);
  private readonly histC = new Int32Array(BUCKETS);
  private readonly capLines: number;
  private readonly capSegments: number;
  private fu: Float32Array = new Float32Array(0);
  private fv: Float32Array = new Float32Array(0);
  private gz: Float32Array = new Float32Array(0);
  private tz: Float32Array = new Float32Array(0);
  private readonly A: Float32Array;
  private readonly B: Float32Array;
  private readonly C: Float32Array;
  private readonly D: Float32Array;
  private readonly E: Float32Array;
  /** The relief's obstacles and the scratch of the eddy sites chosen from the proud crowns. */
  private readonly ob = new Obstacles();
  private readonly siteIdx = new Int16Array(MAX_SITES_CAP);

  constructor(caps: { glyphs: number; segments: number }) {
    this.capSegments = caps.segments;
    // Every line takes at least `MIN_SEG` segments: no more lines than that fit the segments.
    this.capLines = Math.min(caps.glyphs, Math.floor(caps.segments / MIN_SEG));
    this.A = new Float32Array(3 * caps.segments);
    this.B = new Float32Array(3 * caps.segments);
    this.C = new Float32Array(4 * caps.segments);
    this.D = new Float32Array(4 * caps.segments);
    this.E = new Float32Array(4 * caps.segments);
    this.out = { a: this.A, b: this.B, c: this.C, d: this.D, e: this.E, lines: 0, segments: 0, dropped: 0, calm: 0, steep: 0, blocked: 0 };
    const store = 3 * this.capLines + 16;
    this.cand = new Int32Array(3 * store);
    this.candH = new Uint32Array(store);
    this.candN = new Uint8Array(store);
  }

  get busy(): boolean {
    return this.n[N_BUSY] !== 0;
  }

  cancel(): void {
    this.n[N_BUSY] = 0;
    this.n[N_PHASE] = PHASE_DONE;
    this.input = null;
  }

  begin(input: DetailInput): void {
    const n = this.n;
    const out = this.out;
    this.input = input;
    n[N_REBUILDS] = n[N_REBUILDS]! + 1;
    n[N_BUSY] = 0;
    n[N_PHASE] = PHASE_DONE;
    n[N_NSTORE] = 0;
    n[N_TI] = 0;
    n[N_LINES] = 0;
    n[N_SEG] = 0;
    n[N_DROPPED] = 0;
    n[N_CALM] = 0;
    n[N_STEEP] = 0;
    n[N_BLOCKED] = 0;
    n[N_RELIEF] = 0;
    n[N_RIDGE] = 0;
    n[N_CANOPY] = 0;
    n[N_OBST] = 0;
    out.lines = 0;
    out.segments = 0;
    out.dropped = 0;
    out.calm = 0;
    out.steep = 0;
    out.blocked = 0;
    // Is there anything to draw? Comparisons and whole numbers only (see the glyph builder: this function runs a few times a second, so
    // V8 never optimises it, and in the interpreter every number made by arithmetic is a heap number: the arithmetic is in `walk`).
    const lod = input.lod;
    const field = input.field;
    const fg = field.grid;
    const gg = input.ground.grid;
    if (lod.level === 0 || !(lod.spacingM > 0) || !(lod.spacingPx > 0)) return;
    if (fg.nx < 2 || fg.ny < 2 || gg.nx < 2 || gg.ny < 2 || !(fg.cellSize > 0) || !(gg.cellSize > 0)) return;
    if (field.u.length < fg.nx * fg.ny || field.v.length < fg.nx * fg.ny || input.ground.elevation.length < gg.nx * gg.ny) return;
    if (!(input.cssW > 0) || !(input.cssH > 0) || !(input.pxPerMetre1 > 0)) return;
    const capG = Math.min(input.cap.glyphs | 0, this.capLines);
    const capS = Math.min(input.cap.segments | 0, this.capSegments);
    if (capG < 1 || capS < MIN_LINE_SEG) return;
    this.fu = field.u;
    this.fv = field.v;
    this.gz = input.ground.elevation;
    // The 10 m ground is optional at run time: a missing or ill-formed raster gives lines with no terrain terms.
    const g10 = input.ground10 as GroundRaster | undefined;
    const tg = g10 ? g10.grid : null;
    n[N_HAS10] = tg && tg.nx >= 2 && tg.ny >= 2 && tg.cellSize > 0 && g10!.elevation.length >= tg.nx * tg.ny ? 1 : 0;
    if (n[N_HAS10] !== 0) {
      this.tz = g10!.elevation;
      n[N_TNX] = tg!.nx;
      n[N_TNY] = tg!.ny;
    }
    n[N_RNX] = fg.nx;
    n[N_RNY] = fg.ny;
    n[N_GNX] = gg.nx;
    n[N_GNY] = gg.ny;
    n[N_CAPG] = capG;
    n[N_CAPS] = capS;
    n[N_MAXSTORE] = Math.min(3 * capG + 16, this.candH.length);
    n[N_LEVEL] = Math.max(LEVEL_MIN, Math.min(LEVEL_MAX, lod.spacingExp | 0));
    const relief = input.relief;
    n[N_RELIEF] = relief !== undefined && relief.enabled ? 1 : 0;
    n[N_PHASE] = PHASE_SETUP;
    n[N_BUSY] = 1;
  }

  step(budgetMs: number): boolean {
    const n = this.n;
    if (n[N_BUSY] === 0) return true;
    const f = this.f;
    f[F_BUDGET] = budgetMs;
    f[F_DEADLINE] = this.input!.now() + budgetMs;
    if (n[N_PHASE] === PHASE_SETUP || n[N_PHASE] === PHASE_CROWNS || n[N_PHASE] === PHASE_WALK) {
      if (!this.walk()) return false;
      n[N_PHASE] = PHASE_TRACE_START;
    }
    if (!this.trace()) return false;
    n[N_BUSY] = 0;
    n[N_PHASE] = PHASE_DONE;
    return true;
  }

  /** Hash of three integers into `hv[0]`: `hash3` of render/fields.ts (lowbias32), without a returned number. */
  private hash(a: number, b: number, c: number): void {
    let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1)) >>> 0;
    h ^= h >>> 16;
    h = Math.imul(h, 0x7feb352d);
    h ^= h >>> 15;
    h = Math.imul(h, 0x846ca68b);
    h ^= h >>> 16;
    this.hv[0] = h >>> 0;
  }

  /**
   * Hash of three integers into `hv[0]` that does not collide for cells a few apart: `hash` combines its three with xor, and the products
   * of nearby cells cancel under it (cells 2 apart in x and 10 in y share a hash about one time in eight); the sum of products
   * collides only for cells 65,000 apart, then the same finishing mix. For the life of a line, where two lines with the same life would show.
   */
  private hashSum(a: number, b: number, c: number): void {
    let h = (Math.imul(a | 0, 0x27d4eb2d) + Math.imul(b | 0, 0x165667b1) + Math.imul(c | 0, 0x9e3779b1)) >>> 0;
    h ^= h >>> 16;
    h = Math.imul(h, 0x7feb352d);
    h ^= h >>> 15;
    h = Math.imul(h, 0x846ca68b);
    h ^= h >>> 16;
    this.hv[0] = h >>> 0;
  }

  /** The drawn ground (bilinear, clamped to its edge) under (s0, s1) into s2: the arithmetic of `HeightField.heightAt`. */
  private groundAt(): void {
    const f = this.f;
    const s = this.s;
    const gnx = this.n[N_GNX]!;
    const mx = gnx - 1;
    const my = this.n[N_GNY]! - 1;
    const inv = f[F_GINV]!;
    let fx = (s[0]! - f[F_GX0]!) * inv;
    let fy = (s[1]! - f[F_GY0]!) * inv;
    fx = Math.max(0, Math.min(mx, fx));
    fy = Math.max(0, Math.min(my, fy));
    let i0 = fx | 0;
    let j0 = fy | 0;
    if (i0 >= mx) i0 = mx - 1;
    if (j0 >= my) j0 = my - 1;
    const tx = fx - i0;
    const ty = fy - j0;
    const e = this.gz;
    const k = j0 * gnx + i0;
    s[2] = (e[k]! * (1 - tx) + e[k + 1]! * tx) * (1 - ty) + (e[k + gnx]! * (1 - tx) + e[k + gnx + 1]! * tx) * ty;
  }

  /** The 10 m ground (bilinear, clamped to its edge) under (s22, s23) into s24. */
  private ground10At(): void {
    const f = this.f;
    const s = this.s;
    const tnx = this.n[N_TNX]!;
    const mx = tnx - 1;
    const my = this.n[N_TNY]! - 1;
    const inv = f[F_TINV]!;
    let fx = (s[22]! - f[F_TX0]!) * inv;
    let fy = (s[23]! - f[F_TY0]!) * inv;
    fx = Math.max(0, Math.min(mx, fx));
    fy = Math.max(0, Math.min(my, fy));
    let i0 = fx | 0;
    let j0 = fy | 0;
    if (i0 >= mx) i0 = mx - 1;
    if (j0 >= my) j0 = my - 1;
    const tx = fx - i0;
    const ty = fy - j0;
    const e = this.tz;
    const k = j0 * tnx + i0;
    s[24] = (e[k]! * (1 - tx) + e[k + 1]! * tx) * (1 - ty) + (e[k + tnx]! * (1 - tx) + e[k + tnx + 1]! * tx) * ty;
  }

  /** The wind raster (bilinear, clamped to its edge) at (s0, s1) into s5 (u) and s6 (v). */
  private sampleField(): void {
    const f = this.f;
    const s = this.s;
    const nx = this.n[N_RNX]!;
    const mx = nx - 1;
    const my = this.n[N_RNY]! - 1;
    const inv = f[F_RINV]!;
    let fx = (s[0]! - f[F_RX0]!) * inv;
    let fy = (s[1]! - f[F_RY0]!) * inv;
    fx = Math.max(0, Math.min(mx, fx));
    fy = Math.max(0, Math.min(my, fy));
    let i0 = fx | 0;
    let j0 = fy | 0;
    if (i0 >= mx) i0 = mx - 1;
    if (j0 >= my) j0 = my - 1;
    const tx = fx - i0;
    const ty = fy - j0;
    const k = j0 * nx + i0;
    const u = this.fu;
    const v = this.fv;
    s[5] = (u[k]! * (1 - tx) + u[k + 1]! * tx) * (1 - ty) + (u[k + nx]! * (1 - tx) + u[k + nx + 1]! * tx) * ty;
    s[6] = (v[k]! * (1 - tx) + v[k + 1]! * tx) * (1 - ty) + (v[k + nx]! * (1 - tx) + v[k + nx + 1]! * tx) * ty;
  }

  /**
   * What the wind in (s5, s6) makes of a line: its speed into s7 and its length in px into s4, and the number of steps it takes
   * (`clamp(ceil(L / 9), 8, 24)`), 0 when the wind is calm (under 0.3 m/s: no dot, no line).
   */
  private shape(): number {
    const f = this.f;
    const s = this.s;
    const u = s[5]!;
    const v = s[6]!;
    const sp = Math.sqrt(u * u + v * v);
    s[7] = sp;
    if (!(sp >= CALM_MS)) return 0;
    let lenPx = f[F_PXMS]! * sp;
    const lmin = f[F_LMIN]!;
    const lmax = f[F_LMAX]!;
    if (lenPx < lmin) lenPx = lmin;
    else if (lenPx > lmax) lenPx = lmax;
    s[4] = lenPx;
    let steps = Math.ceil(lenPx / STEP_PX);
    if (steps < MIN_SEG) steps = MIN_SEG;
    else if (steps > MAX_SEG) steps = MAX_SEG;
    return steps | 0;
  }

  /**
   * Is the point of identity (ia, ja) born at level `a` a seed? 1 or 0. On 1 the seed is left in the scratch: s0, s1 its position, s2 the
   * ground under it, s3 its metres per pixel, and `N_OUTER` says whether it lies outside the screen's own margin (inside the wide one only a
   * line that runs onto the screen keeps it: see `reaches`). The point is its lattice point (indices x 2^a metres) moved by up to `jitter`
   * spacings of that lattice by the hash of its identity. The tests, in the order of their cost: inside the raster's domain; clip depth
   * beyond the near plane; on the screen plus margin; the orbit density.
   */
  private candidate(ia: number, ja: number, a: number): number {
    const f = this.f;
    const s = this.s;
    const vp = this.vp;
    const jit = f[F_JIT]!;
    const level = this.n[N_LEVEL]!;
    const sa = f[F_S]! * POW2[a - level]!; // the spacing of the lattice the point was born on (metres)
    const lv = levelIndex(a);
    let px: number;
    let py: number;
    if (jit > 0) {
      const salt = SALT_JITTER + 2 * lv;
      this.hash(ia, ja, salt);
      const hx = this.hv[0]! / U32;
      this.hash(ia, ja, salt + 1);
      const hy = this.hv[0]! / U32;
      px = (ia + jit * (hx - 0.5) * 2) * sa;
      py = (ja + jit * (hy - 0.5) * 2) * sa;
    } else {
      px = ia * sa;
      py = ja * sa;
    }
    if (px < f[F_RX0]! || px > f[F_RX1]! || py < f[F_RY0]! || py > f[F_RY1]!) return 0;
    s[0] = px;
    s[1] = py;
    this.groundAt();
    const yw = s[2]! * f[F_VEX]!;
    const zw = -py;
    const w = vp[3]! * px + vp[7]! * yw + vp[11]! * zw + vp[15]!;
    if (!(w > f[F_WMIN]!)) return 0;
    const cx = Math.abs(vp[0]! * px + vp[4]! * yw + vp[8]! * zw + vp[12]!);
    const cy = Math.abs(vp[1]! * px + vp[5]! * yw + vp[9]! * zw + vp[13]!);
    if (cx > f[F_MX]! * w || cy > f[F_MY]! * w) return 0;
    const outer = cx > f[F_MXT]! * w || cy > f[F_MYT]! * w ? 1 : 0; // a whole number: nothing but this lives on across the hash below
    const mpp = w / f[F_PXM1]!;
    // Orbit density: the ground area one pixel covers here against the middle of the screen, as in the glyph builder.
    const dy = f[F_EY]! - yw;
    let ahead = (px - f[F_EX]!) * f[F_HFX]! + (zw - f[F_EZ]!) * f[F_HFZ]!;
    if (ahead < 0) ahead = 0;
    const slant = Math.sqrt(dy * dy + ahead * ahead);
    let s2 = dy > 0.02 * slant ? mpp * mpp * (slant / dy) * f[F_AK]! : DENSITY_S2_MAX;
    if (s2 > DENSITY_S2_MAX) s2 = DENSITY_S2_MAX;
    if (s2 > 1) {
      this.hash(ia, ja, SALT_ORBIT + lv);
      if ((this.hv[0]! / U32) * s2 >= 1) return 0;
    }
    s[3] = mpp;
    this.n[N_OUTER] = outer;
    return 1;
  }

  /**
   * A seed outside the screen's own margin (the wind is in s5, s6, its line length in s4, the seed in s0, s1): does its line run onto
   * the screen? The line is taken straight, and its middle and its end are projected at the seed's drawn height plus the ground
   * under them. 1 or 0. (Without it every seed within a line length of the screen is traced, and most of those lines never show.)
   */
  private reaches(): number {
    const f = this.f;
    const s = this.s;
    const vp = this.vp;
    const vex = f[F_VEX]!;
    const wmin = f[F_WMIN]!;
    const x0 = s[0]!;
    const y0 = s[1]!;
    const reachM = s[4]! * s[3]!;
    const kx = (s[5]! / s[7]!) * reachM;
    const ky = (s[6]! / s[7]!) * reachM;
    const lift = Math.max(LIFT_MIN_M, LIFT_PX * s[3]!);
    for (let t = 1; t <= 2; t++) {
      const x = x0 + 0.5 * t * kx;
      const y = y0 + 0.5 * t * ky;
      s[0] = x;
      s[1] = y;
      this.groundAt();
      const yw = (s[2]! + lift) * vex;
      const zw = -y;
      const w = vp[3]! * x + vp[7]! * yw + vp[11]! * zw + vp[15]!;
      if (!(w > wmin)) continue;
      const cx = Math.abs(vp[0]! * x + vp[4]! * yw + vp[8]! * zw + vp[12]!);
      const cy = Math.abs(vp[1]! * x + vp[5]! * yw + vp[9]! * zw + vp[13]!);
      if (cx <= f[F_MXT]! * w && cy <= f[F_MYT]! * w) return 1;
    }
    return 0;
  }

  /**
   * Keep a seed for the trace phase: when its cap hash is under the threshold (which halves when the store is full), its wind is not
   * calm and, outside the screen's margin, its line reaches the screen. The wind at the seed gives the segments the line takes at most.
   */
  private store(ia: number, ja: number, a: number): void {
    const n = this.n;
    const f = this.f;
    this.hash(ia, ja, SALT_CAP + levelIndex(a));
    const h = this.hv[0]!;
    let tau = f[F_TAU]!;
    if (h >= tau) return;
    this.sampleField();
    const steps = this.shape();
    if (steps === 0) {
      n[N_CALM] = n[N_CALM]! + 1;
      return;
    }
    if (n[N_OBST] !== 0) {
      // A seed inside a crown's disc is not drawn (the seed is still in s0, s1: `reaches` moves them).
      const io = this.ob.io;
      io[IO_X] = this.s[0]!;
      io[IO_Y] = this.s[1]!;
      this.ob.blocked();
      if (io[IO_BLOCK] !== 0) {
        n[N_BLOCKED] = n[N_BLOCKED]! + 1;
        return;
      }
    }
    if (n[N_OUTER] !== 0 && this.reaches() === 0) return;
    let ns = n[N_NSTORE]!;
    const max = n[N_MAXSTORE]!;
    const cand = this.cand;
    const candH = this.candH;
    const candN = this.candN;
    if (ns >= max) {
      while (ns >= max && tau > 1) {
        tau *= 0.5;
        let w = 0;
        for (let r = 0; r < ns; r++) {
          if (candH[r]! < tau) {
            if (w !== r) {
              cand[3 * w] = cand[3 * r]!;
              cand[3 * w + 1] = cand[3 * r + 1]!;
              cand[3 * w + 2] = cand[3 * r + 2]!;
              candH[w] = candH[r]!;
              candN[w] = candN[r]!;
            }
            w++;
          }
        }
        ns = w;
      }
      f[F_TAU] = tau;
      if (h >= tau) {
        n[N_NSTORE] = ns;
        return;
      }
    }
    cand[3 * ns] = ia;
    cand[3 * ns + 1] = ja;
    cand[3 * ns + 2] = a;
    candH[ns] = h;
    candN[ns] = steps;
    n[N_NSTORE] = ns + 1;
  }

  /**
   * Walk the lattice cells of the box; true when done, false when the slice ran out of time (the cursor is kept). The first call of a
   * rebuild first copies the input into the typed state (what `begin` leaves for it: see there).
   */
  private walk(): boolean {
    const n = this.n;
    const f = this.f;
    const input = this.input!;
    if (n[N_PHASE] === PHASE_SETUP) {
      const lod = input.lod;
      const fg = input.field.grid;
      const gg = input.ground.grid;
      const S = lod.spacingM;
      const vp = input.viewProj;
      for (let k = 0; k < 16; k++) this.vp[k] = vp[k]!;
      // The raster's domain: lines stop at its edge.
      const rx0 = fg.x0;
      const ry0 = fg.y0;
      const rx1 = fg.x0 + (fg.nx - 1) * fg.cellSize;
      const ry1 = fg.y0 + (fg.ny - 1) * fg.cellSize;
      f[F_RX0] = rx0;
      f[F_RY0] = ry0;
      f[F_RX1] = rx1;
      f[F_RY1] = ry1;
      f[F_RINV] = 1 / fg.cellSize;
      f[F_GX0] = gg.x0;
      f[F_GY0] = gg.y0;
      f[F_GINV] = 1 / gg.cellSize;
      if (n[N_HAS10] !== 0) {
        const tg = input.ground10.grid;
        f[F_TX0] = tg.x0;
        f[F_TY0] = tg.y0;
        f[F_TINV] = 1 / tg.cellSize;
      }
      const h = input.heightM;
      // (`detailGroundFactor` written out: a double through an argument is a heap number in code V8 does not inline.)
      f[F_GFAC] = h !== undefined && h > T_BASE_HEIGHT_M ? Math.exp(-(h - T_BASE_HEIGHT_M) / T_HEIGHT_SCALE_M) : 1;
      // The life of a line is a hash of its lattice cell and the input seed (whole numbers: a seed of 0 is the app's).
      n[N_LIFE] = (SALT_LIFE + Math.imul(Math.floor(input.seed * 4096) | 0, 0x2545f491)) | 0;
      f[F_PXM1] = input.pxPerMetre1;
      f[F_WMIN] = NEAR_FACTOR * input.near;
      f[F_VEX] = input.vex;
      f[F_S] = S;
      f[F_JIT] = lod.jitter;
      f[F_LMIN] = lod.lengthPx.min;
      f[F_LMAX] = lod.lengthPx.max;
      f[F_PXMS] = lod.lengthPx.pxPerMs;
      f[F_MPPC] = lod.mppCentre !== undefined && lod.mppCentre > 0 ? lod.mppCentre : S / lod.spacingPx;
      // A seed this far outside the screen can still have its line on it: one line length, at least a tenth of the screen. Seeds outside
      // the screen's own margin (a tenth of it) are kept only when their line runs onto the screen.
      const reach = lod.lengthPx.max + REACH_EXTRA_PX;
      f[F_MX] = 1 + (2 * Math.max(SCREEN_MARGIN * input.cssW, reach)) / input.cssW;
      f[F_MY] = 1 + (2 * Math.max(SCREEN_MARGIN * input.cssH, reach)) / input.cssH;
      f[F_MXT] = 1 + 2 * SCREEN_MARGIN;
      f[F_MYT] = 1 + 2 * SCREEN_MARGIN;
      f[F_EX] = input.eye[0]!;
      f[F_EY] = input.eye[1]!;
      f[F_EZ] = input.eye[2]!;
      // Orbit density needs the pitch of the view: see the glyph builder.
      const sinC = Math.max(0.05, -this.vp[7]!);
      f[F_AK] = sinC / (f[F_MPPC]! * f[F_MPPC]!);
      const fh = Math.sqrt(this.vp[3]! * this.vp[3]! + this.vp[11]! * this.vp[11]!);
      f[F_HFX] = fh > 1e-3 ? this.vp[3]! / fh : 0;
      f[F_HFZ] = fh > 1e-3 ? this.vp[11]! / fh : 0;
      f[F_TAU] = U32;
      // The lattice cells to walk: the box inside the raster's domain; a box of more than GLYPH_MAX_CELLS is cut to a square around the camera.
      const box = input.box;
      let bx0 = Math.max(box.x0, rx0);
      let by0 = Math.max(box.y0, ry0);
      let bx1 = Math.min(box.x1, rx1);
      let by1 = Math.min(box.y1, ry1);
      if (((bx1 - bx0) / S + 1) * ((by1 - by0) / S + 1) > MAX_CELLS) {
        const half = 0.5 * S * Math.sqrt(MAX_CELLS);
        let cx = input.eye[0]!;
        let cy = -input.eye[2]!;
        if (!(cx >= bx0 && cx <= bx1 && cy >= by0 && cy <= by1)) {
          cx = 0.5 * (bx0 + bx1);
          cy = 0.5 * (by0 + by1);
        }
        bx0 = Math.max(bx0, cx - half);
        bx1 = Math.min(bx1, cx + half);
        by0 = Math.max(by0, cy - half);
        by1 = Math.min(by1, cy + half);
      }
      f[F_BX0] = bx0;
      f[F_BY0] = by0;
      f[F_BX1] = bx1;
      f[F_BY1] = by1;
      // The share of the finest lattice's own points that the picture keeps: `thin` runs from 1/4 (no points of its own, only the next
      // coarser lattice's) to 1 (all), and `(4 thin - 1) / 3` of them are kept (a hash priority under it). A plan without `thin` keeps all.
      const thin = lod.thin !== undefined && lod.thin < 1 ? Math.max(0, (4 * lod.thin - 1) / 3) : 1;
      f[F_PRIO] = thin * U32;
      if (bx0 <= bx1 && by0 <= by1) this.startPass(0);
      else n[N_PASS] = PASSES + 1; // nothing of the box is inside the raster: no cell to walk
      n[N_PHASE] = PHASE_WALK;
      if (n[N_RELIEF] !== 0) this.reliefSetup();
    }
    if (n[N_PHASE] === PHASE_CROWNS) {
      // The trees that count as crowns are chosen in slices of the clock too, before any seed is looked at.
      const rb = n[N_REBUILDS]!;
      const every = rb <= COLD_REBUILDS ? CROWN_CHECK_COLD : rb <= WARMING_REBUILDS ? CROWN_CHECK_WARMING : this.input!.relief!.crowns.clockEvery | 0;
      if (!this.ob.scan(this.input!.now, f[F_DEADLINE]!, every)) return false;
      this.reliefSites();
      n[N_PHASE] = PHASE_WALK;
    }
    const deadline = f[F_DEADLINE]!;
    const level = n[N_LEVEL]!;
    const rebuilds = n[N_REBUILDS]!;
    const every = rebuilds <= COLD_REBUILDS ? CELL_CHECK_COLD : rebuilds <= WARMING_REBUILDS ? CELL_CHECK_WARMING : CELL_CHECK;
    let check = every;
    let pass = n[N_PASS]!;
    while (pass <= PASSES) {
      const i0 = n[N_I0]!;
      const i1 = n[N_I1]!;
      const j1 = n[N_J1]!;
      let ci = n[N_CI]!;
      let cj = n[N_CJ]!;
      const born = level + pass;
      // The finest lattice keeps only a share of its own points (the ones born on it); the coarser ones keep all of theirs.
      const thinned = pass === 0 && f[F_PRIO]! < U32;
      while (cj <= j1) {
        while (ci <= i1) {
          let ia = ci;
          let ja = cj;
          let a = born;
          let use = 1;
          // A point with both indices even is on the next coarser lattice too, and is that lattice's: skipped here, found by the next pass. The
          // last pass takes them all, and gives each the identity of the coarsest lattice that holds it.
          if (pass < PASSES) {
            if (((ia | ja) & 1) === 0) use = 0;
          } else {
            const k = Math.min(ia === 0 ? MAX_REDUCE : 31 - Math.clz32(ia & -ia), ja === 0 ? MAX_REDUCE : 31 - Math.clz32(ja & -ja), MAX_REDUCE);
            ia >>= k;
            ja >>= k;
            a += k;
          }
          if (use !== 0) {
            if (thinned) {
              this.hash(ia, ja, SALT_PRIO + levelIndex(a));
              if (this.hv[0]! >= f[F_PRIO]!) use = 0;
            }
            if (use !== 0 && this.candidate(ia, ja, a) !== 0) this.store(ia, ja, a);
          }
          ci++;
          if (--check <= 0) {
            check = every;
            if (input.now() >= deadline) {
              n[N_CI] = ci;
              n[N_CJ] = cj;
              n[N_PASS] = pass;
              return false;
            }
          }
        }
        ci = i0;
        cj++;
      }
      pass++;
      if (pass <= PASSES) {
        n[N_PASS] = pass;
        this.startPass(pass);
      }
    }
    n[N_PASS] = pass;
    return true;
  }

  /**
   * The cells of pass `pass` (the lattice `pass` octaves above the finest) to walk, from the box in F_BX0..F_BY1: the points of the lattice that lie
   * inside it, with one more on each side for the jitter (under one spacing), and the cursor at the first of them. The coarse passes are a few cells.
   */
  private startPass(pass: number): void {
    const n = this.n;
    const f = this.f;
    const sa = f[F_S]! * POW2[pass]!;
    n[N_PASS] = pass;
    n[N_I0] = Math.floor(f[F_BX0]! / sa) - 1;
    n[N_I1] = Math.floor(f[F_BX1]! / sa) + 1;
    n[N_J1] = Math.floor(f[F_BY1]! / sa) + 1;
    n[N_CI] = n[N_I0]!;
    n[N_CJ] = Math.floor(f[F_BY0]! / sa) - 1;
  }

  /** Trace the stored seeds in order; true when all are done (or the caps are reached), false when the slice ran out of time. */
  private trace(): boolean {
    const n = this.n;
    const f = this.f;
    const out = this.out;
    const input = this.input!;
    const deadline = f[F_DEADLINE]!;
    const budget = f[F_BUDGET]!;
    const candH = this.candH;
    const ns = n[N_NSTORE]!;
    const capG = n[N_CAPG]!;
    const capS = n[N_CAPS]!;
    const rebuilds = n[N_REBUILDS]!;
    const base = rebuilds <= COLD_REBUILDS ? LINE_CHECK_COLD : rebuilds <= WARMING_REBUILDS ? LINE_CHECK_WARMING : LINE_CHECK;
    if (n[N_PHASE] === PHASE_TRACE_START) {
      // The lattice is walked: decide which of the stored seeds are traced. Each took the segments its wind gives its line, so add them
      // up by the bucket of their hash and keep the buckets, from the lowest, that fit 0.95 of the segment cap and the line cap, and the
      // next one too (the caps stop it where they bind). The share is by hash, so the picture thins evenly over the screen.
      const histS = this.histS;
      const histC = this.histC;
      const candN = this.candN;
      histS.fill(0);
      histC.fill(0);
      for (let r = 0; r < ns; r++) {
        const b = candH[r]! >>> 24;
        histS[b] = histS[b]! + candN[r]!;
        histC[b] = histC[b]! + 1;
      }
      const room = Math.floor(CAP_KEEP * capS);
      let cumS = 0;
      let cumC = 0;
      let last = -1;
      for (let b = 0; b < BUCKETS; b++) {
        if (cumS + histS[b]! > room || cumC + histC[b]! > capG) break;
        cumS += histS[b]!;
        cumC += histC[b]!;
        last = b;
      }
      let p = (last + 2) * BUCKET_SIZE;
      if (p > f[F_TAU]!) p = f[F_TAU]!;
      f[F_PKEEP] = p;
      n[N_TI] = 0;
      n[N_INTERVAL] = base;
      n[N_PHASE] = PHASE_TRACE;
    }
    const pkeep = f[F_PKEEP]!;
    let interval = n[N_INTERVAL]!;
    let left = interval;
    let ti = n[N_TI]!;
    while (ti < ns) {
      const r = ti++;
      if (candH[r]! >= pkeep) continue;
      if (n[N_LINES]! >= capG || n[N_SEG]! + MIN_LINE_SEG > capS) {
        ti = ns; // a cap is reached: the rest is not drawn
        break;
      }
      this.line(r);
      if (--left <= 0) {
        const now = input.now();
        if (now >= deadline) break;
        // Plenty of the slice left: read the clock less often (a clock read allocates its number), but never while the code is cold.
        if (base > LINE_CHECK_COLD && deadline - now > 0.75 * budget && interval < 4 * base) interval *= 2;
        left = interval;
      }
    }
    n[N_TI] = ti;
    n[N_INTERVAL] = interval;
    out.lines = n[N_LINES]!;
    out.segments = n[N_SEG]!;
    out.dropped = n[N_DROPPED]!;
    out.calm = n[N_CALM]!;
    out.steep = n[N_STEEP]!;
    out.blocked = n[N_BLOCKED]!;
    return ti >= ns;
  }

  /** Write the segment held in the scratch (s8..s21) at index `seg` with the colour of speed bin `bin`. */
  private emit(seg: number, bin: number): void {
    const s = this.s;
    const A = this.A;
    const B = this.B;
    const C = this.C;
    const D = this.D;
    const E = this.E;
    const ia = 3 * seg;
    A[ia] = s[8]!;
    A[ia + 1] = s[9]!;
    A[ia + 2] = s[10]!;
    B[ia] = s[11]!;
    B[ia + 1] = s[12]!;
    B[ia + 2] = s[13]!;
    const ib = 3 * bin;
    const ic = 4 * seg;
    C[ic] = SPEED_TABLE[ib]!;
    C[ic + 1] = SPEED_TABLE[ib + 1]!;
    C[ic + 2] = SPEED_TABLE[ib + 2]!;
    C[ic + 3] = 1;
    D[ic] = s[14]!;
    D[ic + 1] = s[15]!;
    D[ic + 2] = s[16]!;
    D[ic + 3] = s[17]!;
    E[ic] = s[18]!;
    E[ic + 1] = s[19]!;
    E[ic + 2] = s[20]!;
    E[ic + 3] = s[21]!;
  }

  /**
   * What the 10 m ground says about the line that starts at (s0, s1) and runs along (s5, s6) at speed s7: `turb` into s19 and `lift`
   * into s20. The roughness is the spread of a 5 x 5 patch about its best plane, the slope is read along the flow either side of the
   * seed, the lee is a fall along it (`DETAIL_TERRAIN`).
   */
  private terrain(): void {
    const s = this.s;
    if (this.n[N_HAS10] === 0) {
      s[19] = T_NO_GROUND_TURB;
      s[20] = 0;
      return;
    }
    const x0 = s[0]!;
    const y0 = s[1]!;
    const step = T_STEP_M;
    s[22] = x0;
    s[23] = y0;
    this.ground10At();
    const z0 = s[24]!;
    // Heights against the middle one; a, b are the patch offsets in steps (-2 to 2): the plane fit of a symmetric patch is a sum each.
    let sz = 0;
    let sz2 = 0;
    let sxz = 0;
    let syz = 0;
    for (let a = -2; a <= 2; a++) {
      for (let b = -2; b <= 2; b++) {
        s[22] = x0 + step * a;
        s[23] = y0 + step * b;
        this.ground10At();
        const dz = s[24]! - z0;
        sz += dz;
        sz2 += dz * dz;
        sxz += a * dz;
        syz += b * dz;
      }
    }
    // Variance of the heights, less what the plane takes: each offset has a variance of 2 steps squared (sum of a squared is 50 of 25).
    const px = sxz / 50;
    const py = syz / 50;
    const mean = sz / 25;
    const v = sz2 / 25 - mean * mean - 2 * (px * px + py * py);
    const rough = v > 0 ? Math.min(1, Math.sqrt(v) / T_ROUGH_M) : 0;
    // The slope along the flow, central over the reach either side.
    const sp = s[7]!;
    const kx = (s[5]! / sp) * T_SLOPE_REACH_M;
    const ky = (s[6]! / sp) * T_SLOPE_REACH_M;
    s[22] = x0 + kx;
    s[23] = y0 + ky;
    this.ground10At();
    const zf = s[24]!;
    s[22] = x0 - kx;
    s[23] = y0 - ky;
    this.ground10At();
    const slope = (zf - s[24]!) / (2 * T_SLOPE_REACH_M);
    let lee = -slope / T_LEE_SLOPE;
    if (lee < 0) lee = 0;
    else if (lee > 1) lee = 1;
    const g = this.f[F_GFAC]!;
    let turb = T_TURB_BASE + 0.5 * (rough + lee) * g;
    if (turb > 1) turb = 1;
    let lift = (sp * slope * g) / T_LIFT_MS;
    if (lift < -1) lift = -1;
    else if (lift > 1) lift = 1;
    s[19] = turb;
    s[20] = lift;
  }

  /**
   * The relief's set-up for this picture (`walk`'s first call, after the typed state is filled): the obstacles' constants, the canopy and the view's numbers,
   * the ridge's constants and the turn cap. With crowns to choose (they are given, and a crown would be big enough on the screen at this zoom) the phase
   * becomes `PHASE_CROWNS`; without, the eddy sites that need no crown (a ridge's lee, the plume) are made at once.
   */
  private reliefSetup(): void {
    const n = this.n;
    const f = this.f;
    const input = this.input!;
    const relief = input.relief!;
    const ob = this.ob;
    ob.configure(relief, input.canopy);
    ob.view.set(this.vp);
    const p = ob.p;
    p[P_PXM1] = input.pxPerMetre1;
    p[P_WMIN] = f[F_WMIN]!;
    p[P_MX] = f[F_MX]!;
    p[P_MY] = f[F_MY]!;
    p[P_ZBASE] = Math.max(LIFT_MIN_M, LIFT_PX * f[F_MPPC]!);
    p[P_VEX] = input.vex;
    p[P_MPPC] = f[F_MPPC]!;
    // A tree that no line from the picture's seeds can reach is passed over: the box of the seeds grown by one and a half line lengths at the middle of the
    // screen (far from the camera a line is longer in metres, but a crown there is small on the screen and does not count) and the widest crown.
    const grow = 1.5 * f[F_LMAX]! * f[F_MPPC]! + REACH_CROWN_M;
    p[P_BX0] = f[F_BX0]! - grow;
    p[P_BY0] = f[F_BY0]! - grow;
    p[P_BX1] = f[F_BX1]! + grow;
    p[P_BY1] = f[F_BY1]! + grow;
    n[N_CANOPY] = ob.hasCanopy ? 1 : 0;
    const rd = relief.ridge;
    const g = f[F_GFAC]!;
    n[N_RIDGE] = n[N_HAS10] !== 0 && rd.beta > 0 && g > RELIEF_MIN_GFAC ? 1 : 0;
    f[F_RBETA] = rd.beta * g; // a wind high above the ground does not care about its ridges
    f[F_RLO] = rd.riseLo;
    f[F_RHI] = rd.riseHi;
    f[F_RFWD] = rd.forwardM;
    const cap = (Math.max(rd.maxTurnDeg, relief.crowns.maxTurnDeg) * Math.PI) / 180;
    f[F_COSCAP] = Math.cos(cap);
    f[F_SINCAP] = Math.sin(cap);
    f[F_PIN] = ob.pinDepth;
    f[F_PINMIN] = ob.pinMin;
    const crowns = input.crowns;
    if (crowns !== undefined && crowns.length > 0 && ob.crownsWanted()) {
      ob.beginScan(crowns);
      n[N_PHASE] = PHASE_CROWNS;
    } else {
      ob.beginScan(NO_CROWNS);
      this.reliefSites();
    }
  }

  /** The unit wind at (s0, s1) into io[IO_DX], io[IO_DY]; false (0) when it is calm. */
  private siteWind(): number {
    const io = this.ob.io;
    this.sampleField();
    const sp = Math.sqrt(this.s[5]! * this.s[5]! + this.s[6]! * this.s[6]!);
    if (!(sp >= CALM_MS)) return 0;
    io[IO_DX] = this.s[5]! / sp;
    io[IO_DY] = this.s[6]! / sp;
    return 1;
  }

  /**
   * The crowns are chosen: put them in the grid and choose the eddy sites. The plume's (at most `plumeSites`, behind the fire's base by the wind there),
   * the ridges' lee (a fixed world lattice of `latticeM`, jittered by a hash of its indices, where the ground falls along the flow, the ground upwind is
   * higher, and a hash priority keeps about half), and the proud crowns that stand free (`Obstacles.proudCandidates`). A site is used only when its core is
   * big enough on the screen (`Obstacles.addSite`). Whole numbers and the scratch only: nothing is allocated.
   */
  private reliefSites(): void {
    const n = this.n;
    const f = this.f;
    const s = this.s;
    const input = this.input!;
    const relief = input.relief!;
    const ob = this.ob;
    const io = ob.io;
    const e = relief.eddies;
    const vex = f[F_VEX]!;
    ob.buildGrid();
    // (c) the plume.
    const plumes = input.plumes;
    if (plumes !== undefined) {
      const np = Math.min(plumes.length, e.plumeSites);
      for (let i = 0; i < np; i++) {
        const q = plumes[i]!;
        s[0] = q.x;
        s[1] = q.y;
        if (this.siteWind() === 0) continue;
        this.groundAt();
        io[IO_X] = q.x;
        io[IO_Y] = q.y;
        io[IO_R] = q.radiusM;
        io[IO_K] = q.strength;
        io[IO_Z] = s[2]! * vex;
        ob.addSite();
      }
    }
    // (b) the lee of a ridge.
    if (n[N_RIDGE] !== 0 && f[F_GFAC]! >= LEE_GFAC_MIN) this.leeSites();
    // (a) the proud crowns that stand free.
    const room = ob.siteRoom;
    if (room > 0 && ob.nCrowns > 0) {
      const m = ob.proudCandidates(this.siteIdx, room);
      for (let c = 0; c < m; c++) {
        const i = this.siteIdx[c]!;
        s[0] = ob.cx[i]!;
        s[1] = ob.cy[i]!;
        if (this.siteWind() === 0) continue;
        this.groundAt();
        io[IO_X] = s[0]!;
        io[IO_Y] = s[1]!;
        io[IO_R] = ob.cr[i]!;
        io[IO_K] = 1;
        io[IO_Z] = s[2]! * vex;
        ob.addSite();
      }
    }
    n[N_OBST] = ob.nCrowns > 0 || ob.nSites > 0 ? 1 : 0;
  }

  /**
   * Sites in the lee of ridges: the lattice points of `latticeM` metres (at most 22 x 22 of them, the ones nearest the eye when the picture holds more),
   * each moved by up to 0.35 of a spacing by a hash of its indices; a point is a site where the 10 m ground falls at least `fallMin` along the flow, the
   * lee factor is at least `leeMin`, the ground `upwindM` upwind is at least `upwindRiseM` higher, and its priority is under `keep`. The radius is
   * `radiusPerDrop` x the drop, held to `radiusMinM` to `radiusMaxM`. At most 12 of them.
   */
  private leeSites(): void {
    const f = this.f;
    const s = this.s;
    const ob = this.ob;
    const io = ob.io;
    const e = this.input!.relief!.eddies;
    const lat = e.latticeM;
    const reach = T_SLOPE_REACH_M;
    const vex = f[F_VEX]!;
    // The lattice cells of the picture's box, cut to a window of `LEE_WINDOW` cells a side around the eye when it is bigger.
    let i0 = Math.floor(f[F_BX0]! / lat);
    let i1 = Math.ceil(f[F_BX1]! / lat);
    let j0 = Math.floor(f[F_BY0]! / lat);
    let j1 = Math.ceil(f[F_BY1]! / lat);
    if (i1 - i0 + 1 > LEE_WINDOW) {
      const c = Math.floor(f[F_EX]! / lat) - (LEE_WINDOW >> 1);
      i0 = Math.max(i0, Math.min(c, i1 - LEE_WINDOW + 1));
      i1 = Math.min(i1, i0 + LEE_WINDOW - 1);
    }
    if (j1 - j0 + 1 > LEE_WINDOW) {
      const c = Math.floor(-f[F_EZ]! / lat) - (LEE_WINDOW >> 1);
      j0 = Math.max(j0, Math.min(c, j1 - LEE_WINDOW + 1));
      j1 = Math.min(j1, j0 + LEE_WINDOW - 1);
    }
    let kept = 0;
    for (let j = j0; j <= j1 && kept < RIDGE_SITES; j++) {
      for (let i = i0; i <= i1 && kept < RIDGE_SITES; i++) {
        this.hash(i, j, SALT_LEE);
        if (this.hv[0]! >= e.keep * U32) continue;
        this.hash(i, j, SALT_LEE + 1);
        const x = (i + LEE_JITTER * (this.hv[0]! / U32 - 0.5) * 2) * lat;
        this.hash(i, j, SALT_LEE + 2);
        const y = (j + LEE_JITTER * (this.hv[0]! / U32 - 0.5) * 2) * lat;
        if (x < f[F_RX0]! || x > f[F_RX1]! || y < f[F_RY0]! || y > f[F_RY1]!) continue;
        s[0] = x;
        s[1] = y;
        if (this.siteWind() === 0) continue;
        const ex = io[IO_DX]!;
        const ey = io[IO_DY]!;
        s[22] = x;
        s[23] = y;
        this.ground10At();
        const z0 = s[24]!;
        s[22] = x + ex * reach;
        s[23] = y + ey * reach;
        this.ground10At();
        const zf = s[24]!;
        s[22] = x - ex * reach;
        s[23] = y - ey * reach;
        this.ground10At();
        const slope = (zf - s[24]!) / (2 * reach);
        if (!(-slope >= e.fallMin) || !(-slope / T_LEE_SLOPE >= e.leeMin)) continue;
        s[22] = x - ex * e.upwindM;
        s[23] = y - ey * e.upwindM;
        this.ground10At();
        const drop = s[24]! - z0;
        if (!(drop >= e.upwindRiseM)) continue;
        let r = e.radiusPerDrop * drop;
        if (r < e.radiusMinM) r = e.radiusMinM;
        else if (r > e.radiusMaxM) r = e.radiusMaxM;
        io[IO_X] = x;
        io[IO_Y] = y;
        io[IO_R] = r;
        io[IO_K] = 1;
        io[IO_Z] = z0 * vex;
        ob.addSite();
        if (io[IO_BLOCK] !== 0) kept++;
      }
    }
  }

  /**
   * The direction of a step: the wind at its midpoint (the unit vector (s5, s6) / s7, the midpoint (s0, s1)) bent by the crowns and the eddies and slid
   * along the contour of a windward slope, never more than the turn cap from the line's heading (s26, s27), written back to (s5, s6) with the same speed.
   * Folds the nearest approach to an obstacle into s28. 0 when the midpoint is inside a crown's rim (the line ends there), else 1.
   */
  private bend(): number {
    const s = this.s;
    const f = this.f;
    const n = this.n;
    const ob = this.ob;
    const io = ob.io;
    const sp2 = s[7]!;
    const ix = s[5]! / sp2;
    const iy = s[6]! / sp2;
    const mx = s[0]!;
    const my = s[1]!;
    let bx = ix;
    let by = iy;
    let bent = 0;
    if (n[N_OBST] !== 0) {
      io[IO_X] = mx;
      io[IO_Y] = my;
      io[IO_DX] = ix;
      io[IO_DY] = iy;
      io[IO_MODE] = 0;
      ob.perturb();
      if (io[IO_HIT] !== 0) return 0;
      if (io[IO_NEAR]! > s[28]!) s[28] = io[IO_NEAR]!;
      const qx = io[IO_PX]!;
      const qy = io[IO_PY]!;
      if (qx !== 0 || qy !== 0) {
        bx = ix + qx;
        by = iy + qy;
        const l = Math.sqrt(bx * bx + by * by);
        if (l > 1e-6) {
          bx /= l;
          by /= l;
        } else {
          bx = ix;
          by = iy;
        }
        bent = 1;
      }
    }
    if (n[N_RIDGE] !== 0) {
      // The ground's gradient by a forward difference of `forwardM` on the 10 m ground; where it rises along the flow the line slides along the contour.
      const fwd = f[F_RFWD]!;
      s[22] = mx;
      s[23] = my;
      this.ground10At();
      const z0 = s[24]!;
      s[22] = mx + fwd;
      this.ground10At();
      const gx = (s[24]! - z0) / fwd;
      s[22] = mx;
      s[23] = my + fwd;
      this.ground10At();
      const gy = (s[24]! - z0) / fwd;
      const rise = gx * bx + gy * by;
      const lo = f[F_RLO]!;
      if (rise > lo) {
        let t = (rise - lo) / (f[F_RHI]! - lo);
        if (t > 1) t = 1;
        const w = t * t * (3 - 2 * t);
        const gm = Math.sqrt(gx * gx + gy * gy);
        const hx = gx / gm;
        const hy = gy / gm;
        const dn = hx * bx + hy * by;
        const k = f[F_RBETA]! * w * dn;
        bx -= k * hx;
        by -= k * hy;
        const l = Math.sqrt(bx * bx + by * by);
        if (l > 1e-6) {
          bx /= l;
          by /= l;
          bent = 1;
        } else {
          bx = ix;
          by = iy;
        }
      }
    }
    // A step never turns more than the cap from the one before, bent or not: a line that was bent round a crown comes back to the wind's direction over a
    // few steps and not in a corner.
    const hx = s[26]!;
    const hy = s[27]!;
    const cs = f[F_COSCAP]!;
    if (bx * hx + by * hy < cs) {
      const sg = hx * by - hy * bx >= 0 ? 1 : -1;
      const sn = f[F_SINCAP]!;
      bx = hx * cs - sg * hy * sn;
      by = sg * hx * sn + hy * cs;
      bent = 1;
    }
    if (bent !== 0) {
      s[5] = bx * sp2;
      s[6] = by * sp2;
    }
    s[26] = bx;
    s[27] = by;
    return 1;
  }

  /** 1 when the point (s0, s1) is inside a crown's rim (the line ends there), else 0. */
  private rimHit(): number {
    const io = this.ob.io;
    io[IO_X] = this.s[0]!;
    io[IO_Y] = this.s[1]!;
    io[IO_DX] = 1;
    io[IO_DY] = 0;
    io[IO_MODE] = 1;
    this.ob.perturb();
    return io[IO_HIT]! !== 0 ? 1 : 0;
  }

  /** The metres over the base lift (s29) that the canopy's top asks of a stroke at (s0, s1), into s30: 0 where there is no canopy to ride on. */
  private canopyExtra(): void {
    const io = this.ob.io;
    io[IO_X] = this.s[0]!;
    io[IO_Y] = this.s[1]!;
    this.ob.canopyAt();
    const zc = io[IO_ZC]!;
    this.s[30] = zc > this.s[29]! ? zc - this.s[29]! : 0;
  }

  /** Trace the line of stored seed `r`. Nothing is returned: a line that is dropped, cut or skipped leaves its mark in the counts. */
  private line(r: number): void {
    const n = this.n;
    const f = this.f;
    const s = this.s;
    const vp = this.vp;
    const cand = this.cand;
    const ia = cand[3 * r]!;
    const ja = cand[3 * r + 1]!;
    const a = cand[3 * r + 2]!;
    if (this.candidate(ia, ja, a) === 0) return;
    const vex = f[F_VEX]!;
    const wmin = f[F_WMIN]!;
    const rx0 = f[F_RX0]!;
    const ry0 = f[F_RY0]!;
    const rx1 = f[F_RX1]!;
    const ry1 = f[F_RY1]!;
    const seedX = s[0]!;
    const seedY = s[1]!;
    const ground0 = s[2]!;
    const mpp = s[3]!;
    this.sampleField();
    let u = s[5]!;
    let v = s[6]!;
    const steps = this.shape();
    if (steps === 0) return;
    const seg0 = n[N_SEG]!;
    if (seg0 + steps > n[N_CAPS]!) return; // does not fit the room that is left: a smaller line may
    let sp = s[7]!;
    const lenPx = s[4]!;
    const stepPx = lenPx / steps;
    const ds = stepPx * mpp;
    const half = 0.5 * ds;
    const maxRise = MAX_SLOPE * ds * vex; // the drawn rise of one step at the steepest slope allowed (the exaggeration is part of the drawing)
    // The line's own numbers, the same on every segment: the life (a hash of the lattice cell and the seed), the speed, the terrain, the tail.
    this.hashSum(ia, ja, n[N_LIFE]! + levelIndex(a));
    s[17] = (this.hv[0]! >>> 8) / 16777216; // 24 bits: exact in Float32 and under 1
    s[18] = sp;
    this.terrain();
    let tail = TAIL_PX_PER_MS * sp + TAIL_BASE_PX;
    if (tail < TAIL_MIN_PX) tail = TAIL_MIN_PX;
    else if (tail > TAIL_MAX_PX) tail = TAIL_MAX_PX;
    s[21] = tail;
    s[16] = lenPx;
    // The drawn height: the ground, the lift off it that keeps a stroke on top (at least 1.5 m, at least 3 px) and what the wind's rise adds (or takes).
    let yoff = Math.max(LIFT_MIN_M, LIFT_PX * mpp) + T_LIFT_M * s[20]!;
    if (yoff < T_MIN_ABOVE_M) yoff = T_MIN_ABOVE_M; // the lee sinks a line, but not into the ground
    // The relief (0.7.0): the line bends where there are obstacles or a ridge, and rides on the canopy's top where there is canopy.
    const rel = n[N_RELIEF]!;
    const bendOn = rel !== 0 && (n[N_OBST] !== 0 || n[N_RIDGE] !== 0);
    const obstOn = rel !== 0 && n[N_OBST] !== 0;
    const canopyOn = rel !== 0 && n[N_CANOPY] !== 0;
    if (rel !== 0) {
      s[26] = u / sp;
      s[27] = v / sp;
      s[28] = 0;
      s[29] = Math.max(LIFT_MIN_M, LIFT_PX * mpp);
    }
    let px = seedX;
    let py = seedY;
    let ox = seedX;
    let oyw = (ground0 + yoff) * vex;
    if (canopyOn) {
      s[0] = seedX;
      s[1] = seedY;
      this.canopyExtra();
      oyw += s[30]!;
    }
    let og = ground0;
    let ozw = -seedY;
    if (!(vp[3]! * ox + vp[7]! * oyw + vp[11]! * ozw + vp[15]! > wmin)) {
      n[N_DROPPED] = n[N_DROPPED]! + 1;
      return;
    }
    let made = 0;
    let stop = 0; // 1 calm, 2 raster edge, 3 near plane, 4 a wall, 5 a crown's rim
    for (let k = 0; k < steps; k++) {
      if (k > 0) {
        s[0] = px;
        s[1] = py;
        this.sampleField();
        u = s[5]!;
        v = s[6]!;
        sp = Math.sqrt(u * u + v * v);
        if (!(sp >= CALM_MS)) {
          stop = 1;
          break;
        }
      }
      const k1 = half / sp;
      s[0] = px + u * k1;
      s[1] = py + v * k1;
      this.sampleField();
      let u2 = s[5]!;
      let v2 = s[6]!;
      const sp2 = Math.sqrt(u2 * u2 + v2 * v2);
      if (!(sp2 >= CALM_MS)) {
        stop = 1;
        break;
      }
      if (bendOn) {
        // The direction is bent, the speed (so the colour bin below) is the model's.
        s[7] = sp2;
        if (this.bend() === 0) {
          stop = 5;
          break;
        }
        u2 = s[5]!;
        v2 = s[6]!;
      }
      const k2 = ds / sp2;
      const qx = px + u2 * k2;
      const qy = py + v2 * k2;
      if (qx < rx0 || qx > rx1 || qy < ry0 || qy > ry1) {
        stop = 2;
        break;
      }
      s[0] = qx;
      s[1] = qy;
      if (obstOn && this.rimHit() !== 0) {
        stop = 5; // the line meets a crown's rim
        break;
      }
      this.groundAt();
      let qyw = (s[2]! + yoff) * vex;
      if (canopyOn) {
        this.canopyExtra();
        qyw += s[30]!;
      }
      const qzw = -qy;
      if (!(vp[3]! * qx + vp[7]! * qyw + vp[11]! * qzw + vp[15]! > wmin)) {
        stop = 3;
        break;
      }
      if (canopyOn) {
        // The wall test judges the ground only: the canopy's edge is a ramp of a cell and must not cut a line.
        const gq = s[2]!;
        if ((gq - og) * vex > maxRise || (og - gq) * vex > maxRise) {
          stop = 4;
          break;
        }
        og = gq;
      } else if (qyw - oyw > maxRise || oyw - qyw > maxRise) {
        stop = 4;
        break;
      }
      s[8] = ox;
      s[9] = oyw;
      s[10] = ozw;
      s[11] = qx;
      s[12] = qyw;
      s[13] = qzw;
      s[14] = made * stepPx;
      s[15] = (made + 1) * stepPx;
      let bin = (sp2 * BIN_SCALE + 0.5) | 0;
      if (bin > SPEED_BINS - 1) bin = SPEED_BINS - 1;
      this.emit(seg0 + made, bin);
      made++;
      ox = qx;
      oyw = qyw;
      ozw = qzw;
      px = qx;
      py = qy;
    }
    if (stop === 3) {
      n[N_DROPPED] = n[N_DROPPED]! + 1;
      return;
    }
    if (stop === 4) n[N_STEEP] = n[N_STEEP]! + 1; // cut at a wall, or not drawn when the first step is the wall
    if (made < MIN_LINE_SEG) {
      if (stop === 1) n[N_CALM] = n[N_CALM]! + 1;
      return;
    }
    if (made < steps) {
      // A line cut short is as long as it is drawn, on every one of its segments.
      const D = this.D;
      const drawn = made * stepPx;
      for (let k = 0; k < made; k++) D[4 * (seg0 + k) + 2] = drawn;
    }
    if (obstOn && s[28]! > 0) {
      // The pin: the shader multiplies the meander of this line by it (1 free, down to `pinMin` at an obstacle).
      let pin = 1 - f[F_PIN]! * s[28]!;
      if (pin < f[F_PINMIN]!) pin = f[F_PINMIN]!;
      const C = this.C;
      for (let k = 0; k < made; k++) C[4 * (seg0 + k) + 3] = pin;
    }
    n[N_LINES] = n[N_LINES]! + 1;
    n[N_SEG] = seg0 + made;
  }
}

/** A builder with room for the caps of the picture tier, made once; `out` is written in place by every build. */
export function createDetailBuilder(tier: GlyphTier): DetailBuilder {
  return new Builder(GLYPH_CAPS[tier]);
}
