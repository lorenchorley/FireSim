import { describe, expect, it } from 'vitest';
import { FIRE_WIND_FIXED_BYTES, FIRE_WIND_QUANTUM, FIRE_WIND_TARGET_CELL_M, decodeFireWind, fireWindBlock, fireWindBytes, fireWindBytesModel, fireWindGrid } from './fireWind';
import { makeGridSpec, type GridSpec } from './grid';
import type { FireWindRaster } from './types';

const ORIGIN = { lat: -33.7, lon: 150.3 };

/** A square fire grid of `extentM` metres at `cs`. */
const fireGrid = (extentM: number, cs: number): GridSpec => makeGridSpec(ORIGIN, extentM, cs);

/** What the publisher will make: the picture of a fire grid, filled with `q(k)` (an Int16 value) in u and `-q(k)` in v. */
function picture(g: GridSpec, q: (k: number) => number = (k) => k): FireWindRaster {
  const k = fireWindBlock(g.cellSize);
  const grid = fireWindGrid(g, k);
  const n = grid.nx * grid.ny;
  const u = new Int16Array(n);
  const v = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    u[i] = q(i);
    v[i] = -q(i);
  }
  return { grid, u, v, block: k, time: 600 };
}

describe('the constants', () => {
  it('are the contract numbers', () => {
    expect(FIRE_WIND_QUANTUM).toBe(0.01);
    expect(FIRE_WIND_TARGET_CELL_M).toBe(60);
    expect(FIRE_WIND_FIXED_BYTES).toBe(64);
  });
});

describe('fireWindBlock', () => {
  it('is max(1, round(60 / cell size)): 2 at 30 m, 3 at 20 m, 2 at 25 and 40 m', () => {
    expect(fireWindBlock(30)).toBe(2);
    expect(fireWindBlock(20)).toBe(3);
    expect(fireWindBlock(25)).toBe(2);
    expect(fireWindBlock(40)).toBe(2);
    expect(fireWindBlock(10)).toBe(6);
  });

  it('is 1 (no blocking) from 41 m up, and for a size that is not a size', () => {
    for (const cs of [41, 60, 100, 120, 300]) expect(fireWindBlock(cs), `${cs} m`).toBe(1);
    for (const cs of [0, -30, Number.NaN, Infinity]) expect(fireWindBlock(cs), `${cs}`).toBe(1);
  });

  it('is always a whole number of at least 1', () => {
    for (let cs = 5; cs <= 200; cs += 0.5) {
      const k = fireWindBlock(cs);
      expect(Number.isInteger(k) && k >= 1, `${cs} m`).toBe(true);
    }
  });
});

describe('fireWindGrid', () => {
  it('halves a 30 m grid: 100 x 100 becomes 50 x 50 cells of 60 m, the first centre 15 m in from the first fire cell', () => {
    const g = fireGrid(3000, 30);
    expect([g.nx, g.ny]).toEqual([100, 100]);
    const f = fireWindGrid(g, 2);
    expect([f.nx, f.ny, f.cellSize]).toEqual([50, 50, 60]);
    expect(f.x0).toBeCloseTo(g.x0 + 15, 9);
    expect(f.y0).toBeCloseTo(g.y0 + 15, 9);
  });

  it('puts every block centre at the middle of the cells it averages, for any k', () => {
    const g = fireGrid(3000, 20);
    for (const k of [1, 2, 3, 4, 5]) {
      const f = fireWindGrid(g, k);
      for (const b of [0, 1, 7, f.nx - 1]) {
        const first = g.x0 + b * k * g.cellSize; // the block's first fire cell
        const last = first + (k - 1) * g.cellSize; // its last (an edge block with fewer cells keeps its nominal centre)
        expect(f.x0 + b * f.cellSize, `k ${k} block ${b}`).toBeCloseTo((first + last) / 2, 9);
      }
    }
  });

  it('takes the blocks that are partly outside the grid too: ceil(n / k) a side, so no cell is dropped', () => {
    const g: GridSpec = { nx: 101, ny: 7, cellSize: 30, x0: -1500, y0: -90, origin: ORIGIN };
    const f = fireWindGrid(g, 2);
    expect([f.nx, f.ny]).toEqual([51, 4]);
    expect(f.nx * 2).toBeGreaterThanOrEqual(g.nx);
    expect(fireWindGrid({ ...g, nx: 300, ny: 300, cellSize: 20 }, 3).nx).toBe(100);
  });

  it('is the same grid at k = 1, and copies the origin rather than sharing it', () => {
    const g = fireGrid(1200, 30);
    const f = fireWindGrid(g, 1);
    expect(f).toEqual(g);
    expect(f.origin).not.toBe(g.origin);
    expect(fireWindGrid(g, 2).origin).toEqual(g.origin);
  });
});

