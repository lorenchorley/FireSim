/**
 * Rasters derived from the context layers, for the 'homeDensity' and 'roadAccess' heat maps (fields.ts calls this).
 * Values are per fire-grid cell (row-major, j = 0 south), like every other field.
 *
 *   homeDensity  homes per hectare: address points within a disc of radius R = max(150 m, ¾ of a cell) of the cell
 *                centre, divided by the disc area (π R² / 10 000). Counting is exact (a bucket grid of R-sized tiles
 *                means each cell only looks at the addresses near it).
 *   roadAccess   distance in metres from the cell centre to the nearest road, track, path or RFS fire trail: the lines
 *                are rasterised onto the grid with the exact distance in the cells they touch (and their neighbours),
 *                then a two-pass 3-4 chamfer distance transform spreads it (error a few percent, exact along lines).
 *                Bridges and paths count as roads. With no lines at all every cell is {@link CONTEXT_NO_DATA}.
 *
 * Results are cached by (context, grid) object identity, so the heat map can be rebuilt on every snapshot for free.
 */
import type { GridSpec } from '../core/grid';
import type { ContextLayers } from '../core/places';

export type ContextFieldKind = 'homeDensity' | 'roadAccess';

/** Same sentinel as legends.NO_DATA (Math.fround(-1e30)): "no value here". */
export const CONTEXT_NO_DATA = Math.fround(-1e30);

/** Radius (m) of the disc over which homes are counted for a fire grid of this cell size. */
export const homeDensityRadius = (cellSize: number): number => Math.max(150, 0.75 * cellSize);

const cache = new WeakMap<ContextLayers, WeakMap<GridSpec, Partial<Record<ContextFieldKind, Float32Array>>>>();

/**
 * 'homeDensity': homes per hectare around each cell; 'roadAccess': distance (m) from the cell centre to the nearest road,
 * track or fire trail. Cached by (context, grid) identity: treat the returned array as read-only.
 */
export function contextFieldValues(kind: ContextFieldKind, context: ContextLayers, grid: GridSpec): Float32Array {
  let byGrid = cache.get(context);
  if (!byGrid) cache.set(context, (byGrid = new WeakMap()));
  let byKind = byGrid.get(grid);
  if (!byKind) byGrid.set(grid, (byKind = {}));
  let v = byKind[kind];
  if (!v) byKind[kind] = v = kind === 'homeDensity' ? homeDensity(context.homes, grid) : roadAccess(context, grid);
  return v;
}

/** Homes per hectare within {@link homeDensityRadius} of each cell centre. */
export function homeDensity(homes: Float32Array, grid: GridSpec): Float32Array {
  const { nx, ny, cellSize: h, x0, y0 } = grid;
  const out = new Float32Array(nx * ny);
  const n = homes.length >> 1;
  if (n === 0) return out;
  const R = homeDensityRadius(h);
  const R2 = R * R;
  const perHa = 10000 / (Math.PI * R2);
  // Bucket the addresses in tiles of side R over the grid's extent (addresses outside it can still be within R of an
  // edge cell, so the tile grid extends R beyond).
  const bx0 = x0 - R;
  const by0 = y0 - R;
  const bnx = Math.max(1, Math.ceil((nx * h + 2 * R) / R) + 1);
  const bny = Math.max(1, Math.ceil((ny * h + 2 * R) / R) + 1);
  const start = new Int32Array(bnx * bny + 1);
  const tile = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const tx = Math.floor((homes[2 * i]! - bx0) / R);
    const ty = Math.floor((homes[2 * i + 1]! - by0) / R);
    if (tx < 0 || ty < 0 || tx >= bnx || ty >= bny) continue;
    const t = ty * bnx + tx;
    tile[i] = t;
    start[t + 1]!++;
  }
  for (let t = 0; t < bnx * bny; t++) start[t + 1] = start[t + 1]! + start[t]!;
  const fill = start.slice(0, bnx * bny);
  const order = new Int32Array(start[bnx * bny]!);
  for (let i = 0; i < n; i++) {
    const t = tile[i]!;
    if (t >= 0) order[fill[t]!++] = i;
  }
  for (let j = 0; j < ny; j++) {
    const cy = y0 + j * h;
    const ty = Math.floor((cy - by0) / R);
    for (let i = 0; i < nx; i++) {
      const cx = x0 + i * h;
      const tx = Math.floor((cx - bx0) / R);
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = ty + dy;
        if (yy < 0 || yy >= bny) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = tx + dx;
          if (xx < 0 || xx >= bnx) continue;
          const t = yy * bnx + xx;
          for (let q = start[t]!; q < start[t + 1]!; q++) {
            const a = order[q]!;
            const ex = homes[2 * a]! - cx;
            const ey = homes[2 * a + 1]! - cy;
            if (ex * ex + ey * ey <= R2) count++;
          }
        }
      }
      out[j * nx + i] = count * perHa;
    }
  }
  return out;
}

