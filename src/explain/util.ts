/**
 * Small numeric helpers for the detectors (spec §10.1): angle arithmetic, soft-AND ratio scores, per-tile top-k
 * accumulators and a counting-sort spatial hash of cells. All allocation happens at construction; the per-cell
 * methods are allocation-free.
 */
import type { GridSpec } from '../core/grid';
import { DEG, RAD, wrapDeg } from '../core/units';
import { EXPLAIN_PARAMS } from './params';

const CAP: number = EXPLAIN_PARAMS.engine.ratioCap;

/** Smallest angle between two azimuths (deg, 0–180); NaN if either is NaN. */
export function angDist(a: number, b: number): number {
  const d = wrapDeg(a - b);
  return d > 180 ? 360 - d : d;
}

/** Soft "x ≥ T" ratio (T > 0), capped to [0, CAP]. NaN → 0. */
export function ge(x: number, t: number): number {
  const r = x / t;
  return r > 0 ? (r < CAP ? r : CAP) : 0;
}

/** Soft "x ≤ T" ratio for T > 0: T/x (x ≤ 0 → CAP). NaN → 0. */
export function le(x: number, t: number): number {
  if (!(x === x)) return 0;
  if (x <= t / CAP) return CAP;
  return t / x;
}

/** Soft "angle ≤ A" ratio. NaN → 0. */
export function angLe(angle: number, maxAngle: number): number {
  if (!(angle === angle)) return 0;
  return angle <= maxAngle / CAP ? CAP : maxAngle / angle;
}

/** Soft "angle ≥ A" ratio (A > 0). */
export const angGe = (angle: number, minAngle: number): number => ge(angle, minAngle);

/** Minimum of up to five ratios (the soft AND). */
export function softAnd(a: number, b = CAP, c = CAP, d = CAP, e = CAP): number {
  let m = a < b ? a : b;
  if (c < m) m = c;
  if (d < m) m = d;
  if (e < m) m = e;
  return m;
}

/** Component of (u, v) along azimuth az (deg, towards). */
export function along(u: number, v: number, azDeg: number): number {
  const r = azDeg * DEG;
  return u * Math.sin(r) + v * Math.cos(r);
}

/** Azimuth (towards) of a vector, or NaN for a (near) zero vector. */
export function azimuthOf(u: number, v: number): number {
  if (u * u + v * v < 1e-12) return NaN;
  return wrapDeg(Math.atan2(u, v) * RAD);
}

/** Circular mean of azimuths accumulated as unit-vector sums; NaN when the resultant is negligible. */
export class CircularMean {
  sx = 0;
  sy = 0;
  n = 0;
  reset(): void {
    this.sx = 0;
    this.sy = 0;
    this.n = 0;
  }
  add(azDeg: number, w = 1): void {
    if (!(azDeg === azDeg)) return;
    const r = azDeg * DEG;
    this.sx += w * Math.sin(r);
    this.sy += w * Math.cos(r);
    this.n += w;
  }
  mean(): number {
    if (this.n <= 0) return NaN;
    const R = Math.hypot(this.sx, this.sy) / this.n;
    if (R < 1e-3) return NaN;
    return wrapDeg(Math.atan2(this.sx, this.sy) * RAD);
  }
}

/** Tile geometry for 500 m spatial keys (spec §10.1), anchored at the grid's south-west corner. */
export class Tiles {
  readonly tnx: number;
  readonly tny: number;
  readonly count: number;
  readonly cellsPerTile: number;
  constructor(
    readonly grid: GridSpec,
    readonly tileM: number,
  ) {
    this.cellsPerTile = tileM / grid.cellSize;
    this.tnx = Math.max(1, Math.ceil(grid.nx / this.cellsPerTile));
    this.tny = Math.max(1, Math.ceil(grid.ny / this.cellsPerTile));
    this.count = this.tnx * this.tny;
  }
  /** Tile index of cell k. */
  ofCell(k: number): number {
    const nx = this.grid.nx;
    const j = (k / nx) | 0;
    const i = k - j * nx;
    return ((j / this.cellsPerTile) | 0) * this.tnx + ((i / this.cellsPerTile) | 0);
  }
  /** Tile index of a local point (clamped into the grid). */
  ofPoint(x: number, y: number): number {
    const g = this.grid;
    let i = Math.round((x - g.x0) / g.cellSize);
    let j = Math.round((y - g.y0) / g.cellSize);
    i = i < 0 ? 0 : i >= g.nx ? g.nx - 1 : i;
    j = j < 0 ? 0 : j >= g.ny ? g.ny - 1 : j;
    return this.ofCell(j * g.nx + i);
  }
  tx(t: number): number {
    return t % this.tnx;
  }
  ty(t: number): number {
    return (t / this.tnx) | 0;
  }
  /** Spatial key `kind:tileX:tileY` (spec §10.1). */
  key(kind: string, t: number): string {
    return `${kind}:${this.tx(t)}:${this.ty(t)}`;
  }
}

