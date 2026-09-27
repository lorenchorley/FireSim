/**
 * Polygon rasterisation for fuel/ (spec §4.2 vegetation, §4.4 fire history, §4.8 brush polygons).
 *
 * A scanline fill with the even-odd rule over all rings of a polygon (so holes and multi-ring parts work), on a regular
 * point lattice: lattice point (i, j) sits at (x0 + i·step, y0 + j·step) in local metres. Edges are bucketed into the
 * rows they cross (O(edges + crossings) per polygon, no per-row pass over all edges), crossings sorted per row, and
 * each inside span [i0, i1] is handed to a callback. Buffers are reused between polygons (no per-row allocation).
 *
 * The crossing rule is half-open in y (an edge crosses row y when min(ya, yb) ≤ y < max(ya, yb)) and every row
 * ordinate is computed the same way (y0 + j·step), so a vertex lying exactly on a row is counted consistently and the
 * crossing count per row is always even for closed rings.
 */
import { LocalProjection } from '../core/geo';
import type { GridSpec } from '../core/grid';

/** A regular point lattice (row-major, j = 0 south). */
export interface Lattice {
  x0: number;
  y0: number;
  step: number;
  nx: number;
  ny: number;
}

/** Local-metre rings of one polygon: each ring is a flat [x0, y0, x1, y1, …] array (closing point optional). */
export type LocalRings = Float64Array[];

/** Lattice of the cell centres of a grid. */
export const cellCentreLattice = (g: GridSpec): Lattice => ({ x0: g.x0, y0: g.y0, step: g.cellSize, nx: g.nx, ny: g.ny });

/** Lattice of an s×s sub-point pattern per cell (offsets ±Δx/3 for s = 3, spec §4.2). Sub-point (I, J) → cell (⌊I/s⌋, ⌊J/s⌋). */
export function subPointLattice(g: GridSpec, s: number): Lattice {
  const step = g.cellSize / s;
  const off = ((s - 1) / 2) * step;
  return { x0: g.x0 - off, y0: g.y0 - off, step, nx: g.nx * s, ny: g.ny * s };
}

/** Project GeoJSON [lon, lat] rings to local metres about `origin`. Rings with fewer than `minPoints` points are dropped. */
export function projectRings(rings: ReadonlyArray<ReadonlyArray<readonly number[]>>, proj: LocalProjection, minPoints = 3): LocalRings {
  const out: LocalRings = [];
  for (const ring of rings) {
    if (!ring || ring.length < minPoints) continue;
    const a = new Float64Array(ring.length * 2);
    for (let p = 0; p < ring.length; p++) {
      const pt = ring[p]!;
      const [x, y] = proj.toLocal({ lon: pt[0]!, lat: pt[1]! });
      a[2 * p] = x;
      a[2 * p + 1] = y;
    }
    out.push(a);
  }
  return out;
}

/** Bounding box of local rings: [xmin, ymin, xmax, ymax] (Infinity/−Infinity when empty). */
export function ringsBounds(rings: LocalRings): [number, number, number, number] {
  let xmin = Infinity;
  let ymin = Infinity;
  let xmax = -Infinity;
  let ymax = -Infinity;
  for (const r of rings) {
    for (let p = 0; p < r.length; p += 2) {
      const x = r[p]!;
      const y = r[p + 1]!;
      if (x < xmin) xmin = x;
      if (x > xmax) xmax = x;
      if (y < ymin) ymin = y;
      if (y > ymax) ymax = y;
    }
  }
  return [xmin, ymin, xmax, ymax];
}

/** Callback for one inside span of lattice row j, columns i0..i1 inclusive. */
export type SpanFn = (j: number, i0: number, i1: number) => void;

/** Reusable scanline rasteriser (one per build; not re-entrant). */
export class ScanlineRasteriser {
  private rowCount = new Int32Array(256);
  private rowStart = new Int32Array(257);
  private xs = new Float64Array(1024);

