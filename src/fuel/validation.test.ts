/**
 * Physical validation and robustness of fuel/ (spec §4, §15 V13 / V19 fuel parts), added in review:
 * - V13 fuel part: a 2-yr-old prescribed burn (p 0.6) in DSF shrubby, end to end from NPWS-style GeoJSON.
 * - V19 fuel part: in the gospers 2019-12-19 replay the Gospers Mountain perimeter keeps its pre-fire fuel.
 * - Olson / regime properties for every burnable class, (FHS, load) consistency of every class row.
 * - Determinism, structured-clone (worker transfer) round trip, empty and degenerate inputs, grid edges.
 */
import { describe, expect, it } from 'vitest';
import { LocalProjection } from '../core/geo';
import { cellAt, makeGridSpec } from '../core/grid';
import { FireHistoryKind, FuelFlag, FuelType, type FuelMap, type Terrain } from '../core/types';
import { buildTerrain, terrainDerived } from '../terrain';
import { plane, TEST_ORIGIN } from '../terrain/testing/synthetic';
import { accumulate, makeCellHistory, makeFuelState, type CellHistory } from './accumulation';
import { CLASS_INFER, FUEL_CLASSES, FUEL_CLASS_COUNT, FUEL_TYPES, resolveClass } from './catalogue';
import { buildDemoFuel } from './demo';
import { applyFuelEdit } from './edits';
import { buildFuelMap, cloneFuelMap, fuelParamsAt, type FuelMapExt } from './fuelMap';
import { fhsFromLoad } from './hazard';
import { burnTime, inclusionAt, parseFireHistory, rasteriseFireHistory } from './history';
import { FUEL_PARAMS, resolveFuelParams, YEAR_MS } from './params';
import { parseVegetation, rasteriseVegetation } from './svtm';
import { loadDemoFireTerrain } from './testing/demoTerrain';

const NOW = Date.parse('2026-09-27T00:00:00Z');

/** Every numeric typed array of a fuel map, keyed by field name. */
function arrays(f: FuelMap): Map<string, ArrayLike<number>> {
  const m = new Map<string, ArrayLike<number>>();
  for (const [k, v] of Object.entries(f)) if (ArrayBuffer.isView(v)) m.set(k, v as unknown as ArrayLike<number>);
  return m;
}
function sameBits(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let q = 0; q < a.length; q++) if (!Object.is(a[q], b[q])) return false;
  return true;
}

