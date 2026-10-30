/**
 * The Wind speed map at the Wind height (0.7.0, E1b "Colour the map by speed"): the values the heat map paints while "Arrows and flow lines" is on, so the
 * ground is coloured by the same wind the arrows trace. Pure (no Three.js, no DOM), unit-tested (windMapField.test.ts); lives in the render chunk.
 *   `'fire'`   the model's 10 m wind (`surfaceU/V`), on the atmosphere grid: what the Wind speed map has always shown.
 *   `'felt'`   the wind the fire feels (`SimSnapshot.fireWind`, Int16 at 0.01 m/s), on its own 60 m grid, read without decoding it first.
 *   a height   metres above the 10 m ground, from a `HeightRaster` at the model's own spacing (refine 1), on the atmosphere grid.
 * A `'felt'` map of a picture that has no `fireWind` is the 10 m map (the same fallback as the arrows, said in their caption and in this map's legend).
 * Values are km/h (`|(u, v)| x 3.6`), `NO_DATA` where a texel is not finite.
 */
import { FIRE_WIND_QUANTUM } from '../../core/fireWind';
import type { GridSpec } from '../../core/grid';
import type { AtmosphereView, FireWindRaster } from '../../core/types';
import type { AtmosphereSampler } from '../atmosphereSampler';
import type { OverlayField } from '../fields';
import { NO_DATA, NO_DATA_THRESHOLD } from '../legends';
import { HeightRaster, surfaceRaster } from './glyphField';
import type { GroundRaster, WindHeight } from './glyphTypes';

const KMH_PER_MS = 3.6;

/** What the map is made from. `ground10` is the 10 m ground as received (the heights are above it); `sampler` the air of the same snapshot. */
export interface WindMapSources {
  atm: AtmosphereView | null | undefined;
  sampler: AtmosphereSampler | null | undefined;
  ground10: GroundRaster | null | undefined;
  fireWind: FireWindRaster | null | undefined;
}

/** Which raster a map reads: the 10 m surface wind, the fire-felt wind or a height raster (`OverlayStats.source`). */
export type WindMapSource = 'surface' | 'felt' | 'height';

const usable = (fw: FireWindRaster | null | undefined): fw is FireWindRaster => !!fw && fw.grid.nx >= 2 && fw.grid.ny >= 2 && fw.u.length >= fw.grid.nx * fw.grid.ny && fw.v.length >= fw.grid.nx * fw.grid.ny;

/** The raster a height reads for a picture: `'felt'` falls back to the 10 m surface wind when the picture has no usable `fireWind`. */
export function windMapSource(height: WindHeight, fireWind: FireWindRaster | null | undefined): WindMapSource {
  if (typeof height === 'number') return 'height';
  return height === 'felt' && usable(fireWind) ? 'felt' : 'surface';
}

/** An array of `n` values: `out` when it is exactly that long (the overlay texture is refilled from it), else a new one. */
const take = (out: Float32Array | undefined, n: number): Float32Array => (out && out.length === n ? out : new Float32Array(n));

/** Speed in km/h of the Float32 raster `u`, `v` (`scale` turns stored units into m/s) on `g`, into `values`. */
function speeds(g: GridSpec, u: ArrayLike<number>, v: ArrayLike<number>, scale: number, out: Float32Array | undefined): OverlayField {
  const n = g.nx * g.ny;
  const values = take(out, n);
  const f = scale * KMH_PER_MS;
  for (let k = 0; k < n; k++) {
    const s = Math.hypot(u[k]!, v[k]!) * f;
    values[k] = Number.isFinite(s) ? s : NO_DATA;
  }
  return { grid: g, values, categorical: false };
}

/** Run a fill to its end without reading the clock. */
const never = (): number => 0;

/**
 * The Wind speed map at `height` for one snapshot, or null when the picture has nothing to draw it from. `hr` is the caller's own `HeightRaster` (made once and
 * kept: its storage is 226 kB); a numeric height without one makes a throw-away. `out` is reused for the values when it has the size the grid needs.
 * Allocation-free apart from `out` (the fire-felt map reads its Int16 values directly).
 */
export function windMapField(src: WindMapSources, height: WindHeight, hr: HeightRaster | null, out?: Float32Array): OverlayField | null {
  switch (windMapSource(height, src.fireWind)) {
    case 'felt': {
      const fw = src.fireWind!;
      return speeds(fw.grid, fw.u, fw.v, FIRE_WIND_QUANTUM, out);
    }
    case 'surface': {
      const r = surfaceRaster(src.atm);
      return r ? speeds(r.grid, r.u, r.v, 1, out) : null;
    }
    case 'height': {
      const { sampler, ground10 } = src;
      if (!sampler || !sampler.hasWind || !ground10 || typeof height !== 'number') return null;
      const h = hr ?? new HeightRaster();
      h.begin(sampler, ground10, height, 1);
      h.step(Infinity, never);
      const r = h.raster;
      return r ? speeds(r.grid, r.u, r.v, 1, out) : null;
    }
  }
}

/** The smallest and largest finite value of a field (km/h), or null when it has none (`OverlayStats`). */
export function fieldRange(f: OverlayField): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (let k = 0; k < f.values.length; k++) {
    const v = f.values[k]!;
    if (!Number.isFinite(v) || v <= NO_DATA_THRESHOLD) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return min <= max ? { min, max } : null;
}
