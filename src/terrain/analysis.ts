/**
 * Terrain analysis: slope, aspect, gradients, topographic position, curvature and landform classes.
 *
 * Everything here is computed once per scenario from the elevation grid and consumed by the fuel-moisture
 * model (aspect, gullies), the fire-spread solver (directional slope, eruptive gullies/chimneys, ridge tops,
 * saddles), the atmosphere model (valley axes for channelling, ridges for speed-up and lee eddies) and the
 * explanation engine ("this is a gully that faces the afternoon sun").
 *
 * Conventions (see src/core/units.ts): local metres, x east, y north, row-major k = j*nx + i with j = 0 the
 * SOUTHERN row; angles in degrees at the API boundary; azimuths clockwise from north.
 *
 * Method summary (thresholds are in {@link DEFAULT_LANDFORM_THRESHOLDS}):
 *  - Gradient: Horn (1981) 3×3 weighted finite differences. Slope = atan|∇z|. Aspect = azimuth of −∇z (the
 *    direction the slope FACES, i.e. downhill), NaN where slope < {@link FLAT_SLOPE_DEG}.
 *  - TPI (Weiss 2001; Guisan et al. 1999): z − mean(z) over a square window of half-width ≈ 300 m
 *    (box radius round(300 / cellSize) cells). A second, small-scale TPI (≈ 100 m) picks out gullies and spurs
 *    that are narrower than the 300 m window.
 *  - Curvature: Laplacian-based, computed on the surface smoothed with a ≈ 50 m tent filter (two box passes) so it
 *    is nearly independent of the DEM resolution: −(z_tt + β·z_ss), where z_tt is the second derivative ACROSS the
 *    slope (along the contour; tangential curvature) and z_ss the one DOWN the slope (profile curvature). β = 1 on
 *    gentle ground (plain −∇²z) and 0.25 on slopes ≥ 10°, so the value tracks plan shape where it matters for
 *    fire (convergent gullies/chutes −, divergent spurs +) and a concave cliff foot or a slope break is not
 *    mistaken for a gully. For a trough or crest running straight down a slope it equals −∇²z exactly.
 *  - Hessian of a ≈ 150 m tent-smoothed surface: its eigenvalues/eigenvectors identify critical points
 *    (peaks: both eigenvalues negative; saddles/passes: one positive, one negative) and valley axes.
 *  - Relative slope position: (z − min)/(max − min) within ≈ 1 km, so long valley walls that are planar at the
 *    300 m scale can still be split into upper / mid / lower slope.
 *
 * Edges: fields are computed on a copy of the DEM padded by odd reflection (linear extrapolation,
 * z(−t) = 2 z(0) − z(t)), so planes stay exact at the domain edge and edges do not look like ridges or valleys.
 */
import { boxBlur, type GridSpec } from '../core/grid';
import { Landform, type Terrain } from '../core/types';
import { RAD } from '../core/units';

// ─────────────────────────────────────────────────────────────────────────────
// Scales and thresholds
// ─────────────────────────────────────────────────────────────────────────────

/** Below this slope (deg) aspect is undefined (NaN) and directional helpers return NaN. */
export const FLAT_SLOPE_DEG = 0.5;
/** Half-width of the TPI neighbourhood stored in {@link Terrain.tpi} (m). */
export const TPI_RADIUS_M = 300;
/** Half-width of the small-scale TPI used for gully / spur detection (m). */
export const TPI_SMALL_RADIUS_M = 100;
/** Box radius of the tent smoothing applied before curvature / valley-axis Hessian (m; applied twice). */
export const CURVATURE_SMOOTH_RADIUS_M = 50;
/** Box radius of the tent smoothing applied before the critical-point (peak / saddle) Hessian (m; applied twice). */
export const CRITICAL_POINT_SMOOTH_RADIUS_M = 150;
/** Half-width of the window used for relative slope position and local relief (m). */
export const RELATIVE_POSITION_RADIUS_M = 1000;

/**
 * Thresholds of the landform classifier. TPI thresholds adapt to the domain in the spirit of Weiss (2001),
 * who uses ±0.5 and ±1 standard deviations of TPI, but are clamped to physically meaningful bounds so that a
 * nearly flat domain does not turn its noise into ridges and a very rugged one does not lose its minor ridges.
 */
