import { describe, expect, it } from 'vitest';
import { FIRE_WIND_FIXED_BYTES, FIRE_WIND_QUANTUM, FIRE_WIND_TARGET_CELL_M, decodeFireWind, fireWindBlock, fireWindBytes, fireWindBytesModel, fireWindGrid } from './fireWind';
import { makeGridSpec, type GridSpec } from './grid';
import type { FireWindRaster } from './types';
import { publishFireWind } from '../sim/fireWindPublish';

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

// ─────────────────────────────────────────────────────────────────────────────
// Publishing (sim/fireWindPublish.ts, 0.7.0 lane D): the block mean of the fire-grid wind, quantised
// ─────────────────────────────────────────────────────────────────────────────

/** A deterministic field of `n` values in [lo, hi) from a fixed LCG (never Math.random). */
function field(n: number, lo: number, hi: number, seed: number): Float32Array {
  const out = new Float32Array(n);
  let s = seed >>> 0;
  for (let k = 0; k < n; k++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[k] = lo + (hi - lo) * (s / 4294967296);
  }
  return out;
}

/** The oracle: the mean of the fire cells of block (bi, bj), a plain loop over the cells that exist (an edge block has fewer). */
function blockMean(g: GridSpec, a: Float32Array, k: number, bi: number, bj: number): number {
  let sum = 0;
  let n = 0;
  for (let j = bj * k; j < Math.min(g.ny, (bj + 1) * k); j++) {
    for (let i = bi * k; i < Math.min(g.nx, (bi + 1) * k); i++) {
      sum += a[j * g.nx + i]!;
      n++;
    }
  }
  return sum / n;
}

