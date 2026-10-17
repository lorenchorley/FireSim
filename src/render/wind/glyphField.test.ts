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
import { HeightRaster, REFINE_CELL_PX, refineFor, surfaceRaster } from './glyphField';
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
