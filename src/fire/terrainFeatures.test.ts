/**
 * computeTerrainFeatures (spec §2.2, §7.6, §7.7, §7.9, §8.6) on analytic surfaces (src/terrain/testing/synthetic.ts)
 * and on the bundled Katoomba 10 m LiDAR DEM, plus the §13 performance budget (< 150 ms for 200 × 200 in Node).
 */
import { describe, expect, it } from 'vitest';
import { cellAt, makeGridSpec, type GridSpec } from '../core/grid';
import { Landform } from '../core/types';
import { loadDemoDem, loadDemoElevation } from '../data';
import { buildTerrain, terrainDerived } from '../terrain';
import { cone, ewRidge, mesa, nsValley, plane, randomHills, saddleRidge, surface, testGrid, TEST_ORIGIN } from '../terrain/testing/synthetic';
import { computeTerrainFeatures, d8Receivers, flowAccumulation, priorityFloodFill, restoreTerrainFeatures, slopeAtScale } from './terrainFeatures';

const build = (g: GridSpec, z: Float32Array) => {
  const t = buildTerrain(g, z, 'synthetic');
  const d = terrainDerived(t);
  return { t, d, f: computeTerrainFeatures(t, d) };
};
const at = (g: GridSpec, x: number, y: number): number => cellAt(g, x, y);
const angDiff = (a: number, b: number): number => Math.abs(((a - b + 540) % 360) - 180);

describe('flow: Priority-Flood + ε, D8, accumulation', () => {
  it('every interior cell drains; area is conserved at the outlets; pits are filled', () => {
    const g = testGrid(3000, 30);
    // Random hills with closed depressions.
    const z = randomHills(g, 7, 30, 200);
    const zf = priorityFloodFill(g, z);
    const recv = d8Receivers(g, zf);
    const { acc, order } = flowAccumulation(g, recv);
    const n = g.nx * g.ny;
    let outletArea = 0;
    for (let k = 0; k < n; k++) {
      expect(zf[k]!).toBeGreaterThanOrEqual(z[k]! - 1e-3);
      const i = k % g.nx;
      const j = Math.floor(k / g.nx);
      const interior = i > 0 && j > 0 && i < g.nx - 1 && j < g.ny - 1;
      if (interior) expect(recv[k]).toBeGreaterThanOrEqual(0);
      if (recv[k]! >= 0) expect(zf[recv[k]!]!).toBeLessThan(zf[k]!);
      else outletArea += acc[k]!;
    }
    expect(outletArea).toBeCloseTo(n * 900, -2);
    expect(new Set(order).size).toBe(n);
  });

  it('tilted plane: flow runs straight downslope and accumulates linearly', () => {
    const g = testGrid(3000, 30);
    const { f } = build(g, plane(g, 0, 0.3)); // rises to the north
    const k = at(g, 0, 0);
    // Receiver is the southern neighbour.
    expect(f.receiver[k]).toBe(k - g.nx);
    // Upslope area of a mid-domain cell = its column north of it.
    const j = Math.floor(k / g.nx);
    expect(f.flowAcc[k]!).toBeCloseTo((g.ny - j) * 900, -1);
  });
});