/** Distance (m) to the nearest road / track / fire trail. */
export function roadAccess(context: Pick<ContextLayers, 'roads' | 'fireTrails'>, grid: GridSpec): Float32Array {
  const lines: Float32Array[] = [];
  for (const r of context.roads) lines.push(r.xy);
  for (const t of context.fireTrails) lines.push(t.xy);
  return distanceToLines(lines, grid);
}

/**
 * Distance from each cell centre to the nearest polyline. Seeds the cells within one cell of each line with the exact
 * point-to-segment distance, then runs a two-pass 3-4 chamfer transform (weights 1 and √2 scaled: 3/3 and 4/3 cells).
 */
export function distanceToLines(lines: readonly Float32Array[], grid: GridSpec): Float32Array {
  const { nx, ny, cellSize: h, x0, y0 } = grid;
  const INF = 1e30;
  const d = new Float32Array(nx * ny).fill(INF);
  let any = false;
  const seed = (i: number, j: number, ax: number, ay: number, vx: number, vy: number, inv: number): void => {
    if (i < 0 || j < 0 || i >= nx || j >= ny) return;
    const px = x0 + i * h - ax;
    const py = y0 + j * h - ay;
    const t = inv > 0 ? Math.max(0, Math.min(1, (px * vx + py * vy) * inv)) : 0;
    const ex = px - vx * t;
    const ey = py - vy * t;
    const dist = Math.hypot(ex, ey);
    const k = j * nx + i;
    if (dist < d[k]!) d[k] = dist;
  };
  for (const xy of lines) {
    const n = xy.length >> 1;
    if (n === 0) continue;
    any = true;
    if (n === 1) {
      const i = Math.round((xy[0]! - x0) / h);
      const j = Math.round((xy[1]! - y0) / h);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) seed(i + di, j + dj, xy[0]!, xy[1]!, 0, 0, 0);
      continue;
    }
    for (let s = 0; s + 1 < n; s++) {
      const ax = xy[2 * s]!;
      const ay = xy[2 * s + 1]!;
      const bx = xy[2 * s + 2]!;
      const by = xy[2 * s + 3]!;
      const vx = bx - ax;
      const vy = by - ay;
      const l2 = vx * vx + vy * vy;
      const inv = l2 > 0 ? 1 / l2 : 0;
      const len = Math.sqrt(l2);
      // Walk the segment in half-cell steps; seed the 3 × 3 cells around each sample.
      const steps = Math.max(1, Math.ceil(len / (h * 0.5)));
      let lastI = NaN;
      let lastJ = NaN;
      for (let q = 0; q <= steps; q++) {
        const t = q / steps;
        const i = Math.round((ax + vx * t - x0) / h);
        const j = Math.round((ay + vy * t - y0) / h);
        if (i === lastI && j === lastJ) continue;
        lastI = i;
        lastJ = j;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) seed(i + di, j + dj, ax, ay, vx, vy, inv);
      }
    }
  }
  if (!any) return new Float32Array(nx * ny).fill(CONTEXT_NO_DATA);
  // Chamfer 3-4: orthogonal step = h, diagonal = h·4/3.
  const a = h;
  const b = (h * 4) / 3;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      let v = d[k]!;
      if (i > 0) v = Math.min(v, d[k - 1]! + a);
      if (j > 0) {
        v = Math.min(v, d[k - nx]! + a);
        if (i > 0) v = Math.min(v, d[k - nx - 1]! + b);
        if (i < nx - 1) v = Math.min(v, d[k - nx + 1]! + b);
      }
      d[k] = v;
    }
  }
  for (let j = ny - 1; j >= 0; j--) {
    for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i;
      let v = d[k]!;
      if (i < nx - 1) v = Math.min(v, d[k + 1]! + a);
      if (j < ny - 1) {
        v = Math.min(v, d[k + nx]! + a);
        if (i < nx - 1) v = Math.min(v, d[k + nx + 1]! + b);
        if (i > 0) v = Math.min(v, d[k + nx - 1]! + b);
      }
      d[k] = v;
    }
  }
  return d;
}
