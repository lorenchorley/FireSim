/**
 * Static terrain features for the fire, atmosphere, ember and explain modules (spec docs/research/00-synthesis.md
 * §2.2 `TerrainFeatures`, details in §7.6 trench/gully base, §7.7 gully axis, §7.9 crest search, §8.6 slope-flow
 * geometry). Computed once per scenario on the fire grid by {@link computeTerrainFeatures}.
 *
 * Algorithms (N = fire-grid cells; all O(N) or O(N log N), typed arrays, no per-cell allocation):
 *  - **Depression filling**: Priority-Flood + ε (Barnes et al. 2014) seeded from the domain edge, with a FIFO "pit"
 *    queue for flats and depressions, so every interior cell has a strictly lower neighbour on the filled surface.
 *  - **Flow**: D8 steepest descent on the filled surface; upslope area by a topological (Kahn) sweep; `drainage` =
 *    flowAcc ≥ 5 ha.
 *  - **Gully axis** (drainage cells): azimuth from a point `axisHalfSpanM` downstream to a point the same distance
 *    upstream along the main stem (largest-area donor) — the up-gully direction, smoothed over the D8 zig-zag.
 *  - **Trench score T** (§7.6): transects ⊥ to the axis at 10 m steps to ±150 m; per side the crest is the maximum
 *    rise h at distance d, wall slope δ = atan(h/d); `T = clamp((min δ − 10°)/10°)·clamp((min h − 10 m)/20 m)`; side
 *    walls within 60 m take `T_axis·(1 − d/60)` and the axis azimuth of the nearest drainage cell.
 *  - **gullyBase**: lowest cell of each 8-connected (drainage ∧ T ≥ 0.3) segment; side walls with T ≥ 0.3 inherit it.
 *  - **valleyDrop / crestRise / crestDist** (§8.6): follow the D8 descent (resp. steepest ascent on the DEM) until the
 *    path gradient over the next `pathWindowM` falls below `pathFlatDeg` (valley floor / crest plateau) or the path
 *    ends; memoised along the paths.
 *  - **slope30**: Horn slope of the DEM block-averaged to 30 m (the 10 m DEM when given), sampled on the fire grid.
 *  - **ridge / saddle / cliff / narrowValley** masks as in §2.2; **crest(k, windFrom)** (§7.9) marches 30 m steps
 *    toward the wind up to 600 m and caches the current 22.5° sector only (Float32/Int32 per cell).
 *
 * Every [H] threshold is in {@link TERRAIN_FEATURE_PARAMS}.
 */
import { sampleBilinear, type GridSpec } from '../core/grid';
import { Landform, type Terrain } from '../core/types';
import type { TerrainFeatures } from '../core/simTypes';
import type { TerrainDerived } from '../terrain';

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export const TERRAIN_FEATURE_PARAMS = {
  /** Drainage = upslope area ≥ 5 ha (spec §2.2) [H]. */
  drainageMinAreaM2: 50000,
  /** ε of the Priority-Flood + ε fill (m); numerical only. */
  fillEpsilonM: 1e-4,
  /** Gully axis: half-span of the along-channel difference (m) [H]. */
  axisHalfSpanM: 90,
  /** Trench score (§7.6) [H]. */
  trench: { stepM: 10, halfWidthM: 150, slopeLoDeg: 10, slopeSpanDeg: 10, riseLoM: 10, riseSpanM: 20, wallInfluenceM: 60, baseMinT: 0.3 },
  /**
   * Saddle: Landform.Saddle, or hxx·hyy − hxy² < −c² with slope ≤ maxSlopeDeg and relPos ≥ minRelPos (§2.2) [H].
   * c = minCurvatureFactor × the terrain's critical-point curvature threshold: without it every weakly hyperbolic
   * plateau cell qualifies (9 % of Katoomba; 3.9 % with the factor 2, against 2.1 % Landform.Saddle).
   */
  saddle: { maxSlopeDeg: 10, minRelPos: 0.6, minCurvatureFactor: 2 },
  /** Ridge: Landform ∈ {Ridge, Peak, Spur} or relPos ≥ minRelPos (§2.2) [H]. */
  ridge: { minRelPos: 0.9 },
  /** Cliff: Landform.Cliff, cliffFraction ≥ minFraction or slopeP90 ≥ p90SlopeDeg; sub-cell cliff slope (§2.1) [H]. */
  cliff: { minFraction: 0.3, p90SlopeDeg: 60, subCellCliffDeg: 60 },
  /** Narrow valley (§2.2, card S43): floor width ≤ 200 m, both walls ≥ 15° within 300 m; floor edge = first 10 m rise [H]. */
  narrowValley: { maxFloorWidthM: 200, minWallSlopeDeg: 15, searchM: 300, footRiseM: 10 },
  /** slope30 averaging scale (m) (§2.2; VLS calibration scale). */
  slopeScaleM: 30,
  /** Path end of valleyDrop / crestRise: gradient over the next window below this (valley floor / plateau) [H]. */
  pathFlatDeg: 4,
  pathWindowM: 90,
  /** Crest search (§7.9): step, maximum distance, cache sector width. */
  crest: { stepM: 30, maxDistM: 600, sectorDeg: 22.5 },
} as const;

