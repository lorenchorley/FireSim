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

interface Store {
  u: Float32Array;
  v: Float32Array;
  /** The raster object of each refine (1, 2), made for `Cached.nx` and the rest; views of `u` and `v`. */
  cache: [Cached | null, Cached | null];
}

/** Rows of texels between two reads of the clock while a fill is sliced: a slice overshoots its budget by at most this many rows (about 0.3 ms for 4 rows of a 60 column model at 4x CPU). */
export const FILL_ROWS_PER_CHECK = 4;

/**
 * Rasters of the wind at a height above the ground, filled in place into storage made once for the largest case
 * (`(2 n - 1)^2` texels for `n` columns a side; it grows only if a model asks for more). `fill` returns a raster whose arrays are
 * views of that storage. There are two storages, used in turn: a build that is still tracing through the raster of the last `fill`
 * keeps reading it intact when the next `fill` is made, and it is the one after that which overwrites it (the refine 1 and refine 2
 * rasters of one turn share their storage).
 *
 * A fill is also resumable, by rows, so the layer can run it in clocked slices on the main thread (a 60 column model at half spacing
 * is 14,000 texels, 10 ms and more at 4x CPU): `begin` takes the turn and sets the job up, `step(budgetMs, now)` does rows until the
 * budget is used (the clock is read every `FILL_ROWS_PER_CHECK` rows, and one batch is always done, so every call makes progress)
 * and says when the raster is complete, `cancel` drops a job. `fill` is `begin` and one unclocked `step`. Slices change nothing in the
 * numbers: the texels are the same, bit for bit, however the rows are cut.
 */
export class HeightRaster {
  private readonly stores: [Store, Store];
  private turn = 0;
  // Scratch of the lookups: allocation-free, and no double goes through an argument (spike S3, rule 1).
  private readonly pos = new Float64Array(4);
  private readonly wind = new Float32Array(3);
  // The job in progress (null sampler = none): what it reads, where it writes and the next row.
  private sampler: AtmosphereSampler | null = null;
  private ground: GroundRaster | null = null;
  private out: FlowRaster | null = null;
  private grid: GridSpec | null = null;
  private heightM = 0;
  private refine = 1;
  private row = 0;
  /** The complete raster of the last finished job (null while one is under way, or after `cancel`). */
  private ready: FlowRaster | null = null;

  constructor(maxN = 60) {
    const cap = (2 * maxN - 1) * (2 * maxN - 1);
    const make = (): Store => ({ u: new Float32Array(cap), v: new Float32Array(cap), cache: [null, null] });
    this.stores = [make(), make()];
  }

  /** The raster of the last finished fill, or null while a fill is under way (its storage is half written) or was cancelled. */
  get raster(): FlowRaster | null {
    return this.ready;
  }

  get busy(): boolean {
    return this.sampler !== null;
  }

  /** Set up a fill (no texel is written yet): the next storage, in turn, and the raster that will be complete when `step` says so. */
  begin(sampler: AtmosphereSampler, ground: GroundRaster, heightM: number, refine: 1 | 2): void {
    const g: GridSpec = sampler.atm?.grid ?? ground.grid;
    const nx = (g.nx - 1) * refine + 1;
    const ny = (g.ny - 1) * refine + 1;
    const count = nx * ny;
    this.turn ^= 1;
    const st = this.stores[this.turn]!;
    if (count > st.u.length) {
      st.u = new Float32Array(count);
      st.v = new Float32Array(count);
      st.cache[0] = null;
      st.cache[1] = null;
    }
    let c = st.cache[refine - 1];
    if (!c || c.nx !== g.nx || c.ny !== g.ny || c.cellSize !== g.cellSize || c.x0 !== g.x0 || c.y0 !== g.y0) {
      const grid: GridSpec = { nx, ny, cellSize: g.cellSize / refine, x0: g.x0, y0: g.y0, origin: g.origin };
      c = { nx: g.nx, ny: g.ny, cellSize: g.cellSize, x0: g.x0, y0: g.y0, raster: { grid, u: st.u.subarray(0, count), v: st.v.subarray(0, count) } };
      st.cache[refine - 1] = c;
    }
    this.sampler = sampler;
    this.ground = ground;
    this.out = c.raster;
    this.grid = g;
    this.heightM = heightM;
    this.refine = refine;
    this.row = 0;
    this.ready = null;
  }

  /**
   * Fill rows until `budgetMs` of `now()` is used; true when the raster is complete (or no fill is under way). At least one batch of
   * rows is done per call. `Infinity` finishes the job without reading the clock.
   */
  step(budgetMs: number, now: () => number): boolean {
    if (this.sampler === null) return true;
    const ny = this.out!.grid.ny;
    const deadline = budgetMs === Infinity ? Infinity : now() + budgetMs;
    for (;;) {
      const to = Math.min(ny, this.row + FILL_ROWS_PER_CHECK);
      this.rows(this.row, to);
      this.row = to;
      if (to >= ny) {
        this.ready = this.out;
        this.sampler = this.ground = this.out = this.grid = null;
        return true;
      }
      if (deadline !== Infinity && now() >= deadline) return false;
    }
  }

  /** Drop the job (its storage stays half written and is not offered as a raster). */
  cancel(): void {
    this.sampler = this.ground = this.out = this.grid = null;
    this.ready = null;
  }

  fill(sampler: AtmosphereSampler, ground: GroundRaster, heightM: number, refine: 1 | 2): FlowRaster {
    this.begin(sampler, ground, heightM, refine);
    this.step(Infinity, never);
    return this.ready!;
  }

  /** Texel rows `rowFrom` up to (not including) `rowTo` of the job in progress. */
  private rows(rowFrom: number, rowTo: number): void {
    const g = this.grid!;
    const sampler = this.sampler!;
    const raster = this.out!;
    const nx = raster.grid.nx;
    const step = g.cellSize / this.refine;
    const gg = this.ground!.grid;
    const ge = this.ground!.elevation;
    const gmx = gg.nx - 1;
    const gmy = gg.ny - 1;
    const ginv = 1 / gg.cellSize;
    const heightM = this.heightM;
    const pos = this.pos;
    const w = this.wind;
    const u = raster.u;
    const v = raster.v;
    pos[3] = heightM; // the height above ground, for the ambient fallback of a view without wind
    let o = rowFrom * nx;
    for (let j = rowFrom; j < rowTo; j++) {
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
  }
}

/** The clock of an unclocked step (never read). */
const never = (): number => 0;
