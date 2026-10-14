import { describe, expect, it } from 'vitest';
import { makeGridSpec, resample, type GridSpec } from '../core/grid';
import { hornSlopeDeg } from './cliffSharpen';
import { ROCK_MASK_DEFAULTS, buildRockMask, rockCopy, sampleRock, type RockField, type RockMask } from './rockMask';
import { ORIGIN, flatGrid, terrainOf } from './testing/cliffs';

const TAN = (deg: number): number => Math.tan((deg * Math.PI) / 180);

/** Piecewise-linear height along x (m) through the points, then `after` m of rise per metre beyond the last one. */
function profile(points: [number, number][], after = 0): (x: number) => number {
  return (x) => {
    if (x <= points[0]![0]) return points[0]![1];
    for (let p = 1; p < points.length; p++) {
      const [x1, z1] = points[p]!;
      const [x0, z0] = points[p - 1]!;
      if (x <= x1) return z0 + ((z1 - z0) * (x - x0)) / (x1 - x0);
    }
    const [xl, zl] = points[points.length - 1]!;
    return zl + after * (x - xl);
  };
}

/**
 * Three layouts along x on a 120 x 24 grid of 10 m cells (cell i is at x = 10 i m): a plateau, a 70 degree face of 150 m that
 * starts at x = 400 m and runs 54.6 m, and then either a 30 degree talus slope for 300 m (`talus`) or a flat foot (`flatFoot`).
 * `rampToLip` has the plateau rising at 30 degrees to the lip instead, so the rock lies downhill of it.
 */
const FACE_RUN = 150 / TAN(70);
const talus = profile(
  [
    [0, 600],
    [400, 600],
    [400 + FACE_RUN, 450],
    [400 + FACE_RUN + 300, 450 - 300 * TAN(30)],
  ],
  -0.03,
);
const flatFoot = profile(
  [
    [0, 600],
    [400, 600],
    [400 + FACE_RUN, 450],
  ],
  0,
);
const rampToLip = profile(
  [
    [0, 500],
    [300, 500],
    [400, 500 + 100 * TAN(30)],
    [400 + FACE_RUN, 500 + 100 * TAN(30) - 150],
  ],
  0,
);

const g = flatGrid(120, 24);
const alongX = (f: (x: number) => number): Float32Array => terrainOf(g, (i) => f(i * 10));

const maskOf = (z: Float32Array, cover?: RockField | null): RockMask => buildRockMask({ grid: g, elevation: z, slope: { grid: g, values: hornSlopeDeg(g, z) }, cover: cover ?? null });
/** Channel c (0 R, 1 G, 2 B) in [0, 1] of the cell at column i (row 12 unless given). */
const ch = (m: RockMask, c: number, i: number, j = 12): number => m.rgba[(j * m.grid.nx + i) * 4 + c]! / 255;
const field = (grid: GridSpec, v: (i: number, j: number) => number): RockField => ({ grid, values: terrainOf(grid, v) });
const allZeroExceptAlpha = (m: RockMask): boolean => m.rgba.every((v, k) => (k % 4 === 3 ? v === 255 : v === 0));

