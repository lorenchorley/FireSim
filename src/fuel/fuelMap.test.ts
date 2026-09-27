import { describe, expect, it } from 'vitest';
import { makeGridSpec, type GridSpec } from '../core/grid';
import { FireHistoryKind, FuelFlag, FuelType, Landform, type FuelMap, type Terrain } from '../core/types';
import { buildTerrain, terrainDerived, type TerrainDerived } from '../terrain';
import { plane, TEST_ORIGIN } from '../terrain/testing/synthetic';
import { CLASS_INFER } from './catalogue';
import { buildFuelMap, faBlendWeight, fuelParamsAt, fuelSummary, grassStateFromLoad, type BuildFuelArgs, type FuelMapExt } from './fuelMap';
import { emptyHistory, type HistoryRaster } from './history';
import { YEAR_MS } from './params';

const T0 = Date.UTC(2026, 8, 27);

interface Fixture {
  grid: GridSpec;
  terrain: Terrain;
  derived: TerrainDerived;
  n: number;
}
function fixture(nCells = 10): Fixture {
  const grid = makeGridSpec(TEST_ORIGIN, nCells * 30, 30);
  const terrain = buildTerrain(grid, plane(grid, 0, 0, 800), 'flat');
  const n = grid.nx * grid.ny;
  // Detach the derived arrays so per-test edits do not leak through the cache.
  const d = terrainDerived(terrain);
  const derived: TerrainDerived = { ...d, tpiSmall: new Float32Array(n) };
  terrain.landform = new Uint8Array(n).fill(Landform.Flat);
  terrain.aspectDeg = new Float32Array(n).fill(NaN);
  terrain.elevation = new Float32Array(n).fill(800);
  terrain.cliffFraction = new Float32Array(n);
  return { grid, terrain, derived, n };
}

/** A HistoryRaster with the given records per cell ([years before T0, kind]). */
function historyOf(grid: GridSpec, perCell: Map<number, [number, number][]>): HistoryRaster {
  const h = emptyHistory(grid);
  const n = grid.nx * grid.ny;
  const tb: number[] = [];
  const kind: number[] = [];
  const idx: number[] = [];
  const start = new Uint32Array(n + 1);
  for (let k = 0; k < n; k++) {
    start[k] = idx.length;
    for (const [y, kd] of (perCell.get(k) ?? []).sort((a, b) => b[0] - a[0])) {
      idx.push(tb.length);
      tb.push(T0 - y * YEAR_MS);
      kind.push(kd);
    }
  }
  start[n] = idx.length;
  h.compact = { recStart: start, recIndex: Uint32Array.from(idx), tb: Float64Array.from(tb), kind: Uint8Array.from(kind) };
  h.source = 'test history';
  return h;
}

function build(fx: Fixture, cls: number | Uint8Array, over: Partial<BuildFuelArgs> = {}): FuelMapExt {
  const classId = typeof cls === 'number' ? new Uint8Array(fx.n).fill(cls) : cls;
  return buildFuelMap({ terrain: fx.terrain, derived: fx.derived, classId, t0: T0, droughtFactor: 7, kbdi: 60, month: 1, ...over }) as FuelMapExt;
}
function canopy(n: number, h: number, c: number): { height: Float32Array; cover: Float32Array; valid: Uint8Array } {
  return { height: new Float32Array(n).fill(h), cover: new Float32Array(n).fill(c), valid: new Uint8Array(n).fill(1) };
}

