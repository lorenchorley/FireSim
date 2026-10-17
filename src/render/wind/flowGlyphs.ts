/**
 * The wind glyph builder (0.5.0, stage E1): arrows and flow lines traced through a 2-D wind raster, written in the layout of
 * `StreakBatch` (start, end, colour per segment). Pure: no Three.js, no DOM, no `Math.random`.
 *
 * Seeds sit on a world lattice of `lod.spacingM` metres (a power of two), each moved inside its own cell by an integer hash of its
 * indices, so a pan never moves a seed. A seed is kept when its exact projection lies on the screen (plus a margin of one glyph
 * length) in front of the near plane, and, toward the horizon of an orbit view, with probability `1 / s2`, where `s2` is the
 * ground area a pixel covers at the seed against the middle of the screen (so the number of glyphs per screen area stays about
 * constant; the contract's `s = mppSeed / mppCentre` counts only the width of that area). When more seeds than the cap remain, a
 * fixed share is kept by a second hash. A glyph runs downwind from its seed in steps of equal length (RK2 midpoint on the unit direction field, so the
 * arc length is constant): one step for a straight arrow (L1, L2), 3 to 10 for a curved flow line (L3, L4), then an arrowhead of
 * two short chevron segments. A calm seed (under 0.3 m/s) is a short dot. Pixel sizes are scaled by `mppSeed = w / pxPerMetre1`
 * with `w` the clip depth of the seed, which is the true scale of a perspective view across the screen and does not change when
 * a top view pans.
 *
 * Cost (spike S3): the tracer reads rasters only, hash and lookups go through scratch arrays and no double travels through an
 * argument or a return value, so a rebuild allocates nothing even when V8 does not inline. State lives in typed arrays for the
 * same reason (a number field of an object that holds a double is boxed). The job is cut into slices that stop on the clock.
 */
import { WIND_RAMP, sampleRamp, srgbToLinear, type Rgb } from '../palette';
import { GLYPH_CAPS, GLYPH_SHAFT_SEGMENTS_MAX, type GlyphBuilder, type GlyphInput, type GlyphOutput, type GlyphTier } from './glyphTypes';

export const SPEED_TABLE_BINS = 64;
/** The table's last bin is this speed (m/s), as the Wind speed map's ramp ends. */
export const SPEED_TABLE_MAX_MS = 25;
/** A wind under this (m/s) is calm: a dot, and a trace that falls under it stops. */
export const GLYPH_CALM_MS = 0.3;
/** Dot length, arrowhead barb angle and the shortest and longest barb (screen px). */
export const GLYPH_DOT_PX = 3;
export const GLYPH_HEAD_DEG = 28;
const HEAD_MIN_PX = 5;
const HEAD_MAX_PX = 9;
const HEAD_FRAC = 0.35;
/** A vertex at a clip depth under this many near-plane distances drops the whole glyph. */
export const GLYPH_NEAR_FACTOR = 1.5;
/** Drawn this far above the ground: at least this many metres and at least this many pixels. */
export const GLYPH_LIFT_MIN_M = 1.5;
export const GLYPH_LIFT_PX = 3;
/** Seeds are kept this far (a share of the screen, and at least one glyph length) outside the screen. */
export const GLYPH_SCREEN_MARGIN = 0.1;
/** Orbit density: a seed is kept with probability 1 / s2, `s2` (ground area of a pixel here against the middle of the screen) clamped to 1..64. */
export const GLYPH_DENSITY_S2_MAX = 64;
/** Keep this share of `cap / count` when thinning to the cap, so the hard stop is rarely reached. */
const CAP_KEEP = 0.95;
/** Most lattice cells one build walks; a bigger box is cut to a square around the camera. */
export const GLYPH_MAX_CELLS = 400_000;

const COS_HEAD = Math.cos((GLYPH_HEAD_DEG * Math.PI) / 180);
const SIN_HEAD = Math.sin((GLYPH_HEAD_DEG * Math.PI) / 180);
const BIN_SCALE = (SPEED_TABLE_BINS - 1) / SPEED_TABLE_MAX_MS;
const U32 = 4294967296;

// Salts of the integer hash (`hash3` of render/fields.ts, written out below). The jitter salts start at 32 so that they can never
// equal the two below, whatever the lattice exponent.
const SALT_ORBIT = 17;
const SALT_CAP = 19;
const SALT_JITTER = 32;

