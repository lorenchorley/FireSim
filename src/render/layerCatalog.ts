/**
 * The single description of every layer of the 3-D view, in plain English: what it shows, why it matters for fire or for
 * finding your way, whether it can be shown right now, where its data come from and how fine they are. The Layers panel
 * and the transparency (model card) page are both built from {@link LAYER_CATALOG}, so a layer can never be listed in one
 * and forgotten in the other. layerCatalog.test.ts fails when a LayerState key or an OverlayKind is added without an entry.
 *
 * A layer is one of
 *  - a SCENE layer: something drawn in the scene that is switched on or off (a LayerState key such as `roads`),
 *  - a HEAT layer: one data set painted over the ground (an {@link OverlayKind}; only one heat map is shown at a time,
 *    LayerState.overlay), or
 *  - BOTH: the same data as an on/off scene layer and as a heat map (e.g. homes as house markers, and as homes per hectare).
 *
 * The remaining LayerState keys are display settings, not layers ({@link LAYER_SETTING_KEYS}).
 *
 * Typical use by the panel:
 *   for (const group of LAYER_GROUPS) for (const info of layersInGroup(group)) {
 *     const a = info.available(ctx);            // { ok, reason? }: grey the row and show `reason` when !ok
 *     if (info.scene) toggle.checked = sceneLayerOn(state, info.scene);    // on tap: view.setLayers(sceneLayerPatch(state, info.scene, on))
 *     if (info.heat) heatButton.pressed = state.overlay === info.heat.overlay;   // on tap: view.setLayers({ overlay })
 *   }
 * The legend of the shown heat map is `view.legend()` (SceneView), or `legendFor(kind, ctx)` from legends.ts.
 */
import type { ContextLayers } from '../core/places';
import { FuelType, type FuelMap, type SimSnapshot } from '../core/types';
import type { LayerState, OverlayKind } from './layers';

// ─────────────────────────────────────────────────────────────────────────────
// Groups
// ─────────────────────────────────────────────────────────────────────────────

/** Panel sections, in display order. */
export const LAYER_GROUPS = ['Ground and terrain', 'Vegetation and fuel', 'Fire and weather', 'Places', 'Simulation visuals'] as const;
export type LayerGroup = (typeof LAYER_GROUPS)[number];

/** One plain sentence under each group heading. */
export const LAYER_GROUP_BLURBS: Record<LayerGroup, string> = {
  'Ground and terrain': 'The shape of the land: height, steepness and the way slopes face.',
  'Vegetation and fuel': 'What can burn: trees, shrubs, litter and grass, and how hazardous each one is.',
  'Fire and weather': 'What the fire and the wind are doing, and the conditions that drive them.',
  Places: 'Roads, trails, homes and names, so you can tell where you are.',
  'Simulation visuals': 'The moving pictures the simulation draws: flames, smoke, embers, wind and markers.',
};

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** LayerState keys that switch a scene layer on or off. */
export type SceneLayerKey =
  | 'vegetation'
  | 'imagery'
  | 'flames'
  | 'smoke'
  | 'embers'
  | 'wind'
  | 'crossSection'
  | 'insightMarkers'
  | 'roads'
  | 'fireTrails'
  | 'homes'
  | 'zones'
  | 'placeNames'
  | 'understorey';

/** How a layer is drawn: colours draped over the ground, models standing in the scene, a volume of air, text or a slice. */
export type LayerDimension = '2.5-D terrain' | '3-D objects' | '3-D volume' | '2-D labels' | '2-D slice';

export const DIMENSION_HELP: Record<LayerDimension, string> = {
  '2.5-D terrain': 'Painted on the 3-D ground surface, so it follows every hill and gully.',
  '3-D objects': 'Small models or particles standing or flying in the 3-D scene.',
  '3-D volume': 'A field through the air above the ground, not just at the surface.',
  '2-D labels': 'Text drawn flat on the screen over the map.',
  '2-D slice': 'A flat vertical cut through the air, drawn as a picture.',
};

/** The colour scale of a heat layer. */
export interface HeatInfo {
  overlay: Exclude<OverlayKind, 'none'>;
  /** Unit of the legend values, e.g. "m", "km/h", "%", "score 0–4"; "categories" for a categorical map. */
  unit: string;
  /** True when the map shows named categories rather than a number (fuel type, landform, last fire). */
  categorical: boolean;
}

/** What is known about the scenario right now (all booleans are cheap to compute; see {@link availabilityContext}). */
export interface AvailabilityContext {
  /** A fire has been marked (or a run is showing), so fire results exist. */
  hasFire: boolean;
  /** The 3-D atmosphere is running (not the fast surface-wind tier). */
  has3dAtmosphere: boolean;
  /** Roads, fire trails, homes, zones and place names were loaded for this place. */
  hasContext: boolean;
  /** Some ground here is grass or grassy woodland. */
  hasGrass: boolean;
  /** Tree heights come from the canopy-height map (not just typical heights for the vegetation). */
  hasCanopyData: boolean;
  /** An aerial photo covers this place. */
  hasImagery: boolean;
  /** Home addresses exist within this place (defaults to hasContext). */
  hasHomes?: boolean;
  /** Roads or trails exist within this place (defaults to hasContext). */
  hasRoads?: boolean;
}