const P = TERRAIN_FEATURE_PARAMS;

/** Result of an upwind crest search (spec §7.9). */
export interface CrestInfo {
  /** Horizontal distance from the cell to the crest (m). */
  d: number;
  /** Crest elevation (m ASL). */
  zCrest: number;
  /** zCrest − valley floor below the cell (z_k − heightAboveValley_k) (m). */
  relief: number;
  /** Crest cell index. */
  kCrest: number;
}

/** Plain-data form of the features (structured-clone / transfer safe); see {@link restoreTerrainFeatures}. */
export interface TerrainFeaturesData {
  flowAcc: Float32Array;
  drainage: Uint8Array;
  trench: Float32Array;
  gullyAxis: Float32Array;
  gullyBase: Int32Array;
  saddle: Uint8Array;
  ridge: Uint8Array;
  cliff: Uint8Array;
  narrowValley: Uint8Array;
  slope30: Float32Array;
  valleyDrop: Float32Array;
  crestRise: Float32Array;
  crestDist: Float32Array;
  /** D8 receiver on the filled surface (−1 = outlet at the domain edge). */
  receiver: Int32Array;
  /** Steepest-ascent neighbour on the DEM (−1 = local maximum). */
  ascent: Int32Array;
}

/** TerrainFeatures with the allocation-free crest API and the flow graph. */
export interface TerrainFeaturesExt extends TerrainFeatures {
  readonly receiver: Int32Array;
  readonly ascent: Int32Array;
  /** Allocation-free crest search: fills `out` and returns true, or returns false when there is no crest. */
  crestInto(k: number, windFromDeg: number, out: CrestInfo): boolean;
  /**
   * Crest arrays of the whole grid for the sector of `windFromDeg` (computes every cell; the arrays are the live
   * sector cache: valid until the next call with another sector). kCrest = −1 where there is no crest.
   */
  crestSector(windFromDeg: number): { sectorFromDeg: number; d: Float32Array; zCrest: Float32Array; relief: Float32Array; kCrest: Int32Array };
  /** Plain arrays for transfer to a worker. */
  data(): TerrainFeaturesData;
}

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

const DI = [1, 1, 0, -1, -1, -1, 0, 1] as const;
const DJ = [0, 1, 1, 1, 0, -1, -1, -1] as const;
const DIST = [1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2] as const;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const wrap360 = (d: number): number => ((d % 360) + 360) % 360;

/** Min-heap of cell indices keyed by Float64 elevation (Priority-Flood). */
class MinHeap {
  private readonly keys: Float64Array;
  private readonly vals: Int32Array;
  size = 0;
  constructor(cap: number) {
    this.keys = new Float64Array(cap);
    this.vals = new Int32Array(cap);
  }
  push(v: number, key: number): void {
    const keys = this.keys;
    const vals = this.vals;
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p]! <= key) break;
      keys[i] = keys[p]!;
      vals[i] = vals[p]!;
      i = p;
    }
    keys[i] = key;
    vals[i] = v;
  }
  pop(): number {
    const keys = this.keys;
    const vals = this.vals;
    const top = vals[0]!;
    const n = --this.size;
    const lk = keys[n]!;
    const lv = vals[n]!;
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && keys[c + 1]! < keys[c]!) c++;
      if (keys[c]! >= lk) break;
      keys[i] = keys[c]!;
      vals[i] = vals[c]!;
      i = c;
    }
    keys[i] = lk;
    vals[i] = lv;
    return top;
  }
}

/** Bilinear elevation at local (x, y), NaN outside the grid (no clamping, so transects stop at the edge). */
function zAt(g: GridSpec, z: Float32Array, x: number, y: number): number {
  const fx = (x - g.x0) / g.cellSize;
  const fy = (y - g.y0) / g.cellSize;
  if (!(fx >= 0 && fy >= 0 && fx <= g.nx - 1 && fy <= g.ny - 1)) return NaN;
  let i0 = Math.floor(fx);
  let j0 = Math.floor(fy);
  if (i0 > g.nx - 2) i0 = g.nx - 2;
  if (j0 > g.ny - 2) j0 = g.ny - 2;
  const tx = fx - i0;
  const ty = fy - j0;
  const k = j0 * g.nx + i0;
  return (z[k]! * (1 - tx) + z[k + 1]! * tx) * (1 - ty) + (z[k + g.nx]! * (1 - tx) + z[k + g.nx + 1]! * tx) * ty;
}

// ─────────────────────────────────────────────────────────────────────────────
// Flow: Priority-Flood + ε, D8 receivers, accumulation
// ─────────────────────────────────────────────────────────────────────────────

