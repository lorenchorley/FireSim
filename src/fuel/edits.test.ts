import { describe, expect, it } from 'vitest';
import { cellAt, makeGridSpec } from '../core/grid';
import { FireHistoryKind, FuelFlag, FuelType, type FuelEdit } from '../core/types';
import { buildTerrain, terrainDerived } from '../terrain';
import { plane, TEST_ORIGIN } from '../terrain/testing/synthetic';
import { applyFuelEdit, brushContains, cellsInBrush } from './edits';
import { buildFuelMap, cloneFuelMap, fuelParamsAt, type FuelMapExt } from './fuelMap';
import { aestTime, rasteriseFireHistory, type HistoryRaster } from './history';
import { loadFromFhs } from './hazard';
import { LocalProjection } from '../core/geo';
import { resolveClass } from './catalogue';

const T0 = Date.UTC(2026, 8, 27);
const grid = makeGridSpec(TEST_ORIGIN, 1500, 30);
const terrain = buildTerrain(grid, plane(grid, 0, 0, 800), 'flat');
const derived = terrainDerived(terrain);
const n = grid.nx * grid.ny;
const proj = new LocalProjection(grid.origin);
const ll = (x: number, y: number): [number, number] => {
  const p = proj.toLatLon(x, y);
  return [p.lon, p.lat];
};

/** Base map: Sydney montane DSF, a 2019-20 wildfire over the west half, CHM 18 m / 0.6 everywhere. */
function base(): { fuel: FuelMapExt; history: HistoryRaster } {
  const history = rasteriseFireHistory(
    grid,
    [
      {
        kind: FireHistoryKind.Wildfire, label: 'wf', name: 'wf', startTime: aestTime('2019-12-01', 0), endTime: aestTime('2020-01-20', 12),
        datesKnown: true, startDate: '2019-12-01', endDate: '2020-01-20', season: 2019,
        rings: [[ll(-800, -800), ll(0, -800), ll(0, 800), ll(-800, 800), ll(-800, -800)]],
      },
    ],
    T0,
  );
  const fuel = buildFuelMap({
    terrain, derived, classId: new Uint8Array(n).fill(13), history, t0: T0, droughtFactor: 7, kbdi: 60, month: 9,
    canopy: { height: new Float32Array(n).fill(18), cover: new Float32Array(n).fill(0.6), valid: new Uint8Array(n).fill(1) },
  }) as FuelMapExt;
  return { fuel, history };
}
const circle = (x: number, y: number, radius: number): FuelEdit['shape'] => ({ kind: 'circle', x, y, radius });

describe('brush cells', () => {
  it('circle and polygon select the cells whose centre is inside', () => {
    const c = cellsInBrush(grid, circle(0, 0, 100));
    expect(c.length).toBeGreaterThan(30); // π·100²/900 ≈ 35
    expect(c.length).toBeLessThan(40);
    const p = cellsInBrush(grid, { kind: 'polygon', points: [[-150, -150], [150, -150], [150, 150], [-150, 150]] });
    expect(p.length).toBe(100);
    expect(cellsInBrush(grid, { kind: 'polygon', points: [[0, 0], [1, 1]] }).length).toBe(0);
    expect(brushContains(circle(0, 0, 10), 5, 5)).toBe(true);
    expect(brushContains({ kind: 'polygon', points: [[-1, -1], [1, -1], [1, 1], [-1, 1]] }, 0, 0)).toBe(true);
  });
});

