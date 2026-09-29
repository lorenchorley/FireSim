/** Heat-map value fields of the data layers (layers rework): values, units, NO_DATA rules and the categorical flag. */
import { describe, expect, it } from 'vitest';
import { makeGridSpec, type GridSpec } from '../core/grid';
import { EMPTY_CONTEXT, type ContextLayers } from '../core/places';
import { FireHistoryKind, FuelType, Landform, type AtmosphereView, type FuelMap, type Terrain } from '../core/types';
import { CANOPY_MIN_HEIGHT, lightTerrain, overlayField } from './fields';
import { NO_DATA } from './legends';

const origin = { lat: -33.7, lon: 150.3 };
const grid = makeGridSpec(origin, 600, 30); // 20 x 20
const n = grid.nx * grid.ny;

function terrainOn(g: GridSpec): Terrain {
  const z = new Float32Array(g.nx * g.ny);
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) z[j * g.nx + i] = 400 + 2 * i + j;
  const t = lightTerrain({ grid: g, elevation: z, ratio: 1 }, 'test');
  for (let k = 0; k < t.landform.length; k++) t.landform[k] = k % 11;
  return t;
}

function fuelOn(g: GridSpec, type: FuelType = FuelType.DryForestShrubby): FuelMap {
  const m = g.nx * g.ny;
  const a = (v: number): Float32Array => new Float32Array(m).fill(v);
  return {
    grid: g,
    type: new Uint8Array(m).fill(type),
    surfaceHazard: a(3),
    nearSurfaceHazard: a(2),
    nearSurfaceHeight: a(0.3),
    elevatedHazard: a(2.5),
    elevatedHeight: a(1.5),
    barkHazard: a(2),
    surfaceLoad: a(12),
    nearSurfaceLoad: a(4),
    elevatedLoad: a(5),
    barkLoad: a(2),
    canopyHeight: a(20),
    canopyCover: a(0.6),
    curing: a(0),
    timeSinceFire: a(12),
    lastFireKind: new Uint8Array(m),
    sources: [],
  };
}

const terrain = terrainOn(grid);

const values = (kind: Parameters<typeof overlayField>[0], s: Parameters<typeof overlayField>[1]): Float32Array => overlayField(kind, s)!.values;

describe('elevation and landform', () => {
  it('elevation is the ground height in metres on the terrain grid', () => {
    const f = overlayField('elevation', { terrain, fuel: fuelOn(grid) })!;
    expect(f.categorical).toBe(false);
    expect(f.grid).toBe(terrain.grid);
    expect(Array.from(f.values)).toEqual(Array.from(terrain.elevation));
    expect(f.values[3 * grid.nx + 5]).toBeCloseTo(400 + 10 + 3, 4);
  });

  it('landform is categorical and carries the Landform codes', () => {
    const f = overlayField('landform', { terrain, fuel: fuelOn(grid) })!;
    expect(f.categorical).toBe(true);
    for (let k = 0; k < n; k++) expect(f.values[k]).toBe(k % 11);
    expect(new Set(f.values).size).toBe(11);
    expect(Landform.Cliff).toBe(10);
  });
});

describe('canopy fields', () => {
  it('canopyHeight is metres for trees, NO_DATA under 2 m, on water and where the map has no value', () => {
    const fuel = fuelOn(grid);
    fuel.canopyHeight[0] = CANOPY_MIN_HEIGHT - 0.1;
    fuel.canopyHeight[1] = CANOPY_MIN_HEIGHT;
    fuel.canopyHeight[2] = NaN;
    fuel.type[3] = FuelType.Water;
    const f = overlayField('canopyHeight', { terrain, fuel })!;
    expect(f.categorical).toBe(false);
    expect(f.values[0]).toBe(NO_DATA);
    expect(f.values[1]).toBeCloseTo(CANOPY_MIN_HEIGHT, 6);
    expect(f.values[2]).toBe(NO_DATA);
    expect(f.values[3]).toBe(NO_DATA);
    expect(f.values[10]).toBe(20);
  });

  it('canopyCover is a percentage 0-100 (open ground is 0 %, not NO_DATA); water is NO_DATA', () => {
    const fuel = fuelOn(grid);
    fuel.canopyCover[0] = 0;
    fuel.canopyCover[1] = 1.4; // clamped
    fuel.type[2] = FuelType.Water;
    const v = values('canopyCover', { terrain, fuel });
    expect(v[0]).toBe(0);
    expect(v[1]).toBe(100);
    expect(v[2]).toBe(NO_DATA);
    expect(v[10]).toBeCloseTo(60, 4);
  });
});

