/** Home density and road access rasters: synthetic inputs with known answers and the bundled Katoomba context. */
import { describe, expect, it } from 'vitest';
import { makeGridSpec } from '../core/grid';
import { EMPTY_CONTEXT, type ContextLayers, type RoadLine } from '../core/places';
import { DEMO_SITES } from '../data/demoSites';
import { loadBundledContext } from '../data/contextLayers';
import { CONTEXT_NO_DATA, contextFieldValues, distanceToLines, homeDensity, homeDensityRadius } from './contextFields';
import { NO_DATA } from './legends';

const origin = { lat: -33.7, lon: 150.3 };

function roadLine(xy: number[]): RoadLine {
  return { cls: 'local', surface: 1, xy: Float32Array.from(xy), lengthM: 0 };
}

describe('homeDensity', () => {
  const grid = makeGridSpec(origin, 2000, 20); // 100 x 100 cells, centre-symmetric about 0

  it('counts addresses within the radius of each cell centre per hectare', () => {
    // 10 homes in a tight cluster at the origin.
    const homes: number[] = [];
    for (let i = 0; i < 10; i++) homes.push(i - 5, (i % 3) - 1);
    const v = homeDensity(Float32Array.from(homes), grid);
    const disc = Math.PI * homeDensityRadius(20) ** 2 / 10000; // hectares
    const cell = (x: number, y: number): number => v[Math.round((y - grid.y0) / 20) * grid.nx + Math.round((x - grid.x0) / 20)]!;
    // A cell near the cluster sees all 10; one 100 m away also (R = 150 m); one 300 m away sees none.
    expect(cell(10, 10)).toBeCloseTo(10 / disc, 6);
    expect(cell(110, 10)).toBeCloseTo(10 / disc, 6);
    expect(cell(310, 10)).toBe(0);
    expect(cell(-490, -490)).toBe(0);
    // One home is counted by every cell centre within R of it: an integer number of cells (~ disc area / cell area).
    const edge = homeDensity(Float32Array.from([0, 0]), grid);
    const total = edge.reduce((a, b) => a + b, 0);
    expect(total * disc).toBeCloseTo(Math.round(total * disc), 2);
    expect(Math.round(total * disc)).toBeGreaterThan(150);
    expect(Math.round(total * disc)).toBeLessThan(200);
  });

  it('matches a brute-force count on random addresses', () => {
    const g = makeGridSpec(origin, 1200, 30);
    const homes = new Float32Array(600);
    let s = 12345;
    const rnd = (): number => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 600; i += 2) {
      homes[i] = (rnd() - 0.5) * 1600;
      homes[i + 1] = (rnd() - 0.5) * 1600;
    }
    const v = homeDensity(homes, g);
    const R = homeDensityRadius(30);
    const per = 10000 / (Math.PI * R * R);
    for (const [i, j] of [[0, 0], [10, 10], [39, 39], [20, 5], [3, 37]] as [number, number][]) {
      let c = 0;
      for (let k = 0; k < 300; k++) if (Math.hypot(homes[2 * k]! - (g.x0 + i * 30), homes[2 * k + 1]! - (g.y0 + j * 30)) <= R) c++;
      expect(v[j * g.nx + i]).toBeCloseTo(c * per, 4);
    }
  });

  it('is zero without homes', () => {
    expect(homeDensity(new Float32Array(0), grid).every((x) => x === 0)).toBe(true);
  });
});