export interface LandformThresholds {
  /** Slope above which a cell is a Cliff (deg). */
  cliffSlopeDeg: number;
  /** Slope below which an otherwise unremarkable cell is Flat (deg). */
  flatSlopeDeg: number;
  /** Maximum slope of a Ridge top (deg). Steeper convex crests are Spurs. */
  ridgeMaxSlopeDeg: number;
  /** Minimum slope of a Spur (deg). */
  spurMinSlopeDeg: number;
  /** Minimum slope of a Gully (deg); gentler concave cells are ValleyFloor. */
  gullyMinSlopeDeg: number;
  /** Maximum slope of a ValleyFloor (deg). */
  valleyFloorMaxSlopeDeg: number;
  /** Maximum slope of a Peak or Saddle cell (deg). */
  criticalMaxSlopeDeg: number;
  /** Large-scale TPI unit tL = clamp(tpiSdFactor · sd(TPI300), tpiMin, tpiMax) (m). Ridge > tL, valley < −0.5 tL. */
  tpiSdFactor: number;
  tpiMin: number;
  tpiMax: number;
  /** Small-scale TPI unit tS = clamp(tpiSmallSdFactor · sd(TPI100), tpiSmallMin, tpiSmallMax) (m). */
  tpiSmallSdFactor: number;
  tpiSmallMin: number;
  tpiSmallMax: number;
  /** |curvature| (1/m, = −∇²z of the 50 m-smoothed surface) above which a cell is convex / concave. */
  curvature: number;
  /**
   * Minimum |eigenvalue| (1/m) of the 150 m-smoothed Hessian for a peak or saddle. 2.5e-4 ≈ the surface rising or
   * falling ≥ 5 m within 200 m of the critical point.
   */
  criticalCurvature: number;
  /** Maximum distance (m) of a cell from the peak / saddle critical point (Newton step H⁻¹∇z) to be labelled so. */
  criticalRadiusM: number;
  /** Relative slope position (0 = local minimum, 1 = local maximum within ≈ 1 km) splitting lower / mid / upper. */
  lowerSlopeRelPos: number;
  upperSlopeRelPos: number;
}

export const DEFAULT_LANDFORM_THRESHOLDS: Readonly<LandformThresholds> = Object.freeze({
  cliffSlopeDeg: 45,
  flatSlopeDeg: 5,
  ridgeMaxSlopeDeg: 12,
  spurMinSlopeDeg: 12,
  gullyMinSlopeDeg: 8,
  valleyFloorMaxSlopeDeg: 8,
  criticalMaxSlopeDeg: 15,
  tpiSdFactor: 1,
  tpiMin: 5,
  tpiMax: 25,
  tpiSmallSdFactor: 0.5,
  tpiSmallMin: 1.5,
  tpiSmallMax: 6,
  curvature: 6e-4,
  criticalCurvature: 2.5e-4,
  criticalRadiusM: 200,
  lowerSlopeRelPos: 1 / 3,
  upperSlopeRelPos: 2 / 3,
});

export interface BuildTerrainOptions {
  thresholds?: Partial<LandformThresholds>;
}

/**
 * Extra per-cell fields that are not part of the {@link Terrain} contract but are useful to other modules
 * (moisture: small-scale TPI; atmosphere: valley axes; explanations: relative position). They are cached per
 * Terrain object and recomputed on demand if the Terrain came through a structured clone (e.g. into a worker).
 */
export interface TerrainDerived {
  /** Small-scale (≈ 100 m) TPI (m). */
  tpiSmall: Float32Array;
  /** Tangential (across-slope, "plan") and profile (down-slope) curvature of the ≈ 50 m-smoothed surface (1/m),
   *  sign convention as {@link Terrain.curvature}: + convex, − concave. Zero where the surface is level. */
  planCurvature: Float32Array;
  profileCurvature: Float32Array;
  /** Hessian of the ≈ 50 m-smoothed surface (1/m): z_xx, z_yy, z_xy. */
  hxx: Float32Array;
  hyy: Float32Array;
  hxy: Float32Array;
  /** Relative elevation within ≈ 1 km: 0 at the local minimum, 1 at the local maximum. */
  relPos: Float32Array;
  /** Local relief (max − min within ≈ 1 km) (m). */
  localRelief: Float32Array;
  /**
   * Height above the lowest ground within ≈ 1 km (m): a proxy for height above the valley floor. Cold air pools
   * in the lowest tens of metres on clear calm nights; the mid-slope "thermal belt" above it stays warmer and
   * drier, so fires there keep burning actively overnight.
   */
  heightAboveValley: Float32Array;
  /** Thresholds actually used (TPI units resolved for this domain). */
  thresholds: LandformThresholds & { tpiUnit: number; tpiSmallUnit: number };
}

const derivedCache = new WeakMap<Terrain, TerrainDerived>();

// ─────────────────────────────────────────────────────────────────────────────
// Padding / filtering helpers
// ─────────────────────────────────────────────────────────────────────────────

/** A field padded by P cells on every side (row-major, width pw = nx + 2P). */
interface Padded {
  data: Float32Array;
  grid: GridSpec;
  P: number;
  pw: number;
}

