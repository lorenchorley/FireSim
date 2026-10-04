/**
 * The Layers panel's model (pure: no DOM). Everything the panel lists comes from the layer catalog
 * (render/layerCatalog.ts, LAYER_CATALOG / LAYER_GROUPS), so a new catalog row appears in the panel without touching it:
 *
 *   Map type     the catalog's imagery row (Aerial photo) plus the two ways of drawing the ground without the photo
 *                (Terrain colours = the vegetation palette with relief, Plain = neutral relief, the best base for a heat map)
 *   Map details  one tile per SCENE layer (kind 'scene' or 'both'), in catalog order, except the imagery (Map type) and the
 *                scene layers that carry their own settings (the vertical air slice: a switch with direction controls)
 *   Heat maps    one row per HEAT layer (kind 'heat' or 'both'), grouped by LAYER_GROUPS in catalog order; 'both' rows
 *                carry a Show (scene) and a Heat map button. Only one heat map is on at a time (tap again = off).
 *
 * Also: availability (the catalog's plain-English reasons), which groups start open, the (i) text of every row (what,
 * why, source, resolution, dimension, availability), the data set behind each layer (from DatasetRecord.layer, the
 * builder's own link, else the data set it is worked out from), and plain words for the units.
 */
import type { DatasetRecord } from '../../../core/datasets';
import type { ScenarioData, SimSnapshot } from '../../../core/types';
import {
  DIMENSION_HELP,
  LAYER_CATALOG,
  LAYER_GROUPS,
  layerDimension,
  layerFactsOfDatasets,
  sceneLayerOn,
  sceneLayerPatch,
  type Availability,
  type AvailabilityContext,
  type LayerGroup,
  type LayerInfo,
  type LayerScenario,
  type SceneLayerKey,
} from '../../../render/layerCatalog';
import type { LayerState, OverlayKind } from '../../../render/layers';

// ─────────────────────────────────────────────────────────────────────────────
// Map type
// ─────────────────────────────────────────────────────────────────────────────

/** How the ground is drawn under everything else. */
export type MapType = 'photo' | 'terrain' | 'plain';

export interface MapTypeOption {
  id: MapType;
  label: string;
  /** One short line under the tile. */
  caption: string;
}

export const MAP_TYPES: readonly MapTypeOption[] = [
  { id: 'photo', label: 'Aerial photo', caption: 'Real photo' },
  { id: 'terrain', label: 'Terrain colours', caption: 'Painted from the vegetation map' },
  { id: 'plain', label: 'Plain', caption: 'Grey relief only' },
];

/** The map type in force: the photo when it is on (and exists), else plain or terrain colours. */
export function mapTypeOf(l: Pick<LayerState, 'imagery'>, plain: boolean, hasImagery: boolean): MapType {
  if (l.imagery && hasImagery) return 'photo';
  return plain ? 'plain' : 'terrain';
}

