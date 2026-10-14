/**
 * Display-only cliff sharpening (plan 9d.3.1, tuned in spike S5; pure, no Three.js, no DOM).
 *
 * The bundled 10 m terrain has faces of 60 to 80 degrees that read as ramps once the mesh blurs them. This makes a copy
 * of the terrain that is steepened along the fall line in steep bands, so faces draw as near-vertical walls. The copy is
 * used only to draw (mesh, picking height field, shadows, lighting, rock mask): the simulation, the slope overlay, the
 * elevation numbers and the cards never see it (plan section 4, rule 10). The rule:
 *   (a) a weight per cell, w = smoothstep(48, 62, Horn slope), spread to the eight neighbours at 0.6 so the shoulders move;
 *   (b) for each cell with a weight, sample the ORIGINAL terrain along the fall line up to 3 cells each way (bilinear), take
 *       the minimum and maximum, and move the cell towards whichever is nearer in height by w x the distance; nothing
 *       happens within 0.5 m of the middle, so a straight ramp is left alone and a gully floor (the middle of a V along
 *       its own fall line) stays where it is;
 *   (c) a despike pass pulls any cell that stands 10 m or more above or below all eight neighbours back to 2 m past them.
 * Deterministic (the despike decides on the heights before any fix), the outer ring of cells is never moved, a fall-line window
 * that would leave the grid is cut short on both sides (so a ramp that runs into the border is left alone, like any other), and a
 * cell with no height (NaN) never moves and never makes another one NaN. A terrain with no cell over 48 degrees comes back as an
 * exact copy; with a steep cell anywhere the despike runs on the whole terrain, so a tower or pit of the data itself goes too.
 */
import type { GridSpec } from '../core/grid';
import { smoothstep } from '../core/units';

export interface CliffSharpenOptions {
  /** Horn slope (deg) where the weight starts and where it reaches 1. */
  loDeg: number;
  hiDeg: number;
  /** Weight given to the eight neighbours of a steep cell (the shoulders). */
  spread: number;
  /** Cells sampled each way along the fall line. */
  window: number;
  /** Multiplier on the weight; 1 is the plan's rule, 0.6 is the fallback if the phone says terraces look wrong (S5). */
  strength: number;
  /** Dead band (m) around the middle of the window. */
  eps: number;
  /** Height (m) of a tower or pit the despike pass removes (0 turns it off), and the margin it leaves (m). */
  despikeM: number;
  despikeMargin: number;
}

/** The plan's rule with the S5 constants. */
export const CLIFF_SHARPEN_DEFAULTS: Readonly<CliffSharpenOptions> = Object.freeze({
  loDeg: 48,
  hiDeg: 62,
  spread: 0.6,
  window: 3,
  strength: 1,
  eps: 0.5,
  despikeM: 10,
  despikeMargin: 2,
});

export interface CliffSharpenStats {
  /** Cells with a weight above zero (steep cells plus their shoulders). */
  weighted: number;
  /** Cells whose final height differs from the data by 0.5 m or more, their mean and largest change (m). */
  moved: number;
  movedMeanM: number;
  movedMaxM: number;
  /** Towers and pits the despike pass fixed. */
  despiked: number;
  /** Milliseconds per stage: slope pass, weights, fall-line moves, despike, total. */
  ms: { slope: number; weights: number; move: number; despike: number; total: number };
}

export interface CliffSharpenResult {
  /** The sharpened copy, same grid as the input; the input is never modified. */
  elevation: Float32Array;
  stats: CliffSharpenStats;
}

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

/**
 * Squared Horn gradient magnitude (tan^2 of the slope) of every cell; edge cells replicate the border, the same operator
 * as `hornGradient` (fields.ts) and src/terrain. No atan: callers compare against tan^2 thresholds.
 */
export function hornTan2(grid: GridSpec, z: ArrayLike<number>, out: Float32Array = new Float32Array(grid.nx * grid.ny)): Float32Array {
  const { nx, ny, cellSize: h } = grid;
  const inv = 1 / (8 * h);
  const clampI = (i: number): number => (i < 0 ? 0 : i >= nx ? nx - 1 : i);
  const clampJ = (j: number): number => (j < 0 ? 0 : j >= ny ? ny - 1 : j);
  const edgeCell = (i: number, j: number): void => {
    const at = (a: number, b: number): number => z[clampJ(b) * nx + clampI(a)]!;
    const a = at(i - 1, j + 1);
    const b = at(i, j + 1);
    const c = at(i + 1, j + 1);
    const d = at(i - 1, j);
    const f = at(i + 1, j);
    const g = at(i - 1, j - 1);
    const hh = at(i, j - 1);
    const ii = at(i + 1, j - 1);
    const p = (c + 2 * f + ii - (a + 2 * d + g)) * inv;
    const q = (a + 2 * b + c - (g + 2 * hh + ii)) * inv;
    out[j * nx + i] = p * p + q * q;
  };
  for (let i = 0; i < nx; i++) {
    edgeCell(i, 0);
    edgeCell(i, ny - 1);
  }
  for (let j = 1; j < ny - 1; j++) {
    edgeCell(0, j);
    edgeCell(nx - 1, j);
    for (let i = 1; i < nx - 1; i++) {
      const k = j * nx + i;
      const n = k + nx;
      const s = k - nx;
      const p = (z[n + 1]! + 2 * z[k + 1]! + z[s + 1]! - (z[n - 1]! + 2 * z[k - 1]! + z[s - 1]!)) * inv;
      const q = (z[n - 1]! + 2 * z[n]! + z[n + 1]! - (z[s - 1]! + 2 * z[s]! + z[s + 1]!)) * inv;
      out[k] = p * p + q * q;
    }
  }
  return out;
}