/** Pad by odd reflection (linear extrapolation) so that planar surfaces remain planar outside the domain. */
function padOdd(g: GridSpec, f: ArrayLike<number>, P: number): Padded {
  const { nx, ny } = g;
  const pw = nx + 2 * P;
  const ph = ny + 2 * P;
  const out = new Float32Array(pw * ph);
  for (let j = 0; j < ny; j++) {
    const s = j * nx;
    const o = (j + P) * pw + P;
    for (let i = 0; i < nx; i++) out[o + i] = f[s + i]!;
    const left = f[s]!;
    const right = f[s + nx - 1]!;
    for (let t = 1; t <= P; t++) {
      const tl = t < nx - 1 ? t : nx - 1;
      out[o - t] = 2 * left - f[s + tl]!;
      out[o + nx - 1 + t] = 2 * right - f[s + nx - 1 - tl]!;
    }
  }
  const bottom = P * pw;
  const top = (P + ny - 1) * pw;
  for (let t = 1; t <= P; t++) {
    const tl = t < ny - 1 ? t : ny - 1;
    const ob = (P - t) * pw;
    const ot = (P + ny - 1 + t) * pw;
    const rb = (P + tl) * pw;
    const rt = (P + ny - 1 - tl) * pw;
    for (let c = 0; c < pw; c++) {
      out[ob + c] = 2 * out[bottom + c]! - out[rb + c]!;
      out[ot + c] = 2 * out[top + c]! - out[rt + c]!;
    }
  }
  const grid: GridSpec = { ...g, nx: pw, ny: ph, x0: g.x0 - P * g.cellSize, y0: g.y0 - P * g.cellSize };
  return { data: out, grid, P, pw };
}

/**
 * Sliding-window minimum and maximum over a (2r+1)² square clamped to the grid, O(N) independent of r
 * (separable monotonic-deque filter).
 */
export function slidingMinMax(g: GridSpec, f: ArrayLike<number>, r: number): { min: Float32Array; max: Float32Array } {
  const { nx, ny } = g;
  const n = nx * ny;
  const rowMin = new Float32Array(n);
  const rowMax = new Float32Array(n);
  const min = new Float32Array(n);
  const max = new Float32Array(n);
  const dqMin = new Int32Array(Math.max(nx, ny));
  const dqMax = new Int32Array(Math.max(nx, ny));
  const pass = (src: ArrayLike<number>, off: number, stride: number, len: number, dMin: Float32Array, dMax: Float32Array): void => {
    let h0 = 0;
    let t0 = 0;
    let h1 = 0;
    let t1 = 0;
    let next = 0;
    for (let i = 0; i < len; i++) {
      const hi = i + r < len - 1 ? i + r : len - 1;
      while (next <= hi) {
        const v = src[off + next * stride]!;
        while (t0 > h0 && src[off + dqMin[t0 - 1]! * stride]! >= v) t0--;
        dqMin[t0++] = next;
        while (t1 > h1 && src[off + dqMax[t1 - 1]! * stride]! <= v) t1--;
        dqMax[t1++] = next;
        next++;
      }
      const lo = i - r;
      while (dqMin[h0]! < lo) h0++;
      while (dqMax[h1]! < lo) h1++;
      dMin[off + i * stride] = src[off + dqMin[h0]! * stride]!;
      dMax[off + i * stride] = src[off + dqMax[h1]! * stride]!;
    }
  };
  for (let j = 0; j < ny; j++) pass(f, j * nx, 1, nx, rowMin, rowMax);
  // Columns: min of row-mins and max of row-maxes.
  const colMinTmp = new Float32Array(n);
  const colMaxTmp = new Float32Array(n);
  for (let i = 0; i < nx; i++) {
    pass(rowMin, i, nx, ny, min, colMaxTmp);
    pass(rowMax, i, nx, ny, colMinTmp, max);
  }
  return { min, max };
}

// ─────────────────────────────────────────────────────────────────────────────
// buildTerrain
// ─────────────────────────────────────────────────────────────────────────────

/** Replace non-finite elevations (no-data) by the mean of the finite ones. Returns the input if already clean. */
function sanitiseElevation(elevation: Float32Array): Float32Array {
  let bad = 0;
  let sum = 0;
  for (let k = 0; k < elevation.length; k++) {
    const z = elevation[k]!;
    if (Number.isFinite(z)) sum += z;
    else bad++;
  }
  if (bad === 0) return elevation;
  const mean = bad === elevation.length ? 0 : sum / (elevation.length - bad);
  const out = new Float32Array(elevation);
  for (let k = 0; k < out.length; k++) if (!Number.isFinite(out[k]!)) out[k] = mean;
  return out;
}

function stdDev(f: Float32Array): number {
  let s = 0;
  let s2 = 0;
  for (let k = 0; k < f.length; k++) {
    const v = f[k]!;
    s += v;
    s2 += v * v;
  }
  const m = s / f.length;
  return Math.sqrt(Math.max(0, s2 / f.length - m * m));
}

const clampNum = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * Derive all terrain fields and classify landforms.
 *
 * @param grid       raster geometry (cellSize in metres)
 * @param elevation  elevation (m ASL), row-major with j = 0 the southern row; stored by reference in the result
 *                   (a cleaned copy is made only if it contains non-finite values)
 * @param source     provenance string for display
 */