describe('V13 fuel part: a 2-yr-old prescribed burn in DSF shrubby (end to end from GeoJSON)', () => {
  const grid = makeGridSpec(TEST_ORIGIN, 3000, 30);
  const terrain = buildTerrain(grid, plane(grid, 0, 0, 800), 'flat');
  const proj = new LocalProjection(grid.origin);
  const lonlat = (x: number, y: number): [number, number] => {
    const ll = proj.toLatLon(x, y);
    return [ll.lon, ll.lat];
  };
  // NPWS convention: 13:00Z / 14:00Z = local midnight of the next date; 2024-09-25 → 2024-09-27 burn, 2 yr before t0.
  const t0 = Date.parse('2026-09-27T00:00:00Z');
  const geojson = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { FireType: 2, FireName: 'Test HR', FireYear: 202425, Label: '2024-25 Prescribed Burn', StartDate: Date.parse('2024-09-24T14:00:00Z'), EndDate: Date.parse('2024-09-26T14:00:00Z') },
        geometry: { type: 'Polygon', coordinates: [[lonlat(-500, -500), lonlat(500, -500), lonlat(500, 500), lonlat(-500, 500), lonlat(-500, -500)]] },
      },
    ],
  };

  it('inside carries the §4.5 residual state, outside is at steady state; the burn is the last record', () => {
    const recs = parseFireHistory(geojson);
    expect(recs).toHaveLength(1);
    expect(recs[0]!.startDate).toBe('2024-09-25');
    expect(recs[0]!.endDate).toBe('2024-09-27');
    const history = rasteriseFireHistory(grid, recs, t0);
    const fuel = buildFuelMap({ terrain, derived: terrainDerived(terrain), classId: new Uint8Array(grid.nx * grid.ny).fill(13), history, t0, droughtFactor: 8, kbdi: 60, month: 9 });
    const kin = cellAt(grid, 0, 0);
    const kout = cellAt(grid, 1200, 1200);
    const tsf = (t0 - burnTime(recs[0]!)) / YEAR_MS;
    expect(tsf).toBeCloseTo(2, 2);
    const pin = fuelParamsAt(fuel, kin);
    const pout = fuelParamsAt(fuel, kout);
    const p = FUEL_PARAMS.patchiness;
    const res = (xss: number, keep: number, k: number): number => xss - (xss - keep * xss) * Math.exp(-k * tsf);
    expect(pin.surfaceLoad).toBeCloseTo(res(14.5, 1 - p, 0.17), 5); // ≈ 8.31 t/ha
    expect(pin.surfaceLoad).toBeCloseTo(8.31, 1);
    expect(pin.nearSurfaceLoad).toBeCloseTo(res(1.9, 1 - p, 0.17), 5);
    expect(pin.elevatedLoad).toBeCloseTo(res(4.9, 1 - 0.5 * p, 0.2), 5);
    expect(pin.barkLoad).toBeCloseTo(res(2.67, 1 - 0.5 * p, 0.1), 5);
    expect(pin.canopyLoad).toBeCloseTo(3.5, 6); // canopy untouched by a prescribed burn
    expect(pin.fhsS).toBeCloseTo(res(3.4, 1 - p, 0.17), 5);
    expect(pin.timeSinceFire).toBeCloseTo(tsf, 5);
    expect(fuel.lastFireKind[kin]).toBe(FireHistoryKind.PrescribedBurn);
    expect(pin.flags & FuelFlag.PostFire).toBe(0); // the post-fire regime follows wildfires only
    expect(pin.flags & FuelFlag.NoFireRecord).toBe(0);
    // Outside: steady state, flagged as having no record (D40).
    expect(pout.surfaceLoad).toBeCloseTo(14.5, 6);
    expect(pout.flags & FuelFlag.NoFireRecord).toBeTruthy();
    expect(Number.isNaN(pout.timeSinceFire)).toBe(true);
    // Mk2 fuel load (surface + near-surface, D6) inside / outside: the recent burn carries ≈ 57 % of the fuel.
    const ratio = (pin.surfaceLoad + pin.nearSurfaceLoad) / (pout.surfaceLoad + pout.nearSurfaceLoad);
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(0.65);
  });
});

describe('V19 fuel part: gospers-2019-12-19 replay', () => {
  it('the Gospers Mountain perimeter is active, excluded from the fuel reset, and keeps its pre-fire fuel', async () => {
    const terrain = (await loadDemoFireTerrain('gospers', 30))!;
    const replayT0 = Date.parse('2019-12-19T03:00:00Z');
    const now = await buildDemoFuel('gospers', terrain, NOW);
    const replay = await buildDemoFuel('gospers', terrain, replayT0);
    expect(replay.history.activeFires.some((r) => r.name === 'Gospers Mountain')).toBe(true);
    expect(replay.history.included.some((r) => r.name === 'Gospers Mountain')).toBe(false);
    // Cells whose last record today is Gospers Mountain.
    const c = now.history.compact;
    const gm: number[] = [];
    for (let k = 0; k < terrain.elevation.length; k++) {
      const a = c.recStart[k]!;
      const b = c.recStart[k + 1]!;
      if (b > a && now.history.included[c.recIndex[b - 1]!]!.name === 'Gospers Mountain') gm.push(k);
    }
    expect(gm.length / terrain.elevation.length).toBeGreaterThan(0.1);
    let reset = 0;
    let fullish = 0;
    let burnable = 0;
    for (const k of gm) {
      expect(now.fuel.timeSinceFire[k]).toBeGreaterThan(6.5);
      expect(now.fuel.timeSinceFire[k]).toBeLessThan(7.2);
      const tr = replay.fuel.timeSinceFire[k]!;
      if (tr < 0.5) reset++; // a reset at the replay date would read ≈ 0
      const cls = resolveClass(replay.fuel.fuelClass![k]!);
      if (cls.family === 'none' || !(cls.surface.load > 0)) continue;
      burnable++;
      if (replay.fuel.surfaceLoad[k]! >= 0.5 * cls.surface.load) fullish++;
    }
    expect(reset).toBe(0);
    // Before the fire the area carried mostly long-unburnt fuel (> 50 % of steady state).
    expect(fullish / burnable).toBeGreaterThan(0.8);
  }, 30000);
});

