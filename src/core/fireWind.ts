/**
 * The wind the fire feels (0.7.0, item B): the pure helpers of `SimSnapshot.fireWind`, a `FireWindRaster` (core/types.ts). The fire-grid
 * wind (m/s, what the spread model is given at each cell) is block-averaged to about 60 m and quantised to Int16 at 0.01 m/s, so a picture
 * is 10 kB (3 km) to 160 kB (12 km). Entry-safe: no engine, no DOM, no Three.js (the history, the memory model and the layer's decode share it).
 * The publishing side (the block mean over the engine's own arrays) is `sim/fireWindPublish.ts`.
 */
import type { GridSpec } from './grid';
import type { FireWindRaster } from './types';

/** m/s per Int16 step: the error of a stored value is at most half of it (0.005 m/s) and the range is +-327.67 m/s. */
export const FIRE_WIND_QUANTUM = 0.01;
/** The cell size (m) a block of fire cells is chosen to come closest to. */
export const FIRE_WIND_TARGET_CELL_M = 60;
/** Bytes a picture costs besides its two arrays (the grid, `block` and `time`, as the memory model counts them). */
export const FIRE_WIND_FIXED_BYTES = 64;

/** Fire cells to a side of one block: `max(1, round(60 / cellSize))`, so 3 at 20 m, 2 at 25, 30 and 40 m, and 1 over 40 m (no blocking). */
export function fireWindBlock(cellSize: number): number {
  return cellSize > 0 && Number.isFinite(cellSize) ? Math.max(1, Math.round(FIRE_WIND_TARGET_CELL_M / cellSize)) : 1;
}

/**
 * The grid of the block centres of a fire grid taken `k` cells at a time: cells `k x` as large, the first centre `(k - 1) / 2` fire cells in
 * from the first fire cell, `ceil(n / k)` blocks a side (an edge block averages the cells it has). The origin is copied.
 */
export function fireWindGrid(g: GridSpec, k: number): GridSpec {
  const half = ((k - 1) / 2) * g.cellSize;
  return { nx: Math.ceil(g.nx / k), ny: Math.ceil(g.ny / k), cellSize: g.cellSize * k, x0: g.x0 + half, y0: g.y0 + half, origin: { ...g.origin } };
}

/** Bytes a picture holds: its two arrays and the fixed part; 0 for none (a snapshot without one). */
export function fireWindBytes(fw: FireWindRaster | undefined): number {
  return fw ? fw.u.byteLength + fw.v.byteLength + FIRE_WIND_FIXED_BYTES : 0;
}

/** The bytes of the picture of a fire grid of `nx` x `ny` cells of `cellSize` m, before one is made (the memory model, the keyframe model). */
export function fireWindBytesModel(nx: number, ny: number, cellSize: number): number {
  const k = fireWindBlock(cellSize);
  return 2 * Int16Array.BYTES_PER_ELEMENT * Math.ceil(nx / k) * Math.ceil(ny / k) + FIRE_WIND_FIXED_BYTES;
}

/**
 * The picture as m/s in Float32 (`q x 0.01`), on `fw.grid` (the same object). Allocation-free when `out` is given and both of its arrays hold the
 * picture: it fills the first `u.length` entries of them and returns them (so they may be longer; read them with the returned grid's size). Smaller
 * arrays, or none, get fresh ones.
 */
export function decodeFireWind(fw: FireWindRaster, out?: { u: Float32Array; v: Float32Array }): { grid: GridSpec; u: Float32Array; v: Float32Array } {
  const n = fw.u.length;
  const u = out && out.u.length >= n ? out.u : new Float32Array(n);
  const v = out && out.v.length >= n ? out.v : new Float32Array(n);
  for (let k = 0; k < n; k++) {
    u[k] = fw.u[k]! * FIRE_WIND_QUANTUM;
    v[k] = fw.v[k]! * FIRE_WIND_QUANTUM;
  }
  return { grid: fw.grid, u, v };
}
