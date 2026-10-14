/**
 * Test helpers for the cliff drawing modules (cliffSharpen, terrainMesh, rockMask): synthetic terrains, the measures the plan
 * states its numbers in (steep mesh edges, towers and pits, drainage overlap) and the four bundled sites. Tests only.
 */
import { makeGridSpec, resample, type GridSpec } from '../../core/grid';
import { loadCanopy } from '../../data/canopy';
import { loadDemoDem } from '../../data/demoRasters';
import { d8Receivers, flowAccumulation, priorityFloodFill } from '../../fire/terrainFeatures';
import { despikeGrid, hornTan2 } from '../cliffSharpen';
import { decimateGrid, type RenderGrid } from '../fields';
import type { DecimateTerrainOptions } from '../terrainMesh';

export const ORIGIN = { lat: -33.7, lon: 150.3 };

/**
 * The plan's first version of the mesh that keeps an edge, as the spike wrote it: the whole-grid Horn pass, a scan of every
 * vertex's footprint, and a full unblurred resample. The shipped `decimateTerrain` gives exactly its result (a test holds it to
 * that) with fewer reads; this one stays as the reference and as the "before" of the timings.
 */
export function decimateTerrainScan(grid: GridSpec, elevation: Float32Array, maxN: number, opts: Partial<DecimateTerrainOptions> = {}): RenderGrid {
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
      let mx = 0;
      for (let b = j0; b <= j1; b++) {
        const row = b * grid.nx;
        for (let a = i0; a <= i1; a++) {
          const v = g2[row + a]!;
          if (v > mx) mx = v;
        }
      }
      if (mx <= tan2Lo) continue;
      const t = Math.min(1, Math.max(0, (Math.atan(Math.sqrt(mx)) * 180) / Math.PI - loDeg) / (hiDeg - loDeg));
      const wt = t * t * (3 - 2 * t);
      const k = j * dst.nx + i;
      out[k] = base.elevation[k]! * (1 - wt) + raw[k]! * wt;
    }
  }
  if ((opts.despikeM ?? 0) > 0) despikeGrid(dst, out, opts.despikeM!, 2);
  return { grid: dst, elevation: out, ratio: base.ratio };
}

/** The four bundled sites the plan's table is about. */
export const CLIFF_SITES = ['katoomba', 'kanangra', 'grose', 'tomah'] as const;
export type CliffSite = (typeof CLIFF_SITES)[number];

/** A plain grid at the origin, `cellSize` metres, cells (0, 0) at local (0, 0). */
export const flatGrid = (nx: number, ny: number, cellSize = 10): GridSpec => ({ nx, ny, cellSize, x0: 0, y0: 0, origin: { ...ORIGIN } });

/** A terrain whose height depends on the cell indices, as a Float32Array in the grid's order (j = 0 south). */
export function terrainOf(g: GridSpec, f: (i: number, j: number) => number): Float32Array {
  const z = new Float32Array(g.nx * g.ny);
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) z[j * g.nx + i] = f(i, j);
  return z;
}

/** Cells that stand `m` metres or more above all eight neighbours (towers) or below all of them (pits). */
export function countSpikes(grid: GridSpec, z: ArrayLike<number>, m: number): { towers: number; pits: number } {
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

/** Slope (deg) of every mesh edge along both axes, the steepness the triangles have. */
export function edgeSlopes(g: GridSpec, z: ArrayLike<number>): Float32Array {
  const out = new Float32Array((g.nx - 1) * g.ny + g.nx * (g.ny - 1));
  let o = 0;
  for (let j = 0; j < g.ny; j++)
    for (let i = 0; i < g.nx; i++) {
      const k = j * g.nx + i;
      if (i < g.nx - 1) out[o++] = (Math.atan(Math.abs(z[k + 1]! - z[k]!) / g.cellSize) * 180) / Math.PI;
      if (j < g.ny - 1) out[o++] = (Math.atan(Math.abs(z[k + g.nx]! - z[k]!) / g.cellSize) * 180) / Math.PI;
    }
  return out;
}

/** Share (percent) of the values above `thr`. */
export function sharePercent(s: ArrayLike<number>, thr: number): number {
  let c = 0;
  for (let k = 0; k < s.length; k++) if (s[k]! > thr) c++;
  return (100 * c) / s.length;
}

export function maxOf(s: ArrayLike<number>): number {
  let m = -Infinity;
  for (let k = 0; k < s.length; k++) if (s[k]! > m) m = s[k]!;
  return m;
}

/** Cells that drain at least `minAreaM2` (default 5 ha) on the depression-filled surface. */
export function drainageMask(g: GridSpec, z: Float32Array, minAreaM2 = 50000): Uint8Array {
  const { acc } = flowAccumulation(g, d8Receivers(g, priorityFloodFill(g, z)));
  const m = new Uint8Array(z.length);
  for (let k = 0; k < m.length; k++) m[k] = acc[k]! >= minAreaM2 ? 1 : 0;
  return m;
}

/** Intersection over union of two masks (1 when both are empty). */
export function iou(a: Uint8Array, b: Uint8Array): number {
  let both = 0;
  let uni = 0;
  for (let k = 0; k < a.length; k++) {
    if (a[k] && b[k]) both++;
    if (a[k] || b[k]) uni++;
  }
  return uni ? both / uni : 1;
}

/** A bundled site's 10 m terrain (900 x 900 cells, j = 0 south) and its canopy cover on a 30 m grid (the fire grid's cell). */
export async function loadSite(id: CliffSite): Promise<{ grid: GridSpec; elevation: Float32Array; cover: { grid: GridSpec; values: Float32Array } }> {
  const dem = await loadDemoDem(id);
  if (!dem) throw new Error(`no bundled terrain for ${id}`);
  const grid30 = makeGridSpec(dem.grid.origin, dem.meta.extent, 30);
  const canopy = await loadCanopy(grid30, { demoSiteId: id, allowRemote: false });
  if (!canopy) throw new Error(`no bundled canopy for ${id}`);
  return { grid: dem.grid, elevation: dem.elevation, cover: { grid: grid30, values: canopy.cover } };
}