/** 64 entries of display-space linear rgb (3 floats each) for the speeds 0 to 25 m/s, from `WIND_RAMP`: the colours of the Wind speed map, computed once. */
export function buildSpeedTable(): Float32Array {
  const t = new Float32Array(SPEED_TABLE_BINS * 3);
  const c: Rgb = [0, 0, 0];
  for (let b = 0; b < SPEED_TABLE_BINS; b++) {
    sampleRamp(WIND_RAMP, (b / (SPEED_TABLE_BINS - 1)) * SPEED_TABLE_MAX_MS, c);
    t[3 * b] = srgbToLinear(c[0]);
    t[3 * b + 1] = srgbToLinear(c[1]);
    t[3 * b + 2] = srgbToLinear(c[2]);
  }
  return t;
}
const SPEED_TABLE = buildSpeedTable();

/** The halo drawn under every stroke: a near-black navy (sRGB #081024), in linear light. */
export const HALO_INK: readonly [number, number, number] = [srgbToLinear(8 / 255), srgbToLinear(16 / 255), srgbToLinear(36 / 255)];

/** What `createGlyphBuilder` returns in `out`: the C0 output plus where each glyph starts, for tests and the oracle. */
export interface GlyphOutputDetail extends GlyphOutput {
  /** `starts[g]` is the first segment of glyph g; `starts[glyphs]` is the end. A dot is one segment, any other glyph is its shaft and two barbs. */
  starts: Int32Array;
}

// Float state (f) and integer state (n) of the job. Typed arrays, so that no field of the builder holds a boxed number.
const F_CSSW = 0;
const F_CSSH = 1;
const F_PXM1 = 2;
const F_WMIN = 3;
const F_VEX = 4;
const F_S = 5;
const F_JIT = 6;
const F_LMIN = 7;
const F_LMAX = 8;
const F_PXMS = 9;
const F_MPPC = 10;
const F_RX0 = 11;
const F_RY0 = 12;
const F_RX1 = 13;
const F_RY1 = 14;
const F_RINV = 15;
const F_GX0 = 16;
const F_GY0 = 17;
const F_GINV = 18;
const F_MX = 19;
const F_MY = 20;
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
const F_LEN = 31;

const N_BUSY = 0;
const N_PHASE = 1;
const N_RNX = 2;
const N_RNY = 3;
const N_GNX = 4;
const N_GNY = 5;
const N_I0 = 6;
const N_I1 = 7;
const N_J1 = 8;
const N_CI = 9;
const N_CJ = 10;
const N_SALT = 11;
const N_SEEDS = 12;
const N_NSTORE = 13;
const N_MAXSTORE = 14;
const N_TI = 15;
const N_GL = 16;
const N_SEG = 17;
const N_DROPPED = 18;
const N_CALM = 19;
const N_CAPG = 20;
const N_CAPS = 21;
const N_SHAFTCAP = 22;
const N_CURVED = 23;
const N_REBUILDS = 24;
const N_INTERVAL = 25;
const N_LEN = 26;

// Phases of a job: set-up pending, walking the lattice, about to trace, tracing, done.
const PHASE_SETUP = 3;
const PHASE_WALK = 0;
const PHASE_TRACE_START = 4;
const PHASE_TRACE = 1;
const PHASE_DONE = 2;

/** Lattice cells between two reads of the clock while walking the lattice. */
const CELL_CHECK = 2048;

class Builder implements GlyphBuilder {
  readonly out: GlyphOutputDetail;
  private input: GlyphInput | null = null;
  private readonly f = new Float64Array(F_LEN);
  private readonly n = new Int32Array(N_LEN);
  /** Projection x view, column-major (THREE's `Matrix4.elements`). */
  private readonly vp = new Float64Array(16);
  /** Scratch: 0 x, 1 y, 2 ground, 3 metres per pixel, 4 clip depth, 5 u, 6 v, 8..13 the segment being written. */
  private readonly s = new Float64Array(14);
  private readonly hv = new Uint32Array(1);
  private readonly cand: Int32Array;
  private readonly candH: Uint32Array;
  private readonly capGlyphs: number;
  private readonly capSegments: number;
  private fu: Float32Array = new Float32Array(0);
  private fv: Float32Array = new Float32Array(0);
  private gz: Float32Array = new Float32Array(0);
  private readonly A: Float32Array;
  private readonly B: Float32Array;
  private readonly C: Float32Array;

