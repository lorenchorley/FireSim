/**
 * The Layers panel's model (layersModel.ts), driven by the layer catalog only: every catalog row lands exactly once in
 * its place (map type, a tile, a switch row, a heat-map row), a new catalog row appears by itself, the heat maps behave
 * like a radio group that can be switched off, availability reasons come from the catalog, the default open groups, the
 * (i) text, the data set behind each layer, the unit words, the map types, and the solo ground of the 3-D view.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DatasetRecord } from '../../../core/datasets';
import { LAYER_CATALOG, LAYER_GROUPS, HEAT_OVERLAY_KINDS, type AvailabilityContext, type LayerInfo } from '../../../render/layerCatalog';
import { DEFAULT_LAYERS } from '../../../render/layers';
import { groundBase } from '../../../render/SceneView';
import {
  MAP_TYPES,
  UNIT_WORDS,
  availabilityOf,
  datasetsForLayer,
  defaultOpenGroups,
  heatPatch,
  heatSubline,
  infoRows,
  layerScenarioOf,
  mapTypeOf,
  mapTypePatch,
  panelPlan,
  scenePatch,
  soloActive,
  tileCaption,
} from './layersModel';

const ALL: AvailabilityContext = { hasFire: true, has3dAtmosphere: true, hasContext: true, hasGrass: true, hasCanopyData: true, hasImagery: true, hasHomes: true, hasRoads: true };
const NONE: AvailabilityContext = { hasFire: false, has3dAtmosphere: false, hasContext: false, hasGrass: false, hasCanopyData: false, hasImagery: false, hasHomes: false, hasRoads: false };

const fixture = (name: string): DatasetRecord[] => (JSON.parse(readFileSync(join(__dirname, '..', '..', '..', '..', 'tests', 'fixtures', 'datasets', `${name}.json`), 'utf8')) as { datasets: DatasetRecord[] }).datasets;

describe('panel plan: driven by the catalog only', () => {
  const plan = panelPlan();

  it('every scene form appears exactly once (map type, a tile or a switch) and every heat form exactly once (a heat row)', () => {
    const sceneIds = [...(plan.mapType ? [plan.mapType.id] : []), ...plan.tiles.map((l) => l.id), ...plan.switches.map((l) => l.id)];
    const heatIds = plan.heat.flatMap((g) => g.rows.map((l) => l.id));
    expect(new Set(sceneIds).size).toBe(sceneIds.length);
    expect(new Set(heatIds).size).toBe(heatIds.length);
    expect(sceneIds.sort()).toEqual(LAYER_CATALOG.filter((l) => l.scene).map((l) => l.id).sort());
    expect(heatIds.sort()).toEqual(LAYER_CATALOG.filter((l) => l.heat).map((l) => l.id).sort());
    // Every catalog row is somewhere on the panel.
    expect(new Set([...sceneIds, ...heatIds])).toEqual(new Set(LAYER_CATALOG.map((l) => l.id)));
    // Every heat map (OverlayKind) can be switched on from exactly one row.
    expect(plan.heat.flatMap((g) => g.rows.map((l) => l.heat!.overlay)).sort()).toEqual([...HEAT_OVERLAY_KINDS].sort());
  });

  it('the map type is the aerial photo, the air slice has its own switch row, the rest of the scene layers are tiles in catalog order', () => {
    expect(plan.mapType?.scene).toBe('imagery');
    expect(plan.switches.map((l) => l.scene)).toEqual(['crossSection']);
    const order = LAYER_CATALOG.filter((l) => l.scene && l.scene !== 'imagery' && l.scene !== 'crossSection').map((l) => l.id);
    expect(plan.tiles.map((l) => l.id)).toEqual(order);
    // The places layers the user asked for are tiles.
    for (const k of ['roads', 'fireTrails', 'homes', 'zones', 'placeNames', 'vegetation', 'understorey', 'flames', 'embers', 'smoke', 'wind', 'insightMarkers']) {
      expect(plan.tiles.some((l) => l.scene === k), k).toBe(true);
    }
  });

  it('heat groups follow LAYER_GROUPS, rows keep catalog order, and the rows with both forms are roads, homes and shrubs', () => {
    const groups = plan.heat.map((g) => g.group);
    expect(groups).toEqual(LAYER_GROUPS.filter((g) => LAYER_CATALOG.some((l) => l.group === g && l.heat)));
    for (const g of plan.heat) expect(g.rows.map((l) => l.id)).toEqual(LAYER_CATALOG.filter((l) => l.group === g.group && l.heat).map((l) => l.id));
    const both = plan.heat.flatMap((g) => g.rows).filter((l) => l.kind === 'both').map((l) => l.id);
    expect(both.sort()).toEqual(['homes', 'roads', 'understorey']);
  });

  it('a new catalog row appears in the panel without touching it', () => {
    const extra: LayerInfo = { ...LAYER_CATALOG.find((l) => l.id === 'slope')!, id: 'newHeat', title: 'New data', heat: { overlay: 'slope', unit: 'm', categorical: false } };
    const extraScene: LayerInfo = { ...LAYER_CATALOG.find((l) => l.id === 'flames')!, id: 'newScene', title: 'New scene' };
    const p = panelPlan([...LAYER_CATALOG, extra, extraScene]);
    expect(p.heat.find((g) => g.group === extra.group)!.rows.at(-1)!.id).toBe('newHeat');
    expect(p.tiles.at(-1)!.id).toBe('newScene');
  });
});

describe('state changes', () => {
  it('heat maps are a radio group that can be switched off', () => {
    expect(heatPatch({ overlay: 'none' }, 'slope')).toEqual({ overlay: 'slope' });
    expect(heatPatch({ overlay: 'slope' }, 'aspect')).toEqual({ overlay: 'aspect' });
    expect(heatPatch({ overlay: 'slope' }, 'slope')).toEqual({ overlay: 'none' });
  });

  it('scene tiles flip their own layer only (wind streaks come back near the ground)', () => {
    const s = { ...DEFAULT_LAYERS, crossSection: { ...DEFAULT_LAYERS.crossSection } };
    expect(scenePatch(s, 'roads')).toEqual({ roads: !s.roads });
    expect(scenePatch({ ...s, wind: 'off' }, 'wind')).toEqual({ wind: 'surface' });
    expect(scenePatch({ ...s, wind: 'volume' }, 'wind')).toEqual({ wind: 'off' });
    expect(scenePatch(s, 'crossSection')).toEqual({ crossSection: { ...s.crossSection, enabled: true } });
  });

  it('solo: a heat map on its own hides the photo and draws plain ground; without a heat map nothing changes', () => {
    expect(soloActive({ overlay: 'slope', soloHeat: true })).toBe(true);
    expect(soloActive({ overlay: 'none', soloHeat: true })).toBe(false);
    expect(soloActive({ overlay: 'slope', soloHeat: false })).toBe(false);
    expect(groundBase({ imagery: true, soloHeat: true, overlay: 'slope' }, false)).toEqual({ imagery: false, plain: true, solo: true });
    expect(groundBase({ imagery: true, soloHeat: false, overlay: 'slope' }, false)).toEqual({ imagery: true, plain: false, solo: false });
    expect(groundBase({ imagery: true, soloHeat: true, overlay: 'none' }, false)).toEqual({ imagery: true, plain: false, solo: false });
    expect(groundBase({ imagery: false, soloHeat: true, overlay: 'none' }, true)).toEqual({ imagery: false, plain: true, solo: false });
  });

  it('map types: photo, terrain colours or plain', () => {
    expect(MAP_TYPES.map((m) => m.id)).toEqual(['photo', 'terrain', 'plain']);
    expect(mapTypeOf({ imagery: true }, false, true)).toBe('photo');
    expect(mapTypeOf({ imagery: true }, false, false)).toBe('terrain'); // no photo here
    expect(mapTypeOf({ imagery: false }, true, true)).toBe('plain');
    expect(mapTypePatch('photo')).toEqual({ layers: { imagery: true }, plain: false });
    expect(mapTypePatch('plain')).toEqual({ layers: { imagery: false }, plain: true });
    expect(mapTypePatch('terrain')).toEqual({ layers: { imagery: false }, plain: false });
  });
});

describe('availability and words', () => {
  it('reasons come from the catalog: fire maps need a fire, places layers need places data', () => {
    const arrival = LAYER_CATALOG.find((l) => l.id === 'arrival')!;
    const roads = LAYER_CATALOG.find((l) => l.id === 'roads')!;
    expect(availabilityOf(arrival, NONE)).toEqual({ ok: false, reason: 'Needs a fire: mark one first' });
    expect(availabilityOf(arrival, ALL).ok).toBe(true);
    expect(availabilityOf(roads, NONE).reason).toBe('No road data for this place');
    expect(tileCaption(true, availabilityOf(roads, NONE))).toBe('No road data for this place');
    expect(tileCaption(true, { ok: true })).toBe('On');
    expect(tileCaption(false, { ok: true })).toBe('Off');
    expect(heatSubline(arrival, availabilityOf(arrival, NONE))).toBe('Needs a fire: mark one first');
    expect(heatSubline(arrival, { ok: true })).toBe('Time since the fire started');
    expect(heatSubline(LAYER_CATALOG.find((l) => l.id === 'fuelType')!, { ok: true })).toBe('Named classes');
  });

  it('every heat unit of the catalog has plain words (no bare jargon units)', () => {
    for (const l of LAYER_CATALOG) if (l.heat && !l.heat.categorical) expect(UNIT_WORDS[l.heat.unit], `${l.id}: ${l.heat.unit}`).toBeTruthy();
  });

  it('groups: the first two open; the fire group opens once there is a fire; the group on show opens; the user decides', () => {
    const plan = panelPlan();
    const g = plan.heat.map((x) => x.group);
    expect([...defaultOpenGroups(plan.heat, { ...ALL, hasFire: false }, 'none')]).toEqual(g.slice(0, 2));
    const fire = plan.heat.find((x) => x.rows.some((r) => r.id === 'arrival'))!.group;
    expect(defaultOpenGroups(plan.heat, ALL, 'none').has(fire)).toBe(true);
    const places = plan.heat.find((x) => x.rows.some((r) => r.id === 'homes'))!.group;
    expect(defaultOpenGroups(plan.heat, ALL, 'none').has(places)).toBe(false);
    expect(defaultOpenGroups(plan.heat, ALL, 'homeDensity').has(places)).toBe(true);
    const saved = { [g[0]!]: false, [places]: true };
    const s = defaultOpenGroups(plan.heat, ALL, 'none', saved);
    expect(s.has(g[0]!)).toBe(false);
    expect(s.has(places)).toBe(true);
  });

  it('the (i) text: what, why, source, how fine, how it is drawn and availability, worded from the scenario', () => {
    const roads = LAYER_CATALOG.find((l) => l.id === 'roads')!;
    const rows = infoRows(roads, { fireCellSize: 30 }, { ok: false, reason: 'No road data for this place' });
    expect(rows.map((r) => r.key)).toEqual(['What it shows', 'Why it matters', 'Where the data come from', 'How fine', 'How it is drawn', 'Available here']);
    expect(rows[3]!.value).toContain('30 m cells');
    expect(rows[4]!.value).toMatch(/^2\.5-D terrain: /);
    expect(rows[5]!.value).toBe('No road data for this place');
  });

  it('the scenario facts for the catalog come from the scenario, the snapshot and the imagery record', () => {
    const datasets = fixture('katoomba-bundled');
    const sc = layerScenarioOf({ terrain: { grid: { cellSize: 30 }, source: 'NSW 5 m LiDAR' }, fuel: { sources: ['canopy height map'] }, context: undefined, datasets } as never, { atmosphere: { grid: { cellSize: 150 } } } as never);
    expect(sc.fireCellSize).toBe(30);
    expect(sc.atmosphereCellSize).toBe(150);
    expect(sc.terrainSource).toBe('NSW 5 m LiDAR');
    const img = datasets.find((d) => d.id === 'imagery')!;
    expect(sc.imageryCellSize).toBe(img.model?.resolutionM ?? img.native?.resolutionM);
    expect(sc.atmosphere3d).toBe(false); // a surface-only wind diagnostic (no levels): not the 3-D atmosphere
    expect(layerScenarioOf({ terrain: { grid: { cellSize: 30 } }, fuel: { sources: [] }, datasets } as never, { atmosphere: { nz: 20, grid: { cellSize: 150 } } } as never).atmosphere3d).toBe(true);
    expect(layerScenarioOf({ terrain: { grid: { cellSize: 30 } }, fuel: { sources: [] }, datasets } as never, null).atmosphere3d).toBeUndefined(); // before the first picture: not known
  });

  it('the (i) text says how the layer is drawn in THIS run: the smoke of the fast mode is not a 3-D volume', () => {
    const smoke = LAYER_CATALOG.find((l) => l.id === 'smoke')!;
    const row = (sc: Parameters<typeof infoRows>[1]): string => infoRows(smoke, sc, { ok: true }).find((r) => r.key === 'How it is drawn')!.value;
    expect(row({ atmosphere3d: false })).toMatch(/^3-D objects:/);
    expect(row({ atmosphere3d: true })).toMatch(/^3-D volume:/);
    expect(row(undefined)).toMatch(/^3-D volume:/);
    expect(infoRows(smoke, { atmosphere3d: false }, { ok: true }).find((r) => r.key === 'How fine')!.value).toMatch(/no smoke field/);
  });

  it('the catalog is worded from the ground and canopy records', () => {
    const datasets = fixture('katoomba-bundled');
    const sc = layerScenarioOf({ terrain: { grid: { cellSize: 30 } }, fuel: { sources: [] }, datasets } as never);
    expect(sc.terrainNativeCellSize).toBe(datasets.find((d) => d.id === 'terrain')!.native!.resolutionM);
  });
});

describe('the data set behind a layer', () => {
  const datasets = fixture('katoomba-bundled');

  it('uses the builder’s own link first', () => {
    const by = (id: string): string[] => datasetsForLayer(LAYER_CATALOG.find((l) => l.id === id)!, datasets).map((d) => d.id);
    for (const d of datasets) {
      if (!d.layer?.layerId) continue;
      const info = LAYER_CATALOG.find((l) => l.id === d.layer!.layerId);
      if (info) expect(by(info.id), info.id).toContain(d.id);
    }
    expect(by('roads')).toEqual(['roads']);
    expect(by('windSpeed')).toEqual(['weather']);
  });

  it('then the data set a layer is worked out from, and nothing for pure simulation results', () => {
    const by = (id: string): string[] => datasetsForLayer(LAYER_CATALOG.find((l) => l.id === id)!, datasets).map((d) => d.id);
    expect(by('slope')).toEqual(['terrain']);
    expect(by('canopy3d')).toEqual(['canopy-height']);
    expect(by('barkHazard')).toEqual(['fuel-derived', 'vegetation-svtm']);
    expect(by('arrival')).toEqual([]);
    expect(by('flames')).toEqual([]);
    expect(datasetsForLayer(LAYER_CATALOG[0]!, undefined)).toEqual([]);
  });

  it('only links data sets the scenario has', () => {
    const ids = new Set(datasets.map((d) => d.id));
    for (const l of LAYER_CATALOG) for (const d of datasetsForLayer(l, datasets)) expect(ids.has(d.id)).toBe(true);
    const offline = fixture('offline-synthetic');
    const offIds = new Set(offline.map((d) => d.id));
    for (const l of LAYER_CATALOG) for (const d of datasetsForLayer(l, offline)) expect(offIds.has(d.id)).toBe(true);
  });
});