describe('buildRockMask', () => {
  it('R: bare steep rock on the face, none on the plateau, the talus slope or the foot', () => {
    const m = maskOf(alongX(talus));
    for (const i of [42, 43, 44]) expect(ch(m, 0, i)).toBeGreaterThan(0.9);
    for (const i of [2, 20, 35, 36, 50, 52, 60, 80, 100]) expect(ch(m, 0, i)).toBe(0);
    const perRow = Array.from({ length: g.nx }, (_, i) => i).filter((i) => ch(m, 0, i) >= 0.5).length;
    expect(perRow).toBeGreaterThanOrEqual(4);
    expect(m.stats.rockCells).toBe(perRow * g.ny);
  });

  it('R follows smoothstep(52, 62, slope) of whatever slope the caller gives, and the limits are options', () => {
    const ramp = flatGrid(32, 4);
    const slope = terrainOf(ramp, (i) => 40 + i); // 40 to 71 degrees across the cells
    const input = { grid: ramp, elevation: terrainOf(ramp, () => 0), slope: { grid: ramp, values: slope } };
    const m = buildRockMask(input);
    for (let i = 0; i < 32; i++) {
      const t = Math.min(1, Math.max(0, (40 + i - 52) / 10));
      expect(Math.abs(ch(m, 0, i, 1) - t * t * (3 - 2 * t))).toBeLessThanOrEqual(1 / 255 + 1e-9);
    }
    const tight = buildRockMask(input, { loDeg: 60, hiDeg: 70 });
    expect(ch(tight, 0, 15, 1)).toBe(0); // 55 degrees
    expect(ch(tight, 0, 31, 1)).toBeGreaterThan(0.95); // 71 degrees
    // a cell with no slope is no rock
    const nan = Float32Array.from(slope);
    nan[ramp.nx + 28] = NaN;
    expect(ch(m, 0, 28, 1)).toBeGreaterThan(0.9);
    expect(ch(buildRockMask({ ...input, slope: { grid: ramp, values: nan } }), 0, 28, 1)).toBe(0);
  });

  it('G: scree on the 22 to 40 degree slope below the face within 80 m of rock, none further down, none where the rock is downhill', () => {
    const m = maskOf(alongX(talus));
    // the last rock cell is at x = 450 m; the talus starts at x = 455 m
    for (const i of [48, 49, 50]) expect(ch(m, 1, i)).toBeGreaterThan(0.5);
    expect(ch(m, 1, 48)).toBeGreaterThan(ch(m, 1, 53)); // fades with the distance from the rock
    for (const i of [62, 68, 74]) expect(ch(m, 1, i)).toBe(0); // the slope is still in the window, but there is no rock within 80 m uphill
    // never on the plateau, the face or ground that is too flat
    for (const i of [10, 30, 43, 44, 100]) expect(ch(m, 1, i)).toBe(0);
    // a 30 degree ramp up to the lip has the rock below it, not above it: no scree there
    const mr = maskOf(alongX(rampToLip));
    expect(ch(mr, 0, 43)).toBeGreaterThan(0.9);
    for (const i of [31, 34, 37]) expect(ch(mr, 1, i)).toBe(0);
  });

  it('B: pavement on flat ground within 40 m of rock that lies below it (the top of a face), and not at the foot', () => {
    const m = maskOf(alongX(talus));
    for (const i of [38, 39]) expect(ch(m, 2, i)).toBeGreaterThan(0.5);
    expect(ch(m, 2, 39)).toBeGreaterThan(ch(m, 2, 37)); // fades with the distance
    for (const i of [5, 15, 25, 30]) expect(ch(m, 2, i)).toBe(0); // beyond 40 m of rock
    for (const i of [43, 44, 50, 55]) expect(ch(m, 2, i)).toBe(0); // the face and the talus are not pavement
    // a face with a flat foot and no talus: the foot lies within 40 m of rock, but the rock is above it
    const mf = maskOf(alongX(flatFoot));
    expect(ch(mf, 0, 43)).toBeGreaterThan(0.9);
    for (const i of [38, 39]) expect(ch(mf, 2, i)).toBeGreaterThan(0.5);
    for (const i of [47, 48, 50, 52, 55]) expect(ch(mf, 2, i)).toBe(0);
    // a plateau that rises at 30 degrees is not pavement
    const mr = maskOf(alongX(rampToLip));
    for (const i of [36, 38]) expect(ch(mr, 2, i)).toBe(0);
  });

  it('cover removes rock: full cover leaves nothing (no scree or pavement without rock), 0.6 keeps R under 0.5, a patch clears only its patch', () => {
    const z = alongX(talus);
    const bare = maskOf(z);
    expect(bare.stats.rockCells).toBeGreaterThan(0);
    expect(allZeroExceptAlpha(maskOf(z, field(g, () => 1)))).toBe(true);
    const part = maskOf(z, field(g, () => 0.6));
    expect(part.stats.rockCells).toBe(0);
    expect(ch(part, 0, 43)).toBeCloseTo(0.4, 1);
    // cover on a 30 m grid (the fire grid's) over the northern half only, taken bilinearly onto the 10 m raster
    const g30: GridSpec = { nx: 40, ny: 8, cellSize: 30, x0: 5, y0: 5, origin: ORIGIN };
    const mh = maskOf(z, field(g30, (_i, j) => (j >= 4 ? 1 : 0)));
    expect(ch(mh, 0, 43, 2)).toBeGreaterThan(0.9); // south: no cover
    expect(ch(mh, 0, 43, 22)).toBe(0); // north: covered
    expect(mh.stats.rockCells).toBeLessThan(bare.stats.rockCells);
    expect(mh.stats.rockCells).toBeGreaterThan(0);
  });

  it('puts no cell at R of 0.5 or more under canopy cover above 0.5, for any slope and any cover', () => {
    const grid = flatGrid(60, 60);
    let s = 99;
    const rnd = (): number => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const slope = terrainOf(grid, () => 30 + 50 * rnd());
    const cover = terrainOf(grid, () => rnd());
    const m = buildRockMask({ grid, elevation: terrainOf(grid, () => 0), slope: { grid, values: slope }, cover: { grid, values: cover } });
    let rock = 0;
    for (let k = 0; k < slope.length; k++) {
      if (m.rgba[k * 4]! / 255 >= 0.5) {
        rock++;
        expect(cover[k]!).toBeLessThanOrEqual(0.5);
      }
    }
    expect(rock).toBeGreaterThan(100);
  });

  it('takes the slope on its own grid: a mesh slope on a coarser grid puts the face in the same place, and a flat slope field gives no rock', () => {
    const z = alongX(talus);
    const mesh: GridSpec = { nx: 60, ny: 12, cellSize: 20, x0: 0, y0: 0, origin: ORIGIN };
    const fine = maskOf(z);
    const coarse = buildRockMask({ grid: g, elevation: z, slope: { grid: mesh, values: hornSlopeDeg(mesh, resample(g, z, mesh)) } });
    const cols = (m: RockMask, c: number, thr: number): number[] => Array.from({ length: g.nx }, (_, i) => i).filter((i) => ch(m, c, i) >= thr);
    const a = cols(fine, 0, 0.5);
    const b = cols(coarse, 0, 0.5);
    expect(b.length).toBeGreaterThan(0);
    expect(Math.abs(Math.min(...a) - Math.min(...b))).toBeLessThanOrEqual(3);
    expect(Math.abs(Math.max(...a) - Math.max(...b))).toBeLessThanOrEqual(3);
    expect(cols(coarse, 1, 0.5).length).toBeGreaterThan(2);
    expect(cols(coarse, 2, 0.5).length).toBeGreaterThan(0);
    const flat = buildRockMask({ grid: g, elevation: z, slope: { grid: mesh, values: terrainOf(mesh, () => 10) } });
    expect(flat.stats.rockCells).toBe(0);
  });

  it('windowSlope: the scree and pavement windows can follow a different slope than R (the render mesh smooths the lip, the 10 m slope does not)', () => {
    const z = alongX(talus);
    const mesh: GridSpec = { nx: 60, ny: 12, cellSize: 20, x0: 0, y0: 0, origin: ORIGIN };
    const meshSlope: RockField = { grid: mesh, values: hornSlopeDeg(mesh, resample(g, z, mesh)) };
    const fineSlope: RockField = { grid: g, values: hornSlopeDeg(g, z) };
    const input = { grid: g, elevation: z, slope: meshSlope };
    const same = buildRockMask({ ...input, windowSlope: meshSlope });
    const split = buildRockMask({ ...input, windowSlope: fineSlope });
    // R follows the first slope either way
    for (let k = 0; k < g.nx * g.ny; k++) expect(split.rgba[k * 4]).toBe(same.rgba[k * 4]);
    // the pavement windows differ: the mesh slope is steeper than 15 degrees right up to about a vertex spacing from the lip
    const flatCells = (m: RockMask): number[] => Array.from({ length: g.nx }, (_, i) => i).filter((i) => ch(m, 2, i) > 0.5);
    expect(flatCells(split).length).toBeGreaterThan(flatCells(same).length - 1);
    expect(split.rgba.some((v, k) => k % 4 !== 0 && v !== same.rgba[k])).toBe(true);
    // absent, the windows follow the 10 m slope of the elevation, not the slope R follows (the easy call must not lose the pavement)
    const absent = buildRockMask(input);
    expect(absent.rgba.every((v, k) => v === split.rgba[k])).toBe(true);
    // with the fine slope everywhere the mask equals the one built from the fine slope alone, for G and B
    const fine = buildRockMask({ grid: g, elevation: z, slope: fineSlope });
    const both = buildRockMask({ grid: g, elevation: z, slope: fineSlope, windowSlope: fineSlope });
    expect(both.rgba.every((v, k) => v === fine.rgba[k])).toBe(true);
  });

  it('finds no scree or pavement without rock, is deterministic, and has the layout of an RGBA8 raster with A = 255', () => {
    const gentle = maskOf(terrainOf(g, (i, j) => 100 + 0.3 * i + 0.1 * j));
    expect(allZeroExceptAlpha(gentle)).toBe(true);
    const f = alongX(talus);
    const a = maskOf(f);
    const b = maskOf(f);
    expect(a.rgba.every((v, k) => v === b.rgba[k])).toBe(true);
    expect(a.rgba.length).toBe(4 * g.nx * g.ny);
    expect(a.rgba.filter((_, k) => k % 4 === 3).every((v) => v === 255)).toBe(true);
    expect(a.grid).toBe(g);
    expect(a.stats.ms).toBeGreaterThanOrEqual(0);
    expect(a.stats.screeCells).toBeGreaterThan(0);
    expect(a.stats.lipCells).toBeGreaterThan(0);
  });

  it('keeps the plan numbers as its defaults', () => {
    expect(ROCK_MASK_DEFAULTS).toMatchObject({ loDeg: 52, hiDeg: 62, screeLoDeg: 22, screeHiDeg: 40, screeReachM: 80, lipMaxDeg: 15, lipReachM: 40 });
  });

  it('is fast: a 900 x 900 raster with faces everywhere in well under a second (a generous guard)', () => {
    const big = makeGridSpec(ORIGIN, 9000, 10);
    const z = terrainOf(big, (i, j) => 600 + 160 * Math.sin(i / 37) * Math.cos(j / 53) + (Math.sin(i / 11) * Math.sin(j / 13) > 0.8 ? 90 : 0));
    const g30 = makeGridSpec(ORIGIN, 9000, 30);
    const t0 = performance.now();
    const m = buildRockMask({ grid: big, elevation: z, slope: { grid: big, values: hornSlopeDeg(big, z) }, cover: field(g30, () => 0.3) });
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(m.stats.rockCells).toBeGreaterThan(1000);
    expect(m.stats.screeCells).toBeGreaterThan(0);
    expect(m.stats.lipCells).toBeGreaterThan(0);
  });
});

