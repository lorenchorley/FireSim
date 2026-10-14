/**
 * The terrain mesh that keeps an edge (plan 9d.3.2, tuned in spike S5; pure, no Three.js, no DOM).
 *
 * Render-only on purpose: it sits next to `decimateGrid` conceptually but not in fields.ts, which is bundled in the entry
 * chunk because the Data sets screen imports it (spike S2). Today the 10 m terrain is box-blurred and sampled at 22 to 40 m,
 * which turns a cliff into a ramp. {@link decimateTerrain} gives the same blurred value on gentle ground and the unblurred
 * bilinear sample where the vertex's footprint is steep, so a step stays a step between adjacent vertices. A face under about
 * 60 m still reads as a ramp on a 22 or 40 m mesh: that is a resolution limit, not a fault.
 */
import { sampleBilinear, type GridSpec } from '../core/grid';
import { despikeGrid, hornTan2 } from './cliffSharpen';
import { decimateGrid, type RenderGrid } from './fields';

export interface DecimateTerrainOptions {
  /** Footprint slope (deg) at or below which the blurred value is used, and where the unblurred sample has taken over entirely. */
  loDeg: number;
  hiDeg: number;
  /**
   * Height (m) of a tower or pit that a despike pass removes from the finished mesh (2 m margin); 0 leaves the mesh as it is.
   * The blend samples the unblurred terrain at single vertices, and 13, 12, 20 and 1 vertices at the four bundled sites stand 10 m
   * or more above or below all eight neighbours (up to 44 m; `decimateGrid` leaves none). See {@link MESH_DESPIKE_M} for the tier values.
   */
  despikeM: number;
}

/** Despike height (m) for the finished mesh by picture-quality tier (S5): 18 m at Low removes only the 20 m ones a 40 m mesh can take. */
export const MESH_DESPIKE_M = { high: 10, medium: 10, low: 18 } as const;

/** The margin (m) the mesh despike leaves past the neighbours. */
const MESH_DESPIKE_MARGIN_M = 2;

/**
 * A mesh that keeps the edge: the same value as {@link decimateGrid} on gentle ground, and the unblurred bilinear sample
 * where the vertex's footprint is steep (blend smoothstep(loDeg, hiDeg, the largest 10 m Horn slope inside the footprint),
 * 40 to 55 degrees by default), so a step stays a step. Where the steepest slope in a footprint is at or below `loDeg` the
 * vertex is bit-identical to `decimateGrid`'s, and with `despikeM` at its default of 0 so is the whole mesh of a terrain
 * with nothing steeper. Returns `decimateGrid`'s result untouched when no decimation is needed (a grid within `maxN`).
 *
 * The footprint of a vertex is the block of source cells within half a mesh cell of it. Instead of scanning that block for
 * every vertex, each steep source cell is scattered to the (one to four) vertices whose footprint contains it, which gives
 * exactly the same maxima for a fraction of the reads, and the unblurred sample is taken only at the vertices that need it.
 */
export function decimateTerrain(grid: GridSpec, elevation: Float32Array, maxN: number, opts: Partial<DecimateTerrainOptions> = {}): RenderGrid {
  const base = decimateGrid(grid, elevation, maxN);
  if (base.ratio === 1) return base;
  const loDeg = opts.loDeg ?? 40;
  const hiDeg = opts.hiDeg ?? 55;
  const despikeM = opts.despikeM ?? 0;
  const dst = base.grid;
  const out = base.elevation; // a fresh array that decimateGrid owns no other reference to
  const g2 = hornTan2(grid, elevation);
  const tan2Lo = Math.tan((loDeg * Math.PI) / 180) ** 2;

  // Footprint of each mesh column and row on the source grid, and the inverse: for each source column (row) the range of
  // mesh columns (rows) whose footprint holds it. Both are monotone, so each inverse set is one run.
  const half = dst.cellSize / 2;
  const colLo = new Int32Array(grid.nx).fill(dst.nx);
  const colHi = new Int32Array(grid.nx).fill(-1);
  const rowLo = new Int32Array(grid.ny).fill(dst.ny);
  const rowHi = new Int32Array(grid.ny).fill(-1);
  for (let i = 0; i < dst.nx; i++) {
    const x = dst.x0 + i * dst.cellSize;
    const a0 = Math.max(0, Math.floor((x - half - grid.x0) / grid.cellSize));
    const a1 = Math.min(grid.nx - 1, Math.ceil((x + half - grid.x0) / grid.cellSize));
    for (let a = a0; a <= a1; a++) {
      if (i < colLo[a]!) colLo[a] = i;
      if (i > colHi[a]!) colHi[a] = i;
    }
  }
  for (let j = 0; j < dst.ny; j++) {
    const y = dst.y0 + j * dst.cellSize;
    const b0 = Math.max(0, Math.floor((y - half - grid.y0) / grid.cellSize));
    const b1 = Math.min(grid.ny - 1, Math.ceil((y + half - grid.y0) / grid.cellSize));
    for (let b = b0; b <= b1; b++) {
      if (j < rowLo[b]!) rowLo[b] = j;
      if (j > rowHi[b]!) rowHi[b] = j;
    }
  }

  // Steepest 10 m slope (as tan^2) in every mesh vertex's footprint, from the steep source cells only.
  const m = new Float32Array(dst.nx * dst.ny);
  let any = false;
  for (let b = 0; b < grid.ny; b++) {
    const row = b * grid.nx;
    const j0 = rowLo[b]!;
    const j1 = rowHi[b]!;
    for (let a = 0; a < grid.nx; a++) {
      const v = g2[row + a]!;
      if (!(v > tan2Lo)) continue;
      any = true;
      const i1 = colHi[a]!;
      for (let j = j0; j <= j1; j++) {
        const o = j * dst.nx;
        for (let i = colLo[a]!; i <= i1; i++) if (v > m[o + i]!) m[o + i] = v;
      }
    }
  }

  if (any) {
    for (let j = 0; j < dst.ny; j++) {
      const y = dst.y0 + j * dst.cellSize;
      for (let i = 0; i < dst.nx; i++) {
        const k = j * dst.nx + i;
        const v = m[k]!;
        if (!(v > tan2Lo)) continue;
        const t = Math.min(1, Math.max(0, (Math.atan(Math.sqrt(v)) * 180) / Math.PI - loDeg) / (hiDeg - loDeg));
        const wt = t * t * (3 - 2 * t);
        // fround: the unblurred value is a Float32 sample, as `resample` makes it, so the blend is the one a full resample gives
        out[k] = out[k]! * (1 - wt) + Math.fround(sampleBilinear(grid, elevation, dst.x0 + i * dst.cellSize, y)) * wt;
      }
    }
  }
  if (despikeM > 0) despikeGrid(dst, out, despikeM, MESH_DESPIKE_MARGIN_M);
  return base;
}