  constructor(caps: { glyphs: number; segments: number }) {
    this.capGlyphs = caps.glyphs;
    this.capSegments = caps.segments;
    this.A = new Float32Array(3 * caps.segments);
    this.B = new Float32Array(3 * caps.segments);
    this.C = new Float32Array(4 * caps.segments);
    this.out = { a: this.A, b: this.B, c: this.C, starts: new Int32Array(caps.glyphs + 1), glyphs: 0, segments: 0, dropped: 0, calm: 0 };
    const store = 3 * caps.glyphs + 16;
    this.cand = new Int32Array(2 * store);
    this.candH = new Uint32Array(store);
  }

  get busy(): boolean {
    return this.n[N_BUSY] !== 0;
  }

  cancel(): void {
    this.n[N_BUSY] = 0;
    this.n[N_PHASE] = PHASE_DONE;
    this.input = null;
  }

  begin(input: GlyphInput): void {
    const n = this.n;
    const out = this.out;
    this.input = input;
    n[N_REBUILDS] = n[N_REBUILDS]! + 1;
    n[N_BUSY] = 0;
    n[N_PHASE] = PHASE_DONE;
    n[N_SEEDS] = 0;
    n[N_NSTORE] = 0;
    n[N_TI] = 0;
    n[N_GL] = 0;
    n[N_SEG] = 0;
    n[N_DROPPED] = 0;
    n[N_CALM] = 0;
    out.glyphs = 0;
    out.segments = 0;
    out.dropped = 0;
    out.calm = 0;
    out.starts[0] = 0;
    // Is there anything to draw? Comparisons and whole numbers only. This function runs a few times a second, so V8 never optimises
    // it, and in the interpreter every number made by arithmetic is a heap number: the arithmetic of the set-up is in `walk`, which
    // is hot, and that is what keeps a rebuild under a kilobyte.
    const lod = input.lod;
    const field = input.field;
    const fg = field.grid;
    const gg = input.ground.grid;
    if (lod.level === 0 || !(lod.spacingM > 0) || !(lod.spacingPx > 0)) return;
    if (fg.nx < 2 || fg.ny < 2 || gg.nx < 2 || gg.ny < 2 || !(fg.cellSize > 0) || !(gg.cellSize > 0)) return;
    if (field.u.length < fg.nx * fg.ny || field.v.length < fg.nx * fg.ny || input.ground.elevation.length < gg.nx * gg.ny) return;
    if (!(input.cssW > 0) || !(input.cssH > 0) || !(input.pxPerMetre1 > 0)) return;
    const capG = Math.min(input.cap.glyphs | 0, this.capGlyphs);
    const capS = Math.min(input.cap.segments | 0, this.capSegments);
    if (capG < 1 || capS < 1) return;
    this.fu = field.u;
    this.fv = field.v;
    this.gz = input.ground.elevation;
    n[N_RNX] = fg.nx;
    n[N_RNY] = fg.ny;
    n[N_GNX] = gg.nx;
    n[N_GNY] = gg.ny;
    n[N_CAPG] = capG;
    n[N_CAPS] = capS;
    n[N_MAXSTORE] = Math.min(3 * capG + 16, this.candH.length);
    n[N_CURVED] = lod.curved ? 1 : 0;
    n[N_SALT] = SALT_JITTER + 2 * (Math.max(-16, Math.min(48, lod.spacingExp | 0)) + 16);
    n[N_PHASE] = PHASE_SETUP;
    n[N_BUSY] = 1;
  }