describe('accumulation properties for every burnable class', () => {
  const hist = (recs: [number, number][], t0: number): CellHistory => {
    const h = makeCellHistory();
    h.n = recs.length;
    recs.forEach(([y, kind], q) => {
      h.tb[q] = t0 - y * YEAR_MS;
      h.kind[q] = kind;
    });
    return h;
  };
  const W = FireHistoryKind.Wildfire;
  const PB = FireHistoryKind.PrescribedBurn;
  const taus = [0, 0.25, 0.5, 1, 2, 3, 5, 8, 12, 15, 20, 30, 60];

  it('after a wildfire every layer and hazard grows monotonically from 0 to the class steady state (regime off)', () => {
    const P = resolveFuelParams({ postFireWeightUnknownSeverity: 0 });
    for (let c = 0; c < FUEL_CLASS_COUNT; c++) {
      const cls = resolveClass(c);
      let prev = makeFuelState();
      for (const tau of taus) {
        const st = accumulate(cls, hist([[tau, W]], NOW), NOW, P, 0, makeFuelState());
        const pairs: [number, number, number][] = [
          [st.s, prev.s, cls.surface.load], [st.ns, prev.ns, cls.nearSurface.load], [st.el, prev.el, cls.elevated.load],
          [st.b, prev.b, cls.bark.load], [st.o, prev.o, cls.canopy.load],
          [st.fhsS, prev.fhsS, cls.fhsMax.surface], [st.fhsNs, prev.fhsNs, cls.fhsMax.nearSurface], [st.fhsEl, prev.fhsEl, cls.fhsMax.elevated],
        ];
        for (const [x, xp, xss] of pairs) {
          expect(x, `class ${c} τ ${tau}`).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(xss + 1e-9);
          if (tau > 0) expect(x).toBeGreaterThanOrEqual(xp - 1e-12);
        }
        if (tau === 0) for (const [x] of pairs) expect(x).toBe(0);
        prev = st;
      }
    }
  });

  it('a prescribed burn always leaves at least as much fuel as a wildfire at the same date; heath follows 1 − e^(−kt) in total', () => {
    for (let c = 0; c < FUEL_CLASS_COUNT; c++) {
      const cls = resolveClass(c);
      for (const tau of [0, 1, 4, 10]) {
        const w = accumulate(cls, hist([[tau, W]], NOW), NOW, resolveFuelParams({ postFireWeightUnknownSeverity: 0 }), 0, makeFuelState());
        const pb = accumulate(cls, hist([[tau, PB]], NOW), NOW, FUEL_PARAMS, 0, makeFuelState());
        expect(pb.s + pb.ns + pb.el + pb.b + pb.o).toBeGreaterThanOrEqual(w.s + w.ns + w.el + w.b + w.o - 1e-9);
        if (cls.family === 'heath' && cls.surface.k === cls.nearSurface.k && cls.surface.k === cls.elevated.k) {
          expect((w.s + w.ns + w.el) / cls.totalFineLoad).toBeCloseTo(1 - Math.exp(-cls.surface.k * tau), 9);
        }
      }
    }
  });

  it('the post-fire regime stays bounded by the post-fire steady states and only raises shrub fuel', () => {
    for (const c of [FuelType.DryForestShrubby, 13, 14, 17, 18, 19, FuelType.SnowGumWoodland, 40, 30]) {
      const cls = resolveClass(c);
      for (const tau of [1, 2, 5, 10, 15]) {
        const std = accumulate(cls, hist([[tau, W]], NOW), NOW, resolveFuelParams({ postFireWeightUnknownSeverity: 0 }), 0, makeFuelState());
        const pf = accumulate(cls, hist([[tau, W]], NOW), NOW, resolveFuelParams({ postFireWeightUnknownSeverity: 1 }), 0, makeFuelState());
        expect(pf.postFireW).toBe(1);
        expect(pf.ns).toBeGreaterThanOrEqual(std.ns - 1e-12);
        expect(pf.el).toBeGreaterThanOrEqual(std.el - 1e-12);
        expect(pf.s).toBeLessThanOrEqual(std.s + 1e-12); // slower litter recovery (k_s × 0.67)
        expect(pf.b).toBeLessThanOrEqual(std.b + 1e-12); // bark recovers slowly (k_b 0.02)
        expect(pf.ns).toBeLessThanOrEqual(cls.nearSurface.load * FUEL_PARAMS.postFireNsMult + 1e-9);
        expect(pf.el).toBeLessThanOrEqual(cls.elevated.load * FUEL_PARAMS.postFireElMult + 1e-9);
        for (const h of [pf.fhsS, pf.fhsNs, pf.fhsEl]) expect(h >= 0 && h <= 4).toBe(true);
      }
    }
  });
});