describe('slope-flow geometry: valleyDrop, crestRise, crestDist (§8.6)', () => {
  it('tilted 16.7° plane: valleyDrop = rise above the southern edge, crestRise = rise to the northern edge', () => {
    const g = testGrid(3000, 30);
    const { t, f } = build(g, plane(g, 0, 0.3));
    const k = at(g, 0, 0);
    const zS = t.elevation[k % g.nx]!;
    const zN = t.elevation[(g.ny - 1) * g.nx + (k % g.nx)]!;
    expect(f.valleyDrop[k]!).toBeCloseTo(t.elevation[k]! - zS, 0);
    expect(f.crestRise[k]!).toBeCloseTo(zN - t.elevation[k]!, 0);
    expect(f.crestDist[k]!).toBeCloseTo((g.ny - 1 - Math.floor(k / g.nx)) * 30, 0);
  });

  it('cone on a flat base: descent stops at the foot, ascent at the summit', () => {
    const g = testGrid(4000, 20);
    const { t, f } = build(g, cone(g, 300, 1500));
    const k = at(g, 600, 0); // 900 m from the rim, z ≈ 500 + 180
    expect(f.valleyDrop[k]!).toBeGreaterThan(160);
    expect(f.valleyDrop[k]!).toBeLessThan(200);
    expect(f.crestRise[k]!).toBeCloseTo(t.maxElevation - t.elevation[k]!, -1);
    expect(f.crestDist[k]!).toBeGreaterThan(560);
    expect(f.crestDist[k]!).toBeLessThan(700); // D8 path ≥ straight 600 m
    // Flat base: nothing to descend or climb.
    const kb = at(g, 1850, 1850);
    expect(f.valleyDrop[kb]!).toBeLessThan(1);
    expect(f.crestRise[kb]!).toBeLessThan(1);
  });

  it('flat plane: zero everywhere, no trench, no narrow valley', () => {
    const g = testGrid(2000, 30);
    const { f } = build(g, plane(g, 0, 0));
    for (let k = 0; k < g.nx * g.ny; k++) {
      expect(f.valleyDrop[k]).toBe(0);
      expect(f.crestRise[k]).toBe(0);
      expect(f.trench[k]).toBe(0);
      expect(f.narrowValley[k]).toBe(0);
    }
  });
});

describe('drainage, gully axis, trench and gully base (§7.6, §7.7)', () => {
  it('N–S valley falling south: drainage on the axis, up-gully azimuth north, steep walls → T = 1', () => {
    const g = testGrid(3000, 30);
    const { f } = build(g, nsValley(g, 0.004, 0.05));
    const k = at(g, 0, 0);
    expect(f.drainage[k]).toBe(1);
    expect(angDiff(f.gullyAxis[k]!, 0)).toBeLessThan(5);
    expect(f.trench[k]!).toBeCloseTo(1, 5);
    // Side wall 30 m away inherits T·(1 − 30/60) and the axis.
    const kw = at(g, 30, 0);
    expect(f.drainage[kw]).toBe(0);
    expect(f.trench[kw]!).toBeCloseTo(0.5, 5);
    expect(angDiff(f.gullyAxis[kw]!, 0)).toBeLessThan(5);
    // Far from the valley: NaN axis, T 0.
    const kf = at(g, 600, 0);
    expect(Number.isNaN(f.gullyAxis[kf]!)).toBe(true);
    expect(f.trench[kf]).toBe(0);
    // gullyBase = the lowest (southernmost) trench cell of the connected segment.
    const base = f.gullyBase[k]!;
    expect(base).toBeGreaterThanOrEqual(0);
    expect(f.gullyBase[kw]).toBe(base);
    expect(Math.floor(base / g.nx)).toBeLessThanOrEqual(1);
  });

  it('shallow valley (walls < 10°): T = 0', () => {
    const g = testGrid(3000, 30);
    const { f } = build(g, nsValley(g, 0.0005, 0.05));
    expect(f.trench[at(g, 0, 0)]!).toBe(0);
  });

  it('V-gully 60 m deep with 25° walls and a 30° axial slope: trench T = 1, narrow valley, walls graded', () => {
    const g = testGrid(2400, 20);
    const tan25 = Math.tan(25 * Math.PI / 180);
    const z = surface(g, (x, y) => 500 + Math.min(Math.abs(x) * tan25, 60) + Math.tan(30 * Math.PI / 180) * y);
    const { f } = build(g, z);
    const k = at(g, 0, -200);
    expect(f.drainage[k]).toBe(1);
    expect(f.trench[k]!).toBeGreaterThan(0.95);
    expect(angDiff(f.gullyAxis[k]!, 0)).toBeLessThan(5);
    expect(f.narrowValley[k]).toBe(1);
    expect(f.trench[at(g, 40, -200)]!).toBeCloseTo(f.trench[k]! * (1 - 40 / 60), 2);
    // valleyDrop on the side wall: down to the gully floor, not all the way down the gully.
    const kw = at(g, 100, -200);
    expect(f.valleyDrop[kw]!).toBeGreaterThan(20);
  });

  it('broad flat-floored valley (≈ 450 m floor) is not narrow; the same walls around a 120 m floor are', () => {
    const g = testGrid(3000, 30);
    const z = surface(g, (x, y) => 500 + 0.02 * y + (Math.abs(x) > 300 ? (Math.abs(x) - 300) * 0.5 : 0) + 0.0002 * x * x);
    const { f } = build(g, z);
    const k = at(g, 0, -600);
    expect(f.drainage[k]).toBe(1);
    expect(f.narrowValley[k]).toBe(0);
    // Same walls closing to a 120 m floor: narrow.
    const z2 = surface(g, (x, y) => 500 + 0.02 * y + (Math.abs(x) > 60 ? (Math.abs(x) - 60) * 0.5 : 0) + 0.0002 * x * x);
    const f2 = build(g, z2).f;
    expect(f2.narrowValley[k]).toBe(1);
  });
});