export interface Availability {
  ok: boolean;
  /** Plain-English reason when !ok, e.g. "Needs a fire: mark one first". */
  reason?: string;
}

/** What the catalog knows about the loaded scenario, to word each layer's data source and resolution exactly. All optional. */
export interface LayerScenario {
  /** Fire-grid cell size (m). */
  fireCellSize?: number;
  /** Atmosphere grid cell size (m). */
  atmosphereCellSize?: number;
  /** Terrain.source, e.g. "NSW Spatial Services 5 m LiDAR". */
  terrainSource?: string;
  /** FuelMap.sources (canopy, vegetation and fire-history provenance strings). */
  fuelSources?: readonly string[];
  /** The loaded context layers (their `sources` word the places layers). */
  context?: Pick<ContextLayers, 'sources' | 'fetched'> | null;
  /** Pixel size of the aerial photo (m). */
  imageryCellSize?: number;
}

export interface LayerInfo {
  /** Unique, stable id (safe for element ids and storage keys). */
  id: string;
  group: LayerGroup;
  /** Plain title, at most 24 characters. */
  title: string;
  /** One plain sentence: what the layer shows. */
  what: string;
  /** One plain sentence: why it matters for fire behaviour or for finding your way. */
  why: string;
  kind: 'heat' | 'scene' | 'both';
  /** The LayerState key an on/off switch toggles (scene and both). */
  scene?: SceneLayerKey;
  /** The heat map (heat and both). */
  heat?: HeatInfo;
  dimension: LayerDimension;
  /** Can this layer be shown now? `reason` says what is missing in plain English. */
  available(ctx: AvailabilityContext): Availability;
  /** Where the data come from, e.g. "NSW Spatial Services, Roads and tracks (CC BY 4.0)". */
  source(scenario?: LayerScenario): string;
  /** How fine the data are, e.g. "30 m cells". */
  resolution(scenario?: LayerScenario): string;
}

// ─────────────────────────────────────────────────────────────────────────────
// LayerState bookkeeping (compile-time complete)
// ─────────────────────────────────────────────────────────────────────────────

/** Every LayerState key is either a layer switch or a display setting; adding a key to LayerState fails to compile until it is listed here. */
const LAYER_STATE_ROLE: Record<keyof LayerState, 'scene' | 'setting'> = {
  overlay: 'setting', // which heat map is shown ('none' = no heat map); the heat layers are the OverlayKinds
  overlayOpacity: 'setting',
  isochroneMinutes: 'setting',
  vegetation: 'scene',
  imagery: 'scene',
  flames: 'scene',
  smoke: 'scene',
  embers: 'scene',
  wind: 'scene',
  crossSection: 'scene',
  insightMarkers: 'scene',
  verticalExaggeration: 'setting',
  legend: 'setting',
  roads: 'scene',
  fireTrails: 'scene',
  homes: 'scene',
  zones: 'scene',
  placeNames: 'scene',
  understorey: 'scene',
  canopyStyle: 'setting',
  canopyCode: 'setting',
  windSway: 'setting',
  soloHeat: 'setting',
};

/** LayerState keys that switch a scene layer. */
export const SCENE_LAYER_KEYS = (Object.keys(LAYER_STATE_ROLE) as (keyof LayerState)[]).filter((k) => LAYER_STATE_ROLE[k] === 'scene') as SceneLayerKey[];
/** LayerState keys that are display settings, not layers (opacity, canopy style, ...). */
export const LAYER_SETTING_KEYS = (Object.keys(LAYER_STATE_ROLE) as (keyof LayerState)[]).filter((k) => LAYER_STATE_ROLE[k] === 'setting');

/** Every OverlayKind (compile-time complete): 'none' means "no heat map", the rest are the heat layers. */
const OVERLAY_KIND_SET: Record<OverlayKind, true> = {
  none: true,
  arrival: true,
  ros: true,
  intensity: true,
  driver: true,
  moisture: true,
  fuelLoad: true,
  fuelType: true,
  timeSinceFire: true,
  slope: true,
  aspect: true,
  insolation: true,
  vls: true,
  attach: true,
  trench: true,
  dmz: true,
  landing: true,
  elevation: true,
  landform: true,
  canopyHeight: true,
  canopyCover: true,
  elevatedHazard: true,
  elevatedHeight: true,
  surfaceHazard: true,
  nearSurfaceHazard: true,
  barkHazard: true,
  grassCuring: true,
  fireHistoryKind: true,
  homeDensity: true,
  roadAccess: true,
  windSpeed: true,
};
export const OVERLAY_KINDS = Object.keys(OVERLAY_KIND_SET) as OverlayKind[];
/** The heat layers (every OverlayKind except 'none'). */
export const HEAT_OVERLAY_KINDS = OVERLAY_KINDS.filter((k): k is Exclude<OverlayKind, 'none'> => k !== 'none');