describe('fuel hazard fields', () => {
  const kinds = [
    ['surfaceHazard', 'surfaceHazard', 3],
    ['nearSurfaceHazard', 'nearSurfaceHazard', 2],
    ['elevatedHazard', 'elevatedHazard', 2.5],
    ['barkHazard', 'barkHazard', 2],
  ] as const;

  for (const [kind, key, v0] of kinds) {
    it(`${kind}: score 0-4 on fuel, NO_DATA on rock, water and missing values`, () => {
      const fuel = fuelOn(grid);
      fuel[key][0] = 9; // clamped to 4
      fuel[key][1] = -1; // clamped to 0
      fuel[key][2] = NaN;
      fuel.type[3] = FuelType.NonFuel;
      fuel.type[4] = FuelType.Water;
      fuel.type[5] = FuelType.Urban; // still fuel: houses and gardens burn
      const f = overlayField(kind, { terrain, fuel })!;
      expect(f.categorical).toBe(false);
      expect(f.values[0]).toBe(4);
      expect(f.values[1]).toBe(0);
      expect(f.values[2]).toBe(NO_DATA);
      expect(f.values[3]).toBe(NO_DATA);
      expect(f.values[4]).toBe(NO_DATA);
      expect(f.values[5]).toBeCloseTo(v0, 6);
      expect(f.values[10]).toBeCloseTo(v0, 6);
      for (let k = 0; k < n; k++) expect(f.values[k] === NO_DATA || (f.values[k]! >= 0 && f.values[k]! <= 4)).toBe(true);
    });
  }

  it('elevatedHeight is metres where there is a shrub layer, else NO_DATA', () => {
    const fuel = fuelOn(grid);
    fuel.elevatedHeight[0] = 0;
    fuel.elevatedHazard[1] = 0; // a height without any shrub hazard is not a shrub layer
    fuel.type[2] = FuelType.NonFuel;
    const f = overlayField('elevatedHeight', { terrain, fuel })!;
    expect(f.categorical).toBe(false);
    expect(f.values[0]).toBe(NO_DATA);
    expect(f.values[1]).toBe(NO_DATA);
    expect(f.values[2]).toBe(NO_DATA);
    expect(f.values[10]).toBeCloseTo(1.5, 6);
  });
});

describe('grassCuring', () => {
  it('is a percentage on grass and grassy fuel types only', () => {
    const fuel = fuelOn(grid);
    const types = [FuelType.Grassland, FuelType.GrassyWoodland, FuelType.AlpineHeathGrass, FuelType.DryForestGrassy, FuelType.DryForestShrubby, FuelType.Heath, FuelType.Water];
    types.forEach((t, k) => {
      fuel.type[k] = t;
      fuel.curing[k] = 85;
    });
    fuel.curing[0] = 130; // clamped
    const f = overlayField('grassCuring', { terrain, fuel })!;
    expect(f.categorical).toBe(false);
    expect(f.values[0]).toBe(100);
    expect(f.values[1]).toBe(85);
    expect(f.values[2]).toBe(85);
    expect(f.values[3]).toBe(85);
    expect(f.values[4]).toBe(NO_DATA);
    expect(f.values[5]).toBe(NO_DATA);
    expect(f.values[6]).toBe(NO_DATA);
  });
});

describe('fireHistoryKind', () => {
  it('is categorical: wildfire 1, prescribed burn 2, unrecorded kind 0; no record is NO_DATA', () => {
    const fuel = fuelOn(grid);
    fuel.lastFireKind[0] = FireHistoryKind.Wildfire;
    fuel.lastFireKind[1] = FireHistoryKind.PrescribedBurn;
    fuel.lastFireKind[2] = FireHistoryKind.Unknown;
    fuel.lastFireKind[3] = 3; // a code the legend does not know is shown as an unrecorded kind
    fuel.timeSinceFire[4] = NaN;
    fuel.lastFireKind[4] = FireHistoryKind.Wildfire;
    const f = overlayField('fireHistoryKind', { terrain, fuel })!;
    expect(f.categorical).toBe(true);
    expect(f.values[0]).toBe(1);
    expect(f.values[1]).toBe(2);
    expect(f.values[2]).toBe(0);
    expect(f.values[3]).toBe(0);
    expect(f.values[4]).toBe(NO_DATA);
  });
});