describe('rockCopy and sampleRock', () => {
  it('copy exactly the R channel into a separate array and sample it bilinearly, clamped at the edge', () => {
    const m = maskOf(alongX(talus));
    const c = rockCopy(m);
    expect(c.r.length).toBe(g.nx * g.ny);
    expect(c.grid).toBe(m.grid);
    for (let k = 0; k < c.r.length; k++) expect(c.r[k]).toBe(m.rgba[k * 4]);
    c.r[0] = 77;
    expect(m.rgba[0]).not.toBe(77);
    c.r[0] = m.rgba[0]!;
    // at a cell centre it is the cell's value; between two cells it lies between them
    const x = g.x0 + 43 * g.cellSize;
    const y = g.y0 + 12 * g.cellSize;
    expect(sampleRock(c, x, y)).toBeCloseTo(c.r[12 * g.nx + 43]! / 255, 6);
    const lo = Math.min(c.r[12 * g.nx + 40]!, c.r[12 * g.nx + 41]!) / 255;
    const hi = Math.max(c.r[12 * g.nx + 40]!, c.r[12 * g.nx + 41]!) / 255;
    const mid = sampleRock(c, 405, y);
    expect(mid).toBeGreaterThanOrEqual(lo - 1e-9);
    expect(mid).toBeLessThanOrEqual(hi + 1e-9);
    expect(hi).toBeGreaterThan(lo + 0.5);
    expect(sampleRock(c, -1e6, -1e6)).toBeCloseTo(c.r[0]! / 255, 6);
  });
});