/** Priority-Flood + ε depression filling (Float64 result; every interior cell drains to the edge). */
export function priorityFloodFill(g: GridSpec, z: ArrayLike<number>, eps: number = P.fillEpsilonM): Float64Array {
  const { nx, ny } = g;
  const n = nx * ny;
  const zf = new Float64Array(n);
  const closed = new Uint8Array(n);
  const heap = new MinHeap(n);
  const pit = new Int32Array(n);
  let pitHead = 0;
  let pitTail = 0;
  for (let k = 0; k < n; k++) zf[k] = Number.isFinite(z[k]!) ? z[k]! : -1e9;
  for (let i = 0; i < nx; i++) {
    for (const j of ny > 1 ? [0, ny - 1] : [0]) {
      const k = j * nx + i;
      if (!closed[k]) {
        closed[k] = 1;
        heap.push(k, zf[k]!);
      }
    }
  }
  for (let j = 1; j < ny - 1; j++) {
    for (const i of nx > 1 ? [0, nx - 1] : [0]) {
      const k = j * nx + i;
      if (!closed[k]) {
        closed[k] = 1;
        heap.push(k, zf[k]!);
      }
    }
  }
  while (heap.size > 0 || pitHead < pitTail) {
    const c = pitHead < pitTail ? pit[pitHead++]! : heap.pop();
    const ci = c % nx;
    const cj = (c - ci) / nx;
    const zc = zf[c]!;
    for (let d = 0; d < 8; d++) {
      const i = ci + DI[d]!;
      const j = cj + DJ[d]!;
      if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
      const k = j * nx + i;
      if (closed[k]) continue;
      closed[k] = 1;
      if (zf[k]! <= zc + eps) {
        zf[k] = zc + eps;
        pit[pitTail++] = k;
      } else heap.push(k, zf[k]!);
    }
  }
  return zf;
}

/** D8 steepest-descent receivers on a (filled) surface; −1 where no neighbour is lower (edge outlets). */
export function d8Receivers(g: GridSpec, zf: ArrayLike<number>): Int32Array {
  const { nx, ny } = g;
  const recv = new Int32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const c = j * nx + i;
      const zc = zf[c]!;
      let best = -1;
      let bestS = 0;
      for (let d = 0; d < 8; d++) {
        const ii = i + DI[d]!;
        const jj = j + DJ[d]!;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const k = jj * nx + ii;
        const s = (zc - zf[k]!) / DIST[d]!;
        if (s > bestS) {
          bestS = s;
          best = k;
        }
      }
      recv[c] = best;
    }
  }
  return recv;
}

/**
 * Upslope area (m²) by a topological sweep of the receiver forest. Returns the accumulation, the processing order
 * (upstream before downstream) and the main-stem donor of each cell (largest-area donor, −1 if none).
 */
export function flowAccumulation(g: GridSpec, recv: Int32Array): { acc: Float32Array; order: Int32Array; mainDonor: Int32Array } {
  const n = g.nx * g.ny;
  const area = g.cellSize * g.cellSize;
  const indeg = new Int32Array(n);
  for (let k = 0; k < n; k++) if (recv[k]! >= 0) indeg[recv[k]!]++;
  const acc = new Float64Array(n).fill(area);
  const order = new Int32Array(n);
  const mainDonor = new Int32Array(n).fill(-1);
  const bestAcc = new Float64Array(n);
  let head = 0;
  let tail = 0;
  for (let k = 0; k < n; k++) if (indeg[k] === 0) order[tail++] = k;
  while (head < tail) {
    const c = order[head++]!;
    const r = recv[c]!;
    if (r < 0) continue;
    acc[r] += acc[c]!;
    if (acc[c]! > bestAcc[r]!) {
      bestAcc[r] = acc[c]!;
      mainDonor[r] = c;
    }
    if (--indeg[r] === 0) order[tail++] = r;
  }
  return { acc: Float32Array.from(acc), order, mainDonor };
}

// ─────────────────────────────────────────────────────────────────────────────
// Paths: valley floor below (D8 descent) and crest above (steepest ascent)
// ─────────────────────────────────────────────────────────────────────────────

/** Steepest-ascent neighbour on the DEM (−1 at local maxima and on exactly level ground). */
function ascentPointers(g: GridSpec, z: Float32Array): Int32Array {
  const { nx, ny } = g;
  const up = new Int32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const c = j * nx + i;
      const zc = z[c]!;
      let best = -1;
      let bestS = 0;
      for (let d = 0; d < 8; d++) {
        const ii = i + DI[d]!;
        const jj = j + DJ[d]!;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const k = jj * nx + ii;
        const s = (z[k]! - zc) / DIST[d]!;
        if (s > bestS) {
          bestS = s;
          best = k;
        }
      }
      up[c] = best;
    }
  }
  return up;
}

/** Horizontal distance (m) between neighbouring (or equal) cells a and b. */
function stepDist(nx: number, h: number, a: number, b: number): number {
  const di = Math.abs((a % nx) - (b % nx));
  const dj = Math.abs(Math.floor(a / nx) - Math.floor(b / nx));
  return di + dj === 2 ? h * Math.SQRT2 : h * (di + dj);
}

/**
 * Follow `next` pointers from every cell until an end cell (a pointer of −1, or where the elevation change over the
 * next `windowM` along the path is below tan(flatDeg)·distance). Memoised; returns the end cell and the path length.
 * `sign` = −1 for descent (drop), +1 for ascent (rise).
 */
