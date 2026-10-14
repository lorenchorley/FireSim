import { describe, expect, it } from 'vitest';
import { makeGridSpec, type GridSpec } from '../core/grid';
import { hornSlopeDeg } from './cliffSharpen';
import { decimateGrid } from './fields';
import { MESH_DESPIKE_M, decimateTerrain } from './terrainMesh';
import { ORIGIN, countSpikes, decimateTerrainScan, edgeSlopes, flatGrid, maxOf, terrainOf } from './testing/cliffs';

const RAD = 180 / Math.PI;

/** Rugged terrain with steep faces and 2 % single-cell spikes, 9 km at 10 m (a whole bundled-site grid), from a fixed seed. */
function rugged(nx = 900): { g: GridSpec; z: Float32Array } {
  const g = makeGridSpec(ORIGIN, nx * 10, 10);
  let s = 777;
  const rnd = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const z = terrainOf(g, (i, j) => 500 + 160 * Math.sin(i / 37) * Math.cos(j / 53) + (Math.sin(i / 11) * Math.sin(j / 13) > 0.8 ? 90 : 0) + (rnd() < 0.02 ? (rnd() - 0.5) * 120 : 0));
  return { g, z };
}

/** The steepest mesh edge along x in the middle row of a mesh of a terrain that is a step of height H at column `cut`. */
function steepestAcrossStep(H: number, maxN: number, phaseM: number, despikeM: number): number {
  const g: GridSpec = { nx: 900, ny: 24, cellSize: 10, x0: 0, y0: 0, origin: ORIGIN };
  const cut = Math.round((4000 + phaseM) / 10); // the step lies between cells cut - 1 and cut
  const z = terrainOf(g, (i) => (i < cut ? H : 0));
  const rg = decimateTerrain(g, z, maxN, { despikeM });
  const row = Math.floor(rg.grid.ny / 2) * rg.grid.nx;
  let m = 0;
  for (let i = 0; i < rg.grid.nx - 1; i++) m = Math.max(m, Math.atan(Math.abs(rg.elevation[row + i + 1]! - rg.elevation[row + i]!) / rg.grid.cellSize) * RAD);
  return m;
}