export function buildTerrain(grid: GridSpec, elevation: Float32Array, source: string, opts: BuildTerrainOptions = {}): Terrain {
  const { nx, ny, cellSize: h } = grid;
  const n = nx * ny;
  if (elevation.length !== n) throw new Error(`buildTerrain: elevation has ${elevation.length} cells, grid has ${n}`);
  const z = sanitiseElevation(elevation);

  // Radii in cells.
  const rL = Math.max(1, Math.round(TPI_RADIUS_M / h));
  const rS = Math.max(1, Math.round(TPI_SMALL_RADIUS_M / h));
  const rH = Math.max(1, Math.round(CURVATURE_SMOOTH_RADIUS_M / h));
  const rC = Math.max(1, Math.round(CRITICAL_POINT_SMOOTH_RADIUS_M / h));
  const rR = Math.max(1, Math.round(RELATIVE_POSITION_RADIUS_M / h));
  // Padding large enough that no filter window of an interior cell reaches the (clamped) padded edge.
  const P = Math.max(rL, rS, 2 * rH + 1, 2 * rC + 1);
  const pad = padOdd(grid, z, P);
  const pz = pad.data;
  const pw = pad.pw;

  // Neighbourhood means and tent-smoothed surfaces on the padded grid.
  const meanL = boxBlur(pad.grid, pz, rL);
  const meanS = boxBlur(pad.grid, pz, rS);
  const smoothH = boxBlur(pad.grid, boxBlur(pad.grid, pz, rH), rH);
  const smoothC = boxBlur(pad.grid, boxBlur(pad.grid, pz, rC), rC);

  const slopeDeg = new Float32Array(n);
  const aspectDeg = new Float32Array(n);
  const dzdx = new Float32Array(n);
  const dzdy = new Float32Array(n);
  const tpi = new Float32Array(n);
  const tpiSmall = new Float32Array(n);
  const curvature = new Float32Array(n);
  const hxx = new Float32Array(n);
  const hyy = new Float32Array(n);
  const hxy = new Float32Array(n);
  const planCurvature = new Float32Array(n);
  const profileCurvature = new Float32Array(n);
  // Critical-point Hessian and gradient (coarse scale), used only during classification.
  const cxx = new Float32Array(n);
  const cyy = new Float32Array(n);
  const cxy = new Float32Array(n);
  const cgx = new Float32Array(n);
  const cgy = new Float32Array(n);

  const inv8h = 1 / (8 * h);
  const invH2 = 1 / (h * h);
  const inv4H2 = 1 / (4 * h * h);
  const inv2h = 1 / (2 * h);
  let zMin = Infinity;
  let zMax = -Infinity;

  for (let j = 0; j < ny; j++) {
    let p = (j + P) * pw + P;
    let k = j * nx;
    for (let i = 0; i < nx; i++, p++, k++) {
      const ze = pz[p]!;
      if (ze < zMin) zMin = ze;
      if (ze > zMax) zMax = ze;
      // Horn (1981): a b c / d e f / g h i with a, b, c on the NORTHERN row (j + 1).
      const a = pz[p + pw - 1]!;
      const b = pz[p + pw]!;
      const c = pz[p + pw + 1]!;
      const d = pz[p - 1]!;
      const f = pz[p + 1]!;
      const gg = pz[p - pw - 1]!;
      const hh = pz[p - pw]!;
      const ii = pz[p - pw + 1]!;
      const gx = (c + 2 * f + ii - (a + 2 * d + gg)) * inv8h;
      const gy = (a + 2 * b + c - (gg + 2 * hh + ii)) * inv8h;
      dzdx[k] = gx;
      dzdy[k] = gy;
      const sl = Math.atan(Math.sqrt(gx * gx + gy * gy)) * RAD;
      slopeDeg[k] = sl;
      if (sl < FLAT_SLOPE_DEG) aspectDeg[k] = NaN;
      else {
        // Azimuth of the downhill vector (−gx, −gy): atan2(east, north).
        let az = Math.atan2(-gx, -gy) * RAD;
        if (az < 0) az += 360;
        aspectDeg[k] = az >= 360 ? 0 : az;
      }
      tpi[k] = ze - meanL[p]!;
      tpiSmall[k] = ze - meanS[p]!;

      // Fine-scale Hessian → curvature.
      const s0 = smoothH[p]!;
      const sxx = (smoothH[p + 1]! - 2 * s0 + smoothH[p - 1]!) * invH2;
      const syy = (smoothH[p + pw]! - 2 * s0 + smoothH[p - pw]!) * invH2;
      const sxy = (smoothH[p + pw + 1]! - smoothH[p + pw - 1]! - smoothH[p - pw + 1]! + smoothH[p - pw - 1]!) * inv4H2;
      hxx[k] = sxx;
      hyy[k] = syy;
      hxy[k] = sxy;
      // Split the Laplacian into down-slope (profile) and across-slope (tangential) parts using the gradient
      // direction of the same smoothed surface.
      const px = (smoothH[p + 1]! - smoothH[p - 1]!) * inv2h;
      const py = (smoothH[p + pw]! - smoothH[p - pw]!) * inv2h;
      const g2 = px * px + py * py;
      const lap = sxx + syy;
      const zss = g2 > 1e-10 ? (sxx * px * px + 2 * sxy * px * py + syy * py * py) / g2 : 0.5 * lap;
      const ztt = lap - zss;
      profileCurvature[k] = g2 > 1e-10 ? -zss : 0;
      planCurvature[k] = g2 > 1e-10 ? -ztt : 0;
      const beta = sl <= 2 ? 1 : sl >= 10 ? 0.25 : 1 - (0.75 * (sl - 2)) / 8;
      curvature[k] = -(ztt + beta * zss);

      // Coarse-scale Hessian and gradient for critical points.
      const c0 = smoothC[p]!;
      cxx[k] = (smoothC[p + 1]! - 2 * c0 + smoothC[p - 1]!) * invH2;
      cyy[k] = (smoothC[p + pw]! - 2 * c0 + smoothC[p - pw]!) * invH2;
      cxy[k] = (smoothC[p + pw + 1]! - smoothC[p + pw - 1]! - smoothC[p - pw + 1]! + smoothC[p - pw - 1]!) * inv4H2;
      cgx[k] = (smoothC[p + 1]! - smoothC[p - 1]!) * inv2h;
      cgy[k] = (smoothC[p + pw]! - smoothC[p - pw]!) * inv2h;
    }
  }

  // Relative slope position and local relief within ≈ 1 km (window clamped to the domain).
  const mm = slidingMinMax(grid, z, rR);
  const relPos = new Float32Array(n);
  const localRelief = new Float32Array(n);
  const heightAboveValley = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const range = mm.max[k]! - mm.min[k]!;
    localRelief[k] = range;
    heightAboveValley[k] = z[k]! - mm.min[k]!;
    relPos[k] = range > 1 ? (z[k]! - mm.min[k]!) / range : 0.5;
  }

  // Thresholds resolved for this domain.
  const base: LandformThresholds = { ...DEFAULT_LANDFORM_THRESHOLDS, ...opts.thresholds };
  const tL = clampNum(base.tpiSdFactor * stdDev(tpi), base.tpiMin, base.tpiMax);
  const tS = clampNum(base.tpiSmallSdFactor * stdDev(tpiSmall), base.tpiSmallMin, base.tpiSmallMax);
  const thresholds = { ...base, tpiUnit: tL, tpiSmallUnit: tS };

  const landform = new Uint8Array(n);
  classifyLandforms(n, thresholds, slopeDeg, tpi, tpiSmall, curvature, planCurvature, relPos, cxx, cyy, cxy, cgx, cgy, landform);

  const terrain: Terrain = {
    grid,
    elevation: z,
    slopeDeg,
    aspectDeg,
    dzdx,
    dzdy,
    tpi,
    curvature,
    landform,
    minElevation: zMin,
    maxElevation: zMax,
    source,
  };
  derivedCache.set(terrain, { tpiSmall, planCurvature, profileCurvature, hxx, hyy, hxy, relPos, localRelief, heightAboveValley, thresholds });
  return terrain;
}