describe('catalogue rows (spec §4.2 "FHS maxima are part of every class that changes loads")', () => {
  it('every class that overrides a load carries FHS maxima in its overrides; derived maxima follow the §4.6 curve', () => {
    for (const c of FUEL_CLASSES) {
      const o = c.overrides;
      if (o.surface === undefined && o.nearSurface === undefined && o.elevated === undefined) continue;
      expect(o.fhsMax, `class ${c.id}`).toBeDefined();
      for (const v of [o.fhsMax!.surface, o.fhsMax!.nearSurface, o.fhsMax!.elevated]) expect(v >= 0 && v <= 4).toBe(true);
      // Consumers reading the raw row see the same maxima as resolveClass().
      expect(resolveClass(c.id).fhsMax).toEqual(o.fhsMax);
    }
    // Class 32 (Sydney montane heath 3 / 3.5 / 5.3 t/ha, no LUT FHS): the §4.6 inverse polyline.
    const h = FUEL_CLASSES[32]!.overrides.fhsMax!;
    expect(h.surface).toBeCloseTo(fhsFromLoad('surface', 3), 2);
    expect(h.nearSurface).toBeCloseTo(3.5, 6);
    expect(h.elevated).toBeCloseTo(fhsFromLoad('elevated', 5.3), 2);
    // LUT rows that give FHS keep them (class 17: 3.4 / 3.1 / 2.5).
    expect(FUEL_CLASSES[17]!.overrides.fhsMax).toEqual({ surface: 3.4, nearSurface: 3.1, elevated: 2.5 });
    // Type rows are untouched.
    expect(FUEL_TYPES[FuelType.Heath].fhsMax).toEqual({ surface: 2.0, nearSurface: 3.5, elevated: 4.0 });
  });
});

describe('determinism and worker transfer', () => {
  it('buildDemoFuel is bitwise repeatable; a structured clone gives identical cell parameters and edits', async () => {
    const terrain = (await loadDemoFireTerrain('katoomba', 30))!;
    const a = (await buildDemoFuel('katoomba', terrain, NOW)).fuel;
    const b = (await buildDemoFuel('katoomba', terrain, NOW)).fuel;
    const aa = arrays(a);
    const bb = arrays(b);
    expect([...aa.keys()].sort()).toEqual([...bb.keys()].sort());
    for (const [k, v] of aa) expect(sameBits(v, bb.get(k)!), k).toBe(true);
    expect(a.sources).toEqual(b.sources);

    const clone = structuredClone(a) as FuelMapExt; // what postMessage does to ScenarioData.fuel
    for (let k = 0; k < a.type.length; k += 211) expect(fuelParamsAt(clone, k)).toEqual(fuelParamsAt(a, k));
    const { history } = await buildDemoFuel('katoomba', terrain, NOW);
    const edit = { kind: 'fuel' as const, id: 'e', shape: { kind: 'circle' as const, x: 0, y: 0, radius: 400 }, setTimeSinceFire: 1, surfaceHazardDelta: 0.5 };
    const w1 = cloneFuelMap(a);
    const w2 = cloneFuelMap(clone);
    expect(applyFuelEdit(w1, edit, a, history.compact, NOW)).toBe(applyFuelEdit(w2, edit, clone, history.compact, NOW));
    const m1 = arrays(w1);
    const m2 = arrays(w2);
    for (const [k, v] of m1) expect(sameBits(v, m2.get(k)!), k).toBe(true);
  }, 30000);
});