describe('publishFireWind: the block mean', () => {
  const cases: [string, GridSpec][] = [
    ['3 km at 30 m', fireGrid(3000, 30)],
    ['2.4 km at 20 m (blocks of 3)', fireGrid(2400, 20)],
    ['2.5 km at 25 m', fireGrid(2500, 25)],
    ['4 km at 40 m', fireGrid(4000, 40)],
    ['an odd grid with partial blocks at both edges (101 x 53 at 30 m)', { nx: 101, ny: 53, cellSize: 30, x0: -1500, y0: -780, origin: ORIGIN }],
    ['partial blocks at 20 m (100 x 31, blocks of 3)', { nx: 100, ny: 31, cellSize: 20, x0: -990, y0: -300, origin: ORIGIN }],
  ];

  for (const [name, g] of cases) {
    it(`is the mean of the fire cells of each block, rounded to 0.01 m/s, for ${name}`, () => {
      const u = field(g.nx * g.ny, -12, 25, 7);
      const v = field(g.nx * g.ny, -30, 9, 11);
      const fw = publishFireWind(g, u, v, 1234);
      const k = fireWindBlock(g.cellSize);
      expect(fw.block).toBe(k);
      expect(fw.time).toBe(1234);
      expect(fw.grid).toEqual(fireWindGrid(g, k));
      expect(fw.u).toBeInstanceOf(Int16Array);
      expect(fw.v).toBeInstanceOf(Int16Array);
      expect(fw.u.length).toBe(fw.grid.nx * fw.grid.ny);
      expect(fw.v.length).toBe(fw.u.length);
      for (let bj = 0; bj < fw.grid.ny; bj++) {
        for (let bi = 0; bi < fw.grid.nx; bi++) {
          const o = bj * fw.grid.nx + bi;
          const mu = blockMean(g, u, k, bi, bj);
          const mv = blockMean(g, v, k, bi, bj);
          expect(fw.u[o], `u block ${bi},${bj}`).toBe(Math.round(mu * 100) + 0); // + 0: an Int16 has no negative zero
          expect(fw.v[o], `v block ${bi},${bj}`).toBe(Math.round(mv * 100) + 0);
          // The stated error: at most half a quantum (0.005 m/s) from the exact mean.
          expect(Math.abs(fw.u[o]! * FIRE_WIND_QUANTUM - mu), `u error ${bi},${bj}`).toBeLessThanOrEqual(0.005 + 1e-9);
          expect(Math.abs(fw.v[o]! * FIRE_WIND_QUANTUM - mv), `v error ${bi},${bj}`).toBeLessThanOrEqual(0.005 + 1e-9);
        }
      }
    });
  }

  it('is a mean, not a point sample: a one-cell spike in a block of four is a quarter of it', () => {
    const g = fireGrid(300, 30); // 10 x 10, blocks of 2
    const u = new Float32Array(100);
    const v = new Float32Array(100).fill(-3);
    u[0] = 20; // the first cell of the first block
    const fw = publishFireWind(g, u, v, 0);
    expect(fw.u[0]).toBe(500); // 20 / 4 = 5 m/s
    expect(fw.u[1]).toBe(0);
    expect(fw.v[0]).toBe(-300);
    expect(fw.v[fw.v.length - 1]).toBe(-300);
  });

  it('an edge block averages only the cells it has (an odd grid is not diluted by cells that are not there)', () => {
    const g: GridSpec = { nx: 5, ny: 3, cellSize: 30, x0: 0, y0: 0, origin: ORIGIN }; // blocks of 2: 3 x 2 blocks, the last column and row are single cells
    const u = new Float32Array(15).fill(4);
    for (let j = 0; j < 3; j++) u[j * 5 + 4] = 10; // the last column
    const fw = publishFireWind(g, u, new Float32Array(15), 0);
    expect([fw.grid.nx, fw.grid.ny]).toEqual([3, 2]);
    expect(Array.from(fw.u)).toEqual([400, 400, 1000, 400, 400, 1000]); // the column of single cells reads 10 m/s, not 5
  });

  it('puts each block value at its own centre: on a linear field the picture equals the field at the block centres', () => {
    // u = 3 + 0.004 x, v = -2 + 0.002 y (m/s, x and y in metres): the mean over a block is the value at the middle of its cells.
    const g = fireGrid(3000, 30);
    const u = new Float32Array(g.nx * g.ny);
    const v = new Float32Array(g.nx * g.ny);
    for (let j = 0; j < g.ny; j++) {
      for (let i = 0; i < g.nx; i++) {
        u[j * g.nx + i] = 3 + 0.004 * (g.x0 + i * g.cellSize);
        v[j * g.nx + i] = -2 + 0.002 * (g.y0 + j * g.cellSize);
      }
    }
    const fw = publishFireWind(g, u, v, 0);
    const f = fw.grid;
    for (const [bi, bj] of [[0, 0], [1, 2], [20, 30], [f.nx - 1, f.ny - 1], [f.nx >> 1, f.ny >> 1]] as const) {
      const x = f.x0 + bi * f.cellSize;
      const y = f.y0 + bj * f.cellSize;
      expect(Math.abs(fw.u[bj * f.nx + bi]! * 0.01 - (3 + 0.004 * x)), `u at ${x},${y}`).toBeLessThanOrEqual(0.0051);
      expect(Math.abs(fw.v[bj * f.nx + bi]! * 0.01 - (-2 + 0.002 * y)), `v at ${x},${y}`).toBeLessThanOrEqual(0.0051);
    }
  });

  it('does not block from 41 m up: the picture is the field itself, quantised', () => {
    const g = fireGrid(2000, 50);
    const u = field(g.nx * g.ny, -5, 5, 3);
    const fw = publishFireWind(g, u, u, 0);
    expect(fw.block).toBe(1);
    expect(fw.grid).toEqual(g);
    for (let k = 0; k < u.length; k++) expect(fw.u[k]).toBe(Math.round(u[k]! * 100) + 0);
  });
});