function pathEnds(g: GridSpec, z: Float32Array, next: Int32Array, sign: 1 | -1): { end: Int32Array; dist: Float32Array } {
  const { nx } = g;
  const h = g.cellSize;
  const n = nx * g.ny;
  const end = new Int32Array(n).fill(-1);
  const dist = new Float32Array(n);
  const tanFlat = Math.tan(P.pathFlatDeg * DEG);
  const windowM = Math.max(P.pathWindowM, h);
  const stack = new Int32Array(n);
  const isEnd = (c: number): boolean => {
    let k = c;
    let L = 0;
    while (L < windowM) {
      const nk = next[k]!;
      if (nk < 0) break;
      L += stepDist(nx, h, k, nk);
      k = nk;
    }
    if (L <= 0) return true;
    return sign * (z[k]! - z[c]!) < tanFlat * L;
  };
  for (let s = 0; s < n; s++) {
    if (end[s]! >= 0) continue;
    let top = 0;
    let c = s;
    // Walk until a resolved cell or an end cell; push the unresolved chain.
    while (end[c]! < 0) {
      if (isEnd(c)) {
        end[c] = c;
        dist[c] = 0;
        break;
      }
      stack[top++] = c;
      c = next[c]!;
    }
    while (top > 0) {
      const k = stack[--top]!;
      const nk = next[k]!;
      end[k] = end[nk]!;
      dist[k] = dist[nk]! + stepDist(nx, h, k, nk);
    }
  }
  return { end, dist };
}

// ─────────────────────────────────────────────────────────────────────────────
// slope30 and sub-cell cliff statistics
// ─────────────────────────────────────────────────────────────────────────────

/** Horn (1981) slope (deg) of a field on its grid (edge-clamped neighbours). */
function hornSlope(g: GridSpec, z: Float32Array): Float32Array {
  const { nx, ny, cellSize: h } = g;
  const out = new Float32Array(nx * ny);
  const at = (i: number, j: number): number => z[(j < 0 ? 0 : j >= ny ? ny - 1 : j) * nx + (i < 0 ? 0 : i >= nx ? nx - 1 : i)]!;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      // Distances across the stencil shrink at the edges (clamped neighbours).
      const wx = (i > 0 ? 1 : 0) + (i < nx - 1 ? 1 : 0);
      const wy = (j > 0 ? 1 : 0) + (j < ny - 1 ? 1 : 0);
      const gx = wx > 0 ? (at(i + 1, j + 1) + 2 * at(i + 1, j) + at(i + 1, j - 1) - at(i - 1, j + 1) - 2 * at(i - 1, j) - at(i - 1, j - 1)) / (4 * wx * h) : 0;
      const gy = wy > 0 ? (at(i - 1, j + 1) + 2 * at(i, j + 1) + at(i + 1, j + 1) - at(i - 1, j - 1) - 2 * at(i, j - 1) - at(i + 1, j - 1)) / (4 * wy * h) : 0;
      out[j * nx + i] = Math.atan(Math.sqrt(gx * gx + gy * gy)) * RAD;
    }
  }
  return out;
}

/**
 * Slope (deg) of the DEM averaged to `scaleM` (30 m), sampled at the fire-grid cell centres. Uses `terrain.slopeDeg`
 * when the fire grid is already at that scale or coarser; otherwise block-averages the source DEM (the 10 m DEM when
 * given) to a `scaleM` grid (m×m bilinear sub-samples per block), takes its Horn slope and samples it bilinearly.
 */
export function slopeAtScale(terrain: Terrain, hiRes?: { grid: GridSpec; elevation: Float32Array }, scaleM: number = P.slopeScaleM): Float32Array {
  const g = terrain.grid;
  if (g.cellSize >= scaleM - 0.5) return Float32Array.from(terrain.slopeDeg);
  const src = hiRes ?? { grid: g, elevation: terrain.elevation };
  const extX = g.nx * g.cellSize;
  const extY = g.ny * g.cellSize;
  const nx = Math.max(2, Math.ceil(extX / scaleM));
  const ny = Math.max(2, Math.ceil(extY / scaleM));
  const x0 = g.x0 - g.cellSize / 2 + scaleM / 2 - (nx * scaleM - extX) / 2;
  const y0 = g.y0 - g.cellSize / 2 + scaleM / 2 - (ny * scaleM - extY) / 2;
  const g30: GridSpec = { nx, ny, cellSize: scaleM, x0, y0, origin: g.origin };
  const m = Math.max(1, Math.round(scaleM / src.grid.cellSize));
  const z30 = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const cx = x0 + i * scaleM;
      const cy = y0 + j * scaleM;
      let s = 0;
      for (let b = 0; b < m; b++) for (let a = 0; a < m; a++) s += sampleBilinear(src.grid, src.elevation, cx - scaleM / 2 + ((a + 0.5) * scaleM) / m, cy - scaleM / 2 + ((b + 0.5) * scaleM) / m);
      z30[j * nx + i] = s / (m * m);
    }
  }
  const s30 = hornSlope(g30, z30);
  const out = new Float32Array(g.nx * g.ny);
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) out[j * g.nx + i] = sampleBilinear(g30, s30, g.x0 + i * g.cellSize, g.y0 + j * g.cellSize);
  return out;
}

/**
 * Sub-cell slope statistics of the fire grid from the 10 m DEM (spec §2.1 `slopeP90Deg`, `cliffFraction`), for use
 * when the scenario did not provide them: the 90th percentile of the 10 m Horn slopes whose centres fall in each
 * fire cell, and the fraction steeper than `cliffDeg`.
 */