/**
 * Per-tile top-K accumulator: `add(cell, score)` keeps the K highest per-cell scores of each tile; the tile's score
 * is then its K-th largest value (so "≥ 5 cells satisfy" ⇔ 5th largest soft-AND score ≥ 1, and the 0.8 hysteresis
 * applies to the same statistic).
 */
export class TileTopK {
  readonly maxK: number;
  private readonly vals: Float32Array;
  private readonly cells: Int32Array;
  private readonly n: Uint8Array;
  private readonly touched: Int32Array;
  private readonly mark: Uint8Array;
  private nTouched = 0;
  private k = 1;
  constructor(
    readonly tiles: Tiles,
    maxK = 16,
  ) {
    this.maxK = maxK;
    this.vals = new Float32Array(tiles.count * maxK);
    this.cells = new Int32Array(tiles.count * maxK);
    this.n = new Uint8Array(tiles.count);
    this.touched = new Int32Array(tiles.count);
    this.mark = new Uint8Array(tiles.count);
  }
  /** Clear (only the tiles touched since the last reset) and set K for the next rule. */
  reset(k: number): void {
    for (let a = 0; a < this.nTouched; a++) {
      const t = this.touched[a]!;
      this.n[t] = 0;
      this.mark[t] = 0;
    }
    this.nTouched = 0;
    this.k = Math.max(1, Math.min(this.maxK, Math.round(k)));
  }
  add(cell: number, score: number, tile = this.tiles.ofCell(cell)): void {
    if (!(score > 0)) return;
    if (!this.mark[tile]) {
      this.mark[tile] = 1;
      this.touched[this.nTouched++] = tile;
    }
    const base = tile * this.maxK;
    let m = this.n[tile]!;
    const K = this.k;
    if (m === K && score <= this.vals[base + K - 1]!) return;
    // Insertion into the descending list.
    let p = m < K ? m : K - 1;
    while (p > 0 && this.vals[base + p - 1]! < score) {
      this.vals[base + p] = this.vals[base + p - 1]!;
      this.cells[base + p] = this.cells[base + p - 1]!;
      p--;
    }
    this.vals[base + p] = score;
    this.cells[base + p] = cell;
    if (m < K) this.n[tile] = ++m;
  }
  get touchedCount(): number {
    return this.nTouched;
  }
  /** i-th touched tile (in first-touch order; callers sort candidates deterministically by key). */
  touchedTile(i: number): number {
    return this.touched[i]!;
  }
  /** Number of cells stored for tile t (≤ K). */
  size(t: number): number {
    return this.n[t]!;
  }
  /** The tile's score: the K-th largest value (0 when fewer than K cells). */
  score(t: number): number {
    return this.n[t]! < this.k ? 0 : this.vals[t * this.maxK + this.k - 1]!;
  }
  /** r-th best cell / value of tile t (r < size(t)). */
  cell(t: number, r: number): number {
    return this.cells[t * this.maxK + r]!;
  }
  value(t: number, r: number): number {
    return this.vals[t * this.maxK + r]!;
  }
}