/**
 * Landform decision list, in priority order:
 *  1. Cliff        slope > cliffSlopeDeg (45°).
 *  2. Peak         within criticalRadiusM of a maximum of the 150 m-smoothed surface (both Hessian eigenvalues
 *                  < −criticalCurvature), TPI > 0.5 tL, slope < criticalMaxSlopeDeg.
 *  3. Saddle       within criticalRadiusM of a saddle point (one eigenvalue > +criticalCurvature, the other
 *                  < −criticalCurvature: valley-like along the ridge, ridge-like across it), TPI > −0.5 tL, gentle.
 *  4. Ridge        gentle (slope < ridgeMaxSlopeDeg) and TPI > tL with a locally convex crest (TPI100 > 0), or
 *                  TPI > 0.5 tL and clearly convex (TPI100 > tS, curvature > curvature threshold).
 *  5. Spur         convex (curvature > threshold), divergent across the slope (tangential curvature > 0.5·threshold),
 *                  raised at either scale (TPI100 > tS or TPI300 > 0.5 tL) and sloping (≥ spurMinSlopeDeg).
 *  6. Gully        concave (curvature < −threshold), convergent across the slope (tangential curvature
 *                  < −0.5·threshold: a trough running DOWN the slope, not a concave slope foot), sunken at either
 *                  scale (TPI100 < −tS: narrow gully/chute; TPI300 < −0.5 tL: broader draw or sloping valley) and
 *                  sloping (≥ gullyMinSlopeDeg).
 *  7. ValleyFloor  gentle (< valleyFloorMaxSlopeDeg) and TPI < −0.5 tL, or gentle and concave (TPI100 < −tS).
 *  8. Flat         slope < flatSlopeDeg.
 *  9. Upper/Mid/LowerSlope from TPI (±0.5 tL, as Weiss 2001) and, where TPI is neutral (planar walls longer than
 *     the TPI window), relative elevation within ≈ 1 km (thirds).
 */