/** Horn slope (deg) of every cell, the same values as `slopeFromGradient(hornGradient(...))` in fields.ts, for callers that want a slope field. */
export function hornSlopeDeg(grid: GridSpec, z: ArrayLike<number>): Float32Array {
  const out = hornTan2(grid, z);
  for (let k = 0; k < out.length; k++) out[k] = Math.atan(Math.sqrt(out[k]!)) * RAD2DEG;
  return out;
}

/**
 * Pull every cell that stands `m` metres or more above all eight neighbours (a tower) or below all of them (a pit) back to
 * `margin` metres past its highest (lowest) neighbour. In place; decisions use the heights before any fix (Jacobi), so the
 * result does not depend on the scan order. The grid's outer ring is never touched. Returns the number of cells fixed.
 * Shared with the mesh ({@link decimateTerrain}, terrainMesh.ts).
 */
export function despikeGrid(grid: GridSpec, z: Float32Array, m: number, margin: number): number {
  const { nx, ny } = grid;
  const off = [-nx - 1, -nx, -nx + 1, -1, 1, nx - 1, nx, nx + 1];
  const fixK: number[] = [];
  const fixV: number[] = [];
  for (let j = 1; j < ny - 1; j++) {
    for (let i = 1; i < nx - 1; i++) {
      const k = j * nx + i;
      const v = z[k]!;
      const first = z[k + off[0]!]!;
      if (v - first >= m) {
        let hi = -Infinity;
        let ok = true;
        for (let t = 0; t < 8; t++) {
          const q = z[k + off[t]!]!;
          if (v - q < m) {
            ok = false;
            break;
          }
          if (q > hi) hi = q;
        }
        if (ok) {
          fixK.push(k);
          fixV.push(hi + margin);
        }
      } else if (first - v >= m) {
        let lo = Infinity;
        let ok = true;
        for (let t = 0; t < 8; t++) {
          const q = z[k + off[t]!]!;
          if (q - v < m) {
            ok = false;
            break;
          }
          if (q < lo) lo = q;
        }
        if (ok) {
          fixK.push(k);
          fixV.push(lo - margin);
        }
      }
    }
  }
  for (let s = 0; s < fixK.length; s++) z[fixK[s]!] = fixV[s]!;
  return fixK.length;
}

/**
 * The sharpened copy of a terrain (see the file header for the rule). `grid` is the 10 m terrain's grid, `z` its heights
 * (j = 0 south); the result has the same grid. A terrain with no cell over `loDeg` comes back as an exact copy, despike included.
 */