describe('the bytes', () => {
  it('fireWindBytes is 0 for no picture, else both arrays and the fixed part', () => {
    expect(fireWindBytes(undefined)).toBe(0);
    const fw = picture(fireGrid(3000, 30));
    expect(fireWindBytes(fw)).toBe(2 * 2 * 50 * 50 + 64);
    expect(fireWindBytes(fw)).toBe(fw.u.byteLength + fw.v.byteLength + FIRE_WIND_FIXED_BYTES);
  });

  it("fireWindBytesModel matches the contract's table (3 km 30 m, 6 km 30 m, 6 km 20 m, 12 km 30 m)", () => {
    expect(fireWindBytesModel(100, 100, 30)).toBe(10_064);
    expect(fireWindBytesModel(200, 200, 30)).toBe(40_064);
    expect(fireWindBytesModel(300, 300, 20)).toBe(40_064);
    expect(fireWindBytesModel(400, 400, 30)).toBe(160_064);
  });

  it('the model equals the bytes of a real picture, for a spread of grids and cell sizes', () => {
    for (const [extent, cs] of [
      [3000, 30],
      [6000, 30],
      [6000, 20],
      [4000, 25],
      [8000, 40],
      [9000, 60],
      [1500, 10],
    ] as const) {
      const g = fireGrid(extent, cs);
      expect(fireWindBytesModel(g.nx, g.ny, g.cellSize), `${extent} m at ${cs} m`).toBe(fireWindBytes(picture(g)));
    }
    // An odd-sized grid, with partial edge blocks.
    const odd: GridSpec = { nx: 101, ny: 53, cellSize: 30, x0: 0, y0: 0, origin: ORIGIN };
    expect(fireWindBytesModel(odd.nx, odd.ny, odd.cellSize)).toBe(fireWindBytes(picture(odd)));
  });
});

describe('decodeFireWind', () => {
  it('multiplies by the quantum, into Float32', () => {
    const fw = picture(fireGrid(300, 30), (k) => [0, 1, -1, 123, -250, 32767, -32767, 5][k % 8]!);
    const d = decodeFireWind(fw);
    expect(d.u).toBeInstanceOf(Float32Array);
    expect(d.u.length).toBe(fw.u.length);
    for (let k = 0; k < fw.u.length; k++) {
      expect(d.u[k], `u ${k}`).toBe(Math.fround(fw.u[k]! * 0.01)); // exactly q x 0.01, rounded to Float32
      expect(d.v[k], `v ${k}`).toBe(Math.fround(fw.v[k]! * 0.01));
    }
    expect(Math.max(...d.u)).toBeCloseTo(327.67, 4); // the range: Int16 at 0.01 m/s covers 327 m/s
    expect(Math.min(...d.v)).toBeCloseTo(-327.67, 4);
  });

  it('returns the picture\'s own grid', () => {
    const fw = picture(fireGrid(600, 30));
    expect(decodeFireWind(fw).grid).toBe(fw.grid);
  });

  it('round trip: a value encoded as round(x x 100) comes back within half a quantum (0.005 m/s) and Float32 rounding', () => {
    const xs = [0, 0.004, 0.005, 0.006, 1.2345, -1.2345, 7.77, -12.3456, 33.333, 99.999, -250.001];
    const fw = picture(fireGrid(120, 30), () => 0);
    expect(fw.u.length).toBeGreaterThanOrEqual(1);
    for (const x of xs) {
      fw.u[0] = Math.round(x * 100);
      const back = decodeFireWind(fw).u[0]!;
      expect(Math.abs(back - x), `${x}`).toBeLessThanOrEqual(0.005 + 1e-5);
    }
  });

  it('allocates nothing when `out` holds the picture: it fills those arrays and returns them', () => {
    const fw = picture(fireGrid(600, 30), (k) => k - 100);
    const out = { u: new Float32Array(fw.u.length), v: new Float32Array(fw.v.length) };
    const d = decodeFireWind(fw, out);
    expect(d.u).toBe(out.u);
    expect(d.v).toBe(out.v);
    expect(out.u[7]).toBeCloseTo((7 - 100) * 0.01, 5);
    expect(out.v[7]).toBeCloseTo(-(7 - 100) * 0.01, 5);
  });

  it('fills only the first n entries of longer arrays, and leaves the rest as they were', () => {
    const fw = picture(fireGrid(300, 30), () => 100);
    const n = fw.u.length;
    const out = { u: new Float32Array(n + 5).fill(9), v: new Float32Array(n + 5).fill(9) };
    const d = decodeFireWind(fw, out);
    expect(d.u).toBe(out.u);
    expect(out.u[n - 1]).toBeCloseTo(1, 5);
    expect(out.u[n]).toBe(9);
    expect(out.v[n + 4]).toBe(9);
  });

  it('makes fresh arrays (and leaves `out` alone) when an array of `out` is too small', () => {
    const fw = picture(fireGrid(300, 30), () => 100);
    const n = fw.u.length;
    const out = { u: new Float32Array(n - 1).fill(9), v: new Float32Array(n) };
    const d = decodeFireWind(fw, out);
    expect(d.u).not.toBe(out.u);
    expect(d.u.length).toBe(n);
    expect(d.u[n - 1]).toBeCloseTo(1, 5);
    expect(out.u[0]).toBe(9);
    expect(d.v).toBe(out.v); // the other one fits, and is reused
  });

  it('decodes an empty picture to empty arrays', () => {
    const fw: FireWindRaster = { grid: { nx: 0, ny: 0, cellSize: 60, x0: 0, y0: 0, origin: ORIGIN }, u: new Int16Array(0), v: new Int16Array(0), block: 2, time: 0 };
    const d = decodeFireWind(fw);
    expect(d.u.length).toBe(0);
    expect(d.v.length).toBe(0);
  });
});