describe('empty, degenerate and edge inputs', () => {
  const grid = makeGridSpec(TEST_ORIGIN, 1500, 30);
  const terrain: Terrain = buildTerrain(grid, plane(grid, 0.05, 0, 900), 'plane');
  const n = grid.nx * grid.ny;

  it('no vegetation, no history, no canopy: a finite, inferred, steady-state map', () => {
    expect(parseFireHistory(null)).toEqual([]);
    expect(parseFireHistory({})).toEqual([]);
    expect(parseVegetation(undefined)).toEqual([]);
    const { classId, minorityWet } = rasteriseVegetation(grid, [], terrain);
    expect(classId.every((c) => c === CLASS_INFER)).toBe(true);
    expect(minorityWet.every((c) => c === 0)).toBe(true);
    const h = rasteriseFireHistory(grid, [], NOW);
    expect(h.warnings.join(' ')).toMatch(/steady-state/);
    const fuel = buildFuelMap({ terrain, derived: terrainDerived(terrain), classId, history: h, canopy: null, t0: NOW, droughtFactor: 7, kbdi: 60, month: 9 });
    for (let k = 0; k < n; k++) {
      const p = fuelParamsAt(fuel, k);
      expect(p.flags & FuelFlag.InferredVegetation).toBeTruthy();
      expect(p.flags & FuelFlag.NoFireRecord).toBeTruthy();
      for (const [key, v] of Object.entries(p)) if (typeof v === 'number' && key !== 'timeSinceFire') expect(Number.isFinite(v), key).toBe(true);
    }
  });

  it('a polygon larger than the grid classifies every cell, including the edge rows and columns', () => {
    const proj = new LocalProjection(grid.origin);
    const ll = (x: number, y: number): [number, number] => {
      const p = proj.toLatLon(x, y);
      return [p.lon, p.lat];
    };
    const big = [[ll(-5000, -5000), ll(5000, -5000), ll(5000, 5000), ll(-5000, 5000), ll(-5000, -5000)]];
    const { classId } = rasteriseVegetation(grid, [{ formation: 'Heathlands', className: 'Sydney Montane Heaths', rings: big }], terrain);
    expect(classId.every((c) => c === 32)).toBe(true);
  });

  it('parseVegetation skips polygon parts without a usable outer ring (holes are never filled as polygons)', () => {
    const gj = {
      features: [
        {
          properties: { vegForm: 'Heathlands', vegClass: 'Sydney Montane Heaths', PCTID: 1 },
          geometry: { type: 'MultiPolygon', coordinates: [[[[150, -33], [150.01, -33]], [[150, -33], [150.01, -33], [150.01, -33.01], [150, -33]]], [[[150, -33], [150.01, -33], [150.01, -33.01], [150, -33]]]] },
        },
      ],
    };
    const recs = parseVegetation(gj);
    expect(recs).toHaveLength(1);
    expect(recs[0]!.fuelClass).toBe(32);
  });

  it('an undated record whose published end date falls after t0 is not used (no negative time since fire)', () => {
    const rec = { kind: FireHistoryKind.Wildfire, label: 'x', rings: [], startTime: 0, endTime: Date.parse('2026-12-01T02:00:00Z'), season: 2024, datesKnown: false };
    expect(inclusionAt(rec, NOW)).toBe('future');
    expect(inclusionAt({ ...rec, endTime: Date.parse('2025-02-01T02:00:00Z') }, NOW)).toBe('included');
  });
});