export function cliffSharpen(grid: GridSpec, z: Float32Array, opts: Partial<CliffSharpenOptions> = {}): CliffSharpenResult {
  const o: CliffSharpenOptions = { ...CLIFF_SHARPEN_DEFAULTS, ...opts };
  const { nx, ny, cellSize: h } = grid;
  const n = nx * ny;
  if (z.length !== n) throw new RangeError(`cliffSharpen: ${z.length} heights for a ${nx} x ${ny} grid`);
  const t0 = performance.now();
  const out = Float32Array.from(z);
  if (nx < 3 || ny < 3) {
    const t = performance.now() - t0;
    return { elevation: out, stats: { weighted: 0, moved: 0, movedMeanM: 0, movedMaxM: 0, despiked: 0, ms: { slope: t, weights: 0, move: 0, despike: 0, total: t } } };
  }

  // (a) weights
  const tan2Lo = Math.tan(o.loDeg * DEG2RAD) ** 2;
  const g2 = hornTan2(grid, z);
  const t1 = performance.now();
  const w0 = new Float32Array(n);
  const steep: number[] = [];
  for (let k = 0; k < n; k++) {
    if (g2[k]! >= tan2Lo) {
      const w = smoothstep(o.loDeg, o.hiDeg, Math.atan(Math.sqrt(g2[k]!)) * RAD2DEG);
      if (w > 0) {
        w0[k] = w;
        steep.push(k);
      }
    }
  }
  if (steep.length === 0) {
    // Nothing steep: the drawing equals the data (no move, no despike), and the Horn pass was the whole cost.
    const t = performance.now();
    return { elevation: out, stats: { weighted: 0, moved: 0, movedMeanM: 0, movedMaxM: 0, despiked: 0, ms: { slope: t1 - t0, weights: t - t1, move: 0, despike: 0, total: t - t0 } } };
  }
  // Spread: w = max(w0, spread x max of the 3 x 3 w0), applied to interior cells only (the scatter form of the gather).
  const w = new Float32Array(n);
  for (let s = 0; s < steep.length; s++) {
    const k = steep[s]!;
    const i = k % nx;
    const j = (k - i) / nx;
    const v0 = w0[k]!;
    const v1 = o.spread * v0;
    for (let dj = -1; dj <= 1; dj++) {
      const jj = j + dj;
      if (jj < 1 || jj > ny - 2) continue;
      for (let di = -1; di <= 1; di++) {
        const ii = i + di;
        if (ii < 1 || ii > nx - 2) continue;
        const kk = jj * nx + ii;
        const v = di === 0 && dj === 0 ? v0 : v1;
        if (v > w[kk]!) w[kk] = v;
      }
    }
  }
  const active: number[] = [];
  for (let j = 1; j < ny - 1; j++) {
    for (let i = 1; i < nx - 1; i++) {
      const k = j * nx + i;
      if (w[k]! > 0) active.push(k);
    }
  }
  const t2 = performance.now();

  // (b) fall-line moves (reads the original terrain, writes the copy)
  const inv8h = 1 / (8 * h);
  const R = Math.max(1, Math.round(o.window));
  const mx1 = nx - 1;
  const my1 = ny - 1;
  const bil = (fx: number, fy: number): number => {
    fx = fx < 0 ? 0 : fx > mx1 ? mx1 : fx;
    fy = fy < 0 ? 0 : fy > my1 ? my1 : fy;
    let i0 = Math.floor(fx);
    let j0 = Math.floor(fy);
    if (i0 > nx - 2) i0 = nx - 2;
    if (j0 > ny - 2) j0 = ny - 2;
    const tx = fx - i0;
    const ty = fy - j0;
    const k = j0 * nx + i0;
    return (z[k]! * (1 - tx) + z[k + 1]! * tx) * (1 - ty) + (z[k + nx]! * (1 - tx) + z[k + nx + 1]! * tx) * ty;
  };
  for (let s = 0; s < active.length; s++) {
    const k = active[s]!;
    const i = k % nx;
    const j = (k - i) / nx;
    const n0 = k + nx;
    const s0 = k - nx;
    const gx = (z[n0 + 1]! + 2 * z[k + 1]! + z[s0 + 1]! - (z[n0 - 1]! + 2 * z[k - 1]! + z[s0 - 1]!)) * inv8h;
    const gy = (z[n0 - 1]! + 2 * z[n0]! + z[n0 + 1]! - (z[s0 - 1]! + 2 * z[s0]! + z[s0 + 1]!)) * inv8h;
    const gn = Math.hypot(gx, gy);
    if (!(gn > 1e-6)) continue;
    const ux = gx / gn;
    const uy = gy / gn;
    const cur = z[k]!;
    let mn = cur;
    let mx = cur;
    for (let t = 1; t <= R; t++) {
      const ax = i + t * ux;
      const ay = j + t * uy;
      const bx = i - t * ux;
      const by = j - t * uy;
      // A window that would leave the grid is cut short on both sides, so a ramp that runs into the border is still a ramp
      // (reading the clamped border instead would put the cell off the middle and pull it towards the border height).
      if (ax < 0 || ax > mx1 || ay < 0 || ay > my1 || bx < 0 || bx > mx1 || by < 0 || by > my1) break;
      const a = bil(ax, ay);
      const b = bil(bx, by);
      if (a < mn) mn = a;
      if (a > mx) mx = a;
      if (b < mn) mn = b;
      if (b > mx) mx = b;
    }
    const d = cur - 0.5 * (mn + mx);
    if (!(Math.abs(d) > o.eps)) continue;
    const wk = Math.min(1, w[k]! * o.strength);
    out[k] = cur + wk * ((d > 0 ? mx : mn) - cur);
  }
  const t3 = performance.now();

  // (c) despike
  const despiked = o.despikeM > 0 ? despikeGrid(grid, out, o.despikeM, o.despikeMargin) : 0;
  const t4 = performance.now();

  // statistics (outside the timed stages)
  let moved = 0;
  let sum = 0;
  let max = 0;
  for (let k = 0; k < n; k++) {
    const dd = Math.abs(out[k]! - z[k]!);
    if (dd >= 0.5) {
      moved++;
      sum += dd;
      if (dd > max) max = dd;
    }
  }
  return {
    elevation: out,
    stats: {
      weighted: active.length,
      moved,
      movedMeanM: moved ? sum / moved : 0,
      movedMaxM: max,
      despiked,
      ms: { slope: t1 - t0, weights: t2 - t1, move: t3 - t2, despike: t4 - t3, total: t4 - t0 },
    },
  };
}
