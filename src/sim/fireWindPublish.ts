/**
 * Publishing the wind the fire feels (0.7.0, item B, lane D): the block mean of the engine's fire-grid wind `env.windU/V` at about 60 m, quantised
 * to Int16, for `SimSnapshot.fireWind` (core/fireWind.ts has the helpers and the byte model). C0 STUB: it throws until lane D builds it; nothing
 * calls it yet (the snapshot carries no `fireWind` in C0, so every result and hash is the 0.6.0 one).
 */
import type { GridSpec } from '../core/grid';
import type { FireWindRaster } from '../core/types';

/**
 * Block-average `u`, `v` (m/s east and north on the fire grid `g`) by `fireWindBlock(g.cellSize)`, quantise at `FIRE_WIND_QUANTUM`, and stamp `time`.
 * A pure read of its inputs: it never writes them and allocates only the picture.
 */
export function publishFireWind(_g: GridSpec, _u: Float32Array, _v: Float32Array, _time: number): FireWindRaster {
  throw new Error('not built in C0');
}