  /** Fill every lattice point inside the polygon (even-odd over all rings). Returns the number of points filled. */
  rasterise(rings: LocalRings, lat: Lattice, fill: SpanFn): number {
    if (rings.length === 0) return 0;
    const [, ymin, , ymax] = ringsBounds(rings);
    const { x0, y0, step, nx, ny } = lat;
    // Rows whose ordinate lies in [ymin, ymax), clipped to the lattice.
    let jLo = Math.max(0, Math.ceil((ymin - y0) / step) - 1);
    while (jLo < ny && y0 + jLo * step < ymin) jLo++;
    let jHi = Math.min(ny - 1, Math.ceil((ymax - y0) / step));
    while (jHi >= 0 && y0 + jHi * step >= ymax) jHi--;
    if (jHi < jLo) return 0;
    const nRows = jHi - jLo + 1;
    if (this.rowCount.length < nRows) {
      this.rowCount = new Int32Array(nRows * 2);
      this.rowStart = new Int32Array(nRows * 2 + 1);
    }
    const cnt = this.rowCount;
    cnt.fill(0, 0, nRows);

    // Pass 1: count crossings per row. Pass 2: store them. The edge → row range is computed identically twice.
    let total = 0;
    for (let pass = 0; pass < 2; pass++) {
      if (pass === 1) {
        const st = this.rowStart;
        st[0] = 0;
        for (let r = 0; r < nRows; r++) st[r + 1] = st[r]! + cnt[r]!;
        total = st[nRows]!;
        if (this.xs.length < total) this.xs = new Float64Array(Math.max(total, this.xs.length * 2));
        cnt.fill(0, 0, nRows);
      }
      for (const ring of rings) {
        const np = ring.length >> 1;
        if (np < 2) continue;
        // Include the closing edge only when the ring is not explicitly closed.
        const closed = ring[0] === ring[2 * np - 2] && ring[1] === ring[2 * np - 1];
        const nEdges = closed ? np - 1 : np;
        for (let e = 0; e < nEdges; e++) {
          const a = 2 * e;
          const b = e + 1 < np ? a + 2 : 0;
          const xa = ring[a]!;
          const ya = ring[a + 1]!;
          const xb = ring[b]!;
          const yb = ring[b + 1]!;
          if (ya === yb) continue;
          const lo = ya < yb ? ya : yb;
          const hi = ya < yb ? yb : ya;
          // Rows with lo ≤ y < hi.
          let r0 = Math.ceil((lo - y0) / step) - 1;
          while (y0 + r0 * step < lo) r0++;
          let r1 = Math.ceil((hi - y0) / step);
          while (y0 + r1 * step >= hi) r1--;
          if (r0 < jLo) r0 = jLo;
          if (r1 > jHi) r1 = jHi;
          if (r1 < r0) continue;
          const slope = (xb - xa) / (yb - ya);
          for (let j = r0; j <= r1; j++) {
            const r = j - jLo;
            if (pass === 0) cnt[r]!++;
            else {
              const y = y0 + j * step;
              this.xs[this.rowStart[r]! + cnt[r]!] = xa + (y - ya) * slope;
              cnt[r]!++;
            }
          }
        }
      }
    }
    if (total === 0) return 0;

    let filled = 0;
    const xs = this.xs;
    for (let r = 0; r < nRows; r++) {
      const s = this.rowStart[r]!;
      const n = cnt[r]!;
      if (n < 2) continue;
      // Insertion sort (rows usually hold a handful of crossings); fall back to a typed sort for long rows.
      if (n <= 32) {
        for (let a = s + 1; a < s + n; a++) {
          const v = xs[a]!;
          let b = a - 1;
          while (b >= s && xs[b]! > v) {
            xs[b + 1] = xs[b]!;
            b--;
          }
          xs[b + 1] = v;
        }
      } else xs.subarray(s, s + n).sort();
      const j = jLo + r;
      for (let q = s; q + 1 < s + n; q += 2) {
        let i0 = Math.ceil((xs[q]! - x0) / step);
        let i1 = Math.ceil((xs[q + 1]! - x0) / step) - 1;
        // Exact half-open test on the computed ordinates: x_i ∈ [xa, xb).
        while (i0 > 0 && x0 + (i0 - 1) * step >= xs[q]!) i0--;
        while (x0 + i0 * step < xs[q]!) i0++;
        while (i1 >= i0 && x0 + i1 * step >= xs[q + 1]!) i1--;
        if (i0 < 0) i0 = 0;
        if (i1 > nx - 1) i1 = nx - 1;
        if (i1 < i0) continue;
        fill(j, i0, i1);
        filled += i1 - i0 + 1;
      }
    }
    return filled;
  }
}

/** Even-odd point-in-polygon over flat local rings (for single points; bulk work uses ScanlineRasteriser). */
export function pointInRings(x: number, y: number, rings: LocalRings): boolean {
  let inside = false;
  for (const ring of rings) {
    const np = ring.length >> 1;
    for (let e = 0, f = np - 1; e < np; f = e++) {
      const xa = ring[2 * e]!;
      const ya = ring[2 * e + 1]!;
      const xb = ring[2 * f]!;
      const yb = ring[2 * f + 1]!;
      if (ya > y !== yb > y && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inside = !inside;
    }
  }
  return inside;
}