/** Is a scene layer on in this state? (`wind` is on unless 'off'; `crossSection` when enabled.) */
export function sceneLayerOn(state: Pick<LayerState, SceneLayerKey>, key: SceneLayerKey): boolean {
  if (key === 'wind') return state.wind !== 'off';
  if (key === 'crossSection') return state.crossSection.enabled;
  return state[key];
}

/** The partial LayerState that switches a scene layer on or off (pass it to SceneView.setLayers). */
export function sceneLayerPatch(state: Pick<LayerState, SceneLayerKey>, key: SceneLayerKey, on: boolean): Partial<LayerState> {
  if (key === 'wind') return { wind: on ? (state.wind === 'off' ? 'surface' : state.wind) : 'off' };
  if (key === 'crossSection') return { crossSection: { ...state.crossSection, enabled: on } };
  return { [key]: on } as Partial<LayerState>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Availability, sources and resolution helpers
// ─────────────────────────────────────────────────────────────────────────────

const OK: Availability = { ok: true };
const need = (ok: boolean, reason: string): Availability => (ok ? OK : { ok: false, reason });

const always = (): Availability => OK;
const needsFire = (c: AvailabilityContext): Availability => need(c.hasFire, 'Needs a fire: mark one first');
const needsAtmosphere = (c: AvailabilityContext): Availability => need(c.has3dAtmosphere, 'Needs the 3-D atmosphere: switch it on in Settings');
const needsContext =
  (what: string, has: (c: AvailabilityContext) => boolean = (c) => c.hasContext) =>
  (c: AvailabilityContext): Availability =>
    need(c.hasContext && has(c), `No ${what} data for this place`);

const cell = (sc?: LayerScenario): string => (sc?.fireCellSize ? `${sc.fireCellSize} m` : '20 or 30 m');
const fireGrid = (sc?: LayerScenario): string => `${cell(sc)} cells (the fire grid)`;

const TERRAIN_DEFAULT = 'NSW Spatial Services 5 m LiDAR ground model (demo sites), or SRTM satellite elevation elsewhere';
const terrainSource = (sc?: LayerScenario): string => sc?.terrainSource ?? TERRAIN_DEFAULT;
const terrainResolution = (sc?: LayerScenario): string => `${cell(sc)} cells for the colours; the 3-D ground is drawn finer (10 m) where LiDAR is available`;

const CANOPY_DEFAULT = 'Meta and World Resources Institute canopy-height map, made from 1 m satellite images (CC BY 4.0)';
const canopySource = (sc?: LayerScenario): string => sc?.fuelSources?.find((s) => /canopy height/i.test(s)) ?? CANOPY_DEFAULT;
const canopyResolution = (sc?: LayerScenario): string => `20 m canopy map, shown on the ${cell(sc)} fire grid`;

const FUEL_DEFAULT = 'NSW State Vegetation Type Map turned into fuel types, with fuel built up since the last fire (NPWS fire history)';
const fuelSource = (sc?: LayerScenario): string => {
  const veg = sc?.fuelSources?.find((s) => /vegetation|SVTM/i.test(s));
  const fire = sc?.fuelSources?.find((s) => /fire history/i.test(s));
  return veg && fire ? `${veg}; ${fire}` : FUEL_DEFAULT;
};
const fuelResolution = (sc?: LayerScenario): string => fireGrid(sc);

const SIMULATION = 'FireSim simulation, computed on this device';
const simResolution = (sc?: LayerScenario): string => `${fireGrid(sc)}, updated at every simulation step`;

/** The wording of a context layer's provenance from ContextLayers.sources, or a default naming the official source. */
function contextSource(sc: LayerScenario | undefined, id: 'roads' | 'fireTrails' | 'homes' | 'zones' | 'places', fallback: string): string {
  const s = sc?.context?.sources.find((x) => x.id === id);
  return s ? `${s.provider}: ${s.title} (${s.licence}), fetched ${s.fetched}` : fallback;
}

// ─────────────────────────────────────────────────────────────────────────────
// The catalog
// ─────────────────────────────────────────────────────────────────────────────

const heat = (overlay: HeatInfo['overlay'], unit: string, categorical = false): HeatInfo => ({ overlay, unit, categorical });

/** All layers, grouped and ordered as the panel lists them. */
export const LAYER_CATALOG: readonly LayerInfo[] = [
  // ── Ground and terrain ─────────────────────────────────────────────────────
  {
    id: 'imagery',
    group: 'Ground and terrain',
    title: 'Aerial photo',
    what: 'A real aerial photograph draped over the 3-D ground.',
    why: 'It lets you spot real landmarks (roads, houses, clearings, dams) and compare them with the fuel and the fire.',
    kind: 'scene',
    scene: 'imagery',
    dimension: '2.5-D terrain',
    available: (c) => need(c.hasImagery, 'No aerial photo for this place'),
    source: () => 'NSW Spatial Services aerial imagery (CC BY 4.0)',
    resolution: (sc) => `${sc?.imageryCellSize ?? 8} m pixels`,
  },
  {
    id: 'elevation',
    group: 'Ground and terrain',
    title: 'Ground height',
    what: 'How high the ground is above sea level, from valley floor to ridge top.',
    why: 'Fire runs faster uphill and ridges catch the wind first, while cold air pools in the valleys at night.',
    kind: 'heat',
    heat: heat('elevation', 'm'),
    dimension: '2.5-D terrain',
    available: always,
    source: terrainSource,
    resolution: terrainResolution,
  },
  {
    id: 'slope',
    group: 'Ground and terrain',
    title: 'Slope steepness',
    what: 'How steep the ground is, in degrees.',
    why: 'A fire roughly doubles its speed for every 10 degrees of uphill slope, and above about 25 degrees flames can attach and surge.',
    kind: 'heat',
    heat: heat('slope', '°'),
    dimension: '2.5-D terrain',
    available: always,
    source: terrainSource,
    resolution: terrainResolution,
  },
  {
    id: 'aspect',
    group: 'Ground and terrain',
    title: 'Which way slopes face',
    what: 'The compass direction each slope faces.',
    why: 'North- and west-facing slopes get the hot afternoon sun, so their fuel is usually the driest.',
    kind: 'heat',
    heat: heat('aspect', '°'),
    dimension: '2.5-D terrain',
    available: always,
    source: terrainSource,
    resolution: terrainResolution,
  },
  {
    id: 'landform',
    group: 'Ground and terrain',
    title: 'Ridges and gullies',
    what: 'Every place named by its shape: ridge top, spur, slope, gully, valley floor, saddle, peak or cliff.',
    why: 'Fire races up gullies like a chimney, ridges and spurs are exposed to the wind, and cold air pools on valley floors.',
    kind: 'heat',
    heat: heat('landform', 'categories', true),
    dimension: '2.5-D terrain',
    available: always,
    source: (sc) => `Worked out from the ground height: ${terrainSource(sc)}`,
    resolution: terrainResolution,
  },
  {
    id: 'insolation',
    group: 'Ground and terrain',
    title: 'Sun on the slope',
    what: 'How much sunshine is reaching each slope right now.',
    why: 'Sunlit slopes dry out and heat the air, which draws wind and fire uphill, while shaded slopes stay damp and cool.',
    kind: 'heat',
    heat: heat('insolation', 'W/m²'),
    dimension: '2.5-D terrain',
    available: always,
    source: (sc) => `Sun position and cloud from the weather, shaded by the ground: ${terrainSource(sc)}`,
    resolution: terrainResolution,
  },

  // ── Vegetation and fuel ────────────────────────────────────────────────────
  {
    id: 'canopy3d',
    group: 'Vegetation and fuel',
    title: '3-D canopy',
    what: 'Trees drawn as 3-D models at their real height, with crowns and bark shaped like the real species.',
    why: 'Seeing the trees shows how tall the fuel is, where the forest is open or dense, and which trunks can throw embers.',
    kind: 'scene',
    scene: 'vegetation',
    dimension: '3-D objects',
    available: always,
    source: (sc) => `Trees placed to match the canopy map and the fuel type: ${canopySource(sc)}`,
    resolution: (sc) => `${canopyResolution(sc)}; trees are drawn individually near the camera`,
  },
  {
    id: 'canopyHeight',
    group: 'Vegetation and fuel',
    title: 'Tree height',
    what: 'How tall the trees are, coloured from short to tall.',
    why: 'Tall trees loft embers higher and further, and a fire that climbs into the crowns is much harder to stop.',
    kind: 'heat',
    heat: heat('canopyHeight', 'm'),
    dimension: '2.5-D terrain',
    available: (c) => need(c.hasCanopyData, 'No tree-height data for this place'),
    source: canopySource,
    resolution: canopyResolution,
  },
  {
    id: 'canopyCover',
    group: 'Vegetation and fuel',
    title: 'Tree cover',
    what: 'How much of the ground is shaded by tree crowns, from open ground to a closed canopy.',
    why: 'Dense cover keeps the fuel below damp and cool, but touching crowns can carry a crown fire from tree to tree.',
    kind: 'heat',
    heat: heat('canopyCover', '%'),
    dimension: '2.5-D terrain',
    available: (c) => need(c.hasCanopyData, 'No tree-cover data for this place'),
    source: canopySource,
    resolution: canopyResolution,
  },
  {
    id: 'understorey',
    group: 'Vegetation and fuel',
    title: 'Shrubs (understorey)',
    what: 'The shrub layer under the trees, drawn among them at its real height, or shown as a shrub-height heat map.',
    why: 'Shrubs are the ladder that lets flames climb from the ground into the tree crowns.',
    kind: 'both',
    scene: 'understorey',
    heat: heat('elevatedHeight', 'm'),
    dimension: '3-D objects',
    available: always,
    source: fuelSource,
    resolution: fuelResolution,
  },
  {
    id: 'elevatedHazard',
    group: 'Vegetation and fuel',
    title: 'Shrub fire hazard',
    what: 'How much fire hazard the shrub layer adds, from Low to Extreme.',
    why: 'The higher the shrub hazard, the taller the flames and the more likely a ground fire climbs into the crowns.',
    kind: 'heat',
    heat: heat('elevatedHazard', 'score 0–4'),
    dimension: '2.5-D terrain',
    available: always,
    source: fuelSource,
    resolution: fuelResolution,
  },
  {
    id: 'surfaceHazard',
    group: 'Vegetation and fuel',
    title: 'Leaf litter hazard',
    what: 'How much fire hazard the fallen leaves, bark and twigs add, from Low to Extreme.',
    why: 'Litter is what a fire burns first, so deeper litter means a hotter, faster flaming edge.',
    kind: 'heat',
    heat: heat('surfaceHazard', 'score 0–4'),
    dimension: '2.5-D terrain',
    available: always,
    source: fuelSource,
    resolution: fuelResolution,
  },
  {
    id: 'nearSurfaceHazard',
    group: 'Vegetation and fuel',
    title: 'Grass and low shrubs',
    what: 'How much fire hazard the grass, bracken and low shrubs near the ground add, from Low to Extreme.',
    why: 'This knee-high layer carries a fire quickly along the ground and makes its flames taller.',
    kind: 'heat',
    heat: heat('nearSurfaceHazard', 'score 0–4'),
    dimension: '2.5-D terrain',
    available: always,
    source: fuelSource,
    resolution: fuelResolution,
  },
  {
    id: 'barkHazard',
    group: 'Vegetation and fuel',
    title: 'Bark (ember) hazard',
    what: 'How much loose, stringy bark the trees carry, from smooth gums (Low) to stringybark (Extreme).',
    why: 'Loose bark launches burning embers far ahead of the fire and starts new spot fires.',
    kind: 'heat',
    heat: heat('barkHazard', 'score 0–4'),
    dimension: '2.5-D terrain',
    available: always,
    source: fuelSource,
    resolution: fuelResolution,
  },
  {
    id: 'grassCuring',
    group: 'Vegetation and fuel',
    title: 'Grass dryness (curing)',
    what: 'How dry and golden the grass is, from fresh and green (0 %) to fully dry (100 %).',
    why: 'Dry grass burns fast and fierce, while green grass hardly burns at all.',
    kind: 'heat',
    heat: heat('grassCuring', '%'),
    dimension: '2.5-D terrain',
    available: (c) => need(c.hasGrass, 'No grass in this place'),
    source: () => 'Estimated from the time of year, the height above sea level and the drought factor for each grass fuel type',
    resolution: fuelResolution,
  },
  {
    id: 'fuelType',
    group: 'Vegetation and fuel',
    title: 'Fuel type',
    what: 'The kind of vegetation on the ground, such as dry forest, wet forest, heath or grassland.',
    why: 'Each fuel type burns differently, so it sets how fast and how hot a fire can run.',
    kind: 'heat',
    heat: heat('fuelType', 'categories', true),
    dimension: '2.5-D terrain',
    available: always,
    source: fuelSource,
    resolution: fuelResolution,
  },
  {
    id: 'fuelLoad',
    group: 'Vegetation and fuel',
    title: 'Fuel amount (load)',
    what: 'How much fine fuel (litter, grass, shrubs and bark) lies on the ground, in tonnes per hectare.',
    why: 'More fuel means taller flames and a hotter fire.',
    kind: 'heat',
    heat: heat('fuelLoad', 't/ha'),
    dimension: '2.5-D terrain',
    available: always,
    source: fuelSource,
    resolution: fuelResolution,
  },
  {
    id: 'timeSinceFire',
    group: 'Vegetation and fuel',
    title: 'Years since last fire',
    what: 'How many years ago each place last burnt, as far as the fire records show.',
    why: 'Fuel builds up for 10 to 20 years after a fire, so long-unburnt country carries the hottest fire.',
    kind: 'heat',
    heat: heat('timeSinceFire', 'years'),
    dimension: '2.5-D terrain',
    available: always,
    source: (sc) => sc?.fuelSources?.find((s) => /fire history/i.test(s)) ?? 'NSW National Parks and Wildlife Service fire history (CC BY 4.0)',
    resolution: fuelResolution,
  },
  {
    id: 'fireHistoryKind',
    group: 'Vegetation and fuel',
    title: 'Wildfire or planned burn',
    what: 'Whether the last recorded fire was a wildfire or a planned (prescribed) burn.',
    why: 'Planned burns deliberately used up the fuel, so they often make a safer place to hold a fire.',
    kind: 'heat',
    heat: heat('fireHistoryKind', 'categories', true),
    dimension: '2.5-D terrain',
    available: always,
    source: (sc) => sc?.fuelSources?.find((s) => /fire history/i.test(s)) ?? 'NSW National Parks and Wildlife Service fire history (CC BY 4.0)',
    resolution: fuelResolution,
  },

  // ── Fire and weather ───────────────────────────────────────────────────────
  {
    id: 'arrival',
    group: 'Fire and weather',
    title: 'Fire arrival time',
    what: 'When the fire reached each place, from the first burnt to the latest.',
    why: 'Where the arrival lines bunch up the fire was slowed, and where they spread apart it ran.',
    kind: 'heat',
    heat: heat('arrival', 'time since start'),
    dimension: '2.5-D terrain',
    available: needsFire,
    source: () => SIMULATION,
    resolution: simResolution,
  },
  {
    id: 'ros',
    group: 'Fire and weather',
    title: 'Rate of spread',
    what: 'How fast the fire edge was moving when it reached each place.',
    why: 'Walking pace uphill off-track is only 1 to 2 km/h, so a fire that moves faster than that cannot be outrun on foot.',
    kind: 'heat',
    heat: heat('ros', 'km/h'),
    dimension: '2.5-D terrain',
    available: needsFire,
    source: () => SIMULATION,
    resolution: simResolution,
  },
  {
    id: 'intensity',
    group: 'Fire and weather',
    title: 'Fire intensity',
    what: 'How much heat the fire edge gave out at each place, sorted into suppression classes.',
    why: 'It tells you whether hand tools, tankers and machinery, or only indirect attack can work.',
    kind: 'heat',
    heat: heat('intensity', 'kW/m'),
    dimension: '2.5-D terrain',
    available: needsFire,
    source: () => SIMULATION,
    resolution: simResolution,
  },
  {
    id: 'driver',
    group: 'Fire and weather',
    title: 'Why it spread',
    what: 'The main reason the fire moved as it did at each place, such as wind, slope or spotting.',
    why: 'Knowing the driver tells you what to watch: a wind-driven fire changes with the wind, a slope-driven one with the hill.',
    kind: 'heat',
    heat: heat('driver', 'categories', true),
    dimension: '2.5-D terrain',
    available: needsFire,
    source: () => SIMULATION,
    resolution: simResolution,
  },
  {
    id: 'moisture',
    group: 'Fire and weather',
    title: 'Dead fuel moisture',
    what: 'How damp the fine dead fuel (leaf litter) is right now.',
    why: 'Below about 6 % litter ignites easily from embers, and above about 20 % a fire struggles to spread.',
    kind: 'heat',
    heat: heat('moisture', '%'),
    dimension: '2.5-D terrain',
    available: needsFire,
    source: () => 'FireSim fuel-moisture model driven by the weather, aspect, shade, canopy and dew, computed on this device',
    resolution: simResolution,
  },
  {
    id: 'windSpeed',
    group: 'Fire and weather',
    title: 'Wind speed',
    what: 'How fast the wind is blowing near the ground, place by place.',
    why: 'Wind is the biggest driver of a fire, and ridges and gaps funnel it hardest.',
    kind: 'heat',
    heat: heat('windSpeed', 'km/h'),
    dimension: '2.5-D terrain',
    available: (c) => (c.has3dAtmosphere ? needsFire(c) : needsAtmosphere(c)),
    source: () => 'FireSim 3-D atmosphere model (winds 10 m above the ground), computed on this device',
    resolution: (sc) => `${sc?.atmosphereCellSize ? `${sc.atmosphereCellSize} m` : '100 to 270 m'} atmosphere cells, updated at every simulation step`,
  },
  {
    id: 'landing',
    group: 'Fire and weather',
    title: 'Ember landings',
    what: 'Where burning embers are landing, and how many.',
    why: 'Spot fires start where embers land in dry fine fuel, and they can join into a new fire front ahead of the main one.',
    kind: 'heat',
    heat: heat('landing', 'brands/ha/h'),
    dimension: '2.5-D terrain',
    available: needsFire,
    source: () => 'FireSim ember model (launch, flight and landing of individual embers), computed on this device',
    resolution: simResolution,
  },
  {
    id: 'trench',
    group: 'Fire and weather',
    title: 'Gullies and chimneys',
    what: 'Narrow, steep gullies where hot gases funnel upwards.',
    why: 'Fire can race up a gully far faster than up an open slope, like flames up a chimney.',
    kind: 'heat',
    heat: heat('trench', 'score 0–1'),
    dimension: '2.5-D terrain',
    available: needsFire,
    source: (sc) => `Worked out from the ground shape: ${terrainSource(sc)}`,
    resolution: simResolution,
  },
  {
    id: 'attach',
    group: 'Fire and weather',
    title: 'Flame attachment',
    what: 'Steep slopes where flames lie down against the ground and the fire can suddenly surge uphill.',
    why: 'Above about 22 degrees flames attach to the slope and the fire can accelerate without warning.',
    kind: 'heat',
    heat: heat('attach', 'score 0–1'),
    dimension: '2.5-D terrain',
    available: needsFire,
    source: (sc) => `Worked out from the ground shape: ${terrainSource(sc)}`,
    resolution: simResolution,
  },
  {
    id: 'vls',
    group: 'Fire and weather',
    title: 'Sideways runs (VLS)',
    what: 'Steep slopes facing away from a strong wind, where fire can run sideways across the slope.',
    why: 'On these lee slopes fire can sweep across the hillside and shower embers downwind, catching crews on the flank.',
    kind: 'heat',
    heat: heat('vls', 'score 0–1'),
    dimension: '2.5-D terrain',
    available: needsFire,
    source: () => SIMULATION,
    resolution: simResolution,
  },
  {
    id: 'dmz',
    group: 'Fire and weather',
    title: 'Dead man zone',
    what: 'The flank of the fire that would become its head when the forecast wind change arrives.',
    why: 'Never be here without a safe refuge, because the fire can turn on you when the wind shifts.',
    kind: 'heat',
    heat: heat('dmz', 'score 0–1'),
    dimension: '2.5-D terrain',
    available: needsFire,
    source: () => SIMULATION,
    resolution: simResolution,
  },

  // ── Places ─────────────────────────────────────────────────────────────────
  {
    id: 'roads',
    group: 'Places',
    title: 'Roads and tracks',
    what: 'Roads and tracks from official NSW data, drawn by type from highway to walking track, or shown as a distance-to-road heat map.',
    why: 'Roads help you find your way and show where trucks can reach, make a stand or get out.',
    kind: 'both',
    scene: 'roads',
    heat: heat('roadAccess', 'm'),
    dimension: '2.5-D terrain',
    available: needsContext('road', (c) => c.hasRoads ?? true),
    source: (sc) => contextSource(sc, 'roads', 'NSW Spatial Services road segments (CC BY 4.0)'),
    resolution: (sc) => `Survey lines at their true position; the distance map is worked out on the ${fireGrid(sc)}`,
  },
  {
    id: 'fireTrails',
    group: 'Places',
    title: 'Fire trails',
    what: 'Vehicle tracks classified by the Rural Fire Service as fire trails, highlighted on top of the roads.',
    why: 'These are the tracks crews rely on to reach, hold and retreat from a fire in the bush.',
    kind: 'scene',
    scene: 'fireTrails',
    dimension: '2.5-D terrain',
    available: needsContext('fire-trail', (c) => c.hasRoads ?? true),
    source: (sc) => contextSource(sc, 'fireTrails', 'NSW Spatial Services classified fire trails (CC BY 4.0)'),
    resolution: () => 'Survey lines at their true position',
  },
  {
    id: 'homes',
    group: 'Places',
    title: 'Homes',
    what: 'One small house marker for every home address, or a heat map of how many homes are nearby.',
    why: 'Homes and the people in them are what most needs protecting, and they can catch alight from embers.',
    kind: 'both',
    scene: 'homes',
    heat: heat('homeDensity', 'homes/ha'),
    dimension: '3-D objects',
    available: needsContext('home address', (c) => c.hasHomes ?? true),
    source: (sc) => contextSource(sc, 'homes', 'NSW Spatial Services address points (CC BY 4.0)'),
    resolution: (sc) => `One point per address; the density map counts homes within about 150 m of each cell of the ${fireGrid(sc)}`,
  },
  {
    id: 'zones',
    group: 'Places',
    title: 'Residential areas',
    what: 'Residential and other built-up land-use zones, shown as tinted areas.',
    why: 'It shows where people live and work, so you can see what lies in the path of the fire.',
    kind: 'scene',
    scene: 'zones',
    dimension: '2.5-D terrain',
    available: needsContext('land-use zone'),
    source: (sc) => contextSource(sc, 'zones', 'NSW Planning land zoning (CC BY 4.0)'),
    resolution: () => 'Zone boundaries at their true position',
  },
  {
    id: 'placeNames',
    group: 'Places',
    title: 'Place names',
    what: 'Suburb, town and major road names written on the map.',
    why: 'Names let you match the map with what you hear on the radio and read on your own map.',
    kind: 'scene',
    scene: 'placeNames',
    dimension: '2-D labels',
    available: needsContext('place-name'),
    source: (sc) => contextSource(sc, 'places', 'NSW Spatial Services places of interest and suburb boundaries (CC BY 4.0)'),
    resolution: () => 'Names at their true position; the ones that fit are shown',
  },

  // ── Simulation visuals ─────────────────────────────────────────────────────
  {
    id: 'flames',
    group: 'Simulation visuals',
    title: 'Flames',
    what: 'Animated flames along the fire edge, as tall as the simulated flame height and leaning with the wind.',
    why: 'Flame height shows how intense the fire is and how close you can safely get.',
    kind: 'scene',
    scene: 'flames',
    dimension: '3-D objects',
    available: always,
    source: () => SIMULATION,
    resolution: simResolution,
  },
  {
    id: 'smoke',
    group: 'Simulation visuals',
    title: 'Smoke',
    what: 'The smoke plume rising from the fire and drifting downwind.',
    why: 'Smoke shows where the fire is lifting air and where its embers and ash will be carried.',
    kind: 'scene',
    scene: 'smoke',
    dimension: '3-D volume',
    available: always,
    source: () => SIMULATION,
    resolution: (sc) => `${sc?.atmosphereCellSize ? `${sc.atmosphereCellSize} m` : '100 to 270 m'} atmosphere cells, drawn as soft puffs`,
  },
  {
    id: 'embers',
    group: 'Simulation visuals',
    title: 'Embers',
    what: 'Glowing embers lifted off the fire and blown ahead of it.',
    why: 'Embers start spot fires far ahead of the front, which is how fires jump roads, creeks and firebreaks.',
    kind: 'scene',
    scene: 'embers',
    dimension: '3-D objects',
    available: always,
    source: () => SIMULATION,
    resolution: () => 'Individual embers (thousands at a time)',
  },
  {
    id: 'wind',
    group: 'Simulation visuals',
    title: 'Wind streaks',
    what: 'Animated streaks that show which way the air is moving, near the ground or up through the plume.',
    why: 'The wind steers the fire and the hills bend it: watch for streaks that speed up over ridges or swirl on the lee side.',
    kind: 'scene',
    scene: 'wind',
    dimension: '3-D volume',
    available: always,
    source: () => 'FireSim 3-D atmosphere (or the weather forecast wind where the atmosphere is off), computed on this device',
    resolution: (sc) => `${sc?.atmosphereCellSize ? `${sc.atmosphereCellSize} m` : '100 to 270 m'} atmosphere cells, drawn as streaks`,
  },
  {
    id: 'crossSection',
    group: 'Simulation visuals',
    title: 'Vertical air slice',
    what: 'A vertical slice through the air along a line, showing warm and cool air and the wind arrows.',
    why: 'It shows how the fire builds its own plume and wind, and how cold air drains down the valleys at night.',
    kind: 'scene',
    scene: 'crossSection',
    dimension: '2-D slice',
    available: needsAtmosphere,
    source: () => 'FireSim 3-D atmosphere, computed on this device',
    resolution: (sc) => `${sc?.atmosphereCellSize ? `${sc.atmosphereCellSize} m` : '100 to 270 m'} atmosphere cells`,
  },
  {
    id: 'insightMarkers',
    group: 'Simulation visuals',
    title: 'Insight markers',
    what: 'Small markers on the map where the simulation has spotted something worth learning.',
    why: 'Each marker explains something the fire is doing that a firefighter should notice, such as an upslope run or a gully chimney.',
    kind: 'scene',
    scene: 'insightMarkers',
    dimension: '3-D objects',
    available: always,
    source: () => 'FireSim explanation rules applied to the simulation, computed on this device',
    resolution: () => 'One marker per lesson, at the place it applies',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Lookups and helpers
// ─────────────────────────────────────────────────────────────────────────────

export const layerById = (id: string): LayerInfo | undefined => LAYER_CATALOG.find((l) => l.id === id);

/** Layers of a group, in panel order. */
export const layersInGroup = (group: LayerGroup): LayerInfo[] => LAYER_CATALOG.filter((l) => l.group === group);

/** The catalog entry that owns a heat map. */
export const layerForOverlay = (overlay: OverlayKind): LayerInfo | undefined => (overlay === 'none' ? undefined : LAYER_CATALOG.find((l) => l.heat?.overlay === overlay));

/** The catalog entry that owns a scene switch. */
export const layerForSceneKey = (key: SceneLayerKey): LayerInfo | undefined => LAYER_CATALOG.find((l) => l.scene === key);

const GRASSY_TYPES: ReadonlySet<number> = new Set([FuelType.Grassland, FuelType.GrassyWoodland, FuelType.AlpineHeathGrass, FuelType.DryForestGrassy]);

/** Does any cell of the fuel map carry grass (so the grass-curing map has something to show)? */
export function fuelHasGrass(fuel: Pick<FuelMap, 'type'>): boolean {
  for (let k = 0; k < fuel.type.length; k++) if (GRASSY_TYPES.has(fuel.type[k]!)) return true;
  return false;
}

/**
 * Builds the {@link AvailabilityContext} from the objects the app already has. `snapshot` is the latest simulation
 * snapshot (null before the first one); `fire` says a fire has been marked even if there is no snapshot yet.
 */
export function availabilityContext(input: {
  fuel?: Pick<FuelMap, 'type' | 'sources'> | null;
  snapshot?: Pick<SimSnapshot, 'atmosphere'> | null;
  context?: ContextLayers | null;
  hasImagery?: boolean;
  fire?: boolean;
}): AvailabilityContext {
  const ctx = input.context ?? null;
  return {
    hasFire: input.fire ?? !!input.snapshot,
    has3dAtmosphere: !!input.snapshot?.atmosphere,
    hasContext: !!ctx,
    hasGrass: input.fuel ? fuelHasGrass(input.fuel) : false,
    hasCanopyData: !!input.fuel?.sources.some((s) => /canopy height/i.test(s)),
    hasImagery: !!input.hasImagery,
    hasHomes: ctx ? ctx.homes.length > 0 : false,
    hasRoads: ctx ? ctx.roads.length + ctx.fireTrails.length > 0 : false,
  };
}