export function subCellSlopeStats(fire: GridSpec, hiRes: { grid: GridSpec; elevation: Float32Array }, cliffDeg: number = P.cliff.subCellCliffDeg): { slopeP90Deg: Float32Array; cliffFraction: Float32Array } {
  const hs = hornSlope(hiRes.grid, hiRes.elevation);
  const hg = hiRes.grid;
  const n = fire.nx * fire.ny;
  const owner = new Int32Array(hg.nx * hg.ny);
  const count = new Int32Array(n + 1);
  for (let j = 0; j < hg.ny; j++) {
    const fj = Math.round((hg.y0 + j * hg.cellSize - fire.y0) / fire.cellSize);
    for (let i = 0; i < hg.nx; i++) {
      const fi = Math.round((hg.x0 + i * hg.cellSize - fire.x0) / fire.cellSize);
      const k = fi >= 0 && fj >= 0 && fi < fire.nx && fj < fire.ny ? fj * fire.nx + fi : -1;
      owner[j * hg.nx + i] = k;
      if (k >= 0) count[k + 1]++;
    }
  }
  for (let k = 0; k < n; k++) count[k + 1] += count[k]!;
  const vals = new Float32Array(count[n]!);
  const fill = count.slice(0, n);
  for (let p = 0; p < owner.length; p++) {
    const k = owner[p]!;
    if (k >= 0) vals[fill[k]!++] = hs[p]!;
  }
  const slopeP90Deg = new Float32Array(n);
  const cliffFraction = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const a = count[k]!;
    const b = count[k + 1]!;
    if (b <= a) continue;
    const seg = vals.subarray(a, b).sort();
    let steep = 0;
    for (let q = 0; q < seg.length; q++) if (seg[q]! > cliffDeg) steep++;
    const pos = 0.9 * (seg.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(seg.length - 1, lo + 1);
    slopeP90Deg[k] = seg[lo]! + (seg[hi]! - seg[lo]!) * (pos - lo);
    cliffFraction[k] = steep / seg.length;
  }
  return { slopeP90Deg, cliffFraction };
}

// ─────────────────────────────────────────────────────────────────────────────
// The feature set
// ─────────────────────────────────────────────────────────────────────────────

class TerrainFeaturesImpl implements TerrainFeaturesExt {
  readonly flowAcc: Float32Array;
  readonly drainage: Uint8Array;
  readonly trench: Float32Array;
  readonly gullyAxis: Float32Array;
  readonly gullyBase: Int32Array;
  readonly saddle: Uint8Array;
  readonly ridge: Uint8Array;
  readonly cliff: Uint8Array;
  readonly narrowValley: Uint8Array;
  readonly slope30: Float32Array;
  readonly valleyDrop: Float32Array;
  readonly crestRise: Float32Array;
  readonly crestDist: Float32Array;
  readonly receiver: Int32Array;
  readonly ascent: Int32Array;

  private readonly grid: GridSpec;
  private readonly z: Float32Array;
  private readonly hav: Float32Array;
  // Current-sector crest cache (spec §7.1): kCrest −2 = not computed, −1 = none.
  private sector = -1;
  private cD: Float32Array | null = null;
  private cZ: Float32Array | null = null;
  private cRel: Float32Array | null = null;
  private cK: Int32Array | null = null;
  private complete = false;

  constructor(d: TerrainFeaturesData, terrain: Terrain, derived: TerrainDerived) {
    this.flowAcc = d.flowAcc;
    this.drainage = d.drainage;
    this.trench = d.trench;
    this.gullyAxis = d.gullyAxis;
    this.gullyBase = d.gullyBase;
    this.saddle = d.saddle;
    this.ridge = d.ridge;
    this.cliff = d.cliff;
    this.narrowValley = d.narrowValley;
    this.slope30 = d.slope30;
    this.valleyDrop = d.valleyDrop;
    this.crestRise = d.crestRise;
    this.crestDist = d.crestDist;
    this.receiver = d.receiver;
    this.ascent = d.ascent;
    this.grid = terrain.grid;
    this.z = terrain.elevation;
    this.hav = derived.heightAboveValley;
  }

  data(): TerrainFeaturesData {
    return {
      flowAcc: this.flowAcc, drainage: this.drainage, trench: this.trench, gullyAxis: this.gullyAxis, gullyBase: this.gullyBase,
      saddle: this.saddle, ridge: this.ridge, cliff: this.cliff, narrowValley: this.narrowValley, slope30: this.slope30,
      valleyDrop: this.valleyDrop, crestRise: this.crestRise, crestDist: this.crestDist, receiver: this.receiver, ascent: this.ascent,
    };
  }

  private useSector(windFromDeg: number): number {
    const w = P.crest.sectorDeg;
    const nSec = Math.round(360 / w);
    const s = Math.round(wrap360(windFromDeg) / w) % nSec;
    if (s !== this.sector || !this.cK) {
      const n = this.grid.nx * this.grid.ny;
      if (!this.cK) {
        this.cD = new Float32Array(n);
        this.cZ = new Float32Array(n);
        this.cRel = new Float32Array(n);
        this.cK = new Int32Array(n);
      }
      this.cK.fill(-2);
      this.sector = s;
      this.complete = false;
    }
    return s * w;
  }

