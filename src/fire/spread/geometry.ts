/**
 * Geometry helpers of the spread module (spec docs/research/00-synthesis.md §7.2 ignition rasterisation, §7.9 VLS
 * zone labelling, §7.13 frontDist): signed distances to ignition geometries, an exact Euclidean distance transform
 * (Felzenszwalb & Huttenlocher 2012, O(N), preallocated buffers) and 4-connected component labelling.
 */

/** Distance (m) from (x, y) to the segment (ax, ay)–(bx, by). */
export function distToSegment(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = ax + t * dx - x;
  const py = ay + t * dy - y;
  return Math.sqrt(px * px + py * py);
}

/** Distance (m) from (x, y) to an open polyline (a single vertex = a point). */
export function distToPolyline(x: number, y: number, pts: readonly (readonly [number, number])[]): number {
  if (pts.length === 1) return Math.hypot(x - pts[0]![0], y - pts[0]![1]);
  let d = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const s = distToSegment(x, y, a[0], a[1], b[0], b[1]);
    if (s < d) d = s;
  }
  return d;
}

/** Even–odd point-in-polygon test (ring closed implicitly). */
export function pointInPolygon(x: number, y: number, pts: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i]![0];
    const yi = pts[i]![1];
    const xj = pts[j]![0];
    const yj = pts[j]![1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Signed distance (m) to a closed polygon: negative inside. */
export function signedDistToPolygon(x: number, y: number, pts: readonly (readonly [number, number])[]): number {
  if (pts.length < 3) return distToPolyline(x, y, pts);
  let d = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const s = distToSegment(x, y, pts[j]![0], pts[j]![1], pts[i]![0], pts[i]![1]);
    if (s < d) d = s;
  }
  return pointInPolygon(x, y, pts) ? -d : d;
}

/** Length (m) of a polyline; `closed` adds the closing edge (polygon perimeter). */
export function polylineLength(pts: readonly (readonly [number, number])[], closed = false): number {
  let L = 0;
  for (let i = 0; i + 1 < pts.length; i++) L += Math.hypot(pts[i + 1]![0] - pts[i]![0], pts[i + 1]![1] - pts[i]![1]);
  if (closed && pts.length > 2) L += Math.hypot(pts[0]![0] - pts[pts.length - 1]![0], pts[0]![1] - pts[pts.length - 1]![1]);
  return L;
}

const BIG = 1e20;

/**
 * Exact Euclidean distance transform on a regular grid (squared-distance lower envelope of parabolas, separable).
 * All buffers are allocated once; {@link compute} is O(nx·ny).
 */
export class DistanceTransform {
  private readonly f: Float64Array;
  private readonly d: Float64Array;
  private readonly v: Int32Array;
  private readonly z: Float64Array;
  private readonly tmp: Float64Array;

  constructor(private readonly nx: number, private readonly ny: number) {
    const m = Math.max(nx, ny);
    this.f = new Float64Array(m);
    this.d = new Float64Array(m);
    this.v = new Int32Array(m);
    this.z = new Float64Array(m + 1);
    this.tmp = new Float64Array(nx * ny);
  }

  /**
   * Distance (m) from every cell to the nearest source cell (`isSource(k)` true); Infinity everywhere when there is
   * no source. `out` has length nx·ny.
   */
  compute(isSource: (k: number) => boolean, cellSize: number, out: Float32Array): void {
    const { nx, ny, tmp, f, d } = this;
    let any = false;
    // Columns (along j).
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        const s = isSource(j * nx + i);
        if (s) any = true;
        f[j] = s ? 0 : BIG;
      }
      this.dt1(ny);
      for (let j = 0; j < ny; j++) tmp[j * nx + i] = d[j]!;
    }
    if (!any) {
      out.fill(Infinity);
      return;
    }
    // Rows (along i).
    for (let j = 0; j < ny; j++) {
      const row = j * nx;
      for (let i = 0; i < nx; i++) f[i] = tmp[row + i]!;
      this.dt1(nx);
      for (let i = 0; i < nx; i++) {
        const q = d[i]!;
        out[row + i] = q >= BIG * 0.5 ? Infinity : Math.sqrt(q) * cellSize;
      }
    }
  }

  /** 1-D squared distance transform of f[0..n) into d[0..n) (Felzenszwalb & Huttenlocher). */
  private dt1(n: number): void {
    const { f, d, v, z } = this;
    let k = 0;
    // Find the first finite sample; with none, the result is all BIG.
    let q0 = 0;
    while (q0 < n && f[q0]! >= BIG) q0++;
    if (q0 === n) {
      for (let q = 0; q < n; q++) d[q] = BIG;
      return;
    }
    v[0] = q0;
    z[0] = -Infinity;
    z[1] = Infinity;
    for (let q = q0 + 1; q < n; q++) {
      const fq = f[q]!;
      if (fq >= BIG) continue;
      let s: number;
      for (;;) {
        const vk = v[k]!;
        s = (fq + q * q - (f[vk]! + vk * vk)) / (2 * q - 2 * vk);
        if (s <= z[k]! && k > 0) k--;
        else break;
      }
      if (s <= z[k]!) {
        // k === 0 and the new parabola dominates everywhere.
        v[0] = q;
        z[0] = -Infinity;
        z[1] = Infinity;
        continue;
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1]! < q) k++;
      const vk = v[k]!;
      d[q] = (q - vk) * (q - vk) + f[vk]!;
    }
  }
}

/**
 * 4-connected components of the cells where `mask(k)` is true, among the candidate cells `cells[0..n)` (any order).
 * Writes labels 1..count into `labels` (0 elsewhere; `labels` must be zero for non-candidates on entry — the caller
 * clears the previous labels) and returns count. Labels are assigned in increasing order of the smallest candidate
 * index reached first, so the result is deterministic. `stack` needs capacity ≥ n.
 */
export function labelComponents4(
  nx: number, ny: number, cells: Int32Array, n: number, mask: (k: number) => boolean, labels: Int32Array, stack: Int32Array,
): number {
  let count = 0;
  for (let a = 0; a < n; a++) {
    const seed = cells[a]!;
    if (labels[seed] !== 0 || !mask(seed)) continue;
    count++;
    let sp = 0;
    stack[sp++] = seed;
    labels[seed] = count;
    while (sp > 0) {
      const k = stack[--sp]!;
      const i = k % nx;
      const j = (k - i) / nx;
      if (i > 0 && labels[k - 1] === 0 && mask(k - 1)) {
        labels[k - 1] = count;
        stack[sp++] = k - 1;
      }
      if (i < nx - 1 && labels[k + 1] === 0 && mask(k + 1)) {
        labels[k + 1] = count;
        stack[sp++] = k + 1;
      }
      if (j > 0 && labels[k - nx] === 0 && mask(k - nx)) {
        labels[k - nx] = count;
        stack[sp++] = k - nx;
      }
      if (j < ny - 1 && labels[k + nx] === 0 && mask(k + nx)) {
        labels[k + nx] = count;
        stack[sp++] = k + nx;
      }
    }
  }
  return count;
}