/** What choosing a map type changes: the imagery switch (LayerState) and the plain-ground flag of the view. */
export function mapTypePatch(t: MapType): { layers: Pick<LayerState, 'imagery'>; plain: boolean } {
  return { layers: { imagery: t === 'photo' }, plain: t === 'plain' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Where each catalog row goes
// ─────────────────────────────────────────────────────────────────────────────

/** Scene layers drawn as a switch row with their own settings instead of a tile. */
export const SCENE_WITH_SETTINGS: ReadonlySet<SceneLayerKey> = new Set<SceneLayerKey>(['crossSection']);
/** The scene layer the Map type row stands for. */
export const MAP_TYPE_SCENE_KEY: SceneLayerKey = 'imagery';

export interface HeatGroup {
  group: LayerGroup;
  rows: LayerInfo[];
}

export interface PanelPlan {
  /** The catalog row behind the Map type row (the aerial photo), if the catalog has one. */
  mapType: LayerInfo | undefined;
  /** Map details tiles: scene and 'both' rows, catalog order. */
  tiles: LayerInfo[];
  /** Scene rows with their own settings (the vertical air slice). */
  switches: LayerInfo[];
  /** Heat and 'both' rows by group, LAYER_GROUPS order, catalog order inside; groups without heat maps are left out. */
  heat: HeatGroup[];
}

/** Lay the catalog out on the panel. Every row lands in exactly one scene place (if it has a scene form) and one heat row (if it has a heat form). */
export function panelPlan(catalog: readonly LayerInfo[] = LAYER_CATALOG, groups: readonly LayerGroup[] = LAYER_GROUPS): PanelPlan {
  const scene = catalog.filter((l) => l.scene);
  const heatRows = catalog.filter((l) => l.heat);
  return {
    mapType: scene.find((l) => l.scene === MAP_TYPE_SCENE_KEY),
    tiles: scene.filter((l) => l.scene !== MAP_TYPE_SCENE_KEY && !SCENE_WITH_SETTINGS.has(l.scene!)),
    switches: scene.filter((l) => SCENE_WITH_SETTINGS.has(l.scene!)),
    heat: groups.map((group) => ({ group, rows: heatRows.filter((l) => l.group === group) })).filter((g) => g.rows.length > 0),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// State changes
// ─────────────────────────────────────────────────────────────────────────────

/** Radio behaviour of the heat maps: tapping the one on show turns it off, any other replaces it. */
export function heatPatch(state: Pick<LayerState, 'overlay'>, overlay: Exclude<OverlayKind, 'none'>): Pick<LayerState, 'overlay'> {
  return { overlay: state.overlay === overlay ? 'none' : overlay };
}

/** Flip a scene layer (the catalog's patch, e.g. wind streaks come back as 'surface'). */
export function scenePatch(state: Pick<LayerState, SceneLayerKey>, key: SceneLayerKey): Partial<LayerState> {
  return sceneLayerPatch(state, key, !sceneLayerOn(state, key));
}

/** True while a heat map stands on its own: the photo and the 3-D canopy are hidden (places layers stay as toggled). */
export function soloActive(l: Pick<LayerState, 'overlay' | 'soloHeat'>): boolean {
  return l.soloHeat && l.overlay !== 'none';
}

// ─────────────────────────────────────────────────────────────────────────────
// Availability
// ─────────────────────────────────────────────────────────────────────────────

/** Can the row be used now? A 'both' row is usable when either form can be shown (the catalog has one rule per row). */
export function availabilityOf(info: LayerInfo, ctx: AvailabilityContext): Availability {
  try {
    return info.available(ctx);
  } catch {
    return { ok: false, reason: 'Not available here' };
  }
}

/** Short signature of every row's availability (the panel re-renders the dimmed state only when it changes). */
export function availabilitySignature(ctx: AvailabilityContext, catalog: readonly LayerInfo[] = LAYER_CATALOG): string {
  return catalog.map((l) => (availabilityOf(l, ctx).ok ? '1' : '0')).join('');
}

/**
 * Which heat-map groups start open: the first two, the group of the heat map on show, and a group whose maps only exist
 * once there is a fire when a fire exists (its maps were all greyed out before). The user's own open / closed choice wins.
 */
export function defaultOpenGroups(heat: readonly HeatGroup[], ctx: AvailabilityContext, overlay: OverlayKind, saved?: Partial<Record<string, boolean>>): Set<LayerGroup> {
  const open = new Set<LayerGroup>();
  heat.forEach((g, i) => {
    const s = saved?.[g.group];
    if (s !== undefined) {
      if (s) open.add(g.group);
      return;
    }
    const noFire = { ...ctx, hasFire: false };
    const fireGroup = ctx.hasFire && g.rows.every((r) => !availabilityOf(r, noFire).ok) && g.rows.some((r) => availabilityOf(r, ctx).ok);
    if (i < 2 || g.rows.some((r) => r.heat?.overlay === overlay) || fireGroup) open.add(g.group);
  });
  return open;
}

// ─────────────────────────────────────────────────────────────────────────────
// Words
// ─────────────────────────────────────────────────────────────────────────────

/** The unit of a heat map as a short plain phrase (the catalog keeps the short form for the legends). */
export const UNIT_WORDS: Readonly<Record<string, string>> = {
  m: 'In metres',
  '°': 'In degrees',
  'W/m²': 'Sunshine in watts per square metre',
  categories: 'Named classes',
  '%': 'In per cent',
  'score 0–4': 'Score from 0 (low) to 4 (extreme)',
  'score 0–1': 'Score from 0 (none) to 1 (highest)',
  't/ha': 'In tonnes per hectare',
  years: 'In years',
  'time since start': 'Time since the fire started',
  'km/h': 'In km/h',
  'kW/m': 'In kilowatts per metre of fire edge',
  'brands/ha/h': 'Embers per hectare per hour',
  'homes/ha': 'Homes per hectare',
};

/** The unit of a heat map in words ("In tonnes per hectare"); an unknown unit is shown as it is ("In ppm"). */
export function unitWords(unit: string): string {
  return UNIT_WORDS[unit] ?? `In ${unit}`;
}

/** Second line of a heat-map row: what the colours mean, or why it cannot be shown now. */
export function heatSubline(info: LayerInfo, a: Availability): string {
  if (!a.ok) return a.reason ?? 'Not available here';
  const h = info.heat;
  if (!h) return '';
  return h.categorical ? 'Named classes' : unitWords(h.unit);
}

/** Caption of a Map details tile: its availability reason, else on / off. */
export function tileCaption(on: boolean, a: Availability): string {
  if (!a.ok) return a.reason ?? 'Not available here';
  return on ? 'On' : 'Off';
}

// ─────────────────────────────────────────────────────────────────────────────
// The (i) text
// ─────────────────────────────────────────────────────────────────────────────

export interface InfoRow {
  key: string;
  value: string;
}

/** The catalog text of a row, in the order the (i) expansion shows it. */
export function infoRows(info: LayerInfo, sc: LayerScenario | undefined, a: Availability): InfoRow[] {
  const safe = (f: () => string, fallback: string): string => {
    try {
      return f() || fallback;
    } catch {
      return fallback;
    }
  };
  return [
    { key: 'What it shows', value: info.what },
    { key: 'Why it matters', value: info.why },
    { key: 'Where the data come from', value: safe(() => info.source(sc), 'Not recorded') },
    { key: 'How fine', value: safe(() => info.resolution(sc), 'Not recorded') },
    { key: 'How it is drawn', value: `${layerDimension(info, sc)}: ${DIMENSION_HELP[layerDimension(info, sc)]}` },
    { key: 'Available here', value: a.ok ? 'Yes' : (a.reason ?? 'No') },
  ];
}

/** The catalog's scenario facts, read from the scenario, the latest snapshot and the data-set records. */
export function layerScenarioOf(scenario: Pick<ScenarioData, 'terrain' | 'fuel' | 'context' | 'datasets'> | null | undefined, snapshot?: Pick<SimSnapshot, 'atmosphere'> | null): LayerScenario {
  const sc: LayerScenario = {};
  if (!scenario) return sc;
  const cs = scenario.terrain?.grid?.cellSize;
  if (Number.isFinite(cs) && cs > 0) sc.fireCellSize = cs;
  const ac = snapshot?.atmosphere?.grid?.cellSize;
  if (ac !== undefined && Number.isFinite(ac) && ac > 0) sc.atmosphereCellSize = ac;
  if (scenario.terrain?.source) sc.terrainSource = scenario.terrain.source;
  if (scenario.fuel?.sources?.length) sc.fuelSources = scenario.fuel.sources;
  if (scenario.context) sc.context = scenario.context;
  const img = scenario.datasets?.find((d) => d.id === 'imagery' && (d.status === 'used' || d.status === 'partial'));
  const px = img?.model?.resolutionM ?? img?.native?.resolutionM;
  if (px !== undefined && Number.isFinite(px) && px > 0) sc.imageryCellSize = px;
  Object.assign(sc, layerFactsOfDatasets(scenario.datasets));
  // The fast mode's wind diagnostic carries no 3-D volume (nz = 0): what is drawn for the smoke and the wind differs.
  if (snapshot?.atmosphere) sc.atmosphere3d = (snapshot.atmosphere.nz ?? 0) > 0;
  return sc;
}

// ─────────────────────────────────────────────────────────────────────────────
// The data set behind a layer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Data sets a layer is worked out from, when the builder links the data set to another layer of the same family (the
 * terrain record links the ground-height map; slope, aspect and landform are worked out from the same ground model).
 * Only ids that exist in the scenario's records are ever linked.
 */
export const LAYER_DATASET_FAMILY: Readonly<Record<string, readonly string[]>> = {
  slope: ['terrain'],
  aspect: ['terrain'],
  landform: ['terrain'],
  insolation: ['terrain'],
  trench: ['terrain'],
  attach: ['terrain'],
  canopy3d: ['canopy-height'],
  canopyCover: ['canopy-height'],
  understorey: ['fuel-derived', 'vegetation-svtm'],
  elevatedHazard: ['fuel-derived', 'vegetation-svtm'],
  surfaceHazard: ['fuel-derived', 'vegetation-svtm'],
  nearSurfaceHazard: ['fuel-derived', 'vegetation-svtm'],
  barkHazard: ['fuel-derived', 'vegetation-svtm'],
  grassCuring: ['fuel-derived', 'weather'],
  fireHistoryKind: ['fire-history'],
  moisture: ['fuel-moisture', 'weather'],
  windSpeed: ['weather'],
  wind: ['weather'],
  smoke: ['weather'],
  crossSection: ['weather', 'upper-air'],
};

/** The data-set records behind a catalog row: the builder's own link first, then the family it is worked out from. */
export function datasetsForLayer(info: LayerInfo, datasets: readonly DatasetRecord[] | null | undefined): DatasetRecord[] {
  if (!datasets?.length) return [];
  const direct = datasets.filter((d) => d.layer && (d.layer.layerId === info.id || (!!info.heat && d.layer.overlay === info.heat.overlay)));
  if (direct.length) return direct;
  const fam = LAYER_DATASET_FAMILY[info.id] ?? [];
  const out: DatasetRecord[] = [];
  for (const id of fam) {
    const d = datasets.find((r) => r.id === id);
    if (d) out.push(d);
  }
  return out;
}