  /** Raw march for one cell and direction (no cache). */
  private search(k: number, fromDeg: number): number {
    const g = this.grid;
    const z = this.z;
    const nx = g.nx;
    const i = k % nx;
    const j = (k - i) / nx;
    const x0 = g.x0 + i * g.cellSize;
    const y0 = g.y0 + j * g.cellSize;
    const ux = Math.sin(fromDeg * DEG);
    const uy = Math.cos(fromDeg * DEG);
    const zk = z[k]!;
    const step = P.crest.stepM;
    const nMax = Math.floor(P.crest.maxDistM / step + 1e-9);
    const ridge = this.ridge;
    for (let s = 1; s <= nMax; s++) {
      const d = s * step;
      const x = x0 + d * ux;
      const y = y0 + d * uy;
      const ci = Math.round((x - g.x0) / g.cellSize);
      const cj = Math.round((y - g.y0) / g.cellSize);
      if (ci < 0 || cj < 0 || ci >= nx || cj >= g.ny) return -1;
      const c = cj * nx + ci;
      if (!ridge[c] || !(z[c]! > zk)) continue;
      const zHere = zAt(g, z, x, y);
      const zNext = zAt(g, z, x + step * ux, y + step * uy);
      if (!Number.isFinite(zNext)) return -1; // cannot confirm the break of slope beyond the domain edge
      if (zNext < zHere) {
        this.cD![k] = d;
        return c;
      }
    }
    return -1;
  }

  crestInto(k: number, windFromDeg: number, out: CrestInfo): boolean {
    const from = this.useSector(windFromDeg);
    const cK = this.cK!;
    let kc = cK[k]!;
    if (kc === -2) {
      kc = this.search(k, from);
      cK[k] = kc;
      if (kc >= 0) {
        const zc = this.z[kc]!;
        this.cZ![k] = zc;
        this.cRel![k] = zc - (this.z[k]! - this.hav[k]!);
      }
    }
    if (kc < 0) return false;
    out.d = this.cD![k]!;
    out.zCrest = this.cZ![k]!;
    out.relief = this.cRel![k]!;
    out.kCrest = kc;
    return true;
  }

  crest(k: number, windFromDeg: number): CrestInfo | null {
    const o: CrestInfo = { d: 0, zCrest: 0, relief: 0, kCrest: -1 };
    return this.crestInto(k, windFromDeg, o) ? o : null;
  }

  crestSector(windFromDeg: number): { sectorFromDeg: number; d: Float32Array; zCrest: Float32Array; relief: Float32Array; kCrest: Int32Array } {
    const from = this.useSector(windFromDeg);
    if (!this.complete) {
      const n = this.grid.nx * this.grid.ny;
      const tmp: CrestInfo = { d: 0, zCrest: 0, relief: 0, kCrest: -1 };
      for (let k = 0; k < n; k++) if (this.cK![k] === -2) this.crestInto(k, from, tmp);
      this.complete = true;
    }
    return { sectorFromDeg: from, d: this.cD!, zCrest: this.cZ!, relief: this.cRel!, kCrest: this.cK! };
  }
}

/** Rebuild the feature object (with its crest search) from plain arrays, e.g. after a transfer into the worker. */
export function restoreTerrainFeatures(data: TerrainFeaturesData, terrain: Terrain, derived: TerrainDerived): TerrainFeaturesExt {
  return new TerrainFeaturesImpl(data, terrain, derived);
}

/**
 * Compute the static terrain features of the fire grid (spec §2.2).
 * @param terrain fire-grid terrain (buildTerrain output)
 * @param derived terrainDerived(terrain)
 * @param hiRes optional 10 m DEM (ScenarioData.terrainHiRes): slope30 averaging and sub-cell cliff statistics when
 *   `terrain.slopeP90Deg` / `cliffFraction` are absent
 */