function classifyLandforms(
  n: number,
  t: LandformThresholds & { tpiUnit: number; tpiSmallUnit: number },
  slope: Float32Array,
  tpi: Float32Array,
  tpiS: Float32Array,
  curv: Float32Array,
  plan: Float32Array,
  relPos: Float32Array,
  cxx: Float32Array,
  cyy: Float32Array,
  cxy: Float32Array,
  cgx: Float32Array,
  cgy: Float32Array,
  out: Uint8Array,
): void {
  const tL = t.tpiUnit;
  const tS = t.tpiSmallUnit;
  const kc = t.curvature;
  const kcp = t.criticalCurvature;
  const rc2 = t.criticalRadiusM * t.criticalRadiusM;
  for (let k = 0; k < n; k++) {
    const s = slope[k]!;
    const T = tpi[k]!;
    const Ts = tpiS[k]!;
    const cv = curv[k]!;
    let lf: Landform;
    if (s > t.cliffSlopeDeg) {
      out[k] = Landform.Cliff;
      continue;
    }
    // Critical points of the coarse surface: eigen-decomposition of the 2×2 symmetric Hessian.
    if (s < t.criticalMaxSlopeDeg) {
      const a = cxx[k]!;
      const c = cyy[k]!;
      const b = cxy[k]!;
      const mean = 0.5 * (a + c);
      const rad = Math.sqrt(0.25 * (a - c) * (a - c) + b * b);
      const l1 = mean + rad; // larger eigenvalue
      const l2 = mean - rad;
      const isPeak = l1 < -kcp && T > 0.5 * tL;
      const isSaddle = l1 > kcp && l2 < -kcp && T > -0.5 * tL;
      if (isPeak || isSaddle) {
        // Newton step to the critical point: δ = H⁻¹ g, measured in the eigenbasis.
        const th = 0.5 * Math.atan2(2 * b, a - c); // direction (radians from +x) of eigenvector for l1
        const e1x = Math.cos(th);
        const e1y = Math.sin(th);
        const gx = cgx[k]!;
        const gy = cgy[k]!;
        const g1 = gx * e1x + gy * e1y;
        const g2 = -gx * e1y + gy * e1x;
        const d1 = g1 / l1;
        const d2 = g2 / l2;
        if (d1 * d1 + d2 * d2 < rc2) {
          out[k] = isPeak ? Landform.Peak : Landform.Saddle;
          continue;
        }
      }
    }
    const convex = cv > kc && Ts > tS;
    const concave = cv < -kc && Ts < -tS;
    const pc = plan[k]!;
    if (s < t.ridgeMaxSlopeDeg && ((T > tL && Ts > 0) || (T > 0.5 * tL && convex))) lf = Landform.Ridge;
    else if (cv > kc && pc > 0.5 * kc && (Ts > tS || T > 0.5 * tL) && s >= t.spurMinSlopeDeg) lf = Landform.Spur;
    else if (cv < -kc && pc < -0.5 * kc && (Ts < -tS || T < -0.5 * tL) && s >= t.gullyMinSlopeDeg) lf = Landform.Gully;
    else if (s < t.valleyFloorMaxSlopeDeg && (T < -0.5 * tL || concave)) lf = Landform.ValleyFloor;
    else if (s < t.flatSlopeDeg) lf = Landform.Flat;
    else {
      const rp = relPos[k]!;
      if (T > 0.5 * tL || (T > -0.5 * tL && rp > t.upperSlopeRelPos)) lf = Landform.UpperSlope;
      else if (T < -0.5 * tL || (T < 0.5 * tL && rp < t.lowerSlopeRelPos)) lf = Landform.LowerSlope;
      else lf = Landform.MidSlope;
    }
    out[k] = lf;
  }
}

/**
 * Derived fields for a Terrain. Cached per object; if the Terrain was built elsewhere (e.g. structured-cloned
 * into a worker) they are recomputed from its elevation once, with default thresholds.
 */
export function terrainDerived(terrain: Terrain): TerrainDerived {
  let d = derivedCache.get(terrain);
  if (!d) {
    const rebuilt = buildTerrain(terrain.grid, terrain.elevation, terrain.source);
    d = derivedCache.get(rebuilt)!;
    derivedCache.set(terrain, d);
  }
  return d;
}

// ─────────────────────────────────────────────────────────────────────────────
// Point helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Slope angle (deg) along a compass azimuth at cell k: positive when moving along `azimuthDeg` goes uphill,
 * negative downhill, 0 across the slope. atan(∇z · û) with û = (sin az, cos az).
 */
export function directionalSlopeDeg(terrain: Terrain, k: number, azimuthDeg: number): number {
  const r = azimuthDeg * (Math.PI / 180);
  return Math.atan(terrain.dzdx[k]! * Math.sin(r) + terrain.dzdy[k]! * Math.cos(r)) * RAD;
}

/** Compass azimuth (deg, [0, 360)) of steepest ascent at cell k; NaN where the slope is < {@link FLAT_SLOPE_DEG}. */
export function upslopeAzimuth(terrain: Terrain, k: number): number {
  if (!(terrain.slopeDeg[k]! >= FLAT_SLOPE_DEG)) return NaN;
  const az = Math.atan2(terrain.dzdx[k]!, terrain.dzdy[k]!) * RAD;
  return az < 0 ? az + 360 : az;
}

