/**
 * What the 10 m elevation says about each fire cell that the cell's own (block-averaged) numbers hide. For every fire cell
 * (b x b block of 10 m cells, b = 3 at the 30 m fire grid):
 *   slope10Max  largest Horn slope (deg) of the block's 10 m cells,
 *   rough10     RMS (m) of the block's heights about their best-fit plane (relief the cell cannot represent),
 *   curv10      largest |Laplacian| (1/m) of the 10 m heights in the block (5-point stencil; + convex-or-concave kinks, ridge and gully lines).
 * Pure functions of the DEM; nothing here reads the simulation.
 */
import type { GridSpec } from '../../../../src/core/grid';

const RAD = 180 / Math.PI;

export interface Shape10 {
  slope10Max: Float32Array;
  rough10: Float32Array;
  curv10: Float32Array;
}

export function shape10(fire: GridSpec, hi: { grid: GridSpec; elevation: Float32Array }): Shape10 {
  const hg = hi.grid;
  const z = hi.elevation;
  const h = hg.cellSize;
  const b = Math.round(fire.cellSize / h);
  if (hg.nx !== fire.nx * b || hg.ny !== fire.ny * b) throw new Error(`10 m grid ${hg.nx}x${hg.ny} is not ${b}x the fire grid ${fire.nx}x${fire.ny}`);
  const at = (i: number, j: number): number => z[Math.min(hg.ny - 1, Math.max(0, j)) * hg.nx + Math.min(hg.nx - 1, Math.max(0, i))]!;
  const nx = fire.nx;
  const n = fire.nx * fire.ny;
  const slope10Max = new Float32Array(n);
  const rough10 = new Float32Array(n);
  const curv10 = new Float32Array(n);
  for (let fj = 0; fj < fire.ny; fj++) {
    for (let fi = 0; fi < fire.nx; fi++) {
      let sMax = 0;
      let cMax = 0;
      let sz = 0;
      let sxz = 0;
      let syz = 0;
      let szz = 0;
      let sxx = 0;
      const cnt = b * b;
      for (let dj = 0; dj < b; dj++) {
        for (let di = 0; di < b; di++) {
          const i = fi * b + di;
          const j = fj * b + dj;
          // Horn slope
          const gx = (at(i + 1, j + 1) + 2 * at(i + 1, j) + at(i + 1, j - 1) - at(i - 1, j + 1) - 2 * at(i - 1, j) - at(i - 1, j - 1)) / (8 * h);
          const gy = (at(i - 1, j + 1) + 2 * at(i, j + 1) + at(i + 1, j + 1) - at(i - 1, j - 1) - 2 * at(i, j - 1) - at(i + 1, j - 1)) / (8 * h);
          const s = Math.atan(Math.hypot(gx, gy)) * RAD;
          if (s > sMax) sMax = s;
          const lap = Math.abs(at(i + 1, j) + at(i - 1, j) + at(i, j + 1) + at(i, j - 1) - 4 * at(i, j)) / (h * h);
          if (lap > cMax) cMax = lap;
          const x = (di - (b - 1) / 2) * h;
          const y = (dj - (b - 1) / 2) * h;
          const v = at(i, j);
          sz += v;
          sxz += x * v;
          syz += y * v;
          szz += v * v;
          sxx += x * x;
        }
      }
      // Least-squares plane through a symmetric b x b block: the x and y moments are orthogonal, so the fit is separable.
      const mean = sz / cnt;
      const ax = sxx > 0 ? sxz / sxx : 0;
      const ay = sxx > 0 ? syz / sxx : 0;
      const ss = szz - cnt * mean * mean - ax * ax * sxx - ay * ay * sxx; // residual sum of squares
      const k = fj * nx + fi;
      slope10Max[k] = sMax;
      curv10[k] = cMax;
      rough10[k] = Math.sqrt(Math.max(0, ss) / cnt);
    }
  }
  return { slope10Max, rough10, curv10 };
}