export function computeTerrainFeatures(terrain: Terrain, derived: TerrainDerived, hiRes?: { grid: GridSpec; elevation: Float32Array }): TerrainFeaturesExt {
  const g = terrain.grid;
  const { nx, ny, cellSize: h } = g;
  const n = nx * ny;
  const z = terrain.elevation;

  // ── Flow ───────────────────────────────────────────────────────────────────
  const zf = priorityFloodFill(g, z);
  const receiver = d8Receivers(g, zf);
  const { acc: flowAcc, mainDonor } = flowAccumulation(g, receiver);
  const drainage = new Uint8Array(n);
  for (let k = 0; k < n; k++) drainage[k] = flowAcc[k]! >= P.drainageMinAreaM2 ? 1 : 0;

  // ── valleyDrop (descent to the valley floor) and crestRise/crestDist (ascent to the local crest) ────────────
  const down = pathEnds(g, z, receiver, -1);
  const ascent = ascentPointers(g, z);
  const up = pathEnds(g, z, ascent, 1);
  const valleyDrop = new Float32Array(n);
  const crestRise = new Float32Array(n);
  const crestDist = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const vd = z[k]! - z[down.end[k]!]!;
    valleyDrop[k] = vd > 0 ? vd : 0;
    const cr = z[up.end[k]!]! - z[k]!;
    crestRise[k] = cr > 0 ? cr : 0;
    crestDist[k] = up.dist[k]!;
  }

  // ── Gully axis on drainage cells (up-gully azimuth along the channel) ─────────────────────────────────────
  const gullyAxis = new Float32Array(n).fill(NaN);
  const halfSteps = Math.max(1, Math.round(P.axisHalfSpanM / h));
  const axisOwn = new Float32Array(n).fill(NaN);
  for (let k = 0; k < n; k++) {
    if (!drainage[k]) continue;
    let dn = k;
    for (let s = 0; s < halfSteps && receiver[dn]! >= 0; s++) dn = receiver[dn]!;
    let upk = k;
    for (let s = 0; s < halfSteps && mainDonor[upk]! >= 0; s++) upk = mainDonor[upk]!;
    let ax: number;
    if (dn !== upk) {
      const dx = (upk % nx) - (dn % nx);
      const dy = Math.floor(upk / nx) - Math.floor(dn / nx);
      ax = wrap360(Math.atan2(dx, dy) * RAD);
    } else {
      // Isolated cell: opposite of the local upslope-to-downslope direction, i.e. up the fall line.
      ax = terrain.aspectDeg[k]! >= 0 ? wrap360(terrain.aspectDeg[k]! + 180) : NaN;
    }
    axisOwn[k] = ax;
  }

  // ── Trench score on drainage cells (§7.6) ───────────────────────────────────────────────────────────────
  const tp = P.trench;
  const trench = new Float32Array(n);
  const tAxis = new Float32Array(n);
  const nSteps = Math.floor(tp.halfWidthM / tp.stepM + 1e-9);
  const sideRiseSlope = (x: number, y: number, z0: number, px: number, py: number, maxM: number, stepM: number): { rise: number; slope: number } => {
    let best = 0;
    let bestD = 0;
    const ns = Math.floor(maxM / stepM + 1e-9);
    for (let s = 1; s <= ns; s++) {
      const d = s * stepM;
      const zz = zAt(g, z, x + d * px, y + d * py);
      if (!Number.isFinite(zz)) break;
      const r = zz - z0;
      if (r > best) {
        best = r;
        bestD = d;
      }
    }
    return { rise: best, slope: bestD > 0 ? Math.atan(best / bestD) * RAD : 0 };
  };
  for (let k = 0; k < n; k++) {
    const ax = axisOwn[k]!;
    if (!drainage[k] || !Number.isFinite(ax)) continue;
    const i = k % nx;
    const j = (k - i) / nx;
    const x = g.x0 + i * h;
    const y = g.y0 + j * h;
    const px = Math.cos(ax * DEG); // unit vector perpendicular (to the right of the up-gully axis)
    const py = -Math.sin(ax * DEG);
    const L = sideRiseSlope(x, y, z[k]!, -px, -py, nSteps * tp.stepM, tp.stepM);
    const R = sideRiseSlope(x, y, z[k]!, px, py, nSteps * tp.stepM, tp.stepM);
    const dMin = Math.min(L.slope, R.slope);
    const hG = Math.min(L.rise, R.rise);
    tAxis[k] = clamp01((dMin - tp.slopeLoDeg) / tp.slopeSpanDeg) * clamp01((hG - tp.riseLoM) / tp.riseSpanM);
  }

  // Side walls within 60 m: T = T_axis·(1 − d/60); gullyAxis from the nearest drainage cell; owner for gullyBase.
  const rCells = Math.ceil(tp.wallInfluenceM / h);
  const nearest = new Float32Array(n).fill(Infinity);
  const owner = new Int32Array(n).fill(-1);
  for (let k = 0; k < n; k++) {
    if (!drainage[k] || !Number.isFinite(axisOwn[k]!)) continue;
    const i = k % nx;
    const j = (k - i) / nx;
    const ta = tAxis[k]!;
    for (let dj = -rCells; dj <= rCells; dj++) {
      const jj = j + dj;
      if (jj < 0 || jj >= ny) continue;
      for (let di = -rCells; di <= rCells; di++) {
        const ii = i + di;
        if (ii < 0 || ii >= nx) continue;
        const d = Math.hypot(di, dj) * h;
        if (d > tp.wallInfluenceM) continue;
        const c = jj * nx + ii;
        const t = ta * (1 - d / tp.wallInfluenceM);
        if (t > trench[c]!) {
          trench[c] = t;
          owner[c] = k;
        }
        if (d < nearest[c]!) {
          nearest[c] = d;
          gullyAxis[c] = axisOwn[k]!;
        }
      }
    }
  }
  for (let k = 0; k < n; k++) {
    if (drainage[k] && Number.isFinite(axisOwn[k]!)) {
      gullyAxis[k] = axisOwn[k]!;
      if (tAxis[k]! >= trench[k]!) {
        trench[k] = tAxis[k]!;
        owner[k] = k;
      }
    }
  }

  // gullyBase: 8-connected components of drainage ∧ T ≥ 0.3, lowest cell of each; walls inherit via their owner.
  const gullyBase = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  const comp: number[] = [];
  for (let s = 0; s < n; s++) {
    if (!drainage[s] || trench[s]! < tp.baseMinT || gullyBase[s] !== -1) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    gullyBase[s] = -2;
    let low = s;
    comp.length = 0;
    while (head < tail) {
      const c = queue[head++]!;
      comp.push(c);
      if (z[c]! < z[low]!) low = c;
      const ci = c % nx;
      const cj = (c - ci) / nx;
      for (let d = 0; d < 8; d++) {
        const ii = ci + DI[d]!;
        const jj = cj + DJ[d]!;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const q = jj * nx + ii;
        if (drainage[q] && trench[q]! >= tp.baseMinT && gullyBase[q] === -1) {
          gullyBase[q] = -2;
          queue[tail++] = q;
        }
      }
    }
    for (const c of comp) gullyBase[c] = low;
  }
  for (let k = 0; k < n; k++) {
    if (gullyBase[k]! >= 0 || trench[k]! < tp.baseMinT) continue;
    const o = owner[k]!;
    if (o >= 0 && gullyBase[o]! >= 0) gullyBase[k] = gullyBase[o]!;
  }

  // ── Masks: ridge, saddle, cliff ──────────────────────────────────────────────────────────────────────────
  const ridge = new Uint8Array(n);
  const saddle = new Uint8Array(n);
  const cliff = new Uint8Array(n);
  let p90 = terrain.slopeP90Deg;
  let cliffFrac = terrain.cliffFraction;
  if ((!p90 || !cliffFrac) && hiRes) {
    const st = subCellSlopeStats(g, hiRes);
    p90 ??= st.slopeP90Deg;
    cliffFrac ??= st.cliffFraction;
  }
  const lf = terrain.landform;
  const cSad = P.saddle.minCurvatureFactor * derived.thresholds.criticalCurvature;
  const detMax = -cSad * cSad;
  for (let k = 0; k < n; k++) {
    const L = lf[k]!;
    const rp = derived.relPos[k]!;
    ridge[k] = L === Landform.Ridge || L === Landform.Peak || L === Landform.Spur || rp >= P.ridge.minRelPos ? 1 : 0;
    const det = derived.hxx[k]! * derived.hyy[k]! - derived.hxy[k]! * derived.hxy[k]!;
    saddle[k] = L === Landform.Saddle || (det < detMax && terrain.slopeDeg[k]! <= P.saddle.maxSlopeDeg && rp >= P.saddle.minRelPos) ? 1 : 0;
    cliff[k] = L === Landform.Cliff || (cliffFrac !== undefined && cliffFrac[k]! >= P.cliff.minFraction) || (p90 !== undefined && p90[k]! >= P.cliff.p90SlopeDeg) ? 1 : 0;
  }

  // ── Narrow valleys (S43) ─────────────────────────────────────────────────────────────────────────────────
  const nv = P.narrowValley;
  const narrowValley = new Uint8Array(n);
  const sStep = h / 2;
  const nS = Math.floor(nv.searchM / sStep + 1e-9);
  const tanWall = Math.tan(nv.minWallSlopeDeg * DEG);
  // Returns the floor half-width (m) on one side, or −1 when that wall is not ≥ 15° within the search distance.
  const wallSide = (x: number, y: number, z0: number, px: number, py: number): number => {
    let foot = -1;
    let zFoot = z0;
    for (let s = 1; s <= nS; s++) {
      const d = s * sStep;
      const zz = zAt(g, z, x + d * px, y + d * py);
      if (!Number.isFinite(zz)) return -1;
      if (foot < 0) {
        if (zz - z0 >= nv.footRiseM) {
          foot = Math.max(0, d - sStep);
          zFoot = zAt(g, z, x + foot * px, y + foot * py);
        }
        continue;
      }
      if (d - foot >= h && (zz - zFoot) / (d - foot) >= tanWall) return foot;
    }
    return -1;
  };
  for (let k = 0; k < n; k++) {
    const ax = axisOwn[k]!;
    if (!drainage[k] || !Number.isFinite(ax)) continue;
    const i = k % nx;
    const j = (k - i) / nx;
    const x = g.x0 + i * h;
    const y = g.y0 + j * h;
    const px = Math.cos(ax * DEG);
    const py = -Math.sin(ax * DEG);
    const wl = wallSide(x, y, z[k]!, -px, -py);
    if (wl < 0) continue;
    const wr = wallSide(x, y, z[k]!, px, py);
    if (wr < 0 || wl + wr > nv.maxFloorWidthM) continue;
    narrowValley[k] = 1;
    // Mark the floor cells across the transect.
    for (const [side, w] of [[-1, wl], [1, wr]] as const) {
      for (let d = sStep; d <= w; d += sStep) {
        const ci = Math.round((x + side * d * px - g.x0) / h);
        const cj = Math.round((y + side * d * py - g.y0) / h);
        if (ci >= 0 && cj >= 0 && ci < nx && cj < ny) narrowValley[cj * nx + ci] = 1;
      }
    }
  }

  // ── slope30 ─────────────────────────────────────────────────────────────────────────────────────────────
  const slope30 = slopeAtScale(terrain, hiRes);

  return new TerrainFeaturesImpl(
    { flowAcc, drainage, trench, gullyAxis, gullyBase, saddle, ridge, cliff, narrowValley, slope30, valleyDrop, crestRise, crestDist, receiver, ascent },
    terrain,
    derived,
  );
}
