/**
 * Spike S5 of docs/plans/air-slice-wind-detail-honest-speed.md (section 10, M0; plan 9d.3 and 9d.5): does the cliff
 * sharpening and the edge-keeping mesh of workstream H-look do what the plan hopes? This file is the measuring harness of
 * that spike: it re-runs the table of 9d.3 on the four bundled steep sites (section 1), measures the mesh edges for each way
 * of building the mesh (2) and the single-vertex spikes of the mesh (2b), times each stage in node (3), checks the
 * properties the plan lists for the pure tests (9d.6) (4), measures what a mesh of a given spacing can show of a step (5),
 * walks the fallback ladder (6), measures how far the drawn face drifts from the data's (6b), and measures the face
 * heights and counts what a steep-patch refinement would cost (7, 7b). Nothing here changes the app. It is not part of
 * `npm test`: it is gated by FIRESIM_SPIKE and takes about a minute and a half.
 *
 *   FIRESIM_SPIKE=1 nice -n 8 npx vitest run tests/spikes/cliffSharpen.spike.test.ts
 *
 * Optional environment:
 *   FIRESIM_SPIKE_OUT=<file>    also write the report to this file
 *   FIRESIM_SPIKE_REPS=7        timed repetitions per stage (median and minimum are reported; default 7)
 *
 * Self-contained: it imports only modules that exist at the commit this spike was cut from (ca8e637), and holds the
 * prototype functions (cliffSharpen, hornTan2, countSpikes, despikeGrid, decimateTerrain) inside itself, between the
 * PROTOTYPE markers below. The same functions are in the throwaway patch (docs/plans/spikes/S5-cliff-look/prototype.patch:
 * src/render/cliffSharpen.ts and fields.ts) that the screenshots were made with. The section REFERENCE is the whole-grid
 * probe that produced the plan's table, kept as it was so the optimised prototype can be checked against it.
 *
 * The report is plain text. "PLAN" columns quote the plan's table (9d.3), "NOW" columns are this run.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { fileURLToPath } from 'node:url';
import { decode } from 'fast-png';
import * as THREE from 'three';
import { makeGridSpec, resample, sampleBilinear, type GridSpec } from '../../src/core/grid';
import { decimateGrid, hornGradient, slopeFromGradient, type RenderGrid } from '../../src/render/fields';
import { d8Receivers, flowAccumulation, priorityFloodFill } from '../../src/fire/terrainFeatures';
import { fireTerrainFromHiRes } from '../../src/scenario/terrain';

// ─────────────────────────────────────────────────────────────────────────────
// PROTOTYPE (throwaway; the same code as src/render/cliffSharpen.ts and decimateTerrain in src/render/fields.ts of the S5 patch)
// ─────────────────────────────────────────────────────────────────────────────

interface CliffSharpenOptions {
  /** Horn slope (deg) where the weight starts / reaches 1. */
  loDeg: number;
  hiDeg: number;
  /** Weight given to the 8 neighbours of a steep cell (the shoulders). */
  spread: number;
  /** Cells sampled each way along the fall line. */
  window: number;
  /** Multiplier on the weight (1 = the plan's rule). */
  strength: number;
  /** Dead band (m) around the middle of the window. */
  eps: number;
  /** Tower / pit height (m) the despike pass removes, and the margin it leaves (m). */
  despikeM: number;
  despikeMargin: number;
  /**
   * Fallback rung "lip and foot snapping only": a cell moves only when its position p = (z - min) / (max - min) in the
   * window is within `snap` of an end (p <= snap or p >= 1 - snap). 0.5 = every cell (the plan's rule).
   */
  snap: number;
}

const CLIFF_SHARPEN_DEFAULTS: Readonly<CliffSharpenOptions> = Object.freeze({
  loDeg: 48,
  hiDeg: 62,
  spread: 0.6,
  window: 3,
  strength: 1,
  eps: 0.5,
  despikeM: 10,
  despikeMargin: 2,
  snap: 0.5,
});

interface CliffSharpenStats {
  /** Cells with a weight above zero (steep cells plus their shoulders). */
  weighted: number;
  /** Cells whose final height differs from the data by at least 0.5 m, their mean and largest change (m). */
  moved: number;
  movedMeanM: number;
  movedMaxM: number;
  /** Towers and pits the despike pass fixed. */
  despiked: number;
  /** Milliseconds per stage: slope pass, weights, fall-line moves, despike, total. */
  ms: { slope: number; weights: number; move: number; despike: number; total: number };
}

interface CliffSharpenResult {
  elevation: Float32Array;
  stats: CliffSharpenStats;
}

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Squared Horn gradient magnitude (tan^2 of the slope) of every cell; edge cells replicate the border, the same
 * operator as `hornGradient` (fields.ts) and src/terrain. No atan: callers compare against tan^2 thresholds.
 */