  step(budgetMs: number): boolean {
    const n = this.n;
    if (n[N_BUSY] === 0) return true;
    const f = this.f;
    f[F_BUDGET] = budgetMs;
    f[F_DEADLINE] = this.input!.now() + budgetMs;
    if (n[N_PHASE] === PHASE_SETUP || n[N_PHASE] === PHASE_WALK) {
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
   * Is lattice cell (i, j) a seed? 1 or 0. On 1 the seed is left in the scratch: s0, s1 its position, s2 the ground under it,
   * s3 its metres per pixel. The tests, in the order of their cost: inside the raster's domain; clip depth beyond the near plane;
   * on the screen plus margin; the orbit density.
   */
  private candidate(i: number, j: number): number {
    const f = this.f;
    const s = this.s;
    const vp = this.vp;
    const S = f[F_S]!;
    const jit = f[F_JIT]!;
    let px: number;
    let py: number;
    if (jit > 0) {
      const salt = this.n[N_SALT]!;
      this.hash(i, j, salt);
      const hx = this.hv[0]! / U32;
      this.hash(i, j, salt + 1);
      const hy = this.hv[0]! / U32;
      px = (i + 0.5 + jit * (hx - 0.5) * 2) * S;
      py = (j + 0.5 + jit * (hy - 0.5) * 2) * S;
    } else {
      px = (i + 0.5) * S;
      py = (j + 0.5) * S;
    }
    if (px < f[F_RX0]! || px > f[F_RX1]! || py < f[F_RY0]! || py > f[F_RY1]!) return 0;
    s[0] = px;
    s[1] = py;
    this.groundAt();
    const yw = s[2]! * f[F_VEX]!;
    const zw = -py;
    const w = vp[3]! * px + vp[7]! * yw + vp[11]! * zw + vp[15]!;
    if (!(w > f[F_WMIN]!)) return 0;
    const cx = vp[0]! * px + vp[4]! * yw + vp[8]! * zw + vp[12]!;
    const cy = vp[1]! * px + vp[5]! * yw + vp[9]! * zw + vp[13]!;
    if (Math.abs(cx) > f[F_MX]! * w || Math.abs(cy) > f[F_MY]! * w) return 0;
    const mpp = w / f[F_PXM1]!;
    // Orbit density: the ground area one pixel covers here against the middle of the screen, `s2 = A / A_centre`, with A = mpp^2 /
    // sin(angle of the view ray to the ground), the angle taken in the vertical plane the camera faces (a seed's sideways offset
    // is ignored, so a top view has s2 = 1 everywhere and a pan moves no seed in or out). Keep the seed with probability 1 / s2 (s2
    // at most 64), so the number of glyphs per screen area stays about constant toward the horizon.
    const dy = f[F_EY]! - yw;
    let ahead = (px - f[F_EX]!) * f[F_HFX]! + (zw - f[F_EZ]!) * f[F_HFZ]!;
    if (ahead < 0) ahead = 0;
    const slant = Math.sqrt(dy * dy + ahead * ahead);
    let s2 = dy > 0.02 * slant ? mpp * mpp * (slant / dy) * f[F_AK]! : GLYPH_DENSITY_S2_MAX;
    if (s2 > GLYPH_DENSITY_S2_MAX) s2 = GLYPH_DENSITY_S2_MAX;
    if (s2 > 1) {
      this.hash(i, j, SALT_ORBIT);
      if ((this.hv[0]! / U32) * s2 >= 1) return 0;
    }
    s[3] = mpp;
    s[4] = w;
    return 1;
  }

  /** Keep a seed for the trace phase: counted always, stored when its cap hash is under the threshold, which halves when the store is full. */
  private store(i: number, j: number): void {
    const n = this.n;
    const f = this.f;
    n[N_SEEDS] = n[N_SEEDS]! + 1;
    this.hash(i, j, SALT_CAP);
    const h = this.hv[0]!;
    let tau = f[F_TAU]!;
    if (h >= tau) return;
    let ns = n[N_NSTORE]!;
    const max = n[N_MAXSTORE]!;
    const cand = this.cand;
    const candH = this.candH;
    if (ns >= max) {
      while (ns >= max && tau > 1) {
        tau *= 0.5;
        let w = 0;
        for (let r = 0; r < ns; r++) {
          if (candH[r]! < tau) {
            if (w !== r) {
              cand[2 * w] = cand[2 * r]!;
              cand[2 * w + 1] = cand[2 * r + 1]!;
              candH[w] = candH[r]!;
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
    cand[2 * ns] = i;
    cand[2 * ns + 1] = j;
    candH[ns] = h;
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
      // The raster's domain: glyphs stop at its edge.
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
      f[F_CSSW] = input.cssW;
      f[F_CSSH] = input.cssH;
      f[F_PXM1] = input.pxPerMetre1;
      f[F_WMIN] = GLYPH_NEAR_FACTOR * input.near;
      f[F_VEX] = input.vex;
      f[F_S] = S;
      f[F_JIT] = lod.jitter;
      f[F_LMIN] = lod.lengthPx.min;
      f[F_LMAX] = lod.lengthPx.max;
      f[F_PXMS] = lod.lengthPx.pxPerMs;
      f[F_MPPC] = lod.mppCentre !== undefined && lod.mppCentre > 0 ? lod.mppCentre : S / lod.spacingPx;
      // A seed this far outside the screen can still have its glyph on it: one glyph length and its head, at least a tenth of the screen.
      const reach = lod.lengthPx.max + HEAD_MAX_PX + 1;
      f[F_MX] = 1 + (2 * Math.max(GLYPH_SCREEN_MARGIN * input.cssW, reach)) / input.cssW;
      f[F_MY] = 1 + (2 * Math.max(GLYPH_SCREEN_MARGIN * input.cssH, reach)) / input.cssH;
      f[F_EX] = input.eye[0]!;
      f[F_EY] = input.eye[1]!;
      f[F_EZ] = input.eye[2]!;
      // Orbit density needs the pitch of the view. The camera's forward axis is the gradient of the clip depth (row 3 of projection x
      // view): its y part gives sin(pitch) for the centre ray, its horizontal part the way the camera faces (none for a top view).
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
      if (((bx1 - bx0) / S + 1) * ((by1 - by0) / S + 1) > GLYPH_MAX_CELLS) {
        const half = 0.5 * S * Math.sqrt(GLYPH_MAX_CELLS);
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
      if (bx0 <= bx1 && by0 <= by1) {
        const i0 = Math.floor(bx0 / S);
        const j0 = Math.floor(by0 / S);
        n[N_I0] = i0;
        n[N_I1] = Math.floor(bx1 / S);
        n[N_J1] = Math.floor(by1 / S);
        n[N_CI] = i0;
        n[N_CJ] = j0;
      } else {
        // Nothing of the box is inside the raster: no cell to walk.
        n[N_I0] = 0;
        n[N_I1] = -1;
        n[N_J1] = -1;
        n[N_CI] = 0;
        n[N_CJ] = 0;
      }
      n[N_PHASE] = PHASE_WALK;
    }
    const deadline = f[F_DEADLINE]!;
    const i0 = n[N_I0]!;
    const i1 = n[N_I1]!;
    const j1 = n[N_J1]!;
    let ci = n[N_CI]!;
    let cj = n[N_CJ]!;
    let check = CELL_CHECK;
    while (cj <= j1) {
      while (ci <= i1) {
        if (this.candidate(ci, cj) !== 0) this.store(ci, cj);
        ci++;
        if (--check <= 0) {
          check = CELL_CHECK;
          if (input.now() >= deadline) {
            n[N_CI] = ci;
            n[N_CJ] = cj;
            return false;
          }
        }
      }
      ci = i0;
      cj++;
    }
    n[N_CI] = ci;
    n[N_CJ] = cj;
    return true;
  }

  /** Trace the stored seeds in order; true when all are done (or the caps are reached), false when the slice ran out of time. */
  private trace(): boolean {
    const n = this.n;
    const f = this.f;
    const out = this.out;
    const input = this.input!;
    const deadline = f[F_DEADLINE]!;
    const budget = f[F_BUDGET]!;
    const cand = this.cand;
    const candH = this.candH;
    const ns = n[N_NSTORE]!;
    const capG = n[N_CAPG]!;
    const base = n[N_REBUILDS]! <= 4 ? 8 : 32;
    if (n[N_PHASE] === PHASE_TRACE_START) {
      // The lattice is walked: decide how many of the stored seeds are traced and how many steps a shaft may have. When more
      // seeds than the cap were found, keep the share 0.95 x cap / count of them, by the hash they were stored with.
      const count = n[N_SEEDS]!;
      let p = count > capG ? (CAP_KEEP * capG * U32) / count : U32;
      if (p > f[F_TAU]!) p = f[F_TAU]!;
      f[F_PKEEP] = p;
      let keep = 0;
      for (let r = 0; r < ns; r++) if (candH[r]! < p) keep++;
      if (keep > capG) keep = capG;
      // All kept glyphs must fit the segments: shaft + 2 for the head each, but at least 3 steps for a curve.
      n[N_SHAFTCAP] = Math.max(3, Math.floor(n[N_CAPS]! / Math.max(1, keep)) - 2);
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
      if (n[N_GL]! >= capG || this.glyph(cand[2 * r]!, cand[2 * r + 1]!) !== 0) {
        ti = ns; // a cap is reached: the rest is not drawn
        break;
      }
      if (--left <= 0) {
        const now = input.now();
        if (now >= deadline) break;
        // Plenty of the slice left: read the clock less often (a clock read allocates its number).
        if (deadline - now > 0.75 * budget && interval < 4 * base) interval *= 2;
        left = interval;
      }
    }
    n[N_TI] = ti;
    n[N_INTERVAL] = interval;
    out.glyphs = n[N_GL]!;
    out.segments = n[N_SEG]!;
    out.dropped = n[N_DROPPED]!;
    out.calm = n[N_CALM]!;
    return ti >= ns;
  }

  /** Write the segment held in the scratch (s8..s13) at index `seg` with the colour of speed bin `bin`. */
  private emit(seg: number, bin: number): void {
    const s = this.s;
    const A = this.A;
    const B = this.B;
    const C = this.C;
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
  }

  /** Trace the glyph of lattice cell (i, j). 1 when the segments are used up (the build stops), else 0. */
  private glyph(i: number, j: number): number {
    if (this.candidate(i, j) === 0) return 0;
    const f = this.f;
    const n = this.n;
    const s = this.s;
    const vp = this.vp;
    const vex = f[F_VEX]!;
    const wmin = f[F_WMIN]!;
    const rx0 = f[F_RX0]!;
    const ry0 = f[F_RY0]!;
    const rx1 = f[F_RX1]!;
    const ry1 = f[F_RY1]!;
    const seedX = s[0]!;
    const seedY = s[1]!;
    const mpp = s[3]!;
    const lift = Math.max(GLYPH_LIFT_MIN_M, GLYPH_LIFT_PX * mpp);
    const yw0 = (s[2]! + lift) * vex;
    this.sampleField();
    let u = s[5]!;
    let v = s[6]!;
    let sp = Math.sqrt(u * u + v * v);
    if (sp >= GLYPH_CALM_MS) {
      let lenPx = f[F_PXMS]! * sp;
      const lmin = f[F_LMIN]!;
      const lmax = f[F_LMAX]!;
      if (lenPx < lmin) lenPx = lmin;
      else if (lenPx > lmax) lenPx = lmax;
      let shaft = 1;
      if (n[N_CURVED] !== 0) {
        shaft = Math.ceil(lenPx / 7);
        if (shaft < 6) shaft = 6;
        if (shaft > GLYPH_SHAFT_SEGMENTS_MAX) shaft = GLYPH_SHAFT_SEGMENTS_MAX;
        if (shaft > n[N_SHAFTCAP]!) shaft = n[N_SHAFTCAP]!;
      }
      const seg0 = n[N_SEG]!;
      if (seg0 + shaft + 2 > n[N_CAPS]!) return 1;
      const ds = (lenPx * mpp) / shaft;
      const half = 0.5 * ds;

      let px = seedX;
      let py = seedY;
      let ox = seedX;
      let oyw = yw0;
      let ozw = -seedY;
      if (!(vp[3]! * ox + vp[7]! * oyw + vp[11]! * ozw + vp[15]! > wmin)) {
        n[N_DROPPED] = n[N_DROPPED]! + 1;
        return 0;
      }
      let made = 0;
      let stop = 0; // 1 calm, 2 raster edge, 3 near plane
      let dux = 0;
      let duy = 0;
      let bin = 0;
      for (let k = 0; k < shaft; k++) {
        if (k > 0) {
          s[0] = px;
          s[1] = py;
          this.sampleField();
          u = s[5]!;
          v = s[6]!;
          sp = Math.sqrt(u * u + v * v);
          if (!(sp >= GLYPH_CALM_MS)) {
            stop = 1;
            break;
          }
        }
        const k1 = half / sp;
        s[0] = px + u * k1;
        s[1] = py + v * k1;
        this.sampleField();
        const u2 = s[5]!;
        const v2 = s[6]!;
        const sp2 = Math.sqrt(u2 * u2 + v2 * v2);
        if (!(sp2 >= GLYPH_CALM_MS)) {
          stop = 1;
          break;
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
        this.groundAt();
        const qyw = (s[2]! + lift) * vex;
        const qzw = -qy;
        if (!(vp[3]! * qx + vp[7]! * qyw + vp[11]! * qzw + vp[15]! > wmin)) {
          stop = 3;
          break;
        }
        s[8] = ox;
        s[9] = oyw;
        s[10] = ozw;
        s[11] = qx;
        s[12] = qyw;
        s[13] = qzw;
        bin = (sp * BIN_SCALE + 0.5) | 0;
        if (bin > SPEED_TABLE_BINS - 1) bin = SPEED_TABLE_BINS - 1;
        this.emit(seg0 + made, bin);
        made++;
        ox = qx;
        oyw = qyw;
        ozw = qzw;
        px = qx;
        py = qy;
        dux = u2 / sp2;
        duy = v2 / sp2;
      }
      if (stop === 3) {
        n[N_DROPPED] = n[N_DROPPED]! + 1;
        return 0;
      }
      if (made === 0 && stop !== 1) return 0; // cut at the raster edge before the first step: nothing to draw
      if (made > 0) {

        // Arrowhead: two chevron barbs from the tip, +/- 28 degrees from the way back, in the ground plane (draped on the ground like the shaft).
        let headPx = HEAD_FRAC * lenPx;
        if (headPx < HEAD_MIN_PX) headPx = HEAD_MIN_PX;
        else if (headPx > HEAD_MAX_PX) headPx = HEAD_MAX_PX;
        const headM = headPx * mpp;
        const rx = -dux;
        const ry = -duy;
        for (let b = 0; b < 2; b++) {
          const sn = b === 0 ? SIN_HEAD : -SIN_HEAD;
          let hx = px + headM * (rx * COS_HEAD - ry * sn);
          let hy = py + headM * (rx * sn + ry * COS_HEAD);
          if (hx < rx0) hx = rx0;
          else if (hx > rx1) hx = rx1;
          if (hy < ry0) hy = ry0;
          else if (hy > ry1) hy = ry1;
          s[0] = hx;
          s[1] = hy;
          this.groundAt();
          const hyw = (s[2]! + lift) * vex;
          const hzw = -hy;
          if (!(vp[3]! * hx + vp[7]! * hyw + vp[11]! * hzw + vp[15]! > wmin)) {
            n[N_DROPPED] = n[N_DROPPED]! + 1;
            return 0;
          }
          s[8] = ox;
          s[9] = oyw;
          s[10] = ozw;
          s[11] = hx;
          s[12] = hyw;
          s[13] = hzw;
          this.emit(seg0 + made + b, bin);
        }
        const end = seg0 + made + 2;
        const gl = n[N_GL]!;
        this.out.starts[gl] = seg0;
        this.out.starts[gl + 1] = end;
        n[N_GL] = gl + 1;
        n[N_SEG] = end;
        return 0;
      }
    }
    // A dot: a calm seed, or a trace that was calm from its first step. (This is in `glyph` and not a method of its own: a method that runs
    // a few times a rebuild stays in the interpreter, where every number made by arithmetic is a heap number.)
    const dseg = n[N_SEG]!;
    if (dseg + 1 > n[N_CAPS]!) return 1;
    const dbx = seedX + GLYPH_DOT_PX * mpp;
    if (!(vp[3]! * seedX + vp[7]! * yw0 - vp[11]! * seedY + vp[15]! > wmin) || !(vp[3]! * dbx + vp[7]! * yw0 - vp[11]! * seedY + vp[15]! > wmin)) {
      n[N_DROPPED] = n[N_DROPPED]! + 1;
      return 0;
    }
    s[8] = seedX;
    s[9] = yw0;
    s[10] = -seedY;
    s[11] = dbx;
    s[12] = yw0;
    s[13] = -seedY;
    this.emit(dseg, 0);
    const dgl = n[N_GL]!;
    this.out.starts[dgl] = dseg;
    this.out.starts[dgl + 1] = dseg + 1;
    n[N_GL] = dgl + 1;
    n[N_SEG] = dseg + 1;
    n[N_CALM] = n[N_CALM]! + 1;
    return 0;
  }
}

/** A builder with room for the caps of the picture tier, made once; `out` is written in place by every build. */
export function createGlyphBuilder(tier: GlyphTier): GlyphBuilder {
  return new Builder(GLYPH_CAPS[tier]);
}