/** Principal curvatures and directions of the ≈ 50 m-smoothed surface at cell k. */
export interface HessianInfo {
  /** Larger eigenvalue (1/m): strongly positive across a valley or gully (concave up). */
  lambdaMax: number;
  /** Smaller eigenvalue (1/m): strongly negative across a ridge or spur (convex). */
  lambdaMin: number;
  /** Compass orientation (deg, [0, 180)) of the eigenvector of lambdaMax, i.e. ACROSS a valley. */
  acrossValleyAzimuth: number;
}

export function hessianAt(terrain: Terrain, k: number): HessianInfo {
  const d = terrainDerived(terrain);
  const a = d.hxx[k]!;
  const c = d.hyy[k]!;
  const b = d.hxy[k]!;
  const mean = 0.5 * (a + c);
  const rad = Math.sqrt(0.25 * (a - c) * (a - c) + b * b);
  const th = 0.5 * Math.atan2(2 * b, a - c) * RAD; // math angle (deg from +x, CCW) of the lambdaMax eigenvector
  let az = (90 - th) % 180;
  if (az < 0) az += 180;
  return { lambdaMax: mean + rad, lambdaMin: mean - rad, acrossValleyAzimuth: az };
}

/**
 * Orientation (deg, [0, 180)) of a valley or gully axis at cell k, from the Hessian of the smoothed surface: the
 * eigenvector of the smaller eigenvalue where the larger one shows a clear trough (λmax > curvature threshold and
 * λmax > 2 |λmin|, i.e. an elongated trough rather than a bowl). NaN where the terrain is not valley-shaped.
 * Use it to detect wind channelling along valleys (cf. Sharples 2009; Whiteman 2000).
 */
export function valleyAxisAzimuth(terrain: Terrain, k: number): number {
  const d = terrainDerived(terrain);
  const hs = hessianAt(terrain, k);
  if (!(hs.lambdaMax > d.thresholds.curvature * 0.5) || hs.lambdaMax < 2 * Math.abs(hs.lambdaMin)) return NaN;
  const az = hs.acrossValleyAzimuth + 90;
  return az >= 180 ? az - 180 : az;
}

/**
 * The valley axis at cell k oriented DOWN-valley (deg, [0, 360)): the direction cold air drains at night and the
 * opposite of the daytime up-valley wind. NaN where there is no valley axis or the axis is level.
 */
export function downValleyAzimuth(terrain: Terrain, k: number): number {
  const ax = valleyAxisAzimuth(terrain, k);
  if (Number.isNaN(ax)) return NaN;
  const along = directionalSlopeDeg(terrain, k, ax);
  if (Math.abs(along) < 0.1) return NaN;
  return along > 0 ? (ax + 180) % 360 : ax;
}

/**
 * Winstral et al. (2002) maximum upwind slope Sx (deg) for a wind blowing FROM `windFromDeg`: the largest elevation
 * angle from each cell to the terrain upwind within `maxDistM`. Sx > 0: sheltered by higher ground upwind (lee
 * slopes behind a crest, where the wind separates and lee eddies / vorticity-driven lateral spread can occur);
 * Sx < 0: exposed (windward slopes and crests, where wind speeds up). Samples beyond the grid edge are ignored.
 * Bilinear sampling every cell width; O(N · maxDistM / cellSize).
 */
export function windShelter(terrain: Terrain, windFromDeg: number, maxDistM = 300): Float32Array {
  const { grid, elevation: z } = terrain;
  const { nx, ny, cellSize: h } = grid;
  const out = new Float32Array(nx * ny);
  const r = windFromDeg * (Math.PI / 180);
  // Upwind step in cell units.
  const di = Math.sin(r);
  const dj = Math.cos(r);
  const steps = Math.max(1, Math.round(maxDistM / h));
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const z0 = z[k]!;
      let best = -Infinity;
      for (let s = 1; s <= steps; s++) {
        const fx = i + di * s;
        const fy = j + dj * s;
        if (fx < 0 || fy < 0 || fx > nx - 1 || fy > ny - 1) break;
        const i0 = Math.min(nx - 2, Math.floor(fx));
        const j0 = Math.min(ny - 2, Math.floor(fy));
        const tx = fx - i0;
        const ty = fy - j0;
        const q = j0 * nx + i0;
        const zs = (z[q]! * (1 - tx) + z[q + 1]! * tx) * (1 - ty) + (z[q + nx]! * (1 - tx) + z[q + nx + 1]! * tx) * ty;
        const tan = (zs - z0) / (s * h);
        if (tan > best) best = tan;
      }
      out[k] = best === -Infinity ? 0 : Math.atan(best) * RAD;
    }
  }
  return out;
}

const COMPASS_POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
const COMPASS_WORDS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'] as const;

/** 8-point compass abbreviation of an azimuth ('N', 'NE', …), or '' for NaN. */
export function compassPoint(azimuthDeg: number): string {
  if (!Number.isFinite(azimuthDeg)) return '';
  return COMPASS_POINTS[Math.round((((azimuthDeg % 360) + 360) % 360) / 45) % 8]!;
}

