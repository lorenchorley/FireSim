/** The layer catalog: complete (every LayerState key and OverlayKind exactly once), plain wording, availability rules. */
import { describe, expect, it } from 'vitest';
import { CANOPY_NATIVE_CELL_LABEL, type DatasetRecord } from '../core/datasets';
import { makeGridSpec } from '../core/grid';
import { EMPTY_CONTEXT, type ContextLayers } from '../core/places';
import { BurnState, FuelType, SpreadDriver, type AtmosphereView, type FireField, type FuelMap } from '../core/types';
import { lightTerrain, overlayField } from './fields';
import {
  HEAT_OVERLAY_KINDS,
  LAYER_CATALOG,
  LAYER_GROUPS,
  LAYER_GROUP_BLURBS,
  LAYER_SETTING_KEYS,
  OVERLAY_KINDS,
  SCENE_LAYER_KEYS,
  availabilityContext,
  fuelHasGrass,
  layerById,
  layerDimension,
  layerFactsOfDatasets,
  layerForOverlay,
  layerForSceneKey,
  layersInGroup,
  sceneLayerOn,
  sceneLayerPatch,
  type AvailabilityContext,
  type LayerInfo,
  type SceneLayerKey,
} from './layerCatalog';
import { DEFAULT_LAYERS, type LayerState } from './layers';
import { legendFor } from './legends';

const NONE: AvailabilityContext = { hasFire: false, has3dAtmosphere: false, hasContext: false, hasGrass: false, hasCanopyData: false, hasImagery: false };
const ALL: AvailabilityContext = { hasFire: true, has3dAtmosphere: true, hasContext: true, hasGrass: true, hasCanopyData: true, hasImagery: true };
const info = (id: string): LayerInfo => layerById(id)!;