describe('context fields', () => {
  const ctx = (homes: number[], roads: number[][]): ContextLayers => ({
    ...EMPTY_CONTEXT(origin),
    homes: Float32Array.from(homes),
    roads: roads.map((xy) => ({ cls: 'local' as const, surface: 1 as const, xy: Float32Array.from(xy), lengthM: 0 })),
  });

  it('homeDensity and roadAccess are null without a context (the UI says "not available here")', () => {
    expect(overlayField('homeDensity', { terrain, fuel: fuelOn(grid) })).toBeNull();
    expect(overlayField('roadAccess', { terrain, fuel: fuelOn(grid), context: null })).toBeNull();
  });

  it('homeDensity is homes per hectare on the fuel grid and NO_DATA where no home is near', () => {
    const c = ctx([0, 0, 10, 10, -10, 5], []);
    const f = overlayField('homeDensity', { terrain, fuel: fuelOn(grid), context: c })!;
    expect(f.categorical).toBe(false);
    expect(f.grid).toBe(grid);
    let dense = 0;
    let empty = 0;
    for (let k = 0; k < n; k++) {
      if (f.values[k] === NO_DATA) empty++;
      else {
        dense++;
        expect(f.values[k]!).toBeGreaterThan(0);
      }
    }
    expect(dense).toBeGreaterThan(0);
    expect(empty).toBeGreaterThan(0);
    // The cell nearest the cluster sees all three homes within ~150 m.
    const centre = Math.round((0 - grid.y0) / 30) * grid.nx + Math.round((0 - grid.x0) / 30);
    expect(f.values[centre]!).toBeGreaterThan(0.3);
    // A ctx with no homes has no density anywhere.
    expect(new Set(overlayField('homeDensity', { terrain, fuel: fuelOn(grid), context: ctx([], []) })!.values)).toEqual(new Set([NO_DATA]));
  });

  it('roadAccess is the distance in metres to the nearest road; NO_DATA everywhere when there are none', () => {
    const c = ctx([], [[-300, 0, 300, 0]]);
    const f = overlayField('roadAccess', { terrain, fuel: fuelOn(grid), context: c })!;
    expect(f.categorical).toBe(false);
    const at = (x: number, y: number): number => f.values[Math.round((y - grid.y0) / 30) * grid.nx + Math.round((x - grid.x0) / 30)]!;
    expect(at(0, 0)).toBeLessThan(20); // on the road (cell centres are 15 m off at worst)
    expect(at(0, 150)).toBeGreaterThan(120);
    expect(at(0, 150)).toBeLessThan(170);
    expect(new Set(overlayField('roadAccess', { terrain, fuel: fuelOn(grid), context: ctx([], []) })!.values)).toEqual(new Set([NO_DATA]));
  });
});

describe('windSpeed', () => {
  const atmGrid = makeGridSpec(origin, 600, 150); // 4 x 4
  const m = atmGrid.nx * atmGrid.ny;
  const atmosphere = (u: number[], v: number[]): AtmosphereView =>
    ({ grid: atmGrid, nz: 1, levels: new Float32Array(1), terrainHeight: new Float32Array(m), surfaceU: Float32Array.from(u), surfaceV: Float32Array.from(v) }) as unknown as AtmosphereView;

  it('is null without an atmosphere view', () => {
    expect(overlayField('windSpeed', { terrain, fuel: fuelOn(grid) })).toBeNull();
    expect(overlayField('windSpeed', { terrain, fuel: fuelOn(grid), atmosphere: null })).toBeNull();
  });

  it('is the surface wind speed in km/h on the atmosphere grid', () => {
    const u = new Array<number>(m).fill(3);
    const v = new Array<number>(m).fill(4); // 5 m/s = 18 km/h
    u[1] = 0;
    v[1] = 0; // calm
    u[2] = NaN; // a broken cell has no value
    const f = overlayField('windSpeed', { terrain, fuel: fuelOn(grid), atmosphere: atmosphere(u, v) })!;
    expect(f.categorical).toBe(false);
    expect(f.grid).toBe(atmGrid);
    expect(f.values[0]).toBeCloseTo(18, 4);
    expect(f.values[1]).toBe(0);
    expect(f.values[2]).toBe(NO_DATA);
  });

  it('ignores an atmosphere whose fields do not match its grid', () => {
    const bad = atmosphere([1, 2, 3], [1, 2, 3]);
    expect(overlayField('windSpeed', { terrain, fuel: fuelOn(grid), atmosphere: bad })).toBeNull();
  });
});