describe('roadAccess', () => {
  const grid = makeGridSpec(origin, 2000, 20);
  const ctx = (roads: number[][], trails: number[][] = []): ContextLayers => ({
    ...EMPTY_CONTEXT(origin),
    roads: roads.map(roadLine),
    fireTrails: trails.map((t) => ({ xy: Float32Array.from(t), lengthM: 0 })),
  });

  it('is the distance to the nearest line, exact along axis-aligned lines and within a few % elsewhere', () => {
    const c = ctx([[-1000, 0.5, 1000, 0.5]]);
    const v = contextFieldValues('roadAccess', c, grid);
    const at = (x: number, y: number): number => v[Math.round((y - grid.y0) / 20) * grid.nx + Math.round((x - grid.x0) / 20)]!;
    // Cell rows are at y = -990 + 20 j: y = 10 is 9.5 m from the road, y = 210 is 209.5 m.
    expect(at(0, 10)).toBeCloseTo(9.5, 3);
    expect(at(300, 210)).toBeCloseTo(209.5, 0);
    expect(at(0, -390)).toBeCloseTo(390.5, 0);
    // A diagonal line: chamfer error stays small.
    const d = ctx([[-1000, -1000, 1000, 1000]]);
    const w = contextFieldValues('roadAccess', d, grid);
    const truth = (x: number, y: number): number => Math.abs(x - y) / Math.SQRT2;
    for (const [x, y] of [[250, -250], [-410, 90], [610, 10]] as [number, number][]) {
      const got = w[Math.round((y - grid.y0) / 20) * grid.nx + Math.round((x - grid.x0) / 20)]!;
      const cx = grid.x0 + Math.round((x - grid.x0) / 20) * 20;
      const cy = grid.y0 + Math.round((y - grid.y0) / 20) * 20;
      expect(Math.abs(got - truth(cx, cy))).toBeLessThan(0.08 * truth(cx, cy) + 10);
    }
  });

  it('includes fire trails and takes the nearest of several lines', () => {
    const c = ctx([[-1000, 500, 1000, 500]], [[-1000, -500, 1000, -500]]);
    const v = contextFieldValues('roadAccess', c, grid);
    const at = (y: number): number => v[Math.round((y - grid.y0) / 20) * grid.nx + 50]!;
    expect(at(-490)).toBeLessThan(20); // by the fire trail
    expect(at(490)).toBeLessThan(20); // by the road
    expect(at(10)).toBeGreaterThan(450);
    expect(at(10)).toBeLessThan(520);
  });

  it('caches by (context, grid) identity and gives no-data when there are no lines', () => {
    const c = ctx([[0, 0, 100, 0]]);
    expect(contextFieldValues('roadAccess', c, grid)).toBe(contextFieldValues('roadAccess', c, grid));
    expect(contextFieldValues('roadAccess', c, makeGridSpec(origin, 2000, 20))).not.toBe(contextFieldValues('roadAccess', c, grid));
    const none = contextFieldValues('roadAccess', ctx([]), grid);
    expect(none[0]).toBe(CONTEXT_NO_DATA);
    expect(CONTEXT_NO_DATA).toBe(NO_DATA);
  });

  it('handles points and grids without any line inside', () => {
    const v = distanceToLines([Float32Array.from([5000, 5000, 6000, 6000])], grid);
    expect(v.every((x) => x > 4000)).toBe(true);
    const p = distanceToLines([Float32Array.from([10, 10])], grid);
    expect(Math.min(...p)).toBeLessThan(15);
  });
});

describe('bundled Katoomba context', () => {
  const kat = DEMO_SITES.find((s) => s.id === 'katoomba')!;

  it('gives plausible home density and road access, fast, on a 300 x 300 grid', async () => {
    const c = await loadBundledContext('katoomba', kat.centre);
    expect(c).not.toBeNull();
    const grid = makeGridSpec(kat.centre, 9000, 30); // 300 x 300
    expect(grid.nx * grid.ny).toBe(90000);
    const t0 = performance.now();
    const hd = contextFieldValues('homeDensity', c!, grid);
    const t1 = performance.now();
    const ra = contextFieldValues('roadAccess', c!, grid);
    const t2 = performance.now();
    expect(t1 - t0).toBeLessThan(250); // spec: < 40 ms on a desktop; slack for a loaded test machine
    expect(t2 - t1).toBeLessThan(250);
    // Town: some cells have several homes per hectare; the bush has none. Homes 7368 within a 3 km town.
    let max = 0;
    let zero = 0;
    for (const v of hd) {
      if (v > max) max = v;
      if (v === 0) zero++;
    }
    expect(max).toBeGreaterThan(5);
    expect(max).toBeLessThan(40);
    expect(zero / hd.length).toBeGreaterThan(0.3);
    // Road access: most of the bush is within a couple of km of a track; never negative, finite everywhere.
    let far = 0;
    let onRoad = 0;
    for (const v of ra) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      if (v > far) far = v;
      if (v < 15) onRoad++;
    }
    expect(far).toBeGreaterThan(300);
    expect(far).toBeLessThan(4500);
    expect(onRoad / ra.length).toBeGreaterThan(0.05);
    // Sum of homes counted equals homes x cells in the disc: a rough check that the total is consistent.
    const R = homeDensityRadius(30);
    const cellsPerDisc = (Math.PI * R * R) / (30 * 30);
    let sum = 0;
    for (const v of hd) sum += (v * (Math.PI * R * R)) / 10000;
    const inside = c!.homes.length / 2;
    expect(sum / cellsPerDisc).toBeGreaterThan(inside * 0.85);
    expect(sum / cellsPerDisc).toBeLessThan(inside * 1.15);
  });
});
