import type { LatLon } from './geo';

/**
 * A regular 2-D raster in the local tangent plane.
 * Indexing: k = j * nx + i, with i increasing EAST and j increasing NORTH (row 0 is the southern edge).
 * Cell (i, j) has its centre at (x0 + i*cellSize, y0 + j*cellSize) in local metres from `origin`.
 */
export interface GridSpec {
  nx: number;
  ny: number;
  /** Cell size in metres. */
  cellSize: number;
  /** Local x (m east of origin) of the centre of cell (0, *). */
  x0: number;
  /** Local y (m north of origin) of the centre of cell (*, 0). */
  y0: number;
  /** Geographic origin of the local projection (the domain centre). */
  origin: LatLon;
}

/** Square grid centred on the origin covering `extentM` metres with cells of `cellSize` metres. */
export function makeGridSpec(origin: LatLon, extentM: number, cellSize: number): GridSpec {
  const n = Math.max(2, Math.round(extentM / cellSize));
  const half = ((n - 1) * cellSize) / 2;
  return { nx: n, ny: n, cellSize, x0: -half, y0: -half, origin: { ...origin } };
}

export const cellCount = (g: GridSpec): number => g.nx * g.ny;
export const idx = (g: GridSpec, i: number, j: number): number => j * g.nx + i;
export const cellX = (g: GridSpec, i: number): number => g.x0 + i * g.cellSize;
export const cellY = (g: GridSpec, j: number): number => g.y0 + j * g.cellSize;
export const inside = (g: GridSpec, i: number, j: number): boolean => i >= 0 && j >= 0 && i < g.nx && j < g.ny;

/** Fractional cell coordinates of a local point. */
export function toCellFrac(g: GridSpec, x: number, y: number): [number, number] {
  return [(x - g.x0) / g.cellSize, (y - g.y0) / g.cellSize];
}

/** Nearest cell index for a local point, or -1 if outside the grid. */
export function cellAt(g: GridSpec, x: number, y: number): number {
  const i = Math.round((x - g.x0) / g.cellSize);
  const j = Math.round((y - g.y0) / g.cellSize);
  return inside(g, i, j) ? idx(g, i, j) : -1;
}

/** Bilinear sample of a field at a local point (clamped to the grid edge). */
export function sampleBilinear(g: GridSpec, f: ArrayLike<number>, x: number, y: number): number {
  let fx = (x - g.x0) / g.cellSize;
  let fy = (y - g.y0) / g.cellSize;
  fx = fx < 0 ? 0 : fx > g.nx - 1 ? g.nx - 1 : fx;
  fy = fy < 0 ? 0 : fy > g.ny - 1 ? g.ny - 1 : fy;
  const i0 = Math.min(Math.floor(fx), g.nx - 2);
  const j0 = Math.min(Math.floor(fy), g.ny - 2);
  const tx = fx - i0;
  const ty = fy - j0;
  const k = j0 * g.nx + i0;
  const a = f[k]!;
  const b = f[k + 1]!;
  const c = f[k + g.nx]!;
  const d = f[k + g.nx + 1]!;
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/**
 * Central-difference gradient (one-sided at the edges) of a scalar field.
 * Returns d/dx (east) and d/dy (north) in field-units per metre.
 */
export function gradient(g: GridSpec, f: ArrayLike<number>): { dx: Float32Array; dy: Float32Array } {
  const { nx, ny, cellSize: h } = g;
  const dx = new Float32Array(nx * ny);
  const dy = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const il = i > 0 ? k - 1 : k;
      const ir = i < nx - 1 ? k + 1 : k;
      const jd = j > 0 ? k - nx : k;
      const ju = j < ny - 1 ? k + nx : k;
      dx[k] = (f[ir]! - f[il]!) / (h * ((i < nx - 1 ? 1 : 0) + (i > 0 ? 1 : 0)));
      dy[k] = (f[ju]! - f[jd]!) / (h * ((j < ny - 1 ? 1 : 0) + (j > 0 ? 1 : 0)));
    }
  }
  return { dx, dy };
}

/** Separable box blur with radius r cells (edge-clamped). Used for smoothing and neighbourhood means. */
export function boxBlur(g: GridSpec, f: ArrayLike<number>, r: number): Float32Array {
  const { nx, ny } = g;
  const tmp = new Float32Array(nx * ny);
  const out = new Float32Array(nx * ny);
  const w = 2 * r + 1;
  for (let j = 0; j < ny; j++) {
    const row = j * nx;
    let acc = 0;
    for (let t = -r; t <= r; t++) acc += f[row + Math.min(nx - 1, Math.max(0, t))]!;
    for (let i = 0; i < nx; i++) {
      tmp[row + i] = acc / w;
      acc += f[row + Math.min(nx - 1, i + r + 1)]! - f[row + Math.max(0, i - r)]!;
    }
  }
  for (let i = 0; i < nx; i++) {
    let acc = 0;
    for (let t = -r; t <= r; t++) acc += tmp[Math.min(ny - 1, Math.max(0, t)) * nx + i]!;
    for (let j = 0; j < ny; j++) {
      out[j * nx + i] = acc / w;
      acc += tmp[Math.min(ny - 1, j + r + 1) * nx + i]! - tmp[Math.max(0, j - r) * nx + i]!;
    }
  }
  return out;
}

/** Resample a field from one grid onto another by bilinear interpolation in local coordinates. */
export function resample(src: GridSpec, f: ArrayLike<number>, dst: GridSpec): Float32Array {
  const out = new Float32Array(dst.nx * dst.ny);
  for (let j = 0; j < dst.ny; j++) {
    const y = dst.y0 + j * dst.cellSize;
    for (let i = 0; i < dst.nx; i++) out[j * dst.nx + i] = sampleBilinear(src, f, dst.x0 + i * dst.cellSize, y);
  }
  return out;
}