describe('publishFireWind: the quantisation', () => {
  const one: GridSpec = { nx: 2, ny: 2, cellSize: 30, x0: 0, y0: 0, origin: ORIGIN }; // one block
  const of = (x: number): FireWindRaster => publishFireWind(one, new Float32Array(4).fill(x), new Float32Array(4).fill(-x), 0);

  it('rounds to the nearest 0.01 m/s, in both signs', () => {
    expect(of(0.004).u[0]).toBe(0);
    expect(of(0.006).u[0]).toBe(1);
    expect(of(-0.006).v[0]).toBe(1); // v is -x
    expect(of(-0.006).u[0]).toBe(-1);
    expect(of(12.344).u[0]).toBe(1234);
    expect(of(12.346).u[0]).toBe(1235);
    expect(of(-7.777).u[0]).toBe(-778);
    expect(of(0).u[0]).toBe(0);
    expect(Object.is(of(-0.001).u[0], -0)).toBe(false); // an Int16 has no negative zero
  });

  it('clamps to +-32767 (+-327.67 m/s), symmetrically', () => {
    expect(of(400).u[0]).toBe(32767);
    expect(of(400).v[0]).toBe(-32767);
    expect(of(1e9).u[0]).toBe(32767);
    expect(of(-1e9).u[0]).toBe(-32767);
    expect(of(327.67).u[0]).toBe(32767);
    expect(of(327.6).u[0]).toBe(32760);
  });

  it('a non-finite mean is 0, and only the block that has it', () => {
    const g = fireGrid(300, 30); // 10 x 10, blocks of 2
    const u = new Float32Array(100).fill(2);
    const v = new Float32Array(100).fill(3);
    u[0] = Number.NaN; // block 0 of u
    v[11] = Infinity; // cell (1, 1): still block 0 of v
    v[2] = -Infinity; // block 1 of v
    const fw = publishFireWind(g, u, v, 0);
    expect([fw.u[0], fw.v[0], fw.v[1]]).toEqual([0, 0, 0]);
    expect([fw.u[1], fw.u[2], fw.v[2]]).toEqual([200, 200, 300]);
  });
});

describe('publishFireWind: what it promises the engine', () => {
  it('is a pure read: the inputs are not written, and two calls give the same bytes in new buffers', () => {
    const g = fireGrid(3000, 30);
    const u = field(g.nx * g.ny, -10, 30, 5);
    const v = field(g.nx * g.ny, -10, 30, 6);
    const u0 = u.slice();
    const v0 = v.slice();
    const a = publishFireWind(g, u, v, 60);
    const b = publishFireWind(g, u, v, 60);
    expect(Array.from(u)).toEqual(Array.from(u0));
    expect(Array.from(v)).toEqual(Array.from(v0));
    expect(Array.from(a.u)).toEqual(Array.from(b.u));
    expect(Array.from(a.v)).toEqual(Array.from(b.v));
    expect(a.u.buffer).not.toBe(b.u.buffer);
    expect(a.u.buffer).not.toBe(u.buffer);
    expect(a.u.buffer).not.toBe(a.v.buffer);
    expect(a.grid).not.toBe(g); // a grid of its own, with its own origin (the snapshot is transferred; the engine keeps its grid)
    expect(a.grid.origin).not.toBe(g.origin);
  });

  it('allocates its picture only: the result is as many bytes as the model says, for the grids of the contract table', () => {
    for (const [extent, cs] of [[3000, 30], [6000, 30], [6000, 20], [12000, 30]] as const) {
      const g = fireGrid(extent, cs);
      const z = new Float32Array(g.nx * g.ny);
      expect(fireWindBytes(publishFireWind(g, z, z, 0)), `${extent} m at ${cs} m`).toBe(fireWindBytesModel(g.nx, g.ny, g.cellSize));
    }
  });

  it('copes with an empty grid', () => {
    const g: GridSpec = { nx: 0, ny: 0, cellSize: 30, x0: 0, y0: 0, origin: ORIGIN };
    const fw = publishFireWind(g, new Float32Array(0), new Float32Array(0), 5);
    expect([fw.u.length, fw.v.length, fw.time]).toEqual([0, 0, 5]);
  });

  it('costs a few milliseconds at 12 km (the number is logged; the bound only catches an accidental blow-up)', () => {
    const g = fireGrid(12000, 30); // 400 x 400, the largest area
    const u = field(g.nx * g.ny, -5, 15, 21);
    const v = field(g.nx * g.ny, -5, 15, 22);
    for (let w = 0; w < 20; w++) publishFireWind(g, u, v, 0);
    const ms: number[] = [];
    for (let r = 0; r < 25; r++) {
      const t0 = performance.now();
      publishFireWind(g, u, v, 0);
      ms.push(performance.now() - t0);
    }
    ms.sort((a, b) => a - b);
    console.info(`publishFireWind 12 km, 400 x 400 -> 200 x 200: median ${ms[12]!.toFixed(2)} ms, best ${ms[0]!.toFixed(2)} ms`);
    expect(ms[12]!).toBeLessThan(40);
  });
});