describe('ridge, saddle, cliff masks', () => {
  it('saddle between two summits; ridge on the crest; not on the flanks', () => {
    const g = testGrid(4000, 30);
    const { f } = build(g, saddleRidge(g));
    expect(f.saddle[at(g, 0, 0)]).toBe(1);
    expect(f.ridge[at(g, 1000, 0)]).toBe(1);
    expect(f.ridge[at(g, 0, -900)]).toBe(0);
    expect(f.saddle[at(g, 0, -900)]).toBe(0);
  });
  it('mesa walls are cliffs; sub-cell statistics from a 10 m DEM mark them too', () => {
    const g = testGrid(3000, 30);
    const { t, f } = build(g, mesa(g, 1000, 200));
    let cl = 0;
    for (let k = 0; k < g.nx * g.ny; k++) if (f.cliff[k]) cl++;
    expect(cl).toBeGreaterThan(0);
    expect(f.cliff[at(g, 0, 0)]).toBe(0);
    // With a 10 m DEM and no Terrain.slopeP90Deg the cells straddling the walls are cliffs.
    const g10 = testGrid(3000, 10);
    const hi = { grid: g10, elevation: mesa(g10, 1000, 200) };
    const f2 = computeTerrainFeatures({ ...t, landform: new Uint8Array(t.landform.length).fill(Landform.MidSlope) }, terrainDerived(t), hi);
    expect(f2.cliff[at(g, 500, 0)] || f2.cliff[at(g, 510, 0)] || f2.cliff[at(g, 490, 0)]).toBe(1);
    expect(f2.cliff[at(g, 0, 0)]).toBe(0);
  });
});

describe('slope30', () => {
  it('equals the Horn slope at 30 m; at 20 m it is averaged to 30 m (a plane keeps its slope)', () => {
    const g = testGrid(2000, 20);
    const t = buildTerrain(g, plane(g, Math.tan(0.3), 0), 's');
    const s = slopeAtScale(t);
    expect(s[at(g, 0, 0)]!).toBeCloseTo(Math.atan(Math.tan(0.3)) * 180 / Math.PI, 3);
    // Sub-30 m corrugation is smoothed.
    const zc = surface(g, (x) => 500 + 10 * Math.sin((2 * Math.PI * x) / 60));
    const tc = buildTerrain(g, zc, 's');
    const sc = slopeAtScale(tc);
    let m20 = 0;
    let m30 = 0;
    for (let k = 0; k < g.nx * g.ny; k++) {
      m20 += tc.slopeDeg[k]!;
      m30 += sc[k]!;
    }
    expect(m30).toBeLessThan(0.8 * m20);
  });
});

