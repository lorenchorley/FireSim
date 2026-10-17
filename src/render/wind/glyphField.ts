/**
 * The wind field the glyphs are traced through (0.5.0, stage E1): a 2-D raster of (u, v) at the height the person chose. The
 * tracer reads rasters only (spike S3: tracing through a raster costs 2.5 ms for 2000 x 10 where sampling the 3-D air for every
 * step costs 6.8 to 8 ms), so this file turns "the wind at a height" into one, once per new picture of the air or height, never
 * per camera move. Pure: no Three.js, no DOM.
 *   `'fire'`   the model's 10 m wind (`surfaceU/V`, already on the atmosphere grid): used as it is, no copy and no refinement,
 *              because bilinear on the model's grid is exactly what `AtmosphereSampler.surfaceWind` does.
 *   a height   metres above the 10 m ground as received: texel (i, j) = `windP` at (x, y, ground(x, y) + h), so the 10, 50 and
 *              100 m pictures read the model's own terrain-following levels and not a flat view with zeros under the hills.
 */
import type { GridSpec } from '../../core/grid';
import type { AtmosphereView } from '../../core/types';
import type { AtmosphereSampler } from '../atmosphereSampler';
import type { FlowRaster, GroundRaster } from './glyphTypes';

/** `'fire'`: `surfaceU/V` as they are (zero copy). Null when the view has no usable surface wind (no view, or arrays shorter than the grid). */
export function surfaceRaster(atm: AtmosphereView | null | undefined): FlowRaster | null {
  if (!atm) return null;
  const g = atm.grid;
  if (!g || g.nx < 2 || g.ny < 2) return null;
  const n = g.nx * g.ny;
  if (atm.surfaceU.length < n || atm.surfaceV.length < n) return null;
  return { grid: g, u: atm.surfaceU, v: atm.surfaceV };
}

/** One model cell wider than this many screen pixels: the raster is made at half the model's column spacing (S3: error 0.47 px at 1x, 0.21 px at 2x for a 60 px cell). */
export const REFINE_CELL_PX = 60;
export const refineFor = (cellPx: number): 1 | 2 => (cellPx > REFINE_CELL_PX ? 2 : 1);

interface Cached {
  /** The model grid this was made for (its fields are compared, not its identity: the sampler is new for every snapshot). */
  nx: number;
  ny: number;
  cellSize: number;
  x0: number;
  y0: number;
  raster: FlowRaster;
}

/**
 * Rasters of the wind at a height above the ground, filled in place into storage made once for the largest case
 * (`(2 n - 1)^2` texels for `n` columns a side; it grows only if a model asks for more). `fill` returns a raster whose arrays are
 * views of that storage, so it stays valid until the next `fill` (the refine 1 and refine 2 rasters share the storage).
 */
export class HeightRaster {
  private u: Float32Array;
  private v: Float32Array;
  private readonly cache: [Cached | null, Cached | null] = [null, null];
  // Scratch of the lookups: allocation-free, and no double goes through an argument (spike S3, rule 1).
  private readonly pos = new Float64Array(4);
  private readonly wind = new Float32Array(3);

  constructor(maxN = 60) {
    const cap = (2 * maxN - 1) * (2 * maxN - 1);
    this.u = new Float32Array(cap);
    this.v = new Float32Array(cap);
  }

  fill(sampler: AtmosphereSampler, ground: GroundRaster, heightM: number, refine: 1 | 2): FlowRaster {
    const g: GridSpec = sampler.atm?.grid ?? ground.grid;
    const nx = (g.nx - 1) * refine + 1;
    const ny = (g.ny - 1) * refine + 1;
    const count = nx * ny;
    if (count > this.u.length) {
      this.u = new Float32Array(count);
      this.v = new Float32Array(count);
      this.cache[0] = null;
      this.cache[1] = null;
    }
    let c = this.cache[refine - 1];
    if (!c || c.nx !== g.nx || c.ny !== g.ny || c.cellSize !== g.cellSize || c.x0 !== g.x0 || c.y0 !== g.y0 || c.raster.u.buffer !== this.u.buffer) {
      const grid: GridSpec = { nx, ny, cellSize: g.cellSize / refine, x0: g.x0, y0: g.y0, origin: g.origin };
      c = { nx: g.nx, ny: g.ny, cellSize: g.cellSize, x0: g.x0, y0: g.y0, raster: { grid, u: this.u.subarray(0, count), v: this.v.subarray(0, count) } };
      this.cache[refine - 1] = c;
    }
    const step = g.cellSize / refine;
    const gg = ground.grid;
    const ge = ground.elevation;
    const gmx = gg.nx - 1;
    const gmy = gg.ny - 1;
    const ginv = 1 / gg.cellSize;
    const pos = this.pos;
    const w = this.wind;
    const u = c.raster.u;
    const v = c.raster.v;
    pos[3] = heightM; // the height above ground, for the ambient fallback of a view without wind
    let o = 0;
    for (let j = 0; j < ny; j++) {
      const y = g.y0 + j * step;
      for (let i = 0; i < nx; i++) {
        const x = g.x0 + i * step;
        // The 10 m ground under the texel, bilinear and clamped to its edge (the arithmetic of HeightField.heightAt).
        let fx = (x - gg.x0) * ginv;
        let fy = (y - gg.y0) * ginv;
        fx = Math.max(0, Math.min(gmx, fx));
        fy = Math.max(0, Math.min(gmy, fy));
        let i0 = fx | 0;
        let j0 = fy | 0;
        if (i0 >= gmx) i0 = gmx - 1;
        if (j0 >= gmy) j0 = gmy - 1;
        const tx = fx - i0;
        const ty = fy - j0;
        const k = j0 * gg.nx + i0;
        const z = (ge[k]! * (1 - tx) + ge[k + 1]! * tx) * (1 - ty) + (ge[k + gg.nx]! * (1 - tx) + ge[k + gg.nx + 1]! * tx) * ty;
        pos[0] = x;
        pos[1] = y;
        pos[2] = z + heightM;
        sampler.windP(pos, w);
        u[o] = w[0]!;
        v[o] = w[1]!;
        o++;
      }
    }
    return c.raster;
  }
}