function hornTan2(grid: GridSpec, z: ArrayLike<number>, out: Float32Array = new Float32Array(grid.nx * grid.ny)): Float32Array {
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

/** Cells that stand `m` metres or more above all eight neighbours (towers) or below all of them (pits). */
function countSpikes(grid: GridSpec, z: ArrayLike<number>, m: number): { towers: number; pits: number } {
  const { nx, ny } = grid;
  let towers = 0;
  let pits = 0;
  const off = [-nx - 1, -nx, -nx + 1, -1, 1, nx - 1, nx, nx + 1];
  for (let j = 1; j < ny - 1; j++) {
    for (let i = 1; i < nx - 1; i++) {
      const k = j * nx + i;
      const v = z[k]!;
      let up = true;
      let dn = true;
      for (let t = 0; t < 8 && (up || dn); t++) {
        const q = z[k + off[t]!]!;
        if (v - q < m) up = false;
        if (q - v < m) dn = false;
      }
      if (up) towers++;
      if (dn) pits++;
    }
  }
  return { towers, pits };
}

/**
 * Pull every cell that stands `m` metres or more above all eight neighbours (a tower) or below all of them (a pit) back to
 * `margin` metres past its highest (lowest) neighbour. In place; decisions use the heights before any fix (Jacobi), so the
 * result does not depend on the scan order. The grid's outer ring is never touched. Returns the number of cells fixed.
 */
function despikeGrid(grid: GridSpec, z: Float32Array, m: number, margin: number): number {
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

function cliffSharpen(grid: GridSpec, z: Float32Array, opts: Partial<CliffSharpenOptions> = {}): CliffSharpenResult {
  const o: CliffSharpenOptions = { ...CLIFF_SHARPEN_DEFAULTS, ...opts };
  const { nx, ny, cellSize: h } = grid;
  const n = nx * ny;
  const t0 = performance.now();
  const out = Float32Array.from(z);

  // ── (a) weights ────────────────────────────────────────────────────────────
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
  // Spread: w = max(w0, spread x max of the 3 x 3 w0), applied to interior cells only (scatter form of the gather).
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

  // ── (b) fall-line moves (reads the original terrain, writes the copy) ─────────
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
      const a = bil(i + t * ux, j + t * uy);
      const b = bil(i - t * ux, j - t * uy);
      if (a < mn) mn = a;
      if (a > mx) mx = a;
      if (b < mn) mn = b;
      if (b > mx) mx = b;
    }
    const d = cur - 0.5 * (mn + mx);
    if (!(Math.abs(d) > o.eps)) continue;
    if (o.snap < 0.5) {
      const p = (cur - mn) / (mx - mn);
      if (p > o.snap && p < 1 - o.snap) continue;
    }
    const wk = Math.min(1, w[k]! * o.strength);
    out[k] = cur + wk * ((d > 0 ? mx : mn) - cur);
  }
  const t3 = performance.now();

  // ── (c) despike ───────────────────────────────────────────────────────────────
  const despiked = o.despikeM > 0 ? despikeGrid(grid, out, o.despikeM, o.despikeMargin) : 0;
  const t4 = performance.now();

  // ── statistics (outside the timed stages) ──────────────────────────────────────
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

interface DecimateTerrainOptions {
  /** Footprint slope (deg) below which the blurred value is used and above which the unblurred sample takes over. */
  loDeg: number;
  hiDeg: number;
  /** When above 0: a despike pass on the finished mesh (towers and pits of this many metres or more, 2 m margin). */
  despikeM: number;
}

/**
 * SPIKE S5 PROTOTYPE (plan 9d.3.2). A mesh that keeps the edge: the same value as {@link decimateGrid} on gentle ground,
 * and the unblurred bilinear sample where the vertex's footprint is steep (blend smoothstep(loDeg, hiDeg, the largest
 * 10 m Horn slope inside the footprint)), so a step stays a step between adjacent vertices. Where the footprint's
 * steepest slope is at or below `loDeg` the result is bit-identical to decimateGrid.
 */
function decimateTerrain(grid: GridSpec, elevation: Float32Array, maxN: number, opts: Partial<DecimateTerrainOptions> = {}): RenderGrid {
  const base = decimateGrid(grid, elevation, maxN);
  if (base.ratio === 1) return base;
  const loDeg = opts.loDeg ?? 40;
  const hiDeg = opts.hiDeg ?? 55;
  const dst = base.grid;
  const raw = resample(grid, elevation, dst);
  const g2 = hornTan2(grid, elevation);
  const tan2Lo = Math.tan((loDeg * Math.PI) / 180) ** 2;
  const out = new Float32Array(base.elevation);
  const half = dst.cellSize / 2;
  for (let j = 0; j < dst.ny; j++) {
    const y = dst.y0 + j * dst.cellSize;
    const j0 = Math.max(0, Math.floor((y - half - grid.y0) / grid.cellSize));
    const j1 = Math.min(grid.ny - 1, Math.ceil((y + half - grid.y0) / grid.cellSize));
    for (let i = 0; i < dst.nx; i++) {
      const x = dst.x0 + i * dst.cellSize;
      const i0 = Math.max(0, Math.floor((x - half - grid.x0) / grid.cellSize));
      const i1 = Math.min(grid.nx - 1, Math.ceil((x + half - grid.x0) / grid.cellSize));
      let m = 0;
      for (let b = j0; b <= j1; b++) {
        const row = b * grid.nx;
        for (let a = i0; a <= i1; a++) {
          const v = g2[row + a]!;
          if (v > m) m = v;
        }
      }
      if (m <= tan2Lo) continue;
      const t = Math.min(1, Math.max(0, (Math.atan(Math.sqrt(m)) * 180) / Math.PI - loDeg) / (hiDeg - loDeg));
      const wt = t * t * (3 - 2 * t);
      const k = j * dst.nx + i;
      out[k] = base.elevation[k]! * (1 - wt) + raw[k]! * wt;
    }
  }
  if ((opts.despikeM ?? 0) > 0) despikeGrid(dst, out, opts.despikeM!, 2);
  return { grid: dst, elevation: out, ratio: base.ratio };
}

// ─────────────────────────────────────────────────────────────────────────────
// END OF PROTOTYPE
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// REFERENCE: the whole-grid probe that produced the table in plan 9d.3 (steepenDir + despike), unchanged in logic.
// ─────────────────────────────────────────────────────────────────────────────
const RAD = 180 / Math.PI;
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
function hornSlope(g: GridSpec, z: Float32Array): Float32Array {
  const { dzdx, dzdy } = hornGradient(g, z);
  const s = new Float32Array(z.length);
  for (let k = 0; k < s.length; k++) s[k] = slopeFromGradient(dzdx[k]!, dzdy[k]!);
  return s;
}
function steepenDirRef(g: GridSpec, z: Float32Array, o: { loDeg: number; hiDeg: number; R: number; passes: number; eps: number }): Float32Array {
  let cur = Float32Array.from(z);
  const { dzdx, dzdy } = hornGradient(g, z);
  const s0 = hornSlope(g, z);
  const w0 = s0.map((s) => smooth(o.loDeg, o.hiDeg, s));
  const w = Float32Array.from(w0);
  for (let j = 1; j < g.ny - 1; j++)
    for (let i = 1; i < g.nx - 1; i++) {
      const k = j * g.nx + i;
      let m = w0[k]!;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) m = Math.max(m, w0[k + dj * g.nx + di]! * 0.6);
      w[k] = m;
    }
  const ux = new Float32Array(z.length);
  const uy = new Float32Array(z.length);
  for (let k = 0; k < z.length; k++) {
    const n = Math.hypot(dzdx[k]!, dzdy[k]!);
    if (n > 1e-6) {
      ux[k] = dzdx[k]! / n;
      uy[k] = dzdy[k]! / n;
    }
  }
  for (let p = 0; p < o.passes; p++) {
    const next = Float32Array.from(cur);
    for (let j = 1; j < g.ny - 1; j++)
      for (let i = 1; i < g.nx - 1; i++) {
        const k = j * g.nx + i;
        const wk = w[k]!;
        if (wk <= 0) continue;
        const x = g.x0 + i * g.cellSize;
        const y = g.y0 + j * g.cellSize;
        let mn = cur[k]!;
        let mx = cur[k]!;
        for (let t = 1; t <= o.R; t++) {
          for (const sgn of [-1, 1]) {
            const v = sampleBilinear(g, cur, x + sgn * t * g.cellSize * ux[k]!, y + sgn * t * g.cellSize * uy[k]!);
            if (v < mn) mn = v;
            if (v > mx) mx = v;
          }
        }
        const mid = 0.5 * (mn + mx);
        const d = cur[k]! - mid;
        if (Math.abs(d) <= o.eps) continue;
        next[k] = cur[k]! + wk * ((d > 0 ? mx : mn) - cur[k]!);
      }
    cur = next;
  }
  return cur;
}
function despikeRef(g: GridSpec, z: Float32Array, m: number): { z: Float32Array; fixed: number } {
  const out = Float32Array.from(z);
  let fixed = 0;
  for (let j = 1; j < g.ny - 1; j++)
    for (let i = 1; i < g.nx - 1; i++) {
      const k = j * g.nx + i;
      const v = z[k]!;
      let hi = -Infinity;
      let lo = Infinity;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const q = z[k + dj * g.nx + di]!;
          if (q > hi) hi = q;
          if (q < lo) lo = q;
        }
      if (v - hi >= m) {
        out[k] = hi + 2;
        fixed++;
      } else if (lo - v >= m) {
        out[k] = lo - 2;
        fixed++;
      }
    }
  return { z: out, fixed };
}
/** The probe's peak-preserving decimation (per-cell footprint scan with Horn slopes in degrees). */
function decimateKeepRef(g: GridSpec, z: Float32Array, n: number): { grid: GridSpec; z: Float32Array } {
  const rg = decimateGrid(g, z, n);
  const raw = resample(g, z, rg.grid);
  const s10 = hornSlope(g, z);
  const out = new Float32Array(raw.length);
  for (let j = 0; j < rg.grid.ny; j++) {
    for (let i = 0; i < rg.grid.nx; i++) {
      const x = rg.grid.x0 + i * rg.grid.cellSize;
      const y = rg.grid.y0 + j * rg.grid.cellSize;
      const half = rg.grid.cellSize / 2;
      const i0 = Math.max(0, Math.floor((x - half - g.x0) / g.cellSize));
      const i1 = Math.min(g.nx - 1, Math.ceil((x + half - g.x0) / g.cellSize));
      const j0 = Math.max(0, Math.floor((y - half - g.y0) / g.cellSize));
      const j1 = Math.min(g.ny - 1, Math.ceil((y + half - g.y0) / g.cellSize));
      let m = 0;
      for (let b = j0; b <= j1; b++) for (let a = i0; a <= i1; a++) m = Math.max(m, s10[b * g.nx + a]!);
      const wt = smooth(40, 55, m);
      const k = j * rg.grid.nx + i;
      out[k] = rg.elevation[k]! * (1 - wt) + raw[k]! * wt;
    }
  }
  return { grid: rg.grid, z: out };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const SITES = ['katoomba', 'kanangra', 'grose', 'tomah'] as const;
const TIERS = [
  ['High', 400],
  ['Medium', 320],
  ['Low', 224],
] as const;
const REPS = Math.max(3, Number(process.env.FIRESIM_SPIKE_REPS ?? 7));

/** The plan's table (9d.3): [steepest data, new], [area over 70 deg data, new], [High edges over 70 today, new], [steepest High edge today, new], [steepest Low edge today, new], IoU. */
const PLAN: Record<string, { steepest: [number, number]; over70: [number, number]; edges70High: [number, number]; edgeMaxHigh: [number, number]; edgeMaxLow: [number, number]; iou: number }> = {
  katoomba: { steepest: [83.2, 85.0], over70: [0.52, 0.97], edges70High: [0.12, 0.6], edgeMaxHigh: [78.0, 83.5], edgeMaxLow: [73.2, 79.1], iou: 0.92 },
  kanangra: { steepest: [82.8, 86.2], over70: [0.16, 0.98], edges70High: [0.02, 0.47], edgeMaxHigh: [79.9, 85.3], edgeMaxLow: [75.9, 81.3], iou: 0.94 },
  grose: { steepest: [84.0, 86.2], over70: [1.09, 1.45], edges70High: [0.44, 0.87], edgeMaxHigh: [80.8, 85.4], edgeMaxLow: [76.4, 81.9], iou: 0.86 },
  tomah: { steepest: [73.5, 81.7], over70: [0.02, 0.79], edges70High: [0.0, 0.31], edgeMaxHigh: [67.3, 79.2], edgeMaxLow: [60.7, 72.3], iou: 0.91 },
};

const report: string[] = [];
const say = (s = ''): void => {
  report.push(s);
};
afterAll(() => {
  if (!report.length) return;
  const text = report.join('\n') + '\n';
  process.stdout.write(text);
  if (process.env.FIRESIM_SPIKE_OUT) writeFileSync(process.env.FIRESIM_SPIKE_OUT, text);
});

function loadDem(id: string): { grid: GridSpec; elev: Float32Array } {
  const dir = fileURLToPath(new URL(`../../public/demo/${id}/`, import.meta.url));
  const meta = JSON.parse(readFileSync(`${dir}dem5m.json`, 'utf8'));
  const img = decode(new Uint8Array(readFileSync(`${dir}dem5m.png`)));
  const grid = makeGridSpec(meta.centre, meta.extent, meta.cellSize);
  const ch = img.channels;
  const d = img.data as Uint8Array;
  const elev = new Float32Array(grid.nx * grid.ny);
  for (let r = 0; r < grid.ny; r++) {
    const j = grid.ny - 1 - r;
    for (let i = 0; i < grid.nx; i++) {
      const o = (r * grid.nx + i) * ch;
      elev[j * grid.nx + i] = d[o]! * 256 + d[o + 1]! + d[o + 2]! / 256 - 32768;
    }
  }
  return { grid, elev };
}

const share = (s: ArrayLike<number>, thr: number): number => {
  let c = 0;
  for (let k = 0; k < s.length; k++) if (s[k]! > thr) c++;
  return (100 * c) / s.length;
};
const maxOf = (s: ArrayLike<number>): number => {
  let m = -Infinity;
  for (let k = 0; k < s.length; k++) if (s[k]! > m) m = s[k]!;
  return m;
};
/** Slope (deg) of every mesh edge, both axes (what the triangles have). */
function edgeSlope(g: GridSpec, z: ArrayLike<number>): Float32Array {
  const out = new Float32Array((g.nx - 1) * g.ny + g.nx * (g.ny - 1));
  let o = 0;
  for (let j = 0; j < g.ny; j++)
    for (let i = 0; i < g.nx; i++) {
      const k = j * g.nx + i;
      if (i < g.nx - 1) out[o++] = Math.atan(Math.abs(z[k + 1]! - z[k]!) / g.cellSize) * RAD;
      if (j < g.ny - 1) out[o++] = Math.atan(Math.abs(z[k + g.nx]! - z[k]!) / g.cellSize) * RAD;
    }
  return out;
}
function drainageMask(g: GridSpec, z: Float32Array, minAreaM2 = 50000): Uint8Array {
  const zf = priorityFloodFill(g, z);
  const recv = d8Receivers(g, zf);
  const { acc } = flowAccumulation(g, recv);
  const m = new Uint8Array(z.length);
  for (let k = 0; k < m.length; k++) m[k] = acc[k]! >= minAreaM2 ? 1 : 0;
  return m;
}
function iou(a: Uint8Array, b: Uint8Array): number {
  let both = 0;
  let uni = 0;
  for (let k = 0; k < a.length; k++) {
    if (a[k] && b[k]) both++;
    if (a[k] || b[k]) uni++;
  }
  return uni ? both / uni : 1;
}
/** Median and minimum (ms) of `fn` over REPS runs after two warm-up runs. */
function time(fn: () => unknown): { med: number; min: number } {
  fn();
  fn();
  const t: number[] = [];
  for (let r = 0; r < REPS; r++) {
    const t0 = performance.now();
    fn();
    t.push(performance.now() - t0);
  }
  t.sort((a, b) => a - b);
  return { med: t[Math.floor(t.length / 2)]!, min: t[0]! };
}
const f1 = (v: number): string => v.toFixed(1);
const f2 = (v: number): string => v.toFixed(2);
const pad = (s: string | number, n: number): string => String(s).padStart(n);
const ms = (t: { med: number; min: number }): string => `${t.med.toFixed(0)} (min ${t.min.toFixed(0)})`;

/** Load the four sites once. */
const DEM = new Map<string, { grid: GridSpec; elev: Float32Array }>();
const demOf = (id: string): { grid: GridSpec; elev: Float32Array } => {
  let d = DEM.get(id);
  if (!d) {
    d = loadDem(id);
    DEM.set(id, d);
  }
  return d;
};

/** The mesh variants of one tier. */
function meshes(grid: GridSpec, data: Float32Array, sharp: Float32Array, n: number): Record<'today' | 'dataKeep' | 'sharpOld' | 'plan', RenderGrid> {
  return {
    today: decimateGrid(grid, data, n),
    dataKeep: decimateTerrain(grid, data, n),
    sharpOld: decimateGrid(grid, sharp, n),
    plan: decimateTerrain(grid, sharp, n),
  };
}

/**
 * Face statistics from lip cells. A lip cell is a cell of 55 deg or more whose cell one step up the fall line is under 45 deg; the
 * face is the fall-line run of cells of 45 deg or more below it, its height the drop and its run the horizontal distance walked
 * (in whole cells). `ledges` counts faces that meet 55 deg or more again within 3 steps below their foot (a bench, then
 * another face).
 */
function faceStats(grid: GridSpec, z: Float32Array): { n: number; bins: number[]; median: number; medianRun: number; ledges: number } {
  const { dzdx, dzdy } = hornGradient(grid, z);
  const sl = (i: number, j: number): number => slopeFromGradient(dzdx[j * grid.nx + i]!, dzdy[j * grid.nx + i]!);
  const heights: number[] = [];
  const runs: number[] = [];
  let ledges = 0;
  const inside = (i: number, j: number): boolean => i >= 2 && j >= 2 && i < grid.nx - 2 && j < grid.ny - 2;
  for (let j = 2; j < grid.ny - 2; j++)
    for (let i = 2; i < grid.nx - 2; i++) {
      const k = j * grid.nx + i;
      const s = slopeFromGradient(dzdx[k]!, dzdy[k]!);
      if (s < 55) continue;
      const gn = Math.hypot(dzdx[k]!, dzdy[k]!);
      const ux = dzdx[k]! / gn; // uphill
      const uy = dzdy[k]! / gn;
      const iu = Math.round(i + ux);
      const ju = Math.round(j + uy);
      if (!inside(iu, ju) || sl(iu, ju) >= 45) continue;
      // walk down
      let x = i;
      let y = j;
      let drop = 0;
      let zPrev = z[k]!;
      let steps = 0;
      while (steps < 80) {
        const ci = Math.round(x);
        const cj = Math.round(y);
        if (!inside(ci, cj)) break;
        const kk = cj * grid.nx + ci;
        const g2 = Math.hypot(dzdx[kk]!, dzdy[kk]!);
        if (slopeFromGradient(dzdx[kk]!, dzdy[kk]!) < 45 || g2 < 1e-6) break;
        x -= dzdx[kk]! / g2;
        y -= dzdy[kk]! / g2;
        const zNow = sampleBilinear(grid, z, grid.x0 + x * grid.cellSize, grid.y0 + y * grid.cellSize);
        drop += Math.max(0, zPrev - zNow);
        zPrev = zNow;
        steps++;
      }
      heights.push(drop);
      runs.push(steps * grid.cellSize);
      // A ledge: after the face ends, up to 3 more steps down the fall line meet 55 degrees or more again (a bench, then another face).
      let lx = x;
      let ly = y;
      for (let e = 0; e < 3; e++) {
        const ci = Math.round(lx);
        const cj = Math.round(ly);
        if (!inside(ci, cj)) break;
        const kk = cj * grid.nx + ci;
        const g2 = Math.hypot(dzdx[kk]!, dzdy[kk]!);
        if (g2 < 1e-6) break;
        lx -= dzdx[kk]! / g2;
        ly -= dzdy[kk]! / g2;
        const c2 = Math.round(lx);
        const d2 = Math.round(ly);
        if (inside(c2, d2) && sl(c2, d2) >= 55) {
          ledges++;
          break;
        }
      }
    }
  heights.sort((a, b) => a - b);
  runs.sort((a, b) => a - b);
  const bins = [0, 0, 0, 0, 0];
  for (const h of heights) bins[h < 30 ? 0 : h < 60 ? 1 : h < 100 ? 2 : h < 200 ? 3 : 4]!++;
  return { n: heights.length, bins, median: heights.length ? heights[Math.floor(heights.length / 2)]! : 0, medianRun: runs.length ? runs[Math.floor(runs.length / 2)]! : 0, ledges };
}


// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────
describe.skipIf(!process.env.FIRESIM_SPIKE)('S5 cliff sharpening and edge-keeping mesh (spike)', () => {
  // ── 1. The plan's table ──────────────────────────────────────────────────────
  it('re-runs the table of plan 9d.3 on the four sites', () => {
    say(`S5 harness: node ${process.version}, ${cpus().length} cores (${cpus()[0]?.model ?? '?'}), load average ${loadavg().map((v) => v.toFixed(1)).join(' ')} when it started, ${REPS} timed repetitions, median (min) in ms`);
    say('');
    say('== 1. The table of plan 9d.3, re-run (10 m terrain, whole grid; the prototype is the optimised cliffSharpen of this file)');
    say('Columns: data to new. "PLAN" is the number printed in 9d.3, "NOW" is this run. d = NOW - PLAN.');
    say('');
    for (const id of SITES) {
      const { grid, elev } = demOf(id);
      const P = PLAN[id]!;
      const r = cliffSharpen(grid, elev);
      const sh = r.elevation;
      const s0 = hornSlope(grid, elev);
      const s1 = hornSlope(grid, sh);
      const d0 = drainageMask(grid, elev);
      const d1 = drainageMask(grid, sh);
      const overlap = iou(d0, d1);
      const m400 = meshes(grid, elev, sh, 400);
      const m224 = meshes(grid, elev, sh, 224);
      const e = (rg: RenderGrid): Float32Array => edgeSlope(rg.grid, rg.elevation);
      const rows: [string, string, string][] = [
        ['steepest 10 m slope (deg)', `${f1(P.steepest[0])} to ${f1(P.steepest[1])}`, `${f1(maxOf(s0))} to ${f1(maxOf(s1))}`],
        ['area over 70 deg (%)', `${f2(P.over70[0])} to ${f2(P.over70[1])}`, `${f2(share(s0, 70))} to ${f2(share(s1, 70))}`],
        ['High mesh edges over 70 deg (%), today to new', `${f2(P.edges70High[0])} to ${f2(P.edges70High[1])}`, `${f2(share(e(m400.today), 70))} to ${f2(share(e(m400.plan), 70))}`],
        ['steepest High mesh edge (deg), today to new', `${f1(P.edgeMaxHigh[0])} to ${f1(P.edgeMaxHigh[1])}`, `${f1(maxOf(e(m400.today)))} to ${f1(maxOf(e(m400.plan)))}`],
        ['steepest Low mesh edge (deg), today to new', `${f1(P.edgeMaxLow[0])} to ${f1(P.edgeMaxLow[1])}`, `${f1(maxOf(e(m224.today)))} to ${f1(maxOf(e(m224.plan)))}`],
        ['drainage overlap (IoU, 5 ha)', f2(P.iou), f2(overlap)],
      ];
      say(`-- ${id} (${grid.nx} x ${grid.ny} cells at ${grid.cellSize} m)`);
      say(`${'quantity'.padEnd(48)}${pad('PLAN', 16)}${pad('NOW', 16)}`);
      for (const [name, a, b] of rows) say(`${name.padEnd(48)}${pad(a, 16)}${pad(b, 16)}`);
      say(`cells with weight > 0: ${r.stats.weighted} (${f2((100 * r.stats.weighted) / elev.length)} % of cells); moved by 0.5 m or more: ${r.stats.moved} (${f2((100 * r.stats.moved) / elev.length)} %), mean ${f1(r.stats.movedMeanM)} m, largest ${f1(r.stats.movedMaxM)} m`);
      say(`despiked: ${r.stats.despiked} cells; towers/pits of 10 m or more left: ${JSON.stringify(countSpikes(grid, sh, 10))}; before sharpening, in the data: ${JSON.stringify(countSpikes(grid, elev, 10))}`);
      say(`smaller spikes (towers/pits standing out from all 8 neighbours by at least 3 m, 5 m): data ${JSON.stringify(countSpikes(grid, elev, 3))} ${JSON.stringify(countSpikes(grid, elev, 5))}; sharpened ${JSON.stringify(countSpikes(grid, sh, 3))} ${JSON.stringify(countSpikes(grid, sh, 5))}`);
      // Cross-check against the probe that made the plan's table.
      const ref = despikeRef(grid, steepenDirRef(grid, elev, { loDeg: 48, hiDeg: 62, R: 3, passes: 1, eps: 0.5 }), 10);
      let diff = 0;
      let maxd = 0;
      for (let k = 0; k < sh.length; k++) {
        const dd = Math.abs(sh[k]! - ref.z[k]!);
        if (dd > 1e-3) diff++;
        if (dd > maxd) maxd = dd;
      }
      say(`against the plan's probe (steepenDir + despike, whole grid): ${diff} cells differ by more than 1 mm, largest difference ${maxd.toExponential(1)} m; probe despiked ${ref.fixed}`);
      // The probe's decimateKeep against decimateTerrain on the same sharpened terrain (High).
      const kr = decimateKeepRef(grid, sh, 400);
      let dm = 0;
      for (let k = 0; k < kr.z.length; k++) dm = Math.max(dm, Math.abs(kr.z[k]! - m400.plan.elevation[k]!));
      say(`decimateTerrain against the probe's decimateKeep (High): largest difference ${dm.toExponential(1)} m`);
      say('');
      // Reproduction is judged on the plan's rounding.
      expect(Math.abs(maxOf(s0) - P.steepest[0])).toBeLessThan(0.15);
      expect(Math.abs(maxOf(s1) - P.steepest[1])).toBeLessThan(0.15);
      expect(Math.abs(share(s1, 70) - P.over70[1])).toBeLessThan(0.02);
      expect(Math.abs(overlap - P.iou)).toBeLessThan(0.015);
      expect(maxd).toBeLessThan(0.01);
      expect(dm).toBeLessThan(0.01);
    }
  }, 600000);

  // ── 2. Mesh edges for every combination, all tiers ───────────────────────────
  it('measures the mesh edges for the four combinations and three tiers', () => {
    say('== 2. Mesh edges (share of the triangle edges, both axes) by combination: today = box blur of the data (decimateGrid);');
    say('   data+keep = decimateTerrain of the data; sharp+blur = decimateGrid of the sharpened terrain; plan = decimateTerrain of the sharpened terrain');
    say(`${'site'.padEnd(10)}${'tier'.padEnd(8)}${'cell'.padEnd(8)}${'combination'.padEnd(12)}${pad('max deg', 9)}${pad('>60 %', 9)}${pad('>70 %', 9)}${pad('>80 %', 9)}`);
    for (const id of SITES) {
      const { grid, elev } = demOf(id);
      const sh = cliffSharpen(grid, elev).elevation;
      for (const [tier, n] of TIERS) {
        const m = meshes(grid, elev, sh, n);
        for (const key of ['today', 'dataKeep', 'sharpOld', 'plan'] as const) {
          const e = edgeSlope(m[key].grid, m[key].elevation);
          const label = { today: 'today', dataKeep: 'data+keep', sharpOld: 'sharp+blur', plan: 'plan' }[key];
          say(`${id.padEnd(10)}${tier.padEnd(8)}${(m[key].grid.cellSize.toFixed(1) + ' m').padEnd(8)}${label.padEnd(12)}${pad(f1(maxOf(e)), 9)}${pad(f2(share(e, 60)), 9)}${pad(f2(share(e, 70)), 9)}${pad(f2(share(e, 80)), 9)}`);
        }
      }
    }
    say('');
    say('== 2b. Spikes in the mesh as drawn: vertices that stand out from all 8 mesh neighbours by at least 5 m / 10 m / 20 m (towers + pits), by combination.');
    say('   "plan + despike" = decimateTerrain with a despike pass on the finished mesh at 10 m (High) / 18 m (Low), 2 m margin (the 10 m terrain rule scaled to the vertex spacing: 45 degrees to every neighbour at 10 m cells is about 22 m at 22.5 m and 40 m at 40.3 m; 10 and 18 are the milder values tried)');
    say(`${'site'.padEnd(10)}${'tier'.padEnd(8)}${'combination'.padEnd(16)}${pad('>=5 m', 8)}${pad('>=10 m', 8)}${pad('>=20 m', 8)}${pad('max deg', 9)}${pad('>70 %', 8)}`);
    for (const id of SITES) {
      const { grid, elev } = demOf(id);
      const sh = cliffSharpen(grid, elev).elevation;
      for (const [tier, n, dm] of [
        ['High', 400, 10],
        ['Low', 224, 18],
      ] as const) {
        const m = meshes(grid, elev, sh, n);
        const variants: [string, RenderGrid][] = [
          ['today', m.today],
          ['plan', m.plan],
          ['plan + despike', decimateTerrain(grid, sh, n, { despikeM: dm })],
        ];
        for (const [label, rg] of variants) {
          const c = (t: number): number => {
            const r = countSpikes(rg.grid, rg.elevation, t);
            return r.towers + r.pits;
          };
          const e = edgeSlope(rg.grid, rg.elevation);
          say(`${id.padEnd(10)}${tier.padEnd(8)}${label.padEnd(16)}${pad(c(5), 8)}${pad(c(10), 8)}${pad(c(20), 8)}${pad(f1(maxOf(e)), 9)}${pad(f2(share(e, 70)), 8)}`);
        }
      }
    }
    say('');
  }, 600000);

  // ── 3. Timings in node ──────────────────────────────────────────────────────
  it('times every stage in node', () => {
    say('== 3. Build timings in node (ms, median of ' + REPS + ' after 2 warm-ups; this machine has 4 shared cores, so read them as upper-ish)');
    say(`${'site'.padEnd(10)}${pad('sharpen', 16)}${pad('slope', 7)}${pad('weights', 9)}${pad('move', 7)}${pad('despike', 9)}${pad('decim old', 16)}${pad('decim keep', 16)}${pad('light 10 m', 16)}`);
    for (const id of SITES) {
      const { grid, elev } = demOf(id);
      const sh = cliffSharpen(grid, elev).elevation;
      const tot = time(() => cliffSharpen(grid, elev));
      // stage split of one more run
      const st = cliffSharpen(grid, elev).stats.ms;
      const dOld = time(() => decimateGrid(grid, sh, 400));
      const dKeep = time(() => decimateTerrain(grid, sh, 400));
      const lg = time(() => {
        const g = hornGradient(grid, sh);
        const n2 = new Float32Array(grid.nx * grid.ny * 2);
        for (let k = 0; k < grid.nx * grid.ny; k++) {
          n2[k * 2] = g.dzdx[k]!;
          n2[k * 2 + 1] = g.dzdy[k]!;
        }
        const h = new Uint16Array(n2.length);
        for (let k = 0; k < n2.length; k++) h[k] = THREE.DataUtils.toHalfFloat(Math.max(-65000, Math.min(65000, n2[k]!)));
        return h;
      });
      say(`${id.padEnd(10)}${pad(ms(tot), 16)}${pad(st.slope.toFixed(0), 7)}${pad(st.weights.toFixed(0), 9)}${pad(st.move.toFixed(0), 7)}${pad(st.despike.toFixed(0), 9)}${pad(ms(dOld), 16)}${pad(ms(dKeep), 16)}${pad(ms(lg), 16)}`);
      // The unoptimised whole-grid probe, for the plan's "0.45 to 0.54 s".
      if (id === 'katoomba' || id === 'tomah') {
        const t0 = performance.now();
        despikeRef(grid, steepenDirRef(grid, elev, { loDeg: 48, hiDeg: 62, R: 3, passes: 1, eps: 0.5 }), 10);
        say(`${''.padEnd(10)}the plan's unoptimised probe on this site: ${(performance.now() - t0).toFixed(0)} ms (one run)`);
      }
    }
    say('"light 10 m" = Horn gradient of the 10 m terrain + interleave + half-float conversion, i.e. what the RG16F lighting texture costs to build on the CPU (the plan does not budget it).');
    say('');
  }, 600000);

  // ── 4. Properties from the plan's pure-test list (9d.6) on the prototype ──────
  it('holds the properties listed in plan 9d.6', () => {
    say('== 4. Properties from the pure-test list of plan 9d.6, checked on the prototype');
    const props: [string, boolean, string][] = [];
    const mk = (nx: number, ny: number, h = 10): GridSpec => ({ nx, ny, cellSize: h, x0: 0, y0: 0, origin: { lat: -33.7, lon: 150.3 } });
    // (a) a 70 degree ramp with rounded shoulders becomes steeper and keeps its end heights.
    {
      const g = mk(60, 40);
      const z = new Float32Array(g.nx * g.ny);
      // height profile along x: plateau 100 m, ramp of 70 deg (run 36 m for 100 m), foot 0 m, shoulders rounded by a smoothstep over 3 cells
      const prof = (x: number): number => {
        const x0 = 200;
        const run = 100 / Math.tan((70 * Math.PI) / 180);
        const u = (x - x0) / run;
        const t = Math.min(1, Math.max(0, u));
        // blend of the straight ramp and a smoothstep: rounded shoulders, same end heights
        const ramp = 100 * (1 - t);
        const rounded = 100 * (1 - t * t * (3 - 2 * t));
        return 0.45 * ramp + 0.55 * rounded;
      };
      for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) z[j * g.nx + i] = prof(i * 10);
      const r = cliffSharpen(g, z);
      const before = maxOf(hornSlope(g, z));
      const after = maxOf(hornSlope(g, r.elevation));
      const j = 20;
      const topSame = r.elevation[j * g.nx + 5] === z[j * g.nx + 5] && r.elevation[j * g.nx + 6] === z[j * g.nx + 6];
      const footSame = r.elevation[j * g.nx + 54] === z[j * g.nx + 54];
      props.push(['a 70 deg ramp with rounded shoulders becomes steeper', after > before + 2, `steepest ${f1(before)} to ${f1(after)} deg`]);
      props.push(['... and keeps its end heights', topSame && footSame, `plateau cells unchanged: ${topSame}, foot cells unchanged: ${footSame}`]);
    }
    // (b) a straight ramp and all ground under 48 degrees are untouched bit for bit.
    {
      const g = mk(80, 80);
      const plane = new Float32Array(g.nx * g.ny);
      const gentle = new Float32Array(g.nx * g.ny);
      for (let j = 0; j < g.ny; j++)
        for (let i = 0; i < g.nx; i++) {
          plane[j * g.nx + i] = 500 - 25 * i + 7 * j; // 68 deg planar ramp, slightly oblique
          gentle[j * g.nx + i] = 300 + 6 * Math.sin(i / 9) * 3 + 4 * Math.cos(j / 7) * 3 - 3 * i; // mean slope about 17 deg, steepest under 30
        }
      const rp = cliffSharpen(g, plane).elevation;
      let same = true;
      for (let j = 5; j < g.ny - 5; j++) for (let i = 5; i < g.nx - 5; i++) if (rp[j * g.nx + i] !== plane[j * g.nx + i]) same = false;
      const rg = cliffSharpen(g, gentle).elevation;
      const sameG = rg.every((v, k) => v === gentle[k]);
      const maxG = maxOf(hornSlope(g, gentle));
      props.push(['a straight ramp (68 deg plane, 5 cells in from the edge) is untouched bit for bit', same, '']);
      props.push(['ground under 48 deg is untouched bit for bit', sameG && maxG < 48, `steepest in the test ${f1(maxG)} deg`]);
    }
    // (c) a gully with steep walls stays a slot: floor cells unchanged, drainage kept.
    {
      const g = mk(120, 120);
      const z = new Float32Array(g.nx * g.ny);
      for (let j = 0; j < g.ny; j++)
        for (let i = 0; i < g.nx; i++) {
          const x = Math.abs(i - 60) * 10; // distance from the gully axis (m)
          const wall = Math.min(x * Math.tan((60 * Math.PI) / 180), 120); // 60 deg walls up to a plateau 120 m above the floor
          z[j * g.nx + i] = 200 + 1.8 * j * 1 + wall; // the whole thing falls 0.18 m per metre (10 deg) towards the south
        }
      const r = cliffSharpen(g, z).elevation;
      let floorSame = true;
      for (let j = 4; j < g.ny - 4; j++) if (Math.abs(r[j * g.nx + 60]! - z[j * g.nx + 60]!) > 1e-3) floorSame = false;
      const m0 = drainageMask(g, z, 10000);
      const m1 = drainageMask(g, r, 10000);
      let cnt0 = 0;
      for (let k = 0; k < m0.length; k++) cnt0 += m0[k]!;
      props.push(['a gully with 60 deg walls stays a slot: floor cells unchanged', floorSame, `drainage cells (1 ha) before ${cnt0}, overlap ${f2(iou(m0, m1))}`]);
      props.push(['... and its drainage is kept (overlap at least 0.85)', iou(m0, m1) >= 0.85, '']);
    }
    // (d) no tower or pit of 10 m or more after the despike; bounded moves; deterministic; edges untouched; no NaN.
    {
      const g = mk(120, 120);
      const z = new Float32Array(g.nx * g.ny);
      let s = 12345;
      const rnd = (): number => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
      };
      for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) z[j * g.nx + i] = 400 + 90 * Math.sin(i / 9) * Math.cos(j / 11) + (rnd() < 0.02 ? (rnd() - 0.5) * 120 : 0) + 2 * rnd();
      const a = cliffSharpen(g, z);
      const b = cliffSharpen(g, z);
      const sp = countSpikes(g, a.elevation, 10);
      const det = a.elevation.every((v, k) => v === b.elevation[k]);
      let edges = true;
      for (let i = 0; i < g.nx; i++) if (a.elevation[i] !== z[i] || a.elevation[(g.ny - 1) * g.nx + i] !== z[(g.ny - 1) * g.nx + i]) edges = false;
      for (let j = 0; j < g.ny; j++) if (a.elevation[j * g.nx] !== z[j * g.nx] || a.elevation[j * g.nx + g.nx - 1] !== z[j * g.nx + g.nx - 1]) edges = false;
      // bounded: every output cell lies within the 7 x 7 neighbourhood range of the data, plus the despike margin
      let bounded = true;
      for (let j = 3; j < g.ny - 3; j++)
        for (let i = 3; i < g.nx - 3; i++) {
          let lo = Infinity;
          let hi = -Infinity;
          for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
            const v = z[(j + dj) * g.nx + i + di]!;
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
          const o = a.elevation[j * g.nx + i]!;
          if (o < lo - 2 - 1e-3 || o > hi + 2 + 1e-3) bounded = false;
        }
      const zn = Float32Array.from(z);
      zn[60 * g.nx + 60] = NaN;
      zn[30 * g.nx + 40] = NaN;
      const rn = cliffSharpen(g, zn).elevation;
      let nan = 0;
      for (let k = 0; k < rn.length; k++) if (Number.isNaN(rn[k]!) && !Number.isNaN(zn[k]!)) nan++;
      props.push(['no tower or pit of 10 m or more after the despike (rugged test terrain with 2 % random spikes)', sp.towers === 0 && sp.pits === 0, `towers ${sp.towers}, pits ${sp.pits}; despiked ${a.stats.despiked}`]);
      props.push(['deterministic (two runs identical)', det, '']);
      props.push(['grid edges untouched', edges, '']);
      props.push(['moves bounded by the 7 x 7 neighbourhood range (plus the 2 m despike margin)', bounded, '']);
      props.push(['no new NaN when the data has NaN cells', nan === 0, `${nan} new NaN`]);
    }
    // (e) a generous time guard on a real 900 x 900 grid.
    {
      const { grid, elev } = demOf('kanangra');
      const t0 = performance.now();
      cliffSharpen(grid, elev);
      const dt = performance.now() - t0;
      props.push(['900 x 900 grid in under 1 s (generous guard)', dt < 1000, `${dt.toFixed(0)} ms`]);
    }
    // (f) decimateTerrain: bit-identical to decimateGrid where every footprint is gentler than 40 degrees.
    {
      const { grid, elev } = demOf('tomah');
      const gentle = new Float32Array(grid.nx * grid.ny);
      for (let j = 0; j < grid.ny; j++) for (let i = 0; i < grid.nx; i++) gentle[j * grid.nx + i] = 600 + 18 * Math.sin(i / 23) * Math.cos(j / 31) * 8 + 0.35 * i;
      const smax = maxOf(hornSlope(grid, gentle));
      const a = decimateTerrain(grid, gentle, 400);
      const b = decimateGrid(grid, gentle, 400);
      const same = a.elevation.length === b.elevation.length && a.elevation.every((v, k) => v === b.elevation[k]);
      props.push(['decimateTerrain equals decimateGrid exactly on ground under 40 deg', same && smax < 40, `steepest in the test ${f1(smax)} deg`]);
      // On the real terrain: every vertex whose footprint is under 40 deg equals decimateGrid.
      const real = decimateTerrain(grid, elev, 400);
      const base = decimateGrid(grid, elev, 400);
      let eq = 0;
      let ne = 0;
      for (let k = 0; k < real.elevation.length; k++) if (real.elevation[k] === base.elevation[k]) eq++;
      else ne++;
      props.push(['(real Tomah data) share of High vertices that differ from decimateGrid', true, `${ne} of ${real.elevation.length} (${f2((100 * ne) / real.elevation.length)} %)`]);
    }
    say(`${'property'.padEnd(100)}result`);
    for (const [name, ok, note] of props) say(`${name.padEnd(100)}${ok ? 'PASS' : 'FAIL'}  ${note}`);
    say('');
    for (const [name, ok] of props) expect(ok, name).toBe(true);
  }, 600000);

  // ── 5. What the mesh alone can show: a step of height H sampled at spacing s ─────
  it('measures what a 22 m and a 40 m mesh can show of a step', () => {
    say('== 5. What the mesh alone can show: the steepest edge of the mesh across an ideal step of height H, as the step slides across the vertex lattice');
    say('   (the data step is one 10 m cell wide, 10 m cells, mesh by decimateTerrain on the data; the phase is scanned in 1 m steps; "blur" = decimateGrid)');
    say(`${'H (m)'.padEnd(8)}${'spacing'.padEnd(10)}${pad('ideal', 8)}${pad('keep min', 10)}${pad('keep mean', 11)}${pad('keep max', 10)}${pad('blur min', 10)}${pad('blur mean', 11)}${pad('blur max', 10)}`);
    const origin = { lat: -33.7, lon: 150.3 };
    for (const H of [30, 60, 100, 150, 300]) {
      for (const n of [400, 224]) {
        const g: GridSpec = { nx: 900, ny: 24, cellSize: 10, x0: 0, y0: 0, origin };
        const spacing = (899 * 10) / (n - 1);
        const keepV: number[] = [];
        const blurV: number[] = [];
        const wide: GridSpec = { ...g, ny: 900 };
        for (let ph = 0; ph < spacing; ph += 1) {
          const z = new Float32Array(wide.nx * wide.ny);
          const cut = Math.round((4000 + ph) / 10); // step between cell cut-1 and cut
          for (let j = 0; j < wide.ny; j++) for (let i = 0; i < wide.nx; i++) z[j * wide.nx + i] = i < cut ? H : 0;
          const steepest = (rg: RenderGrid): number => {
            // the mesh edges along x in a row away from the grid edge
            const row = Math.floor(rg.grid.ny / 2);
            let mx = 0;
            for (let i = 0; i < rg.grid.nx - 1; i++) mx = Math.max(mx, Math.atan(Math.abs(rg.elevation[row * rg.grid.nx + i + 1]! - rg.elevation[row * rg.grid.nx + i]!) / rg.grid.cellSize) * RAD);
            return mx;
          };
          keepV.push(steepest(decimateTerrain(wide, z, n)));
          blurV.push(steepest(decimateGrid(wide, z, n)));
        }
        const st = (a: number[]): [number, number, number] => [Math.min(...a), a.reduce((x, y) => x + y, 0) / a.length, Math.max(...a)];
        const k = st(keepV);
        const b = st(blurV);
        say(`${String(H).padEnd(8)}${(spacing.toFixed(1) + ' m').padEnd(10)}${pad(f1((Math.atan(H / spacing) * 180) / Math.PI), 8)}${pad(f1(k[0]), 10)}${pad(f1(k[1]), 11)}${pad(f1(k[2]), 10)}${pad(f1(b[0]), 10)}${pad(f1(b[1]), 11)}${pad(f1(b[2]), 10)}`);
      }
    }
    say('"ideal" = atan(H / spacing): the best a mesh can do with one pair of vertices straddling the step. The plan 9d.6 test "150 m step keeps at least 80 deg on the 22 m mesh and 75 on the 40 m mesh" is the ideal column; it needs no vertex inside the 10 m transition.');
    say('');
  }, 600000);

  // ── 6. Fallback ladder ──────────────────────────────────────────────────────
  it('walks the fallback ladder', () => {
    say('== 6. Fallback ladder (cumulative, strongest first). Numbers per site: steepest slope, area over 70 deg, High and Low mesh edges over 70 deg (decimateTerrain), drainage overlap, cells moved, mean move, despiked');
    const rungs: [string, Partial<CliffSharpenOptions>][] = [
      ['R0 plan: gate 48-62, window 3, full', {}],
      ['R1 weaker gate 52-66', { loDeg: 52, hiDeg: 66 }],
      ['R2 R1 + one-cell window', { loDeg: 52, hiDeg: 66, window: 1 }],
      ['R3 R2 + lip and foot only (snap 0.25)', { loDeg: 52, hiDeg: 66, window: 1, snap: 0.25 }],
      ['(alone) one-cell window, plan gate', { window: 1 }],
      ['(alone) lip and foot only (snap 0.25), plan gate', { snap: 0.25 }],
      ['(alone) strength 0.6, plan gate', { strength: 0.6 }],
      ['(alone) despike at 5 m, plan gate', { despikeM: 5 }],
      ['(alone) despike at 3 m, plan gate', { despikeM: 3 }],
    ];
    say(`${'site'.padEnd(10)}${'rung'.padEnd(52)}${pad('steep', 7)}${pad('>70 %', 7)}${pad('High>70', 9)}${pad('Low>70', 8)}${pad('IoU', 6)}${pad('moved', 8)}${pad('mean m', 8)}${pad('desp', 6)}${pad('spk>=5', 8)}${pad('ledge %', 9)}`);
    for (const id of SITES) {
      const { grid, elev } = demOf(id);
      const d0 = drainageMask(grid, elev);
      const s0 = hornSlope(grid, elev);
      say(`${id.padEnd(10)}${'data (no sharpening)'.padEnd(52)}${pad(f1(maxOf(s0)), 7)}${pad(f2(share(s0, 70)), 7)}${pad(f2(share(edgeSlope(decimateGrid(grid, elev, 400).grid, decimateGrid(grid, elev, 400).elevation), 70)), 9)}${pad(f2(share(edgeSlope(decimateGrid(grid, elev, 224).grid, decimateGrid(grid, elev, 224).elevation), 70)), 8)}${pad('', 6 + 6 + 8 + 8)}${pad('', 8)}${pad((() => { const c = countSpikes(grid, elev, 5); return c.towers + c.pits; })(), 8)}${pad((() => { const f = faceStats(grid, elev); return `${((100 * f.ledges) / Math.max(1, f.n)).toFixed(0)} %`; })(), 9)}`);
      for (const [name, o] of rungs) {
        const r = cliffSharpen(grid, elev, o);
        const s1 = hornSlope(grid, r.elevation);
        const hi = decimateTerrain(grid, r.elevation, 400);
        const lo = decimateTerrain(grid, r.elevation, 224);
        const ov = iou(d0, drainageMask(grid, r.elevation));
        say(`${''.padEnd(10)}${name.padEnd(52)}${pad(f1(maxOf(s1)), 7)}${pad(f2(share(s1, 70)), 7)}${pad(f2(share(edgeSlope(hi.grid, hi.elevation), 70)), 9)}${pad(f2(share(edgeSlope(lo.grid, lo.elevation), 70)), 8)}${pad(f2(ov), 6)}${pad(r.stats.moved, 8)}${pad(f1(r.stats.movedMeanM), 8)}${pad(r.stats.despiked, 6)}${pad((() => { const c = countSpikes(grid, r.elevation, 5); return c.towers + c.pits; })(), 8)}${pad((() => { const f = faceStats(grid, r.elevation); return `${((100 * f.ledges) / Math.max(1, f.n)).toFixed(0)} %`; })(), 9)}`);
      }
    }
    say('');
  }, 900000);

  // ── 6b. How far does the drawn face drift from the data's? ──────────────────────────
  it('measures how far the sharpened faces sit from the data faces', () => {
    say('== 6b. Drift of the drawn face from the data (plan 9d.3 item 7: the drawn lip and foot "can sit up to about three cells (30 m)" from the data\'s)');
    say('   For every cell of the sharpened terrain at 45 deg or more: the distance (cells, Chebyshev) to the nearest data cell at 45 deg or more, searched out to 6 cells. 0 = the cell is steep in the data too.');
    say(`${'site'.padEnd(10)}${pad('cells', 8)}${pad('0', 7)}${pad('1', 7)}${pad('2', 7)}${pad('3', 7)}${pad('4', 7)}${pad('5-6', 7)}${pad('>6', 7)}${pad('mean', 7)}`);
    const R = 6;
    for (const id of SITES) {
      const { grid, elev } = demOf(id);
      const sh = cliffSharpen(grid, elev).elevation;
      const t45 = Math.tan((45 * Math.PI) / 180) ** 2;
      const t62 = t45;
      const gd = hornTan2(grid, elev);
      const gs = hornTan2(grid, sh);
      const bins = new Array<number>(8).fill(0);
      let n = 0;
      let sum = 0;
      for (let j = R; j < grid.ny - R; j++)
        for (let i = R; i < grid.nx - R; i++) {
          if (gs[j * grid.nx + i]! < t62) continue;
          n++;
          let best = R + 1;
          for (let r = 0; r <= R && best > R; r++) {
            for (let dj = -r; dj <= r && best > R; dj++)
              for (let di = -r; di <= r; di++) {
                if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
                if (gd[(j + dj) * grid.nx + i + di]! >= t45) {
                  best = r;
                  break;
                }
              }
          }
          bins[best <= 4 ? best : best <= 6 ? 5 : 6]!++;
          sum += Math.min(best, R + 1);
        }
      const pc = (v: number): string => `${((100 * v) / n).toFixed(1)}%`;
      say(`${id.padEnd(10)}${pad(n, 8)}${bins.slice(0, 7).map((v) => pad(pc(v), 7)).join('')}${pad((sum / n).toFixed(2), 7)}`);
    }
    say('');
  }, 600000);

  // ── 6c. The faces used in the pictures ─────────────────────────────────────────────
  it('measures the faces of the pictures and the band the shader paints as rock', () => {
    // One sheer face per site: centre (local m), the compass direction it faces (downhill). Chosen from the 10 m terrain by drop and run.
    const FACES: Record<string, { c: [number, number]; az: number }> = {
      katoomba: { c: [2505, -1995], az: 181 },
      kanangra: { c: [-55, 505], az: 348 },
      grose: { c: [-1665, -915], az: 89 },
      tomah: { c: [2225, -4185], az: 239 },
    };
    say('== 6c. The faces of the pictures: ground height at the face centre, and the width of the band where the slope the shader uses is 50 deg or more');
    say('   (the shader switches from photo to banded rock between 40 and 58 deg). Profile along the fall line through the centre, 2 m steps, +-200 m; "from, to" in m, + = downhill.');
    say(`${'site'.padEnd(10)}${'ground at centre: data / today mesh / sharpened mesh (m)'.padEnd(58)}`);
    for (const id of SITES) {
      const { grid, elev } = demOf(id);
      const f = FACES[id]!;
      const sh = cliffSharpen(grid, elev).elevation;
      const today = decimateGrid(grid, elev, 400);
      const plan = decimateTerrain(grid, sh, 400);
      const zc = (g: GridSpec, z: Float32Array): number => sampleBilinear(g, z, f.c[0], f.c[1]);
      say(`${id.padEnd(10)}${`${zc(grid, elev).toFixed(0)} / ${zc(today.grid, today.elevation).toFixed(0)} / ${zc(plan.grid, plan.elevation).toFixed(0)}`.padEnd(58)}`);
      const ux = Math.sin((f.az * Math.PI) / 180);
      const uy = Math.cos((f.az * Math.PI) / 180);
      const fire30 = fireTerrainFromHiRes({ grid, elevation: elev, source: 'spike' }, 30);
      const reps: [string, GridSpec, Float32Array, Float32Array][] = [];
      const add = (name: string, g: GridSpec, z: Float32Array): void => {
        const gr = hornGradient(g, z);
        reps.push([name, g, gr.dzdx, gr.dzdy]);
      };
      reps.push(["fire grid 30 m (today's lighting)", fire30.grid, fire30.dzdx, fire30.dzdy]);
      add('10 m data', grid, elev);
      add('10 m sharpened', grid, sh);
      add('High mesh, today', today.grid, today.elevation);
      add('High mesh, plan', plan.grid, plan.elevation);
      const lowToday = decimateGrid(grid, elev, 224);
      const lowPlan = decimateTerrain(grid, sh, 224);
      add('Low mesh, today', lowToday.grid, lowToday.elevation);
      add('Low mesh, plan', lowPlan.grid, lowPlan.elevation);
      for (const [name, g, dx, dy] of reps) {
        let n = 0;
        let first = NaN;
        let last = NaN;
        for (let t = -200; t <= 200; t += 2) {
          const x = f.c[0] + ux * t;
          const y = f.c[1] + uy * t;
          const sl = (Math.atan(Math.hypot(sampleBilinear(g, dx, x, y), sampleBilinear(g, dy, x, y))) * 180) / Math.PI;
          if (sl >= 50) {
            n++;
            if (Number.isNaN(first)) first = t;
            last = t;
          }
        }
        say(`   ${name.padEnd(36)} width ${pad(n * 2, 4)} m   from ${pad(first, 5)} to ${pad(last, 5)}`);
      }
    }
    say('');
  }, 600000);

  // ── 7. How tall are the faces, and what would steep-patch refinement cost? ─────
  it('measures face heights and the cost of steep-patch refinement', () => {
    say('== 7. Face heights (fall-line runs of 45 deg or more that start at a lip cell of 55 deg or more), in the data and in the sharpened terrain');
    say('   A lip cell = a cell of 55 deg or more whose cell one step up the fall line is under 45 deg. The height is the drop to the foot (the first cell under 45 deg going down).');
    say('   ledge % = share of faces that meet 55 deg or more again within 3 cells below their foot (a bench, then another face): a measure of terracing.');
    say(`${'site'.padEnd(10)}${'terrain'.padEnd(17)}${pad('lips', 7)}${pad('<30 m', 8)}${pad('30-60', 8)}${pad('60-100', 8)}${pad('100-200', 9)}${pad('>200 m', 8)}${pad('drop', 8)}${pad('run', 7)}${pad('ledge %', 9)}`);
    for (const id of SITES) {
      const { grid, elev } = demOf(id);
      const sh = cliffSharpen(grid, elev).elevation;
      const hiToday = decimateGrid(grid, elev, 400);
      const hiPlan = decimateTerrain(grid, sh, 400);
      const loToday = decimateGrid(grid, elev, 224);
      const loPlan = decimateTerrain(grid, sh, 224);
      const items: [string, GridSpec, Float32Array][] = [
        ['10 m data', grid, elev],
        ['10 m sharpened', grid, sh],
        ['High today', hiToday.grid, hiToday.elevation],
        ['High plan', hiPlan.grid, hiPlan.elevation],
        ['Low today', loToday.grid, loToday.elevation],
        ['Low plan', loPlan.grid, loPlan.elevation],
      ];
      for (const [label, g, z] of items) {
        const f = faceStats(g, z);
        const pc = (v: number): string => (f.n ? `${((100 * v) / f.n).toFixed(0)} %` : '-');
        say(`${id.padEnd(10)}${label.padEnd(17)}${pad(f.n, 7)}${pad(pc(f.bins[0]!), 8)}${pad(pc(f.bins[1]!), 8)}${pad(pc(f.bins[2]!), 8)}${pad(pc(f.bins[3]!), 9)}${pad(pc(f.bins[4]!), 8)}${pad(f.median.toFixed(0) + ' m', 8)}${pad(f.medianRun.toFixed(0) + ' m', 7)}${pad(pc(f.ledges), 9)}`);
      }
    }
    say('   drop = median height from lip to foot; run = median horizontal distance from the lip cell to the first cell under 45 deg (whole cells of the grid it is measured on).');
    say('');
    say('== 7b. Steep-patch refinement, counted (10 m triangles instead of the mesh quads where the sharpened terrain has 45 deg or more inside the quad, plus a one-quad margin)');
    say(`${'site'.padEnd(10)}${'tier'.padEnd(8)}${pad('mesh tris', 11)}${pad('quads', 8)}${pad('flagged', 9)}${pad('% of quads', 11)}${pad('extra tris', 12)}${pad('total tris', 12)}${pad('flag >=55', 11)}${pad('extra >=55', 12)}`);
    for (const id of SITES) {
      const { grid, elev } = demOf(id);
      const sh = cliffSharpen(grid, elev).elevation;
      const g2 = hornTan2(grid, sh);
      const t45 = Math.tan((45 * Math.PI) / 180) ** 2;
      const t55 = Math.tan((55 * Math.PI) / 180) ** 2;
      for (const [tier, n] of TIERS) {
        const rg = decimateGrid(grid, sh, n);
        const mg = rg.grid;
        const cellsPerQuad = (mg.cellSize / grid.cellSize) ** 2;
        const flag = (thr: number): number => {
          const f = new Uint8Array(mg.nx * mg.ny);
          for (let j = 0; j < mg.ny - 1; j++)
            for (let i = 0; i < mg.nx - 1; i++) {
              const xa = mg.x0 + i * mg.cellSize;
              const ya = mg.y0 + j * mg.cellSize;
              const i0 = Math.max(0, Math.floor((xa - grid.x0) / grid.cellSize));
              const i1 = Math.min(grid.nx - 1, Math.ceil((xa + mg.cellSize - grid.x0) / grid.cellSize));
              const j0 = Math.max(0, Math.floor((ya - grid.y0) / grid.cellSize));
              const j1 = Math.min(grid.ny - 1, Math.ceil((ya + mg.cellSize - grid.y0) / grid.cellSize));
              let hit = false;
              for (let b = j0; b <= j1 && !hit; b++) for (let a = i0; a <= i1; a++) if (g2[b * grid.nx + a]! >= thr) {
                hit = true;
                break;
              }
              if (hit) f[j * mg.nx + i] = 1;
            }
          // one-quad margin
          const d = new Uint8Array(f);
          for (let j = 0; j < mg.ny - 1; j++)
            for (let i = 0; i < mg.nx - 1; i++)
              if (f[j * mg.nx + i]) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
                const jj = j + dj;
                const ii = i + di;
                if (ii >= 0 && jj >= 0 && ii < mg.nx - 1 && jj < mg.ny - 1) d[jj * mg.nx + ii] = 1;
              }
          let c = 0;
          for (let k = 0; k < d.length; k++) c += d[k]!;
          return c;
        };
        const a = flag(t45);
        const b = flag(t55);
        const quads = (mg.nx - 1) * (mg.ny - 1);
        const tris = 2 * quads;
        const extra = (c: number): number => Math.round(c * (2 * cellsPerQuad - 2));
        say(`${id.padEnd(10)}${tier.padEnd(8)}${pad(tris, 11)}${pad(quads, 8)}${pad(a, 9)}${pad(((100 * a) / quads).toFixed(1) + ' %', 11)}${pad(extra(a), 12)}${pad(tris + extra(a), 12)}${pad(b, 11)}${pad(extra(b), 12)}`);
      }
    }
    say('Each flagged quad is replaced by about (spacing / 10 m)^2 cells of 10 m, two triangles each (High and Medium: about 10 triangles per 22 m quad, Low: about 32 per 40 m quad). Crack-free stitching is not counted.');
    say('');
  }, 900000);
});
