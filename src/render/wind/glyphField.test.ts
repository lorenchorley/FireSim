/**
 * The wind rasters of the glyphs: `'fire'` is the model's 10 m wind as it is, a height is `windP` at the ground plus that height,
 * filled in place at the model's column spacing or half of it.
 */
import * as v8 from 'node:v8';
import * as vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { makeGridSpec } from '../../core/grid';
import type { WeatherHour } from '../../core/types';
import { AtmosphereSampler, profileFactor } from '../atmosphereSampler';
import { HeightField } from '../heightfield';
import { makeAirView } from '../slice/testing';
import { FILL_ROWS_PER_CHECK, HeightRaster, REFINE_CELL_PX, refineFor, surfaceRaster } from './glyphField';
import { bilinear, groundOf, ORIGIN } from './glyphOracle.testing';

const GRID = makeGridSpec(ORIGIN, 45 * 133, 133);
const BASE = 500;
const hills = (x: number, y: number): number => BASE + 220 + 150 * Math.sin(x / 800) * Math.cos(y / 650);
/** A 10 m ground finer than the model's columns, a little different from the model's own. */
const GROUND = groundOf({ nx: 150, ny: 150, cellSize: 40, x0: GRID.x0, y0: GRID.y0, origin: ORIGIN }, (x, y) => hills(x, y) + 12 * Math.sin(x / 90 + y / 70));

function view(o: { linear?: boolean } = {}) {
  return makeAirView({
    grid: GRID,
    baseM: BASE,
    topM: 3000,
    groundAt: (x, y) => hills(x, y) - 25,
    u: o.linear ? (x, y, z) => 3 + 0.002 * x + 0.001 * y + (z - BASE) / 100 : (x, y, z) => 6 + 3 * Math.sin(x / 700 + z / 900) + 0.002 * y,
    v: o.linear ? (x, _y, z) => -2 + 0.001 * x + (z - BASE) / 250 : (_x, y, z) => 1 + 2 * Math.cos(y / 600 - z / 700),
    w: () => 0.3,
  });
}