/** Plain-language aspect, e.g. "north-west-facing", or "flat" where aspect is undefined. */
export function aspectName(aspectDeg: number): string {
  if (!Number.isFinite(aspectDeg)) return 'flat';
  return `${COMPASS_WORDS[Math.round((((aspectDeg % 360) + 360) % 360) / 45) % 8]!}-facing`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Relief statistics
// ─────────────────────────────────────────────────────────────────────────────

export type ReliefClass = 'flat' | 'undulating' | 'hilly' | 'mountainous';

export interface ReliefStats {
  minElevation: number;
  maxElevation: number;
  /** max − min over the whole domain (m). */
  relief: number;
  meanElevation: number;
  stdElevation: number;
  meanSlopeDeg: number;
  medianSlopeDeg: number;
  p90SlopeDeg: number;
  maxSlopeDeg: number;
  /** Fractions of cells steeper than 20° (fire spread ≈ 4× flat) and 30° (≈ 8×; eruptive potential). */
  fractionSteep20: number;
  fractionSteep30: number;
  /** Median local relief within ≈ 1 km (m), and the Hammond-style class it implies. */
  medianLocalRelief: number;
  reliefClass: ReliefClass;
  /** Mean terrain ruggedness index (Riley et al. 1999): mean |Δz| to the 8 neighbours (m). */
  meanTRI: number;
  /** Fraction of cells in each Landform class, indexed by the enum value. */
  landformFractions: number[];
}

/**
 * Domain-wide relief statistics (used to decide whether mountain phenomena matter, and for the scenario summary).
 * Relief classes use the median ≈ 2 km-window local relief: < 30 m flat, < 90 m undulating, < 300 m hilly,
 * otherwise mountainous (after Hammond 1964).
 */
export function reliefStats(terrain: Terrain): ReliefStats {
  const { grid, elevation: z, slopeDeg } = terrain;
  const { nx, ny } = grid;
  const n = nx * ny;
  const d = terrainDerived(terrain);
  let sum = 0;
  let sum2 = 0;
  let sSum = 0;
  let sMax = 0;
  let steep20 = 0;
  let steep30 = 0;
  const lf = new Array<number>(11).fill(0);
  for (let k = 0; k < n; k++) {
    const v = z[k]!;
    sum += v;
    sum2 += v * v;
    const s = slopeDeg[k]!;
    sSum += s;
    if (s > sMax) sMax = s;
    if (s > 20) steep20++;
    if (s > 30) steep30++;
    const c = terrain.landform[k]!;
    if (c < lf.length) lf[c]!++;
  }
  // Riley TRI.
  let tri = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const zc = z[k]!;
      let acc = 0;
      let cnt = 0;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj >= ny) continue;
        for (let di = -1; di <= 1; di++) {
          const ii = i + di;
          if ((di === 0 && dj === 0) || ii < 0 || ii >= nx) continue;
          acc += Math.abs(z[jj * nx + ii]! - zc);
          cnt++;
        }
      }
      tri += cnt ? acc / cnt : 0;
    }
  }
  const sortedSlope = Float32Array.from(slopeDeg).sort();
  const sortedRelief = Float32Array.from(d.localRelief).sort();
  const q = (a: Float32Array, p: number): number => a[Math.min(a.length - 1, Math.floor(p * a.length))]!;
  const medRelief = q(sortedRelief, 0.5);
  const mean = sum / n;
  return {
    minElevation: terrain.minElevation,
    maxElevation: terrain.maxElevation,
    relief: terrain.maxElevation - terrain.minElevation,
    meanElevation: mean,
    stdElevation: Math.sqrt(Math.max(0, sum2 / n - mean * mean)),
    meanSlopeDeg: sSum / n,
    medianSlopeDeg: q(sortedSlope, 0.5),
    p90SlopeDeg: q(sortedSlope, 0.9),
    maxSlopeDeg: sMax,
    fractionSteep20: steep20 / n,
    fractionSteep30: steep30 / n,
    medianLocalRelief: medRelief,
    reliefClass: medRelief < 30 ? 'flat' : medRelief < 90 ? 'undulating' : medRelief < 300 ? 'hilly' : 'mountainous',
    meanTRI: tri / n,
    landformFractions: lf.map((c) => c / n),
  };
}

/** Human-readable landform names (for UI and explanations). */
export const LANDFORM_NAMES: Record<Landform, string> = {
  [Landform.Flat]: 'Flat ground',
  [Landform.Ridge]: 'Ridge top',
  [Landform.Spur]: 'Spur',
  [Landform.UpperSlope]: 'Upper slope',
  [Landform.MidSlope]: 'Mid slope',
  [Landform.LowerSlope]: 'Lower slope',
  [Landform.Gully]: 'Gully',
  [Landform.ValleyFloor]: 'Valley floor',
  [Landform.Saddle]: 'Saddle',
  [Landform.Peak]: 'Peak',
  [Landform.Cliff]: 'Cliff',
};