/** Counting-sort spatial hash of a set of cells for radius queries. */
export class CellHash {
  readonly bnx: number;
  readonly bny: number;
  private readonly start: Int32Array;
  private items: Int32Array;
  private readonly cellBucket: number;
  count = 0;
  /** Distance (m) of the last `nearest` hit. */
  lastDist = Infinity;
  constructor(
    readonly grid: GridSpec,
    readonly bucketM: number,
  ) {
    this.cellBucket = Math.max(1, Math.round(bucketM / grid.cellSize));
    this.bnx = Math.max(1, Math.ceil(grid.nx / this.cellBucket));
    this.bny = Math.max(1, Math.ceil(grid.ny / this.cellBucket));
    this.start = new Int32Array(this.bnx * this.bny + 1);
    this.items = new Int32Array(64);
  }
  private bucketOf(k: number): number {
    const nx = this.grid.nx;
    const j = (k / nx) | 0;
    const i = k - j * nx;
    return ((j / this.cellBucket) | 0) * this.bnx + ((i / this.cellBucket) | 0);
  }
  /** Rebuild from `cells[0..n)`. */
  build(cells: Int32Array, n: number): void {
    const start = this.start;
    start.fill(0);
    if (this.items.length < n) this.items = new Int32Array(Math.max(n, this.items.length * 2));
    for (let a = 0; a < n; a++) start[this.bucketOf(cells[a]!) + 1]!++;
    for (let b = 1; b < start.length; b++) start[b]! += start[b - 1]!;
    // Fill using a running cursor stored temporarily in start (shifted back afterwards).
    for (let a = 0; a < n; a++) {
      const b = this.bucketOf(cells[a]!);
      this.items[start[b]!++] = cells[a]!;
    }
    for (let b = start.length - 1; b > 0; b--) start[b] = start[b - 1]!;
    start[0] = 0;
    this.count = n;
  }
  /** Nearest hashed cell to (x, y) within rMax (m), or −1. Sets `lastDist`. */
  nearest(x: number, y: number, rMax: number): number {
    const g = this.grid;
    const cs = g.cellSize;
    const fi = (x - g.x0) / cs;
    const fj = (y - g.y0) / cs;
    const rc = rMax / cs;
    const b0 = Math.max(0, Math.floor((fi - rc) / this.cellBucket));
    const b1 = Math.min(this.bnx - 1, Math.floor((fi + rc) / this.cellBucket));
    const c0 = Math.max(0, Math.floor((fj - rc) / this.cellBucket));
    const c1 = Math.min(this.bny - 1, Math.floor((fj + rc) / this.cellBucket));
    let best = -1;
    let bd2 = rc * rc;
    const nx = g.nx;
    for (let bj = c0; bj <= c1; bj++) {
      for (let bi = b0; bi <= b1; bi++) {
        const b = bj * this.bnx + bi;
        for (let a = this.start[b]!, e = this.start[b + 1]!; a < e; a++) {
          const k = this.items[a]!;
          const j = (k / nx) | 0;
          const di = k - j * nx - fi;
          const dj = j - fj;
          const d2 = di * di + dj * dj;
          if (d2 <= bd2) {
            bd2 = d2;
            best = k;
          }
        }
      }
    }
    this.lastDist = best >= 0 ? Math.sqrt(bd2) * cs : Infinity;
    return best;
  }
  /** Bucket range covering a disc: fills `out` = [b0, b1, c0, c1]. */
  bucketRange(x: number, y: number, r: number, out: Int32Array): void {
    const g = this.grid;
    const cs = g.cellSize;
    const fi = (x - g.x0) / cs;
    const fj = (y - g.y0) / cs;
    const rc = r / cs;
    out[0] = Math.max(0, Math.floor((fi - rc) / this.cellBucket));
    out[1] = Math.min(this.bnx - 1, Math.floor((fi + rc) / this.cellBucket));
    out[2] = Math.max(0, Math.floor((fj - rc) / this.cellBucket));
    out[3] = Math.min(this.bny - 1, Math.floor((fj + rc) / this.cellBucket));
  }
  bucketStart(b: number): number {
    return this.start[b]!;
  }
  bucketEnd(b: number): number {
    return this.start[b + 1]!;
  }
  item(a: number): number {
    return this.items[a]!;
  }
}

/** Median of the finite values of an array (copying into a scratch buffer); NaN if none. */
export function medianFinite(a: ArrayLike<number>, scratch?: Float32Array): number {
  const buf = scratch && scratch.length >= a.length ? scratch : new Float32Array(a.length);
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    const v = a[i]!;
    if (v === v && v !== Infinity && v !== -Infinity) buf[n++] = v;
  }
  if (n === 0) return NaN;
  const s = buf.subarray(0, n).sort();
  return n % 2 ? s[(n - 1) / 2]! : 0.5 * (s[n / 2 - 1]! + s[n / 2]!);
}

/** Bilinear-free nearest-cell sample of a field at a local point; NaN outside the grid. */
export function cellIndexAt(g: GridSpec, x: number, y: number): number {
  const i = Math.round((x - g.x0) / g.cellSize);
  const j = Math.round((y - g.y0) / g.cellSize);
  return i >= 0 && j >= 0 && i < g.nx && j < g.ny ? j * g.nx + i : -1;
}

/** Local x, y of cell k's centre. */
export const cellXY = (g: GridSpec, k: number): [number, number] => {
  const j = (k / g.nx) | 0;
  return [g.x0 + (k - j * g.nx) * g.cellSize, g.y0 + j * g.cellSize];
};

/** Cell k displaced by `dist` metres along azimuth az (towards), or −1 outside the grid. */
export function stepCell(g: GridSpec, k: number, azDeg: number, dist: number): number {
  const j = (k / g.nx) | 0;
  const i = k - j * g.nx;
  const r = azDeg * DEG;
  const ii = Math.round(i + (Math.sin(r) * dist) / g.cellSize);
  const jj = Math.round(j + (Math.cos(r) * dist) / g.cellSize);
  return ii >= 0 && jj >= 0 && ii < g.nx && jj < g.ny ? jj * g.nx + ii : -1;
}

/** Distance (m) between two cells. */
export function cellDist(g: GridSpec, a: number, b: number): number {
  const ja = (a / g.nx) | 0;
  const jb = (b / g.nx) | 0;
  return Math.hypot(a - ja * g.nx - (b - jb * g.nx), ja - jb) * g.cellSize;
}

/** Azimuth (towards) from cell a to cell b; NaN if a === b. */
export function cellAzimuth(g: GridSpec, a: number, b: number): number {
  const ja = (a / g.nx) | 0;
  const jb = (b / g.nx) | 0;
  return azimuthOf(b - jb * g.nx - (a - ja * g.nx), jb - ja);
}
