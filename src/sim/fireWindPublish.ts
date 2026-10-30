/**
 * Publishing the wind the fire feels (0.7.0, item B): the block mean of the engine's fire-grid wind `env.windU/V` at about 60 m, quantised
 * to Int16, for `SimSnapshot.fireWind` (core/fireWind.ts has the helpers and the byte model). Called by `Simulation.makeSnapshot` only:
 * a pure read of the engine's arrays (nothing the run computes depends on it), so every result is the 0.6.0 one with or without it.
 */
import { FIRE_WIND_QUANTUM, fireWindBlock, fireWindGrid } from '../core/fireWind';
import type { GridSpec } from '../core/grid';
import type { FireWindRaster } from '../core/types';

/** Int16 steps per m/s (100 exactly), and the largest magnitude stored: -32768 is never used, so the range is symmetric. */
const PER_MS = 1 / FIRE_WIND_QUANTUM;
const Q_MAX = 32767;

/** `round(mean x 100)` clamped to +-32767; a mean that is not a finite number is 0. */
function quantise(mean: number): number {
  if (!Number.isFinite(mean)) return 0;
  const q = Math.round(mean * PER_MS);
  return q > Q_MAX ? Q_MAX : q < -Q_MAX ? -Q_MAX : q;
}

/**
 * Block-average `u`, `v` (m/s east and north on the fire grid `g`) by `fireWindBlock(g.cellSize)`, quantise at `FIRE_WIND_QUANTUM`, and stamp `time`.
 * A pure read of its inputs: it never writes them and allocates only the picture (two Int16 arrays and the grid). The sums run in double
 * precision, row by row in a fixed order, so the same inputs give the same bytes on every machine; an edge block averages the cells it has.
 */
export function publishFireWind(g: GridSpec, u: Float32Array, v: Float32Array, time: number): FireWindRaster {
  const k = fireWindBlock(g.cellSize);
  const grid = fireWindGrid(g, k);
  const nx = g.nx;
  const ny = g.ny;
  const bx = grid.nx;
  const by = grid.ny;
  const qu = new Int16Array(bx * by);
  const qv = new Int16Array(bx * by);
  let o = 0;
  for (let bj = 0; bj < by; bj++) {
    const j0 = bj * k;
    const j1 = Math.min(ny, j0 + k);
    for (let bi = 0; bi < bx; bi++, o++) {
      const i0 = bi * k;
      const i1 = Math.min(nx, i0 + k);
      let su = 0;
      let sv = 0;
      for (let j = j0; j < j1; j++) {
        const row = j * nx;
        for (let i = i0; i < i1; i++) {
          su += u[row + i]!;
          sv += v[row + i]!;
        }
      }
      const n = (i1 - i0) * (j1 - j0);
      qu[o] = quantise(su / n);
      qv[o] = quantise(sv / n);
    }
  }
  return { grid, u: qu, v: qv, block: k, time };
}