describe('catalog completeness', () => {
  it('has the five groups in the agreed order, each with a blurb and at least one layer', () => {
    expect([...LAYER_GROUPS]).toEqual(['Ground and terrain', 'Vegetation and fuel', 'Fire and weather', 'Places', 'Simulation visuals']);
    for (const g of LAYER_GROUPS) {
      expect(layersInGroup(g).length, g).toBeGreaterThan(0);
      expect(LAYER_GROUP_BLURBS[g]).toMatch(/^[A-Z].*\.$/);
    }
    // Catalog order follows the group order.
    const order = LAYER_CATALOG.map((l) => LAYER_GROUPS.indexOf(l.group));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('ids and titles are unique', () => {
    expect(new Set(LAYER_CATALOG.map((l) => l.id)).size).toBe(LAYER_CATALOG.length);
    expect(new Set(LAYER_CATALOG.map((l) => l.title)).size).toBe(LAYER_CATALOG.length);
    for (const l of LAYER_CATALOG) expect(l.id).toMatch(/^[a-zA-Z][a-zA-Z0-9]*$/);
  });

  it('every scene layer key of LayerState appears exactly once, and only scene keys do', () => {
    const scenes = LAYER_CATALOG.filter((l) => l.scene).map((l) => l.scene!);
    expect(new Set(scenes).size).toBe(scenes.length);
    expect([...scenes].sort()).toEqual([...SCENE_LAYER_KEYS].sort());
  });

  it('every LayerState key is either a layer switch or a display setting', () => {
    const keys = Object.keys(DEFAULT_LAYERS).sort();
    expect([...SCENE_LAYER_KEYS, ...LAYER_SETTING_KEYS].sort()).toEqual(keys);
    for (const k of SCENE_LAYER_KEYS) expect(LAYER_SETTING_KEYS as string[]).not.toContain(k);
    expect(LAYER_SETTING_KEYS).toEqual(expect.arrayContaining(['overlay', 'overlayOpacity', 'canopyStyle', 'canopyCode', 'soloHeat', 'windSway']));
  });

  it('every OverlayKind except "none" appears exactly once as a heat map', () => {
    const heats = LAYER_CATALOG.filter((l) => l.heat).map((l) => l.heat!.overlay);
    expect(new Set(heats).size).toBe(heats.length);
    expect([...heats].sort()).toEqual([...HEAT_OVERLAY_KINDS].sort());
    expect(OVERLAY_KINDS).toContain('none');
    expect(HEAT_OVERLAY_KINDS).not.toContain('none');
    expect(HEAT_OVERLAY_KINDS.length).toBe(OVERLAY_KINDS.length - 1);
    expect(layerForOverlay('none')).toBeUndefined();
    for (const k of HEAT_OVERLAY_KINDS) expect(layerForOverlay(k)?.heat?.overlay).toBe(k);
    for (const k of SCENE_LAYER_KEYS) expect(layerForSceneKey(k)?.scene).toBe(k);
  });

  it('kind matches the fields each entry has', () => {
    for (const l of LAYER_CATALOG) {
      expect(l.kind === 'scene' || l.kind === 'heat' || l.kind === 'both').toBe(true);
      expect(!!l.scene, l.id).toBe(l.kind !== 'heat');
      expect(!!l.heat, l.id).toBe(l.kind !== 'scene');
    }
    expect(LAYER_CATALOG.filter((l) => l.kind === 'both').map((l) => l.id).sort()).toEqual(['homes', 'roads', 'understorey']);
  });
});

describe('plain wording', () => {
  it('titles are short; what and why are one plain sentence each', () => {
    for (const l of LAYER_CATALOG) {
      expect(l.title.length, l.title).toBeLessThanOrEqual(24);
      expect(l.title.trim()).toBe(l.title);
      for (const t of [l.what, l.why]) {
        expect(t, `${l.id}: ${t}`).toMatch(/^[A-Z0-9].*\.$/);
        expect(t.match(/[.!?] [A-Z]/), `${l.id}: ${t}`).toBeNull();
        expect(t.length).toBeLessThanOrEqual(190);
        expect(t).not.toMatch(/undefined|NaN|\[object/);
      }
    }
  });

  it('heat layers give a unit, and the categorical flag agrees with the legend and with the field', () => {
    const g = makeGridSpec({ lat: -33.7, lon: 150.3 }, 300, 30);
    const n = g.nx * g.ny;
    const a = (v: number): Float32Array => new Float32Array(n).fill(v);
    const fuel = {
      grid: g,
      type: new Uint8Array(n).fill(FuelType.GrassyWoodland),
      surfaceHazard: a(3),
      nearSurfaceHazard: a(2),
      nearSurfaceHeight: a(0.3),
      elevatedHazard: a(3),
      elevatedHeight: a(1.5),
      barkHazard: a(2),
      surfaceLoad: a(12),
      nearSurfaceLoad: a(4),
      elevatedLoad: a(5),
      barkLoad: a(2),
      canopyHeight: a(20),
      canopyCover: a(0.6),
      curing: a(60),
      timeSinceFire: a(8),
      lastFireKind: new Uint8Array(n).fill(1),
      sources: [],
    } as FuelMap;
    const terrain = lightTerrain({ grid: g, elevation: a(500), ratio: 1 }, 'test');
    const fire: FireField = {
      grid: g,
      arrivalTime: a(100),
      burnState: new Uint8Array(n).fill(BurnState.BurntOut),
      ros: a(0.1),
      intensity: a(2000),
      flameHeight: a(2),
      spreadDir: a(0),
      driver: new Uint8Array(n).fill(SpreadDriver.Wind),
      phase: new Uint8Array(n),
    };
    const context: ContextLayers = { ...EMPTY_CONTEXT(g.origin), homes: Float32Array.of(0, 0), roads: [{ cls: 'local', surface: 1, xy: Float32Array.of(-100, 0, 100, 0), lengthM: 200 }] };
    const atmosphere = { grid: g, nz: 1, levels: a(0), terrainHeight: a(0), surfaceU: a(3), surfaceV: a(4) } as unknown as AtmosphereView;
    const layers = Object.fromEntries(['vls', 'attach', 'trench', 'dmz', 'landing'].map((k) => [k, a(0.5)]));
    const sources = { terrain, fuel, fire, moisture: a(8), insolation: a(600), layers, context, atmosphere };
    for (const k of HEAT_OVERLAY_KINDS) {
      const l = layerForOverlay(k)!;
      expect(l.heat!.unit.length, k).toBeGreaterThan(0);
      const field = overlayField(k, sources);
      expect(field, k).not.toBeNull();
      expect(field!.categorical, k).toBe(l.heat!.categorical);
      const legend = legendFor(k, { elevationRange: [400, 900] })!;
      expect(legend.kind === 'categorical', k).toBe(l.heat!.categorical);
      expect(l.heat!.categorical ? legend.units === '' && l.heat!.unit === 'categories' : legend.units === l.heat!.unit, `${k}: '${legend.units}' vs '${l.heat!.unit}'`).toBe(true);
    }
  });

  it('every layer has a plain data source, resolution and dimension, with and without a scenario', () => {
    for (const l of LAYER_CATALOG) {
      for (const sc of [undefined, { fireCellSize: 30, fuelSources: ['x'], context: null }]) {
        for (const t of [l.source(sc), l.resolution(sc)]) {
          expect(t.length, l.id).toBeGreaterThan(8);
          expect(t).not.toMatch(/undefined|NaN|\[object|null/);
        }
      }
      expect(['2.5-D terrain', '3-D objects', '3-D volume', '2-D labels', '2-D slice']).toContain(l.dimension);
    }
  });

  it('resolution and source follow the scenario', () => {
    expect(info('elevation').resolution({ fireCellSize: 20 })).toMatch(/^20 m cells/);
    expect(info('fuelType').resolution({ fireCellSize: 30 })).toContain('30 m');
    expect(info('canopyHeight').resolution({ fireCellSize: 30 })).toMatch(/^20 m canopy map.*30 m/);
    expect(info('imagery').resolution()).toBe('8 m pixels');
    expect(info('elevation').source({ terrainSource: 'AWS Terrain Tiles (SRTM 1″)' })).toBe('AWS Terrain Tiles (SRTM 1″)');
    expect(info('windSpeed').resolution({ atmosphereCellSize: 150 })).toMatch(/^150 m/);
    expect(info('canopyCover').source({ fuelSources: ['NSW SVTM', 'Meta & WRI 1 m canopy height (Tolan et al. 2024, CC BY 4.0)'] })).toMatch(/Meta & WRI/);
  });

  it('the ground and the canopy are worded from the data really used (no LiDAR, no fixed 20 m)', () => {
    const interpolated = { fireCellSize: 30, terrainHiResCellSize: 10, terrainNativeCellSize: 30 };
    expect(info('elevation').resolution(interpolated)).toContain('drawn on a 10 m grid smoothly interpolated from 30 m heights');
    expect(info('elevation').resolution({ fireCellSize: 30, terrainHiResCellSize: 10, terrainNativeCellSize: 5 })).toBe('30 m cells for the colours; the 3-D ground is drawn on a finer 10 m grid');
    expect(info('canopyHeight').resolution({ fireCellSize: 30, canopyCellSize: 30 })).toMatch(/^30 m canopy map.*30 m/);
    expect(info('canopyHeight').resolution({ fireCellSize: 30 })).toMatch(/^20 m canopy map/);
    for (const l of LAYER_CATALOG) for (const sc of [undefined, interpolated]) expect(`${l.source(sc)} ${l.resolution(sc)}`, l.id).not.toMatch(/LiDAR/);
  });

  it('the smoke is a 3-D volume only with the 3-D atmosphere; the wind streaks read a 3-D wind on both tiers (the fast tier publishes its diagnosed wind through the air, plan 7.3)', () => {
    const fast = { atmosphere3d: false, atmosphereCellSize: 133 };
    const air = { atmosphere3d: true, atmosphereCellSize: 133 };
    expect(layerDimension(info('smoke'), fast)).toBe('3-D objects');
    expect(layerDimension(info('smoke'), air)).toBe('3-D volume');
    expect(layerDimension(info('smoke'))).toBe('3-D volume'); // not known yet: described for the 3-D air
    expect(layerDimension(info('wind'), fast)).toBe('3-D volume');
    expect(layerDimension(info('wind'), air)).toBe('3-D volume');
    expect(layerDimension(info('wind'))).toBe('3-D volume');
    expect(info('smoke').resolution(fast)).toMatch(/one drawn column.*no smoke field/i);
    expect(info('smoke').source(fast)).toMatch(/does not simulate smoke/);
    expect(info('wind').resolution(fast)).toBe('133 m grid of wind cells (the diagnosed wind), drawn as streaks');
    expect(info('wind').resolution({ atmosphere3d: false })).toBe('Wind cells of the diagnosed wind, drawn as streaks');
    expect(info('wind').resolution(air)).toBe('133 m grid of atmosphere cells, drawn as streaks');
    // The fast mode's streaks are the diagnosed wind, and the text says what that leaves out: not a "surface wind only", not "bent around".
    expect(info('wind').source(fast)).toMatch(/diagnosed wind: the forecast wind fitted to the terrain.*terrain effects only, so there is no plume in it/);
    for (const text of [info('wind').source(fast), info('wind').resolution(fast), info('wind').resolution({ atmosphere3d: false })]) expect(text).not.toMatch(/surface wind|surface field|[—–]/);
    expect(info('crossSection').dimension).toBe('2-D slice');
    for (const l of LAYER_CATALOG) if (l.id !== 'smoke') expect(layerDimension(l, fast), l.id).toBe(l.dimension);
  });

  it('layerFactsOfDatasets reads the ground and canopy resolutions of the records, and ignores made-up ground and a missing canopy map', () => {
    const rec = (id: string, origin: string, extra: object): DatasetRecord => ({ id, origin, stats: [], ...extra }) as unknown as DatasetRecord;
    expect(layerFactsOfDatasets([rec('terrain', 'live', { native: { resolutionM: 30 } }), rec('canopy-height', 'live', { stats: [{ label: CANOPY_NATIVE_CELL_LABEL, value: '30 m', raw: 30 }] })])).toEqual({ terrainNativeCellSize: 30, canopyCellSize: 30 });
    expect(layerFactsOfDatasets([rec('terrain', 'synthetic', { native: { resolutionM: 30 } }), rec('canopy-height', 'none', { stats: [{ label: CANOPY_NATIVE_CELL_LABEL, value: '30 m', raw: 30 }] })])).toEqual({});
    expect(layerFactsOfDatasets(undefined)).toEqual({});
  });

  it('places layers quote the official source of the loaded data', () => {
    const context = {
      fetched: '2026-09-29',
      sources: [
        { id: 'roads' as const, title: 'Roads and tracks', provider: 'Spatial Services NSW', layer: 'x', url: 'u', licence: 'CC BY 4.0', attribution: 'a', fetched: '2026-09-29' },
        { id: 'zones' as const, title: 'Land zoning', provider: 'NSW Planning', layer: 'x', url: 'u', licence: 'CC BY 4.0', attribution: 'a', fetched: '2026-09-28' },
      ],
    };
    expect(info('roads').source({ context })).toBe('Spatial Services NSW: Roads and tracks (CC BY 4.0), fetched 2026-09-29');
    expect(info('zones').source({ context })).toContain('NSW Planning');
    expect(info('homes').source({ context })).toMatch(/NSW Spatial Services address points/); // not in this run's sources: the default
  });
});

describe('availability', () => {
  const a = (id: string, ctx: AvailabilityContext) => info(id).available(ctx);

  it('fire results need a fire', () => {
    for (const id of ['arrival', 'ros', 'intensity', 'driver', 'moisture', 'landing', 'vls', 'attach', 'trench', 'dmz']) {
      expect(a(id, NONE), id).toEqual({ ok: false, reason: 'Needs a fire: mark one first' });
      expect(a(id, ALL).ok, id).toBe(true);
      expect(a(id, ALL).reason).toBeUndefined();
    }
  });

  it('wind speed needs an air picture, and the 3-D atmosphere when the picture does not say what air it is', () => {
    expect(a('windSpeed', { ...ALL, has3dAtmosphere: false })).toEqual({ ok: false, reason: 'Needs the 3-D atmosphere: switch it on in Settings' });
    expect(a('windSpeed', { ...ALL, hasFire: false }).ok).toBe(false);
    expect(a('windSpeed', ALL).ok).toBe(true);
  });

  it('the air slice is available on any air with a 3-D wind: the 3-D atmosphere and the fast tier’s diagnosed wind', () => {
    expect(a('crossSection', ALL).ok).toBe(true);
    expect(a('crossSection', { ...ALL, hasFire: false }).ok).toBe(true); // it slices the air whether or not a fire exists
    const fastTier = { ...ALL, has3dAtmosphere: false, hasAirWind: true };
    expect(a('crossSection', fastTier)).toEqual({ ok: true });
    // No air picture at all (before the first one): the reason is to wait for the simulation, not to change a setting.
    const none = { ok: false, reason: 'Needs the air picture, which the simulation makes once it has started' };
    expect(a('crossSection', { ...ALL, has3dAtmosphere: false, hasAirWind: false })).toEqual(none);
    expect(a('crossSection', { ...ALL, has3dAtmosphere: false })).toEqual(none); // a context that does not say: the 3-D atmosphere decides
    expect(a('crossSection', { ...ALL, has3dAtmosphere: true, hasAirWind: false })).toEqual(none);
  });

  it('the air slice says which air it shows in its source and resolution, for both kinds', () => {
    const cs = info('crossSection');
    expect(cs.source({ atmosphere3d: true })).toBe('FireSim 3-D atmosphere, computed on this device');
    expect(cs.source()).toBe('FireSim 3-D atmosphere, computed on this device');
    expect(cs.source({ atmosphere3d: false })).toMatch(/forecast wind fitted to the terrain/);
    expect(cs.source({ atmosphere3d: false })).toMatch(/no plume, temperature or smoke/);
    expect(cs.resolution({ atmosphere3d: true, atmosphereCellSize: 133 })).toBe('133 m atmosphere cells');
    expect(cs.resolution()).toBe('100 to 270 m atmosphere cells');
    expect(cs.resolution({ atmosphere3d: false, atmosphereCellSize: 133 })).toMatch(/^133 m wind cells, fitted again for each weather record/);
    for (const text of [cs.title, cs.what, cs.why, cs.source({ atmosphere3d: false }), cs.resolution({ atmosphere3d: false })]) expect(text).not.toMatch(/[—–]/);
  });

  it('wind speed also shows in the fast tier, whose diagnosed wind carries the 10 m wind (plan 7.5 step 4), and says where it comes from', () => {
    const fastTier = { ...ALL, has3dAtmosphere: false, hasAirWind: true };
    expect(a('windSpeed', fastTier).ok).toBe(true);
    expect(a('windSpeed', { ...fastTier, hasFire: false })).toEqual({ ok: false, reason: 'Needs a fire: mark one first' });
    // No air picture at all (before the first one, or a view without wind): the old reason.
    expect(a('windSpeed', { ...ALL, has3dAtmosphere: false, hasAirWind: false })).toEqual({ ok: false, reason: 'Needs the 3-D atmosphere: switch it on in Settings' });
    expect(info('windSpeed').source({ atmosphere3d: false })).toMatch(/forecast wind fitted to the terrain/);
    expect(info('windSpeed').source({ atmosphere3d: true })).toMatch(/3-D atmosphere model/);
    expect(info('windSpeed').resolution({ atmosphere3d: false, atmosphereCellSize: 133 })).toMatch(/^133 m wind cells, fitted again for each weather record/);
    expect(info('windSpeed').resolution({ atmosphereCellSize: 150 })).toMatch(/^150 m atmosphere cells/);
  });

  it('wind speed says it is the air model’s wind, not always the wind the fire feels: on a calm night the two can differ a lot (measured by the 0.4.0 verifier, plan 18.4)', () => {
    const ws = info('windSpeed');
    expect(ws.why).toBe('Wind is the biggest driver of a fire, and ridges and gaps funnel it hardest; on a calm night the wind the fire feels can differ a lot from this map.');
    // The map's own legend says the same, and says what the colours are (the model's 10 m wind, fitted to the terrain) on either tier.
    const note = legendFor('windSpeed')!.note!;
    expect(note).toContain('this map shows the model’s wind about 10 m above the ground, fitted to the terrain');
    expect(note).toContain('on a calm night can differ a lot from the wind the fire feels');
    for (const text of [ws.why, note]) expect(text).not.toMatch(/[—–]/);
  });

  it('places layers need their data and name what is missing', () => {
    const cases: [string, string][] = [
      ['roads', 'No road data for this place'],
      ['fireTrails', 'No fire-trail data for this place'],
      ['homes', 'No home address data for this place'],
      ['zones', 'No land-use zone data for this place'],
      ['placeNames', 'No place-name data for this place'],
    ];
    for (const [id, reason] of cases) {
      expect(a(id, NONE), id).toEqual({ ok: false, reason });
      expect(a(id, ALL).ok, id).toBe(true);
    }
    // Context loaded but with no homes or no roads at all.
    expect(a('homes', { ...ALL, hasHomes: false }).ok).toBe(false);
    expect(a('roads', { ...ALL, hasRoads: false }).reason).toBe('No road data for this place');
    expect(a('fireTrails', { ...ALL, hasRoads: false }).ok).toBe(false);
    expect(a('zones', { ...ALL, hasHomes: false, hasRoads: false }).ok).toBe(true);
  });

  it('grass, canopy and aerial photo layers need their data', () => {
    expect(a('grassCuring', NONE)).toEqual({ ok: false, reason: 'No grass in this place' });
    expect(a('canopyHeight', NONE).reason).toBe('No tree-height data for this place');
    expect(a('canopyCover', NONE).reason).toBe('No tree-cover data for this place');
    expect(a('imagery', NONE).reason).toBe('No aerial photo for this place');
    for (const id of ['grassCuring', 'canopyHeight', 'canopyCover', 'imagery']) expect(a(id, ALL).ok, id).toBe(true);
  });

  it('terrain, fuel and visual layers are always available', () => {
    for (const id of ['elevation', 'slope', 'aspect', 'landform', 'insolation', 'fuelType', 'fuelLoad', 'timeSinceFire', 'fireHistoryKind', 'surfaceHazard', 'nearSurfaceHazard', 'elevatedHazard', 'barkHazard', 'understorey', 'canopy3d', 'flames', 'smoke', 'embers', 'wind', 'insightMarkers']) {
      expect(a(id, NONE), id).toEqual({ ok: true });
    }
  });

  it('every reason is a plain, non-empty sentence fragment', () => {
    for (const l of LAYER_CATALOG) {
      const r = l.available(NONE);
      if (!r.ok) {
        expect(r.reason, l.id).toMatch(/^[A-Z][^.]*[a-z]$/);
        expect(r.reason).not.toMatch(/undefined/);
      } else expect(r.reason).toBeUndefined();
    }
  });
});

describe('availabilityContext builder', () => {
  const fuel = (types: number[], sources: string[]): Pick<FuelMap, 'type' | 'sources'> => ({ type: Uint8Array.from(types), sources });
  const ctx = (homes: number, roads: number): ContextLayers => ({
    ...EMPTY_CONTEXT({ lat: 0, lon: 0 }),
    homes: new Float32Array(homes * 2),
    roads: Array.from({ length: roads }, () => ({ cls: 'local' as const, surface: 1 as const, xy: Float32Array.of(0, 0, 1, 1), lengthM: 1 })),
  });

  it('derives every flag from the objects the app has', () => {
    expect(availabilityContext({})).toEqual({ hasFire: false, has3dAtmosphere: false, hasAirWind: false, hasContext: false, hasGrass: false, hasCanopyData: false, hasImagery: false, hasHomes: false, hasRoads: false });
    const full = availabilityContext({
      fuel: fuel([FuelType.Grassland, FuelType.Heath], ['NSW SVTM', 'Meta & WRI 1 m canopy height (Tolan et al. 2024, CC BY 4.0)']),
      snapshot: { atmosphere: { nz: 20 } as AtmosphereView },
      context: ctx(3, 2),
      hasImagery: true,
    });
    // (a bare `{ nz: 20 }` has no arrays to sample, so it is the 3-D atmosphere by `kind` but holds no wind)
    expect(full).toEqual({ hasFire: true, has3dAtmosphere: true, hasAirWind: false, hasContext: true, hasGrass: true, hasCanopyData: true, hasImagery: true, hasHomes: true, hasRoads: true });
    const surfaceOnly = availabilityContext({ fuel: fuel([FuelType.WetForest], ['Canopy: type defaults']), snapshot: { atmosphere: undefined as unknown as AtmosphereView }, context: ctx(0, 0), fire: true });
    expect(surfaceOnly).toMatchObject({ hasFire: true, has3dAtmosphere: false, hasGrass: false, hasCanopyData: false, hasContext: true, hasHomes: false, hasRoads: false });
    // A surface-only view (nz = 0) is not the 3-D atmosphere and holds no 3-D wind.
    expect(availabilityContext({ snapshot: { atmosphere: { nz: 0 } as AtmosphereView } })).toMatchObject({ has3dAtmosphere: false, hasAirWind: false });
    // The fast tier's diagnosed wind is a 3-D wind but not the 3-D atmosphere; the time-stepped air is both.
    const volume = (kind?: 'prognostic' | 'diagnosed'): AtmosphereView => {
      const grid = makeGridSpec({ lat: 0, lon: 0 }, 300, 100);
      const n = grid.nx * grid.ny * 2;
      const a = (): Float32Array => new Float32Array(n);
      const none = new Float32Array(0);
      const diagnosed = kind === 'diagnosed';
      return { grid, nz: 2, levels: Float32Array.of(10, 40), terrainHeight: new Float32Array(grid.nx * grid.ny), ...(kind ? { kind } : {}), surfaceU: new Float32Array(grid.nx * grid.ny), surfaceV: new Float32Array(grid.nx * grid.ny), u: a(), v: a(), w: a(), thetaAnomaly: diagnosed ? none : a(), smoke: diagnosed ? none : a() };
    };
    expect(availabilityContext({ snapshot: { atmosphere: volume('diagnosed') } })).toMatchObject({ has3dAtmosphere: false, hasAirWind: true });
    expect(availabilityContext({ snapshot: { atmosphere: volume('prognostic') } })).toMatchObject({ has3dAtmosphere: true, hasAirWind: true });
    expect(availabilityContext({ snapshot: { atmosphere: volume() } })).toMatchObject({ has3dAtmosphere: true, hasAirWind: true }); // a view made before `kind` existed
    // A marked fire counts before the first snapshot arrives.
    expect(availabilityContext({ fire: true }).hasFire).toBe(true);
    expect(availabilityContext({ snapshot: { atmosphere: undefined as unknown as AtmosphereView }, fire: false }).hasFire).toBe(false);
  });

  it('finds grass among the fuel types', () => {
    expect(fuelHasGrass({ type: Uint8Array.of(FuelType.Heath, FuelType.DryForestGrassy) })).toBe(true);
    expect(fuelHasGrass({ type: Uint8Array.of(FuelType.Heath, FuelType.PinePlantation) })).toBe(false);
  });
});

describe('scene layer switches', () => {
  const state = (over: Partial<LayerState> = {}): LayerState => ({ ...DEFAULT_LAYERS, crossSection: { ...DEFAULT_LAYERS.crossSection }, ...over });

  it('reads and writes every scene key, including wind and the air slice', () => {
    for (const key of SCENE_LAYER_KEYS) {
      const s = state();
      for (const on of [true, false]) {
        const patch = sceneLayerPatch(s, key, on);
        const next = { ...s, ...patch } as LayerState;
        expect(sceneLayerOn(next, key), `${key} ${on}`).toBe(on);
        // The patch touches only its own key.
        expect(Object.keys(patch)).toEqual([key]);
      }
    }
  });

  it('wind keeps the mode it was in, and turns on to the surface wind', () => {
    expect(sceneLayerPatch(state({ wind: 'off' }), 'wind', true)).toEqual({ wind: 'surface' });
    expect(sceneLayerPatch(state({ wind: 'volume' }), 'wind', true)).toEqual({ wind: 'volume' });
    expect(sceneLayerPatch(state({ wind: 'volume' }), 'wind', false)).toEqual({ wind: 'off' });
    const cs = state({ crossSection: { enabled: false, azimuth: 40, centre: [1, 2] } });
    expect(sceneLayerPatch(cs, 'crossSection', true)).toEqual({ crossSection: { enabled: true, azimuth: 40, centre: [1, 2] } });
  });

  it('SceneLayerKey values are LayerState keys', () => {
    const keys: SceneLayerKey[] = SCENE_LAYER_KEYS;
    for (const k of keys) expect(k in DEFAULT_LAYERS).toBe(true);
  });
});

describe('arrows and flow lines (windGlyphs, 0.5.0)', () => {
  const g = info('windGlyphs');
  const fastTier = { ...ALL, has3dAtmosphere: false, hasAirWind: true };

  it('is one scene row in Simulation visuals, before the air slice, with its own state keys (the switch, and the height as a setting)', () => {
    expect(g.group).toBe('Simulation visuals');
    expect(g.kind).toBe('scene');
    expect(g.scene).toBe('windGlyphs');
    expect(g.title).toBe('Arrows and flow lines');
    expect(g.title.length).toBeLessThanOrEqual(24);
    expect(g.dimension).toBe('2.5-D terrain');
    expect(LAYER_CATALOG.findIndex((l) => l.id === 'windGlyphs')).toBeLessThan(LAYER_CATALOG.findIndex((l) => l.id === 'crossSection'));
    expect(SCENE_LAYER_KEYS).toContain('windGlyphs');
    expect(LAYER_SETTING_KEYS).toContain('windHeight');
    expect(SCENE_LAYER_KEYS as string[]).not.toContain('windHeight');
    expect(DEFAULT_LAYERS.windGlyphs).toBe(false); // opt in
    expect(DEFAULT_LAYERS.windHeight).toBe('fire');
  });

  it('is available on any air with a 3-D wind, on both tiers, with or without a fire, and waits for the simulation otherwise', () => {
    const a = (c: AvailabilityContext) => g.available(c);
    expect(a(ALL)).toEqual({ ok: true });
    expect(a({ ...ALL, hasFire: false }).ok).toBe(true); // it draws the air whether or not a fire exists
    expect(a(fastTier)).toEqual({ ok: true });
    // Before the first snapshot, and a picture with no wind: the reason is to wait for the simulation, not to change a setting.
    const waits = { ok: false, reason: 'Needs the air picture, which the simulation makes once it has started' };
    expect(a({ ...ALL, has3dAtmosphere: false, hasAirWind: false })).toEqual(waits);
    expect(a({ ...ALL, has3dAtmosphere: true, hasAirWind: false })).toEqual(waits);
    expect(a({ ...ALL, has3dAtmosphere: false })).toEqual(waits); // a context that does not say: the 3-D atmosphere decides
    expect(a(NONE)).toEqual(waits);
  });

  it('follows the real snapshots: none (before the first picture), a view with a wind of either kind, a view with no levels', () => {
    const grid = makeGridSpec(0, 0, 4, 4, 133);
    const wind = (kind: 'prognostic' | 'diagnosed'): AtmosphereView => {
      const n = grid.nx * grid.ny * 2;
      return { grid, nz: 2, kind, u: new Float32Array(n), v: new Float32Array(n), w: new Float32Array(n), ...(kind === 'prognostic' ? { thetaAnomaly: new Float32Array(n), smoke: new Float32Array(n) } : {}) } as unknown as AtmosphereView;
    };
    const at = (atmosphere: AtmosphereView | undefined) => g.available(availabilityContext({ snapshot: atmosphere ? { atmosphere } : null }));
    expect(at(undefined).ok).toBe(false);
    expect(at(wind('prognostic')).ok).toBe(true);
    expect(at(wind('diagnosed')).ok).toBe(true);
    expect(at({ ...wind('diagnosed'), nz: 0, u: new Float32Array(0), v: new Float32Array(0), w: new Float32Array(0) } as AtmosphereView).ok).toBe(false);
  });

  it('says which air it draws, for both kinds, and that the curves are a fit through the model cells', () => {
    expect(g.source({ atmosphere3d: true })).toBe('FireSim 3-D atmosphere, computed on this device');
    expect(g.source()).toBe('FireSim 3-D atmosphere, computed on this device'); // not known yet: described for the 3-D air
    expect(g.source({ atmosphere3d: false })).toBe('FireSim wind model: the forecast wind fitted to the terrain, computed on this device (terrain effects only: the fast mode has no plume)');
    expect(g.resolution({ atmosphere3d: true, atmosphereCellSize: 133 })).toBe('133 m wind cells; the curves are a smooth fit through them, not new detail');
    expect(g.resolution({ atmosphere3d: false, atmosphereCellSize: 133 })).toBe('133 m wind cells; the curves are a smooth fit through them, not new detail');
    expect(g.resolution()).toBe('100 to 270 m wind cells; the curves are a smooth fit through them, not new detail');
    for (const text of [g.title, g.what, g.why, g.source({ atmosphere3d: false }), g.source({ atmosphere3d: true }), g.resolution({ atmosphereCellSize: 133 }), g.resolution()]) expect(text).not.toMatch(/[—–]/);
    expect(g.what).toMatch(/^[A-Z].*\.$/);
    expect(g.why).toMatch(/^[A-Z].*\.$/);
  });

  it('switches by its own key only, as a plain boolean', () => {
    const s = { ...DEFAULT_LAYERS, crossSection: { ...DEFAULT_LAYERS.crossSection } };
    expect(sceneLayerPatch(s, 'windGlyphs', true)).toEqual({ windGlyphs: true });
    expect(sceneLayerPatch({ ...s, windGlyphs: true }, 'windGlyphs', false)).toEqual({ windGlyphs: false });
    expect(sceneLayerOn({ ...s, windGlyphs: true }, 'windGlyphs')).toBe(true);
  });
});