describe('decimateTerrain', () => {
  it('is bit-identical to decimateGrid on ground under 40 degrees, at every picture tier, and returns a small grid unchanged', () => {
    const g = makeGridSpec(ORIGIN, 9000, 10);
    const z = terrainOf(g, (i, j) => 600 + 60 * Math.sin(i / 23) * Math.cos(j / 31) + 0.35 * i);
    expect(maxOf(hornSlopeDeg(g, z))).toBeLessThan(40);
    for (const n of [400, 320, 224]) {
      const a = decimateTerrain(g, z, n);
      const b = decimateGrid(g, z, n);
      expect(a.grid).toEqual(b.grid);
      expect(a.ratio).toBe(b.ratio);
      expect(a.elevation.every((v, k) => v === b.elevation[k])).toBe(true);
      // the shipped despike changes nothing where there is nothing to remove
      const d = decimateTerrain(g, z, n, { despikeM: MESH_DESPIKE_M.high });
      expect(d.elevation.every((v, k) => v === b.elevation[k])).toBe(true);
    }
    expect(decimateTerrain(g, z, 1000).grid).toBe(g);
    expect(decimateTerrain(g, z, 1000).elevation).toBe(z);
  });

  it('is decimateGrid exactly wherever the footprint is gentle, and differs only where a footprint is steep', () => {
    const g = makeGridSpec(ORIGIN, 9000, 10);
    // gentle in the west half, a 120 m step at x = +1500 m
    const z = terrainOf(g, (i, j) => 400 + 0.2 * j + (g.x0 + i * 10 > 1500 ? 0 : 120));
    const a = decimateTerrain(g, z, 400);
    const b = decimateGrid(g, z, 400);
    let differing = 0;
    for (let j = 0; j < a.grid.ny; j++)
      for (let i = 0; i < a.grid.nx; i++) {
        const x = a.grid.x0 + i * a.grid.cellSize;
        const k = j * a.grid.nx + i;
        if (Math.abs(x - 1500) > 40) expect(a.elevation[k]).toBe(b.elevation[k]);
        else if (a.elevation[k] !== b.elevation[k]) differing++;
      }
    expect(differing).toBeGreaterThan(5);
  });

  it('keeps a 150 m step steeper than the blur leaves it: at least 80 degrees between adjacent vertices on the 22 m mesh and 72 on the 40 m mesh, at every phase', () => {
    // S5: the ideal for one pair of vertices across the step is 81.5 degrees at 22.5 m and 75.0 at 40.3 m, and the worst phase of
    // the mesh gives 80.9 and 72.7. The plan's 75 for the 40 m mesh cannot be met at every phase.
    let worstHigh = Infinity;
    let worstLow = Infinity;
    for (let ph = 0; ph < 40; ph += 1) {
      if (ph < 22.5) worstHigh = Math.min(worstHigh, steepestAcrossStep(150, 400, ph, MESH_DESPIKE_M.high));
      worstLow = Math.min(worstLow, steepestAcrossStep(150, 224, ph, MESH_DESPIKE_M.low));
    }
    expect(worstHigh).toBeGreaterThanOrEqual(80);
    expect(worstLow).toBeGreaterThanOrEqual(72);
    // the blur, for comparison, loses several degrees
    const g: GridSpec = { nx: 900, ny: 24, cellSize: 10, x0: 0, y0: 0, origin: ORIGIN };
    const z = terrainOf(g, (i) => (i < 400 ? 150 : 0));
    const blur = decimateGrid(g, z, 400);
    const row = Math.floor(blur.grid.ny / 2) * blur.grid.nx;
    let m = 0;
    for (let i = 0; i < blur.grid.nx - 1; i++) m = Math.max(m, Math.atan(Math.abs(blur.elevation[row + i + 1]! - blur.elevation[row + i]!) / blur.grid.cellSize) * RAD);
    expect(m).toBeLessThan(worstHigh - 1);
  });

  it('leaves no vertex 10 m or more above or below all eight neighbours after the mesh despike (and has them before it)', () => {
    const { g, z } = rugged();
    for (const [n, m] of [
      [400, MESH_DESPIKE_M.high],
      [320, MESH_DESPIKE_M.medium],
      [224, MESH_DESPIKE_M.low],
    ] as const) {
      const raw = decimateTerrain(g, z, n);
      const fixed = decimateTerrain(g, z, n, { despikeM: m });
      const before = countSpikes(raw.grid, raw.elevation, m);
      expect(before.towers + before.pits).toBeGreaterThan(0);
      expect(countSpikes(fixed.grid, fixed.elevation, m)).toEqual({ towers: 0, pits: 0 });
      // the despike moves single vertices and nothing else: the share of changed vertices is small
      let changed = 0;
      for (let k = 0; k < fixed.elevation.length; k++) if (fixed.elevation[k] !== raw.elevation[k]) changed++;
      expect(changed).toBeGreaterThan(0);
      expect(changed / fixed.elevation.length).toBeLessThan(0.01);
    }
  });

  it('is deterministic, keeps the same grid and ratio as decimateGrid, and does not touch its input', () => {
    const { g, z } = rugged();
    const copy = Float32Array.from(z);
    const a = decimateTerrain(g, z, 400, { despikeM: 10 });
    const b = decimateTerrain(g, z, 400, { despikeM: 10 });
    expect(a.elevation.every((v, k) => v === b.elevation[k])).toBe(true);
    expect(a.grid).toEqual(decimateGrid(g, z, 400).grid);
    expect(a.ratio).toBe(decimateGrid(g, z, 400).ratio);
    expect(z.every((v, k) => v === copy[k])).toBe(true);
    expect(a.elevation.every(Number.isFinite)).toBe(true);
  });

  it('gives exactly the result of the scan of every footprint that it replaces (same blend, same despike), on steep rugged ground and on a non-square grid', () => {
    const { g, z } = rugged();
    for (const n of [400, 224]) {
      for (const despikeM of [0, 10]) {
        const a = decimateTerrain(g, z, n, { despikeM });
        const b = decimateTerrainScan(g, z, n, { despikeM });
        expect(a.grid).toEqual(b.grid);
        expect(a.elevation.every((v, k) => v === b.elevation[k])).toBe(true);
      }
    }
    // a wide grid, other thresholds
    const w: GridSpec = { nx: 700, ny: 300, cellSize: 10, x0: -3000, y0: -1000, origin: ORIGIN };
    const zw = terrainOf(w, (i, j) => 300 + 200 * Math.sin(i / 21) * Math.cos(j / 17));
    const o = { loDeg: 30, hiDeg: 60 };
    expect(decimateTerrain(w, zw, 300, o).elevation).toEqual(decimateTerrainScan(w, zw, 300, o).elevation);
  });

  it('is faster than the scan it replaces on a whole 900 x 900 terrain, and quick in itself (generous guards)', () => {
    const { g, z } = rugged();
    const time = (f: () => unknown): number => {
      f();
      let best = Infinity;
      for (let r = 0; r < 5; r++) {
        const t0 = performance.now();
        f();
        best = Math.min(best, performance.now() - t0);
      }
      return best;
    };
    const fast = time(() => decimateTerrain(g, z, 400, { despikeM: 10 }));
    const scan = time(() => decimateTerrainScan(g, z, 400, { despikeM: 10 }));
    expect(fast).toBeLessThan(500);
    expect(fast).toBeLessThan(scan);
  });

  it('keeps edges that a blurred mesh loses: on a face with no vertex spike the steepest edge of the 22 m mesh is steeper than decimateGrid gives', () => {
    const g = flatGrid(900, 900);
    const z = terrainOf(g, (i) => 200 + (i < 450 ? 120 : 0));
    const keep = decimateTerrain(g, z, 400, { despikeM: 10 });
    const blur = decimateGrid(g, z, 400);
    expect(maxOf(edgeSlopes(keep.grid, keep.elevation))).toBeGreaterThan(maxOf(edgeSlopes(blur.grid, blur.elevation)) + 2);
  });
});