describe("'fire': the model's 10 m wind", () => {
  it('is surfaceU and surfaceV as they are, no copy', () => {
    const atm = view();
    const r = surfaceRaster(atm)!;
    expect(r.u).toBe(atm.surfaceU);
    expect(r.v).toBe(atm.surfaceV);
    expect(r.grid).toBe(atm.grid);
  });

  it('is exactly the bilinear surface wind of the sampler, everywhere, so it needs no refinement', () => {
    const atm = view();
    for (let k = 0; k < atm.surfaceU.length; k++) {
      atm.surfaceU[k] = 4 + 3 * Math.sin(k * 0.37);
      atm.surfaceV[k] = -2 + 2 * Math.cos(k * 0.11);
    }
    const r = surfaceRaster(atm)!;
    const s = new AtmosphereSampler(atm, BASE, null);
    const out = new Float32Array(2);
    let worst = 0;
    for (let k = 0; k < 800; k++) {
      const x = GRID.x0 + (((k * 0.6180339887) % 1) * (GRID.nx - 1) * GRID.cellSize);
      const y = GRID.y0 + (((k * 0.7548776662) % 1) * (GRID.ny - 1) * GRID.cellSize);
      s.surfaceWind(x, y, out);
      const [u, v] = bilinear(r, x, y);
      worst = Math.max(worst, Math.abs(u - out[0]!), Math.abs(v - out[1]!));
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it('is null when there is no view, or its surface wind does not cover its grid', () => {
    expect(surfaceRaster(null)).toBeNull();
    expect(surfaceRaster(undefined)).toBeNull();
    const atm = view();
    expect(surfaceRaster({ ...atm, surfaceU: new Float32Array(10) })).toBeNull();
    expect(surfaceRaster({ ...atm, surfaceV: new Float32Array(0) })).toBeNull();
  });
});

describe('refineFor', () => {
  it('doubles the raster where one model cell is wider than 60 px', () => {
    expect(REFINE_CELL_PX).toBe(60);
    expect(refineFor(10)).toBe(1);
    expect(refineFor(60)).toBe(1);
    expect(refineFor(60.0001)).toBe(2);
    expect(refineFor(400)).toBe(2);
  });
});

describe('HeightRaster', () => {
  const hf = new HeightField(GROUND.grid, GROUND.elevation);

  for (const refine of [1, 2] as const) {
    it(`refine ${refine}: every texel is windP at (x, y, ground(x, y) + h) to 1e-6, and the grid is the model's, ${refine === 2 ? 'halved' : 'as it is'}`, () => {
      const atm = view();
      const s = new AtmosphereSampler(atm, BASE, null);
      const hr = new HeightRaster();
      for (const h of [50, 300, 2000]) {
        const r = hr.fill(s, GROUND, h, refine);
        expect(r.grid.nx).toBe((GRID.nx - 1) * refine + 1);
        expect(r.grid.ny).toBe((GRID.ny - 1) * refine + 1);
        expect(r.grid.cellSize).toBeCloseTo(GRID.cellSize / refine, 12);
        expect(r.grid.x0).toBe(GRID.x0);
        expect(r.grid.y0).toBe(GRID.y0);
        expect(r.u).toHaveLength(r.grid.nx * r.grid.ny);
        const pos = new Float64Array(4);
        const w = new Float32Array(3);
        let worst = 0;
        for (let j = 0; j < r.grid.ny; j += 3) {
          for (let i = 0; i < r.grid.nx; i += 2) {
            const x = r.grid.x0 + i * r.grid.cellSize;
            const y = r.grid.y0 + j * r.grid.cellSize;
            pos[0] = x;
            pos[1] = y;
            pos[2] = hf.heightAt(x, y) + h;
            pos[3] = h;
            s.windP(pos, w);
            worst = Math.max(worst, Math.abs(r.u[j * r.grid.nx + i]! - w[0]!), Math.abs(r.v[j * r.grid.nx + i]! - w[1]!));
          }
        }
        expect(worst).toBeLessThan(1e-6);
      }
    });
  }

  it('reads the air a height ABOVE the 10 m ground, not at a flat height: u = (z - 500) / 100 in a field linear in z', () => {
    const atm = view({ linear: true });
    const s = new AtmosphereSampler(atm, BASE, null);
    const r = new HeightRaster().fill(s, GROUND, 100, 1);
    let worst = 0;
    for (let j = 1; j < r.grid.ny - 1; j += 4) {
      for (let i = 1; i < r.grid.nx - 1; i += 4) {
        const x = r.grid.x0 + i * r.grid.cellSize;
        const y = r.grid.y0 + j * r.grid.cellSize;
        const zAsl = hf.heightAt(x, y) + 100;
        const want = 3 + 0.002 * x + 0.001 * y + (zAsl - BASE) / 100;
        worst = Math.max(worst, Math.abs(r.u[j * r.grid.nx + i]! - want));
      }
    }
    expect(worst).toBeLessThan(2e-4); // Float32 storage of a wind of a few m/s
    // Higher up is faster (the field gains 1 m/s every 100 m) and the same ground sits under both.
    const r300 = new HeightRaster().fill(s, GROUND, 300, 1);
    expect(r300.u[500]! - r.u[500]!).toBeCloseTo(2, 3);
  });

  it('is filled in place, into two storages used in turn: the raster of the last fill is intact when the next one is made', () => {
    const s = new AtmosphereSampler(view(), BASE, null);
    const hr = new HeightRaster();
    const a = hr.fill(s, GROUND, 50, 1);
    const aBefore = Float32Array.from(a.u);
    const b = hr.fill(s, GROUND, 1000, 1);
    expect(b.u.buffer).not.toBe(a.u.buffer);
    expect(b.u[700]).not.toBe(a.u[700]);
    expect(Float32Array.from(a.u)).toEqual(aBefore); // a build still tracing through `a` is not disturbed by the fill of `b`
    const c = hr.fill(s, GROUND, 300, 2); // the turn of a's storage again
    expect(c.u.buffer).toBe(a.u.buffer);
    expect(c.grid.nx).toBe(2 * (GRID.nx - 1) + 1);
    // The raster objects are reused for the same model, two turns on.
    const d = hr.fill(s, GROUND, 50, 1);
    expect(d).toBe(b);
    expect(d.u.buffer).toBe(b.u.buffer);
    const e = hr.fill(s, GROUND, 50, 1);
    expect(e).toBe(a);
    expect(Float32Array.from(e.u)).toEqual(aBefore); // the same height gives the same picture in either storage
    expect(a.u.buffer.byteLength).toBeGreaterThanOrEqual((2 * 60 - 1) ** 2 * 4); // made for the largest case
  });

  it('grows, rather than fail, for a model of more than 60 columns', () => {
    const grid = makeGridSpec(ORIGIN, 70 * 100, 100);
    const atm = makeAirView({ grid, baseM: BASE, nz: 6, u: () => 5, v: () => 1 });
    const r = new HeightRaster(60).fill(new AtmosphereSampler(atm, BASE, null), GROUND, 100, 2);
    expect(r.grid.nx).toBe(2 * 69 + 1);
    expect(r.u[0]).toBeCloseTo(5, 5);
    expect(r.v[r.v.length - 1]).toBeCloseTo(1, 5);
  });

  it('without an air view it fills the ambient wind with its profile over the ground grid', () => {
    const ambient = { windSpeed10: 10, windDir10: 270 } as unknown as WeatherHour; // from the west: u = +10
    const s = new AtmosphereSampler(null, BASE, ambient);
    const r = new HeightRaster().fill(s, GROUND, 300, 1);
    expect(r.grid.nx).toBe(GROUND.grid.nx);
    expect(r.u[1234]).toBeCloseTo(10 * profileFactor(300), 4);
    expect(Math.abs(r.v[1234]!)).toBeLessThan(1e-4);
  });

  it('refills without allocating: 200 fills grow the heap by almost nothing', () => {
    v8.setFlagsFromString('--expose-gc');
    const gc = vm.runInNewContext('gc') as () => void;
    const s = new AtmosphereSampler(view(), BASE, null);
    const hr = new HeightRaster();
    for (let k = 0; k < 20; k++) hr.fill(s, GROUND, 50 + k, (1 + (k & 1)) as 1 | 2);
    gc();
    gc();
    const before = process.memoryUsage().heapUsed;
    for (let k = 0; k < 200; k++) hr.fill(s, GROUND, 50 + (k % 9) * 100, (1 + (k & 1)) as 1 | 2);
    gc();
    const grew = process.memoryUsage().heapUsed - before;
    expect(grew).toBeLessThan(64 * 1024);
  });
});

/** FNV-1a over the bytes of a raster's array: two rasters with the same hash have the same bits. */
function fnv(a: Float32Array): string {
  const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) {
    h ^= b[i]!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

describe('HeightRaster in slices', () => {
  // Hashes of the one-shot fill as it was before the fill became resumable (the 0.5.0 tree at c916f10), for the same air and ground as
  // `view()` and GROUND above. They pin that cutting the fill into rows changes no bit; they are not to be re-baselined.
  const BEFORE: Record<string, string> = {
    '1 50': '45x45 u bda2eb39 v ccf70878',
    '1 300': '45x45 u ad73012a v 5b20f34c',
    '1 2000': '45x45 u 38ca0402 v 3444510d',
    '2 50': '89x89 u ac0d1c2f v b61c66c4',
    '2 300': '89x89 u 1a9dc65f v 057464e0',
    '2 2000': '89x89 u e3d98aab v 76ea98f8',
  };
  const sig = (r: { grid: { nx: number; ny: number }; u: Float32Array; v: Float32Array }): string => `${r.grid.nx}x${r.grid.ny} u ${fnv(r.u)} v ${fnv(r.v)}`;

  /** A sampler whose every wind lookup costs `ms` of a fake clock: a texel has a price, so the length of a slice can be asserted exactly. */
  function priced(ms: number, air = view()): { sampler: AtmosphereSampler; clock: { t: number } } {
    const sampler = new AtmosphereSampler(air, BASE, null);
    const clock = { t: 0 };
    const real = sampler.windP.bind(sampler);
    sampler.windP = (pos, out) => {
      clock.t += ms;
      real(pos, out);
    };
    return { sampler, clock };
  }

  it('the one-shot fill gives the very bits of the build before it was resumable', () => {
    const s = new AtmosphereSampler(view(), BASE, null);
    const hr = new HeightRaster();
    for (const refine of [1, 2] as const) for (const h of [50, 300, 2000]) expect(sig(hr.fill(s, GROUND, h, refine)), `refine ${refine} at ${h} m`).toBe(BEFORE[`${refine} ${h}`]);
  });

  for (const refine of [1, 2] as const) {
    it(`refine ${refine}: cut into slices of any size (a batch of rows, a few, the lot) it gives the same bits as before`, () => {
      const hr = new HeightRaster();
      for (const budget of [0, 0.01, 0.5, 3, 1e9]) {
        for (const h of [50, 300, 2000]) {
          const { sampler, clock } = priced(0.001);
          hr.begin(sampler, GROUND, h, refine);
          let slices = 1;
          while (!hr.step(budget, () => clock.t)) {
            slices++;
            expect(hr.raster, 'a half written raster is not offered').toBeNull();
            expect(hr.busy).toBe(true);
            if (slices > 10_000) throw new Error('no progress');
          }
          expect(hr.busy).toBe(false);
          expect(sig(hr.raster!), `refine ${refine}, ${h} m, slices of ${budget} ms (${slices} of them)`).toBe(BEFORE[`${refine} ${h}`]);
        }
      }
    });
  }

  it('stops on the clock: no slice is longer than its budget by more than one batch of rows, and every slice but the last uses the budget up', () => {
    const cost = 0.001; // ms a texel
    const { sampler, clock } = priced(cost);
    const hr = new HeightRaster();
    const BUDGET = 0.4;
    for (const refine of [1, 2] as const) {
      hr.begin(sampler, GROUND, 100, refine);
      const nx = (GRID.nx - 1) * refine + 1;
      const ny = (GRID.ny - 1) * refine + 1;
      const batch = FILL_ROWS_PER_CHECK * nx * cost; // the longest a slice can run past its budget
      const lengths: number[] = [];
      for (;;) {
        const t0 = clock.t;
        const done = hr.step(BUDGET, () => clock.t);
        lengths.push(clock.t - t0);
        if (done) break;
      }
      const whole = nx * ny * cost;
      expect(lengths.length, `refine ${refine}`).toBeGreaterThan(1);
      expect(lengths.length).toBeLessThanOrEqual(Math.ceil(whole / BUDGET) + 1);
      for (const l of lengths) expect(l, `a slice of ${l.toFixed(3)} ms`).toBeLessThanOrEqual(BUDGET + batch + 1e-9);
      for (const l of lengths.slice(0, -1)) expect(l).toBeGreaterThanOrEqual(BUDGET - 1e-9);
      expect(lengths.reduce((a, b) => a + b, 0)).toBeCloseTo(whole, 6); // every texel once
    }
  });

  it('a 60 column model at half spacing (the worst case: 14,161 texels) is more than one slice at 8 ms on a slow phone, and no slice passes 8 ms by a batch of rows', () => {
    const grid = makeGridSpec(ORIGIN, 60 * 133, 133);
    const atm = makeAirView({ grid, baseM: BASE, nz: 6, u: () => 5, v: () => 1 });
    expect(atm.grid.nx).toBe(60);
    const MS = 0.0008; // 4x CPU measured 5.6 ms for 7,921 texels: 0.7 us a texel
    const { sampler, clock } = priced(MS, atm);
    const hr = new HeightRaster();
    hr.begin(sampler, GROUND, 100, 2);
    const lengths: number[] = [];
    for (;;) {
      const t0 = clock.t;
      const done = hr.step(8, () => clock.t);
      lengths.push(clock.t - t0);
      if (done) break;
    }
    expect(119 * 119 * MS).toBeGreaterThan(8); // more than one slice's worth
    expect(lengths).toHaveLength(2);
    expect(Math.max(...lengths)).toBeLessThanOrEqual(8 + FILL_ROWS_PER_CHECK * 119 * MS + 1e-9);
    expect(sig(hr.raster!).startsWith('119x119')).toBe(true);
  });

  it('always makes progress, whatever the budget (zero or negative): a call does at least one batch of rows', () => {
    const { sampler, clock } = priced(0.001);
    const hr = new HeightRaster();
    hr.begin(sampler, GROUND, 300, 1);
    const at: number[] = [];
    while (!hr.step(-5, () => clock.t)) {
      at.push(clock.t);
      if (at.length > 1000) throw new Error('no progress');
    }
    expect(at).toHaveLength(Math.ceil(GRID.ny / FILL_ROWS_PER_CHECK) - 1); // a batch of rows each; the last call finishes
    for (let i = 1; i < at.length; i++) expect(at[i]! - at[i - 1]!).toBeCloseTo(FILL_ROWS_PER_CHECK * GRID.nx * 0.001, 9);
  });

  it('does not read the clock for an unclocked step', () => {
    const s = new AtmosphereSampler(view(), BASE, null);
    const hr = new HeightRaster();
    hr.begin(s, GROUND, 50, 1);
    const never = (): number => {
      throw new Error('the clock was read');
    };
    expect(hr.step(Infinity, never)).toBe(true);
    expect(hr.raster).not.toBeNull();
  });

  it('keeps the raster of the last fill intact while the next one is under way, slice by slice', () => {
    const s = new AtmosphereSampler(view(), BASE, null);
    const hr = new HeightRaster();
    const a = hr.fill(s, GROUND, 50, 1);
    const before = fnv(a.u) + fnv(a.v);
    hr.begin(s, GROUND, 2000, 1);
    let t = 0;
    let slices = 0;
    while (!hr.step(0, () => t++)) {
      slices++;
      expect(fnv(a.u) + fnv(a.v), `after ${slices} slices`).toBe(before);
    }
    expect(slices).toBeGreaterThan(5);
    expect(fnv(a.u) + fnv(a.v)).toBe(before);
    expect(hr.raster!.u.buffer).not.toBe(a.u.buffer);
  });

  it('can be cancelled: no raster is offered, nothing is left running, and the half written storage is overwritten whole by a later fill', () => {
    const s = new AtmosphereSampler(view(), BASE, null);
    const hr = new HeightRaster();
    hr.begin(s, GROUND, 300, 2);
    expect(hr.step(0, () => 0)).toBe(false); // one batch of rows
    hr.cancel();
    expect(hr.busy).toBe(false);
    expect(hr.raster).toBeNull();
    expect(hr.step(0, () => 0)).toBe(true); // nothing to do
    // The turn after the cancelled one is the other storage; the one after that is the half written one again, and comes out whole.
    hr.fill(s, GROUND, 50, 1);
    expect(sig(hr.fill(s, GROUND, 300, 2))).toBe(BEFORE['2 300']);
  });

  it('a new begin drops the job before it: a fill never mixes two jobs', () => {
    const s = new AtmosphereSampler(view(), BASE, null);
    const hr = new HeightRaster();
    hr.begin(s, GROUND, 50, 2);
    hr.step(0, () => 0);
    hr.begin(s, GROUND, 2000, 2); // the first is abandoned half done
    expect(hr.raster).toBeNull();
    while (!hr.step(0, () => 0)) {
      // slice after slice
    }
    expect(sig(hr.raster!)).toBe(BEFORE['2 2000']);
  });

  it('allocates next to nothing when it fills in slices: 100 fills of many slices grow the heap by a few tens of kilobytes', () => {
    v8.setFlagsFromString('--expose-gc');
    const gc = vm.runInNewContext('gc') as () => void;
    const s = new AtmosphereSampler(view(), BASE, null);
    const hr = new HeightRaster();
    let t = 0;
    const clock = (): number => (t += 0.4);
    const run = (n: number): void => {
      for (let k = 0; k < n; k++) {
        hr.begin(s, GROUND, 50 + (k % 9) * 100, (1 + (k & 1)) as 1 | 2);
        while (!hr.step(1, clock)) {
          // slice after slice
        }
      }
    };
    run(20);
    gc();
    gc();
    const before = process.memoryUsage().heapUsed;
    run(100);
    gc();
    const grew = process.memoryUsage().heapUsed - before;
    expect(grew).toBeLessThan(96 * 1024);
  });
});