describe('crest search (§7.9)', () => {
  it('E–W ridge, wind from the north: a south-slope cell finds the crest upwind; no crest looking downhill', () => {
    const g = testGrid(4000, 30);
    const { t, d, f } = build(g, ewRidge(g, 300, 500));
    const k = at(g, 0, -300);
    const c = f.crest(k, 0);
    expect(c).not.toBeNull();
    expect(c!.d).toBeGreaterThanOrEqual(270);
    expect(c!.d).toBeLessThanOrEqual(360);
    expect(Math.abs(g.y0 + Math.floor(c!.kCrest / g.nx) * 30)).toBeLessThanOrEqual(60);
    expect(c!.zCrest).toBeGreaterThan(t.elevation[k]!);
    expect(c!.relief).toBeCloseTo(c!.zCrest - (t.elevation[k]! - d.heightAboveValley[k]!), 4);
    expect(f.crest(k, 180)).toBeNull();
    // Same sector (±11.25°) → same cached answer; another sector recomputes.
    expect(f.crest(k, 8)!.kCrest).toBe(c!.kCrest);
    expect(f.crest(k, 90)).toBeNull();
    // Beyond 600 m: none.
    expect(f.crest(at(g, 0, -1300), 0)).toBeNull();
  });
  it('crestSector fills the whole sector cache consistently with crest()', () => {
    const g = testGrid(3000, 30);
    const { f } = build(g, ewRidge(g, 300, 500));
    const sec = f.crestSector(3);
    expect(sec.sectorFromDeg).toBe(0);
    let found = 0;
    for (let k = 0; k < g.nx * g.ny; k += 17) {
      const c = f.crest(k, 0);
      if (c) {
        found++;
        expect(sec.kCrest[k]).toBe(c.kCrest);
        expect(sec.d[k]).toBe(c.d);
      } else expect(sec.kCrest[k]).toBe(-1);
    }
    expect(found).toBeGreaterThan(10);
  });
  it('data() → restoreTerrainFeatures round trip (worker transfer) keeps arrays and crest search', () => {
    const g = testGrid(3000, 30);
    const { t, d, f } = build(g, ewRidge(g, 300, 500));
    const plain = structuredClone(f.data());
    const r = restoreTerrainFeatures(plain, t, d);
    expect(r.trench).toEqual(f.trench);
    const k = at(g, 0, -300);
    expect(r.crest(k, 0)).toEqual(f.crest(k, 0));
  });
});

describe('performance (§13: < 150 ms for 200 × 200 in Node)', () => {
  it('random hills 200 × 200 at 30 m', () => {
    const g = makeGridSpec(TEST_ORIGIN, 6000, 30);
    expect(g.nx).toBe(200);
    const t = buildTerrain(g, randomHills(g, 3, 60, 300), 'perf');
    const d = terrainDerived(t);
    computeTerrainFeatures(t, d); // warm-up (JIT)
    let best = Infinity;
    for (let r = 0; r < 3; r++) {
      const t0 = performance.now();
      const f = computeTerrainFeatures(t, d);
      f.crestSector(270);
      best = Math.min(best, performance.now() - t0);
    }
    console.log(`computeTerrainFeatures 200×200 (+ one full crest sector): ${best.toFixed(1)} ms`);
    expect(best).toBeLessThan(150);
  });
});

