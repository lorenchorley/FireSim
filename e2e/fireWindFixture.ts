/**
 * What the e2e specs of the wind the fire feels (0.7.0, items A and B) share: reading the 60 m picture of the snapshot shown, and a stand-in for it.
 *
 * The real engine publishes `SimSnapshot.fireWind` on every snapshot (lane D of the raster contract). Until that is in the build under test, the specs
 * give the snapshot shown a fixture of the same shape and call the view with it (`ensureFireWind` says which it was, so a spec can say what it checked):
 * a 60 m Int16 raster over the fire grid made from the air's own 10 m wind, stronger and turned a little, so that it differs from the 10 m wind
 * everywhere and is easy to tell from it. Everything the lane built reads the snapshot (the layer, the map, the caption), so the stand-in drives all of it.
 */
import type { Page } from '@playwright/test';

export type FeltSource = 'engine' | 'injected';

export interface FeltFacts {
  source: FeltSource;
  nx: number;
  ny: number;
  cellM: number;
  x0: number;
  time: number;
  /** The fire grid it was made over (cells, metres, first centre). */
  fire: { nx: number; ny: number; cellSize: number; x0: number };
  /** The largest speed in the picture (km/h), worked out here from the Int16 values: independent of the code under test. */
  maxKmh: number;
  minKmh: number;
}

/** The snapshot shown carries the wind the fire feels: the engine's, or a fixture put on it (and the view told). */
export async function ensureFireWind(page: Page): Promise<FeltFacts> {
  return page.evaluate(() => {
    type Grid = { nx: number; ny: number; cellSize: number; x0: number; y0: number; origin: unknown };
    type Raster = { grid: Grid; u: Int16Array; v: Int16Array; block: number; time: number };
    type Snap = { time: number; fire: { grid: Grid }; atmosphere: { grid: Grid; surfaceU: Float32Array; surfaceV: Float32Array }; fireWind?: Raster };
    const h = (window as unknown as { __firesim: { session: { state: { get(): { snapshot: Snap | null } } }; view: { update(s: Snap): void } } }).__firesim;
    const snap = h.session.state.get().snapshot;
    if (!snap) throw new Error('no snapshot yet');
    if (!snap.fireWind) {
      Object.defineProperty(snap, '__injected', { value: true, enumerable: false });
      const fire = snap.fire.grid;
      const ag = snap.atmosphere.grid;
      const k = Math.max(1, Math.round(60 / fire.cellSize));
      const half = ((k - 1) / 2) * fire.cellSize;
      const grid: Grid = { nx: Math.ceil(fire.nx / k), ny: Math.ceil(fire.ny / k), cellSize: fire.cellSize * k, x0: fire.x0 + half, y0: fire.y0 + half, origin: fire.origin };
      const n = grid.nx * grid.ny;
      const u = new Int16Array(n);
      const v = new Int16Array(n);
      const bil = (a: Float32Array, x: number, y: number): number => {
        const fx = Math.max(0, Math.min(ag.nx - 1.0001, (x - ag.x0) / ag.cellSize));
        const fy = Math.max(0, Math.min(ag.ny - 1.0001, (y - ag.y0) / ag.cellSize));
        const i = Math.floor(fx);
        const j = Math.floor(fy);
        const p = fx - i;
        const q = fy - j;
        const c = j * ag.nx + i;
        return (a[c]! * (1 - p) + a[c + 1]! * p) * (1 - q) + (a[c + ag.nx]! * (1 - p) + a[c + ag.nx + 1]! * p) * q;
      };
      for (let j = 0; j < grid.ny; j++) {
        for (let i = 0; i < grid.nx; i++) {
          const x = grid.x0 + i * grid.cellSize;
          const y = grid.y0 + j * grid.cellSize;
          const su = bil(snap.atmosphere.surfaceU, x, y);
          const sv = bil(snap.atmosphere.surfaceV, x, y);
          u[j * grid.nx + i] = Math.max(-32767, Math.min(32767, Math.round((1.3 * su + 1.5 * Math.sin(x / 400)) * 100)));
          v[j * grid.nx + i] = Math.max(-32767, Math.min(32767, Math.round((1.3 * sv + 1.5 * Math.cos(y / 400)) * 100)));
        }
      }
      snap.fireWind = { grid, u, v, block: k, time: snap.time };
      h.view.update(snap); // (the same snapshot again, now with the picture: the layer and the map read it from here)
    }
    const source: 'engine' | 'injected' = (snap as { __injected?: boolean }).__injected ? 'injected' : 'engine';
    const fw = snap.fireWind!;
    let max = 0;
    let min = Infinity;
    for (let c = 0; c < fw.u.length; c++) {
      const s = Math.hypot(fw.u[c]! * 0.01, fw.v[c]! * 0.01) * 3.6;
      if (s > max) max = s;
      if (s < min) min = s;
    }
    const f = snap.fire.grid;
    return { source, nx: fw.grid.nx, ny: fw.grid.ny, cellM: fw.grid.cellSize, x0: fw.grid.x0, time: fw.time, fire: { nx: f.nx, ny: f.ny, cellSize: f.cellSize, x0: f.x0 }, maxKmh: max, minKmh: min };
  });
}

/** The largest and smallest 10 m wind speed (km/h) of the snapshot shown, worked out here from the air's own `surfaceU/V`. */
export function surfaceRangeKmh(page: Page): Promise<{ min: number; max: number; nx: number; ny: number; cellM: number }> {
  return page.evaluate(() => {
    const a = (window as unknown as { __firesim: { session: { state: { get(): { snapshot: { atmosphere: { grid: { nx: number; ny: number; cellSize: number }; surfaceU: Float32Array; surfaceV: Float32Array } } | null } } } } }).__firesim.session.state.get().snapshot!.atmosphere;
    let min = Infinity;
    let max = 0;
    for (let k = 0; k < a.grid.nx * a.grid.ny; k++) {
      const s = Math.hypot(a.surfaceU[k]!, a.surfaceV[k]!) * 3.6;
      if (s > max) max = s;
      if (s < min) min = s;
    }
    return { min, max, nx: a.grid.nx, ny: a.grid.ny, cellM: a.grid.cellSize };
  });
}