describe('buildFuelMap (spec §4.7)', () => {
  it('steady state on the fire grid: class loads, FHS maxima, bark hazard, flags, sources', () => {
    const fx = fixture();
    const f = build(fx, 13);
    expect(f.grid).toBe(fx.terrain.grid);
    for (const a of [f.type, f.surfaceLoad, f.wrf!, f.flags!, f.fuelClass!, f.canopyHeightEff!, f.faBlendW!]) expect(a.length).toBe(fx.n);
    const k = 12;
    expect(f.type[k]).toBe(FuelType.DryForestShrubby);
    expect(f.fuelClass![k]).toBe(13);
    expect(f.surfaceLoad[k]).toBeCloseTo(14.5, 5);
    expect(f.nearSurfaceLoad[k]).toBeCloseTo(1.9, 5);
    expect(f.elevatedLoad[k]).toBeCloseTo(4.9, 5);
    expect(f.canopyLoad![k]).toBeCloseTo(3.5, 5);
    expect(f.surfaceHazard[k]).toBeCloseTo(3.4, 5);
    expect(f.barkHazard[k]).toBe(3);
    expect(f.wrf![k]).toBeCloseTo(3.5, 6);
    expect(f.canopyHeight[k]).toBe(20); // no CHM: type default
    expect(f.canopyHeightEff![k]).toBe(20);
    expect(Number.isNaN(f.timeSinceFire[k]!)).toBe(true);
    const fl = f.flags![k]!;
    expect(fl & FuelFlag.NoFireRecord).toBeTruthy();
    expect(fl & FuelFlag.Stringybark).toBeTruthy();
    expect(fl & FuelFlag.HeavyFuel).toBeTruthy(); // bark hazard 3
    expect(fl & FuelFlag.WetSubmodel).toBeFalsy();
    expect(f.sources[0]).toMatch(/SVTM/);
  });

  it('H_o,eff = max(CHM p90, 0.8·type H_o); CHM gives cover and height', () => {
    const fx = fixture();
    let f = build(fx, 13, { canopy: canopy(fx.n, 13, 0.7) });
    expect(f.canopyHeight[0]).toBe(13);
    expect(f.canopyCover[0]).toBeCloseTo(0.7, 6);
    expect(f.canopyHeightEff![0]).toBe(16);
    f = build(fx, 13, { canopy: canopy(fx.n, 25, 0.7) });
    expect(f.canopyHeightEff![0]).toBe(25);
    // Grassland (no trees) and heath without an overstorey: 0.
    f = build(fx, FuelType.Grassland, { canopy: canopy(fx.n, 2, 0.05) });
    expect(f.canopyHeightEff![0]).toBe(0);
    f = build(fx, 32, { canopy: canopy(fx.n, 2, 0.3) });
    expect(f.canopyHeightEff![0]).toBe(0);
    expect(f.flags![0]! & FuelFlag.UnderWoodland).toBe(0);
    // Heath under a woodland overstorey (CHM ≥ 8 m, cover ≥ 0.1).
    f = build(fx, 32, { canopy: canopy(fx.n, 10, 0.2) });
    expect(f.flags![0]! & FuelFlag.UnderWoodland).toBeTruthy();
    expect(f.canopyHeightEff![0]).toBe(10);
    expect(fuelParamsAt(f, 0).underWoodland).toBe(true);
  });

  it('WRF chain: ridge −0.5 (not wetForest), low cover −1, post-fire −w, clamp [1.5, 6]', () => {
    const fx = fixture();
    fx.terrain.landform.fill(Landform.Ridge);
    let f = build(fx, 13, { canopy: canopy(fx.n, 10, 0.7) });
    expect(f.wrf![0]).toBeCloseTo(3.0, 6);
    f = build(fx, 13, { canopy: canopy(fx.n, 14, 0.7) }); // CHM ≥ 12 m: sheltered crest
    expect(f.wrf![0]).toBeCloseTo(3.5, 6);
    f = build(fx, FuelType.WetForest, { canopy: canopy(fx.n, 10, 0.7) }); // D10: no ridge reduction for wetForest
    expect(f.wrf![0]).toBeCloseTo(4.5, 6);
    f = build(fx, 13, { canopy: canopy(fx.n, 10, 0.2) }); // ridge and open canopy
    expect(f.wrf![0]).toBeCloseTo(2.0, 6);
    f = build(fx, FuelType.Heath, { canopy: canopy(fx.n, 2, 0.2) });
    expect(f.wrf![0]).toBeCloseTo(1.5, 6); // clamped
    f = build(fx, FuelType.Grassland);
    expect(f.wrf![0]).toBeCloseTo(1.2, 6); // grass keeps the class value
    fx.terrain.landform.fill(Landform.MidSlope);
    const h = historyOf(fx.grid, new Map([[0, [[5, FireHistoryKind.Wildfire]]]]));
    f = build(fx, 13, { history: h });
    expect(f.flags![0]! & FuelFlag.PostFire).toBeTruthy();
    expect(f.wrf![0]).toBeCloseTo(3.0, 6); // 3.5 − 0.5·1
    expect(f.elevatedHeight[0]).toBeCloseTo(2.0 * 1.125, 6);
    expect(f.flags![1]! & FuelFlag.PostFire).toBe(0);
  });

  it('curing: C_month − 15·[z > 1400] + offset + 3·(DF − 5), clamped 20–100', () => {
    const fx = fixture();
    fx.terrain.elevation[1] = 1500;
    let f = build(fx, FuelType.Grassland, { month: 1, droughtFactor: 7 });
    expect(f.curing[0]).toBe(96);
    expect(f.curing[1]).toBe(81);
    f = build(fx, 39, { month: 1, droughtFactor: 7 });
    expect(f.curing[1]).toBe(66); // alpine herbfield −15 more
    f = build(fx, FuelType.Grassland, { month: 10, droughtFactor: 5 });
    expect(f.curing[0]).toBe(60);
    f = build(fx, FuelType.Grassland, { month: 2, droughtFactor: 10 });
    expect(f.curing[0]).toBe(100);
    f = build(fx, FuelType.Grassland, { month: 7, droughtFactor: 0 });
    expect(f.curing[0]).toBe(30);
    f = build(fx, FuelType.NonFuel);
    expect(f.curing[0]).toBe(0);
  });

  it('grass state from the grass load; class/type overrides; grass WAF', () => {
    expect([grassStateFromLoad(6), grassStateFromLoad(5.9), grassStateFromLoad(3), grassStateFromLoad(2.9)]).toEqual(['natural', 'grazed', 'grazed', 'eatenOut']);
    const fx = fixture();
    expect(fuelParamsAt(build(fx, FuelType.Grassland), 0).grassState).toBe('grazed'); // 5.1 t/ha
    expect(fuelParamsAt(build(fx, FuelType.GrassyWoodland), 0).grassState).toBe('natural'); // 10 t/ha
    expect(fuelParamsAt(build(fx, FuelType.Urban), 0).grassState).toBe('eatenOut');
    expect(fuelParamsAt(build(fx, 35), 0).grassState).toBe('eatenOut');
    expect(fuelParamsAt(build(fx, 48), 0).grassState).toBe('eatenOut');
    expect(fuelParamsAt(build(fx, 39), 0).grassState).toBe('grazed'); // 5.8 t/ha
    const h = historyOf(fx.grid, new Map([[0, [[0.5, FireHistoryKind.Wildfire]]]]));
    expect(fuelParamsAt(build(fx, FuelType.Grassland, { history: h }), 0).grassState).toBe('eatenOut'); // 1.9 t/ha
    expect(fuelParamsAt(build(fx, FuelType.GrassyWoodland, { canopy: canopy(fx.n, 12, 0.2) }), 0).grassWaf).toBe(0.5);
    expect(fuelParamsAt(build(fx, FuelType.GrassyWoodland, { canopy: canopy(fx.n, 12, 0.5) }), 0).grassWaf).toBe(0.3);
    expect(fuelParamsAt(build(fx, FuelType.Grassland), 0).grassWaf).toBe(1.0);
    expect(fuelParamsAt(build(fx, FuelType.Urban), 0).grassWaf).toBe(0.3);
  });

  it('class 34 moisture offset +3 pp while KBDI < 100', () => {
    const fx = fixture();
    expect(build(fx, 34, { kbdi: 60 }).moistureOffset![0]).toBe(3);
    expect(build(fx, 34, { kbdi: 120 }).moistureOffset![0]).toBe(0);
    expect(build(fx, 32, { kbdi: 60 }).moistureOffset![0]).toBe(0);
  });

  it('§5.9 topographic blend weight: flat wet-forest cell (aspect NaN, tpiSmall 30 m) w = 0.5; 0 outside wetForest', () => {
    expect(faBlendWeight(30, NaN)).toBeCloseTo(0.5, 9);
    expect(faBlendWeight(30, 315)).toBeCloseTo(1, 9);
    expect(faBlendWeight(30, 135)).toBeCloseTo(0, 9);
    expect(faBlendWeight(-5, 315)).toBe(0);
    expect(faBlendWeight(15, 315)).toBeCloseTo(0.5, 9);
    const fx = fixture();
    fx.derived.tpiSmall.fill(30);
    expect(fuelParamsAt(build(fx, FuelType.WetForest), 0).faBlendW).toBeCloseTo(0.5, 6);
    expect(fuelParamsAt(build(fx, FuelType.Rainforest), 0).faBlendW).toBeCloseTo(0.5, 6);
    expect(fuelParamsAt(build(fx, 13), 0).faBlendW).toBe(0);
  });

  it('flags: Cliff, InferredVegetation, WetGullyMinority, WetSubmodel, RibbonBark', () => {
    const fx = fixture();
    fx.terrain.cliffFraction![3] = 0.4;
    const minorityWet = new Uint8Array(fx.n);
    minorityWet[4] = 1;
    minorityWet[6] = 1;
    const cls = new Uint8Array(fx.n).fill(30);
    cls[4] = 13; // DSF cell holding a wet sub-cell strip
    cls[5] = CLASS_INFER;
    const f = build(fx, cls, { minorityWet });
    expect(f.flags![3]! & FuelFlag.Cliff).toBeTruthy();
    expect(f.flags![4]! & FuelFlag.WetGullyMinority).toBeTruthy();
    expect(f.flags![6]! & FuelFlag.WetGullyMinority).toBe(0); // the cell itself is wet forest: no "minority" strip
    expect(f.flags![0]! & FuelFlag.WetSubmodel).toBeTruthy();
    expect(f.flags![0]! & FuelFlag.RibbonBark).toBeTruthy();
    expect(f.flags![5]! & FuelFlag.InferredVegetation).toBeTruthy();
    expect(f.type[5]).toBe(FuelType.DryForestShrubby); // flat, no canopy → DSF
    expect(f.fuelClass![5]).toBe(FuelType.DryForestShrubby);
    expect(f.flags![0]! & FuelFlag.InferredVegetation).toBe(0);
    expect(f.sources.join(' ')).toMatch(/inferred/);
  });

  it('fire history rasters and TFI counts use the resolved class', () => {
    const fx = fixture();
    const h = historyOf(fx.grid, new Map([[0, [[20, FireHistoryKind.Wildfire], [12, FireHistoryKind.Wildfire], [6.8, FireHistoryKind.Wildfire]]]]));
    const f = build(fx, 13, { history: h });
    expect(f.timeSinceFire[0]).toBeCloseTo(6.8, 5);
    expect(f.lastFireKind[0]).toBe(FireHistoryKind.Wildfire);
    expect(f.fireCount30![0]).toBe(3);
    expect(f.fireCountTfi![0]).toBe(1); // 12 → 6.8 yr = 5.2 yr < 7 (DSF shrubby SFAZ minimum); 20 → 12 = 8 yr is not
    const g = build(fx, 25, { history: h }); // shrubby WSF, TFI 25 yr: both intervals short
    expect(g.fireCountTfi![0]).toBe(2);
    expect(f.flags![0]! & FuelFlag.NoFireRecord).toBe(0);
    expect(f.sources).toContain('test history');
  });

  it('fuelParamsAt on a flat cell (aspect NaN) returns finite values for every field', () => {
    const fx = fixture();
    const h = historyOf(fx.grid, new Map([[0, [[3, FireHistoryKind.PrescribedBurn]]]]));
    for (const cls of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 30, 31, 32, 34, 35, 39, 48]) {
      const f = build(fx, cls, { history: h, canopy: canopy(fx.n, 15, 0.6) });
      const p = fuelParamsAt(f, 0);
      for (const [key, v] of Object.entries(p)) if (typeof v === 'number') expect(Number.isFinite(v), `class ${cls} ${key}`).toBe(true);
      // Without a record everything but timeSinceFire (NaN = no record, D40) is finite.
      const q = fuelParamsAt(f, 1);
      for (const [key, v] of Object.entries(q)) if (typeof v === 'number' && key !== 'timeSinceFire') expect(Number.isFinite(v), `class ${cls} ${key}`).toBe(true);
    }
  });

  it('fuelParamsAt falls back to the class/type row on maps without the optional fields', () => {
    const fx = fixture(4);
    const full = build(fx, FuelType.WetForest);
    const bare: FuelMap = {
      grid: full.grid, type: full.type, surfaceHazard: full.surfaceHazard, nearSurfaceHazard: full.nearSurfaceHazard,
      nearSurfaceHeight: full.nearSurfaceHeight, elevatedHazard: full.elevatedHazard, elevatedHeight: full.elevatedHeight,
      barkHazard: full.barkHazard, surfaceLoad: full.surfaceLoad, nearSurfaceLoad: full.nearSurfaceLoad, elevatedLoad: full.elevatedLoad,
      barkLoad: full.barkLoad, canopyHeight: full.canopyHeight, canopyCover: full.canopyCover, curing: full.curing,
      timeSinceFire: full.timeSinceFire, lastFireKind: full.lastFireKind, sources: [],
    };
    const p = fuelParamsAt(bare, 0);
    expect(p.fuelClass).toBe(FuelType.WetForest);
    expect(p.wrf).toBe(4.5);
    expect(p.canopyLoad).toBe(6.9);
    expect(p.hOEff).toBe(35);
    expect(p.moistureFamily).toBe('wetForest');
    expect(p.faBlendW).toBe(0);
    expect(p.tauF).toBe(60);
    expect(p.cRef).toBe(0.8);
  });

  it('fuelSummary reads like the §4.7 example', () => {
    const fx = fixture();
    const h = historyOf(fx.grid, new Map([[0, [[6.8, FireHistoryKind.Wildfire]]]]));
    const f = build(fx, 13, { history: h, params: { postFireWeightUnknownSeverity: 0 } });
    const s = fuelSummary(f, 0);
    expect(s).toMatch(/^Dry forest \(shrubby\) — Sydney Montane DSF · wildfire 6\.8 yr ago · litter 9\.9 t\/ha \(69 % of max\) · shrubs 2\.0 m · bark stringy/);
    expect(fuelSummary(f, 1)).toMatch(/no recorded fire/);
    expect(fuelSummary(build(fx, 32), 0)).toMatch(/Heath — Sydney Montane Heaths · .*shrub fuel 11\.8 t\/ha/);
    expect(fuelSummary(build(fx, FuelType.Grassland), 0)).toMatch(/grass 5\.1 t\/ha \(grazed\)/);
  });

  it('builds a 300 × 300 map with history in well under a second', () => {
    const fx = fixture(300);
    const per = new Map<number, [number, number][]>();
    for (let k = 0; k < fx.n; k += 2) per.set(k, [[30, FireHistoryKind.Wildfire], [12, FireHistoryKind.PrescribedBurn], [6.8, FireHistoryKind.Wildfire]]);
    const h = historyOf(fx.grid, per);
    const cls = new Uint8Array(fx.n);
    for (let k = 0; k < fx.n; k++) cls[k] = [13, 25, 31, 32, 41, CLASS_INFER][k % 6]!;
    build(fx, cls, { history: h }); // warm-up
    const t = performance.now();
    build(fx, cls, { history: h, canopy: canopy(fx.n, 15, 0.6) });
    expect(performance.now() - t).toBeLessThan(400);
  });
});