describe('Katoomba LiDAR DEM (bundled 10 m DTM)', async () => {
  const centre = { lat: -33.715, lon: 150.285 };
  const grid = makeGridSpec(centre, 6000, 30);
  const el = await loadDemoElevation(grid, ['katoomba']);
  const hi = await loadDemoDem('katoomba');
  it.skipIf(!el || !hi)('realistic drainage, trenches, cliffs, valley drops and crests; < 150 ms', () => {
    const t = buildTerrain(grid, el!.elevation, el!.source);
    const d = terrainDerived(t);
    const t0 = performance.now();
    const f = computeTerrainFeatures(t, d, { grid: hi!.grid, elevation: hi!.elevation });
    const ms = performance.now() - t0;
    const n = grid.nx * grid.ny;
    let drain = 0, trench = 0, cliff = 0, narrow = 0, ridge = 0, saddle = 0, maxDrop = 0, maxRise = 0, bases = 0;
    for (let k = 0; k < n; k++) {
      drain += f.drainage[k]!;
      if (f.trench[k]! >= 0.5) trench++;
      cliff += f.cliff[k]!;
      narrow += f.narrowValley[k]!;
      ridge += f.ridge[k]!;
      saddle += f.saddle[k]!;
      maxDrop = Math.max(maxDrop, f.valleyDrop[k]!);
      maxRise = Math.max(maxRise, f.crestRise[k]!);
      if (f.gullyBase[k] === k) bases++;
      expect(Number.isFinite(f.slope30[k]!)).toBe(true);
      expect(f.trench[k]!).toBeGreaterThanOrEqual(0);
      expect(f.trench[k]!).toBeLessThanOrEqual(1);
    }
    const pct = (c: number) => ((100 * c) / n).toFixed(1);
    console.log(
      `Katoomba 200×200 @30 m (+10 m DEM): ${ms.toFixed(0)} ms; drainage ${pct(drain)} %, trench≥0.5 ${pct(trench)} %, cliff ${pct(cliff)} %, ` +
        `narrowValley ${pct(narrow)} %, ridge ${pct(ridge)} %, saddle ${pct(saddle)} %, gully bases ${bases}, max valleyDrop ${maxDrop.toFixed(0)} m, ` +
        `max crestRise ${maxRise.toFixed(0)} m`,
    );
    expect(drain / n).toBeGreaterThan(0.03);
    expect(drain / n).toBeLessThan(0.3);
    expect(trench).toBeGreaterThan(50); // incised sandstone gullies
    expect(cliff / n).toBeGreaterThan(0.005); // 300 m escarpment cliffs
    expect(narrow).toBeGreaterThan(20);
    expect(bases).toBeGreaterThan(3);
    expect(maxDrop).toBeGreaterThan(200); // plateau → Megalong / Jamison valley floors
    expect(maxDrop).toBeLessThan(900);
    expect(maxRise).toBeGreaterThan(200);
    expect(ms).toBeLessThan(400); // includes the 10 m sub-cell pass (810k cells)
    // Westerly: lee (east-facing) slopes below the escarpment find a crest within 600 m for some cells.
    const sec = f.crestSector(270);
    let withCrest = 0;
    for (let k = 0; k < n; k++) if (sec.kCrest[k]! >= 0) withCrest++;
    expect(withCrest / n).toBeGreaterThan(0.02);
    // Timing of the fire-grid part alone (no 10 m pass) against the §13 budget.
    const t1 = performance.now();
    computeTerrainFeatures(t, d);
    const ms2 = performance.now() - t1;
    console.log(`Katoomba 200×200 without the 10 m pass: ${ms2.toFixed(0)} ms`);
    expect(ms2).toBeLessThan(150);
  });

  it.skipIf(!hi)('full 9 km demo extent at 30 m (300 × 300): timing', async () => {
    const g9 = makeGridSpec(centre, 9000, 30);
    const e9 = await loadDemoElevation(g9, ['katoomba']);
    if (!e9) return;
    const t = buildTerrain(g9, e9.elevation, e9.source);
    const d = terrainDerived(t);
    const t0 = performance.now();
    const f = computeTerrainFeatures(t, d);
    const ms = performance.now() - t0;
    console.log(`Katoomba 300×300 @30 m: ${ms.toFixed(0)} ms`);
    expect(f.flowAcc.length).toBe(90000);
    expect(ms).toBeLessThan(400);
  });
});