describe('applyFuelEdit (spec §4.8)', () => {
  it('setType: generic class of the type, §4.5 recomputed from the kept history', () => {
    const { fuel, history } = base();
    const b = cloneFuelMap(fuel);
    const kWest = cellAt(grid, -300, 0);
    const kEast = cellAt(grid, 300, 0);
    const edit: FuelEdit = { kind: 'fuel', id: 'e1', shape: circle(0, 0, 400), setType: FuelType.Heath };
    const count = applyFuelEdit(fuel, edit, b, history.compact, T0);
    expect(count).toBeGreaterThan(400);
    for (const k of [kWest, kEast]) {
      expect(fuel.type[k]).toBe(FuelType.Heath);
      expect(fuel.fuelClass![k]).toBe(FuelType.Heath);
      expect(fuel.flags![k]! & FuelFlag.UserEdited).toBeTruthy();
    }
    // Burnt half keeps its fire: heath 6.7 yr after a wildfire (k 0.2) vs steady-state heath in the east.
    const tsf = (T0 - aestTime('2020-01-20', 12)) / (365.25 * 86400e3);
    expect(fuel.surfaceLoad[kWest]).toBeCloseTo(5 * (1 - Math.exp(-0.2 * tsf)), 4);
    expect(fuel.timeSinceFire[kWest]).toBeCloseTo(tsf, 4);
    expect(fuel.surfaceLoad[kEast]).toBeCloseTo(5, 4);
    expect(fuel.wrf![kEast]).toBeCloseTo(1.5, 6);
    expect(fuel.canopyHeight[kEast]).toBe(18); // CHM kept
    // Outside the brush: unchanged.
    const kFar = cellAt(grid, 700, 700);
    expect(fuel.type[kFar]).toBe(FuelType.DryForestShrubby);
    expect(fuel.flags![kFar]! & FuelFlag.UserEdited).toBe(0);
  });

  it('setType NonFuel makes a fire break', () => {
    const { fuel, history } = base();
    applyFuelEdit(fuel, { kind: 'fuel', id: 'road', shape: circle(300, 0, 50), setType: FuelType.NonFuel }, cloneFuelMap(fuel), history.compact, T0);
    const p = fuelParamsAt(fuel, cellAt(grid, 300, 0));
    expect(p.family).toBe('none');
    expect(p.surfaceLoad + p.nearSurfaceLoad + p.elevatedLoad).toBe(0);
    expect(p.hOEff).toBe(0);
  });

  it('setTimeSinceFire: a synthetic p = 1 burn τ years ago (s/ns reset, el and bark halved)', () => {
    const { fuel, history } = base();
    const k = cellAt(grid, 300, 0); // unburnt: steady state before the edit
    applyFuelEdit(fuel, { kind: 'fuel', id: 'bb', shape: circle(300, 0, 60), setTimeSinceFire: 0 }, cloneFuelMap(fuel), history.compact, T0);
    expect(fuel.surfaceLoad[k]).toBeCloseTo(0, 6);
    expect(fuel.nearSurfaceLoad[k]).toBeCloseTo(0, 6);
    expect(fuel.elevatedLoad[k]).toBeCloseTo(4.9 / 2, 5);
    expect(fuel.barkLoad[k]).toBeCloseTo(2.67 / 2, 5);
    expect(fuel.canopyLoad![k]).toBeCloseTo(3.5, 5);
    expect(fuel.timeSinceFire[k]).toBeCloseTo(0, 6);
    expect(fuel.lastFireKind[k]).toBe(FireHistoryKind.PrescribedBurn);
    expect(fuel.flags![k]! & FuelFlag.NoFireRecord).toBe(0);
    const { fuel: f2 } = base();
    applyFuelEdit(f2, { kind: 'fuel', id: 'bb', shape: circle(300, 0, 60), setTimeSinceFire: 3 }, cloneFuelMap(f2), history.compact, T0);
    expect(f2.surfaceLoad[k]).toBeCloseTo(14.5 * (1 - Math.exp(-0.17 * 3)), 4);
    expect(f2.timeSinceFire[k]).toBeCloseTo(3, 5);
  });

  it('a later setType on a cell with a setTimeSinceFire edit keeps the synthetic history', () => {
    const { fuel, history } = base();
    const b = cloneFuelMap(fuel);
    const k = cellAt(grid, 300, 0);
    applyFuelEdit(fuel, { kind: 'fuel', id: 'bb', shape: circle(300, 0, 60), setTimeSinceFire: 2 }, b, history.compact, T0);
    applyFuelEdit(fuel, { kind: 'fuel', id: 'ty', shape: circle(300, 0, 60), setType: FuelType.Heath }, b, history.compact, T0);
    expect(fuel.timeSinceFire[k]).toBeCloseTo(2, 5);
    expect(fuel.surfaceLoad[k]).toBeCloseTo(5 * (1 - Math.exp(-0.2 * 2)), 4);
  });

  it('hazard deltas clamp to 0–4 and set the load from the FHS curve', () => {
    const { fuel, history } = base();
    const k = cellAt(grid, 300, 0);
    const before = fuel.surfaceHazard[k]!;
    applyFuelEdit(
      fuel,
      { kind: 'fuel', id: 'h', shape: circle(300, 0, 60), surfaceHazardDelta: -0.15, nearSurfaceHazardDelta: 5, elevatedHazardDelta: -9, barkHazardDelta: 1 },
      cloneFuelMap(fuel),
      history.compact,
      T0,
    );
    expect(fuel.surfaceHazard[k]).toBeCloseTo(before - 0.15, 5);
    expect(fuel.surfaceLoad[k]).toBeCloseTo(loadFromFhs('surface', before - 0.15), 5);
    expect(fuel.nearSurfaceHazard[k]).toBe(4);
    expect(fuel.nearSurfaceLoad[k]).toBe(4);
    expect(fuel.elevatedHazard[k]).toBe(0);
    expect(fuel.elevatedLoad[k]).toBe(0);
    expect(fuel.barkHazard[k]).toBe(4);
    expect(fuel.barkLoad[k]).toBe(7);
    expect(fuel.flags![k]! & FuelFlag.HeavyFuel).toBeTruthy();
  });

  it('elevatedHeight and moistureDelta (offset clamped to [−10, +40] pp)', () => {
    const { fuel, history } = base();
    const k = cellAt(grid, 0, 0);
    const b = cloneFuelMap(fuel);
    applyFuelEdit(fuel, { kind: 'fuel', id: 'm', shape: circle(0, 0, 40), elevatedHeight: 3.5, moistureDelta: 25 }, b, history.compact, T0);
    expect(fuel.elevatedHeight[k]).toBe(3.5);
    expect(fuel.moistureOffset![k]).toBe(25);
    applyFuelEdit(fuel, { kind: 'fuel', id: 'm2', shape: circle(0, 0, 40), moistureDelta: 25 }, b, history.compact, T0);
    expect(fuel.moistureOffset![k]).toBe(40);
    applyFuelEdit(fuel, { kind: 'fuel', id: 'm3', shape: circle(0, 0, 40), moistureDelta: -100 }, b, history.compact, T0);
    expect(fuel.moistureOffset![k]).toBe(-10);
  });

  it('setType swaps the class moisture offset (class 34 +3 pp at KBDI 60)', () => {
    const fuel = buildFuelMap({ terrain, derived, classId: new Uint8Array(n).fill(34), t0: T0, droughtFactor: 7, kbdi: 60, month: 9 }) as FuelMapExt;
    const k = cellAt(grid, 0, 0);
    expect(fuel.moistureOffset![k]).toBe(3);
    const empty = rasteriseFireHistory(grid, [], T0).compact;
    applyFuelEdit(fuel, { kind: 'fuel', id: 'd', shape: circle(0, 0, 40), moistureDelta: 2 }, cloneFuelMap(fuel), empty, T0);
    expect(fuel.moistureOffset![k]).toBe(5);
    applyFuelEdit(fuel, { kind: 'fuel', id: 't', shape: circle(0, 0, 40), setType: FuelType.Heath }, cloneFuelMap(fuel), empty, T0);
    expect(fuel.moistureOffset![k]).toBe(2);
    expect(resolveClass(fuel.fuelClass![k]!).classId).toBe(FuelType.Heath);
  });

  it('hazard / height edits on non-fuel cells change nothing and are not counted; empty or NaN edits change nothing', () => {
    const { fuel, history } = base();
    applyFuelEdit(fuel, { kind: 'fuel', id: 'road', shape: circle(300, 0, 50), setType: FuelType.NonFuel }, cloneFuelMap(fuel), history.compact, T0);
    const road = cellAt(grid, 300, 0);
    const b = cloneFuelMap(fuel);
    const flagsBefore = fuel.flags![road]!;
    expect(applyFuelEdit(fuel, { kind: 'fuel', id: 'h', shape: circle(300, 0, 40), surfaceHazardDelta: 1, elevatedHeight: 2 }, b, history.compact, T0)).toBe(0);
    expect(fuel.surfaceLoad[road]).toBe(0);
    expect(fuel.flags![road]).toBe(flagsBefore);
    // An edit without any field (or with NaN deltas) touches nothing.
    const k = cellAt(grid, -300, 0);
    const before = fuel.surfaceLoad[k];
    expect(applyFuelEdit(fuel, { kind: 'fuel', id: 'none', shape: circle(-300, 0, 60) }, b, history.compact, T0)).toBe(0);
    expect(applyFuelEdit(fuel, { kind: 'fuel', id: 'nan', shape: circle(-300, 0, 60), surfaceHazardDelta: NaN, moistureDelta: NaN }, b, history.compact, T0)).toBe(0);
    expect(fuel.surfaceLoad[k]).toBe(before);
    expect(fuel.flags![k]! & FuelFlag.UserEdited).toBe(0);
    // A moisture edit on a non-fuel cell still applies (a wet rock shelf seeds nothing, but the offset is the user's).
    expect(applyFuelEdit(fuel, { kind: 'fuel', id: 'm', shape: circle(300, 0, 40), moistureDelta: 3 }, b, history.compact, T0)).toBeGreaterThan(0);
  });

  it('setType on an inferred cell clears InferredVegetation (the user asserted the type); setTimeSinceFire keeps it', () => {
    const history = rasteriseFireHistory(grid, [], T0);
    const fuel = buildFuelMap({ terrain, derived, classId: new Uint8Array(n).fill(255), history, t0: T0, droughtFactor: 7, kbdi: 60, month: 9 }) as FuelMapExt;
    const k = cellAt(grid, 0, 0);
    expect(fuel.flags![k]! & FuelFlag.InferredVegetation).toBeTruthy();
    const b = cloneFuelMap(fuel);
    applyFuelEdit(fuel, { kind: 'fuel', id: 't', shape: circle(0, 0, 40), setTimeSinceFire: 2 }, b, history.compact, T0);
    expect(fuel.flags![k]! & FuelFlag.InferredVegetation).toBeTruthy();
    applyFuelEdit(fuel, { kind: 'fuel', id: 's', shape: circle(0, 0, 40), setType: fuel.type[k] as FuelType }, b, history.compact, T0);
    expect(fuel.flags![k]! & FuelFlag.InferredVegetation).toBe(0);
    expect(fuel.timeSinceFire[k]).toBeCloseTo(2, 5); // the synthetic burn is kept
  });

  it('is repeatable: re-applying the remaining edits to a copy of the base gives the same map (removeEdit)', () => {
    const { fuel: b, history } = base();
    const edits: FuelEdit[] = [
      { kind: 'fuel', id: 'a', shape: circle(0, 0, 300), setType: FuelType.WetForest },
      { kind: 'fuel', id: 'b', shape: circle(100, 0, 200), setTimeSinceFire: 1 },
      { kind: 'fuel', id: 'c', shape: circle(-100, 0, 200), surfaceHazardDelta: 0.5 },
    ];
    const run = (list: FuelEdit[]): FuelMapExt => {
      const w = cloneFuelMap(b);
      for (const e of list) applyFuelEdit(w, e, b, history.compact, T0);
      return w;
    };
    const all = run(edits);
    const again = run(edits);
    expect(Array.from(again.surfaceLoad)).toEqual(Array.from(all.surfaceLoad));
    // Removing edit 'b' and re-applying the rest from the base.
    const without = run([edits[0]!, edits[2]!]);
    const k = cellAt(grid, 150, 0); // unburnt east half, inside edits a and b
    expect(all.timeSinceFire[k]).toBeCloseTo(1, 5);
    expect(Number.isNaN(without.timeSinceFire[k]!)).toBe(true);
    expect(without.type[k]).toBe(FuelType.WetForest);
    expect(without.surfaceLoad[k]).toBeCloseTo(17, 4);
    expect(b.type[k]).toBe(FuelType.DryForestShrubby); // base untouched
    expect(b.syntheticBurnTime).toBeUndefined();
  });
});
