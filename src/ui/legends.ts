/**
 * Legends for the overlay layers (Layers tool). Colours mirror src/render/palette.ts so the legend always matches
 * what the 3-D view paints; each legend also says what the layer teaches, in plain language.
 */
import { FuelType, SpreadDriver } from '../core/types';
import type { OverlayKind } from '../render/layers';
import { DRIVER_LABELS, FUEL_LABELS } from './labels';

export interface LegendStop {
  colour: string;
  label: string;
  /** Plain-English gloss of the stop or class ("fresh breeze", "thin litter, little to burn"), when the renderer gives one. */
  words?: string;
}

export type Legend =
  | { kind: 'ramp'; title: string; unit: string; about: string; stops: LegendStop[]; /** CSS gradient override */ gradient?: string; /** extra swatches, e.g. "not burnt" */ extra?: LegendStop[] }
  | { kind: 'classes'; title: string; unit: string; about: string; classes: (LegendStop & { note?: string })[] };

export interface OverlayOption {
  id: OverlayKind;
  label: string;
  /** Short group heading in the chooser. */
  group: 'Fire' | 'Fuel' | 'Terrain' | 'Mountain' | 'Off';
}

export const OVERLAY_OPTIONS: OverlayOption[] = [
  { id: 'none', label: 'No overlay', group: 'Off' },
  { id: 'arrival', label: 'Arrival time', group: 'Fire' },
  { id: 'ros', label: 'Spread rate', group: 'Fire' },
  { id: 'intensity', label: 'Intensity', group: 'Fire' },
  { id: 'driver', label: 'Why it spread', group: 'Fire' },
  { id: 'moisture', label: 'Litter moisture', group: 'Fuel' },
  { id: 'fuelLoad', label: 'Fuel load', group: 'Fuel' },
  { id: 'fuelType', label: 'Fuel type', group: 'Fuel' },
  { id: 'timeSinceFire', label: 'Time since fire', group: 'Fuel' },
  { id: 'slope', label: 'Slope', group: 'Terrain' },
  { id: 'aspect', label: 'Aspect', group: 'Terrain' },
  { id: 'insolation', label: 'Sunlight', group: 'Terrain' },
  // Mountain-phenomena rasters computed by the engine (SimSnapshot.layers).
  { id: 'trench', label: 'Gullies / chimneys', group: 'Mountain' },
  { id: 'attach', label: 'Flame attachment', group: 'Mountain' },
  { id: 'vls', label: 'Sideways runs (VLS)', group: 'Mountain' },
  { id: 'dmz', label: 'Dead man zone', group: 'Mountain' },
  { id: 'landing', label: 'Ember landings', group: 'Mountain' },
];

/** Overlays whose raster comes from the engine in SimSnapshot.layers (empty until the engine provides it). */
export const SNAPSHOT_LAYER_OVERLAYS: ReadonlySet<OverlayKind> = new Set<OverlayKind>(['vls', 'attach', 'trench', 'dmz', 'landing']);

/** Hazard / potential score 0–1 ramp (mirrors src/render/palette.ts HAZARD_RAMP). */
const HAZARD_STOPS: LegendStop[] = [
  { colour: '#fff7bc', label: 'low' },
  { colour: '#fec44f', label: '' },
  { colour: '#fe9929', label: '' },
  { colour: '#d7301f', label: '' },
  { colour: '#7a0177', label: 'high' },
];

const hazardLegend = (title: string, about: string): Legend => ({ kind: 'ramp', title, unit: 'score 0–1', about, stops: HAZARD_STOPS });

const FUEL_COLOURS: Record<FuelType, string> = {
  [FuelType.NonFuel]: '#bdb6a8',
  [FuelType.Water]: '#2c7fb8',
  [FuelType.Grassland]: '#e6d36a',
  [FuelType.GrassyWoodland]: '#b8c85a',
  [FuelType.DryForestShrubby]: '#6f8f2f',
  [FuelType.DryForestGrassy]: '#98a84a',
  [FuelType.WetForest]: '#2f7a3f',
  [FuelType.Rainforest]: '#0f4d2a',
  [FuelType.Heath]: '#b07aa1',
  [FuelType.AlpineHeathGrass]: '#d9a6c9',
  [FuelType.SnowGumWoodland]: '#7fb8a4',
  [FuelType.PinePlantation]: '#264d33',
  [FuelType.Urban]: '#7f7f7f',
};

const DRIVER_COLOURS: Record<SpreadDriver, string> = {
  [SpreadDriver.None]: '#9e9e9e',
  [SpreadDriver.Wind]: '#1f78b4',
  [SpreadDriver.Slope]: '#e31a1c',
  [SpreadDriver.WindAndSlope]: '#6a3d9a',
  [SpreadDriver.Fuel]: '#33a02c',
  [SpreadDriver.DryFuel]: '#b15928',
  [SpreadDriver.Spotting]: '#ff7f00',
  [SpreadDriver.LateralVorticity]: '#f0027f',
  [SpreadDriver.Eruptive]: '#ffe119',
  [SpreadDriver.FireInducedWind]: '#a6cee3',
  [SpreadDriver.Backing]: '#b2df8a',
  [SpreadDriver.Junction]: '#fb9a99',
};

export const fuelColour = (t: FuelType): string => FUEL_COLOURS[t] ?? '#999999';
export const driverColour = (d: SpreadDriver): string => DRIVER_COLOURS[d] ?? '#9e9e9e';

const LEGENDS: Partial<Record<Exclude<OverlayKind, 'none'>, Legend>> = {
  arrival: {
    kind: 'ramp',
    title: 'Fire arrival time',
    unit: 'since ignition',
    about: 'When the fire reached each place. Arrival-time lines are drawn at equal time steps: where they are far apart the fire ran fast, where they bunch up it was slow (backing, downhill, moist gullies).',
    stops: [
      { colour: '#2a0f78', label: 'Start' },
      { colour: '#6a00a8', label: '' },
      { colour: '#b12a90', label: '' },
      { colour: '#e16462', label: '' },
      { colour: '#fca636', label: '' },
      { colour: '#f0f921', label: 'Now' },
    ],
  },
  ros: {
    kind: 'ramp',
    title: 'Rate of spread',
    unit: 'km/h',
    about: 'How fast the edge was moving when it arrived. Walking uphill on a 20° track is only about 1.4 km/h.',
    stops: [
      { colour: '#fff7bc', label: '0.05' },
      { colour: '#fee391', label: '0.2' },
      { colour: '#fec44f', label: '0.5' },
      { colour: '#fe9929', label: '1' },
      { colour: '#ec7014', label: '2' },
      { colour: '#cc4c02', label: '4' },
      { colour: '#8c2d04', label: '8' },
      { colour: '#4a1402', label: '15+' },
    ],
  },
  intensity: {
    kind: 'classes',
    title: 'Fireline intensity',
    unit: 'kW/m',
    about: 'Energy released per metre of fire edge — what it means for suppression.',
    classes: [
      { colour: '#bfe3a1', label: '< 500', note: 'Hand tools can hold it' },
      { colour: '#f7e36b', label: '500 – 2,000', note: 'Tankers and machinery' },
      { colour: '#f6a13a', label: '2,000 – 4,000', note: 'Limit of direct attack' },
      { colour: '#e4572e', label: '4,000 – 10,000', note: 'Indirect attack only' },
      { colour: '#a51d2d', label: '10,000 – 30,000', note: 'Crown fire likely' },
      { colour: '#4d0b2e', label: '> 30,000', note: 'Uncontrollable' },
    ],
  },
  driver: {
    kind: 'classes',
    title: 'Why it spread here',
    unit: '',
    about: 'The main reason the fire moved the way it did at each place.',
    classes: [
      SpreadDriver.Wind,
      SpreadDriver.Slope,
      SpreadDriver.WindAndSlope,
      SpreadDriver.DryFuel,
      SpreadDriver.Fuel,
      SpreadDriver.Spotting,
      SpreadDriver.Eruptive,
      SpreadDriver.LateralVorticity,
      SpreadDriver.FireInducedWind,
      SpreadDriver.Backing,
      SpreadDriver.Junction,
    ].map((d) => ({ colour: driverColour(d), label: DRIVER_LABELS[d] })),
  },
  moisture: {
    kind: 'ramp',
    title: 'Dead fine fuel (litter) moisture',
    unit: '%',
    about: 'Below about 6 % litter ignites easily and embers catch; above about 20 % fire struggles to spread.',
    stops: [
      { colour: '#8c510a', label: '3' },
      { colour: '#d8b365', label: '6' },
      { colour: '#f6e8c3', label: '9' },
      { colour: '#c7eae5', label: '13' },
      { colour: '#5ab4ac', label: '18' },
      { colour: '#01665e', label: '25+' },
    ],
  },
  fuelLoad: {
    kind: 'ramp',
    title: 'Fine fuel load',
    unit: 't/ha',
    about: 'Litter, grass, shrubs and bark that burn in the flaming front. More fuel means taller flames and more heat.',
    stops: [
      { colour: '#ffffe5', label: '0' },
      { colour: '#fff7bc', label: '5' },
      { colour: '#fee391', label: '10' },
      { colour: '#fec44f', label: '15' },
      { colour: '#fe9929', label: '20' },
      { colour: '#ec7014', label: '25' },
      { colour: '#cc4c02', label: '30' },
      { colour: '#8c2d04', label: '40+' },
    ],
  },
  fuelType: {
    kind: 'classes',
    title: 'Fuel type',
    unit: '',
    about: 'Vegetation groups that burn differently (AFDRS fuel families).',
    classes: [
      FuelType.DryForestShrubby,
      FuelType.DryForestGrassy,
      FuelType.WetForest,
      FuelType.Rainforest,
      FuelType.Heath,
      FuelType.Grassland,
      FuelType.GrassyWoodland,
      FuelType.SnowGumWoodland,
      FuelType.AlpineHeathGrass,
      FuelType.PinePlantation,
      FuelType.Urban,
      FuelType.NonFuel,
      FuelType.Water,
    ].map((t) => ({ colour: fuelColour(t), label: FUEL_LABELS[t] })),
  },
  timeSinceFire: {
    kind: 'ramp',
    title: 'Time since fire',
    unit: 'years',
    about: 'Fuel builds up for 10–20 years after a fire. Recently burnt ground (light) is a safer anchor and slows a fire.',
    stops: [
      { colour: '#fff7bc', label: '0' },
      { colour: '#f7fcb9', label: '2' },
      { colour: '#c2e699', label: '5' },
      { colour: '#78c679', label: '10' },
      { colour: '#31a354', label: '20' },
      { colour: '#006837', label: '30' },
      { colour: '#00331a', label: '50+' },
    ],
  },
  slope: {
    kind: 'classes',
    title: 'Slope',
    unit: '°',
    about: 'Fire roughly doubles its speed for every 10° uphill. Above 20° every model tends to under-predict.',
    classes: [
      { colour: '#f0f7e6', label: '0 – 5°', note: 'Flat to gentle' },
      { colour: '#c7e6b0', label: '5 – 10°' },
      { colour: '#fde68a', label: '10 – 15°', note: '≈ ×2 uphill' },
      { colour: '#fbbf57', label: '15 – 20°' },
      { colour: '#f2711c', label: '20 – 25°', note: '≈ ×4, beyond tested range' },
      { colour: '#c81d25', label: '25 – 35°', note: 'Flames can attach' },
      { colour: '#5c0a3a', label: '> 35°', note: 'Very steep / cliff' },
    ],
  },
  aspect: {
    kind: 'classes',
    title: 'Aspect (way the slope faces)',
    unit: '',
    about: 'North- and west-facing slopes get the afternoon sun: drier, hotter fuel. South-facing slopes stay moister.',
    classes: [
      { colour: '#e6550d', label: 'North' },
      { colour: '#fd8d3c', label: 'North-east' },
      { colour: '#fdd0a2', label: 'East' },
      { colour: '#bcbddc', label: 'South-east' },
      { colour: '#6a51a3', label: 'South' },
      { colour: '#9e9ac8', label: 'South-west' },
      { colour: '#fdae6b', label: 'West' },
      { colour: '#d94801', label: 'North-west' },
      { colour: '#d9d9d9', label: 'Flat' },
    ],
  },
  insolation: {
    kind: 'ramp',
    title: 'Sunlight on the slope',
    unit: 'W/m²',
    about: 'Sun-heated slopes dry the litter and drive upslope winds; shaded slopes cool and drain air downhill.',
    stops: [
      { colour: '#1d2c4c', label: '0' },
      { colour: '#3f3f7a', label: '150' },
      { colour: '#8b3f7e', label: '350' },
      { colour: '#d9534f', label: '550' },
      { colour: '#f79d39', label: '750' },
      { colour: '#fce38a', label: '950' },
      { colour: '#fffbe0', label: '1100' },
    ],
  },
  trench: hazardLegend('Gullies and chimneys', 'Narrow, steep gullies channel hot gases like a chimney: fire can race up them far faster than up an open slope.'),
  attach: hazardLegend('Flame attachment / blow-up potential', 'On slopes steeper than about 22° flames lie down on the fuel and the fire can suddenly accelerate uphill.'),
  vls: hazardLegend('Sideways run on lee slopes (VLS)', 'Steep slopes facing away from a strong wind can make fire run sideways across the slope and shower embers downwind.'),
  dmz: hazardLegend('Dead man zone (wind change)', 'The flank that becomes a head fire when the forecast wind change arrives. Never be here without a safe refuge.'),
  landing: {
    kind: 'ramp',
    title: 'Where embers are landing',
    unit: 'brands/ha/h',
    about: 'Spot fires start where embers land in dry, fine fuel. Dense landings ahead of the front can merge into a new fire front.',
    stops: [
      { colour: '#fee391', label: '0.1' },
      { colour: '#fe9929', label: '1' },
      { colour: '#cc4c02', label: '10' },
      { colour: '#662506', label: '100' },
    ],
  },
  // ── Data layers as heat maps (layers rework): mirrors of the renderer's legends (src/render/legends.ts), kept in step by src/render/uiLegendParity.test.ts ──
  elevation: {
    kind: 'ramp',
    title: 'Ground height above sea level',
    unit: 'm',
    about: 'Fire runs faster uphill, ridges catch the wind first, and on a still night cold air drains down into the low ground.',
    stops: [{ colour: '#3f82c8', label: 'Lowest' }, { colour: '#f4e04d', label: 'Middle' }, { colour: '#6a1150', label: 'Highest' }],
    gradient: 'linear-gradient(to right, #3f82c8 0%, #48a7c5 13%, #7ac6a7 25%, #bbdb7b 38%, #f4e04d 50%, #f3a131 63%, #e15e2c 75%, #b62837 88%, #6a1150 100%)',
  },
  landform: {
    kind: 'classes',
    title: 'Landform (ridge, slope, gully)',
    unit: '',
    about: 'Gullies act like chimneys that fire races up, ridge tops and spurs are exposed to the wind, and cliffs and flat ground slow a fire down.',
    classes: [
      { colour: '#8c1c13', label: 'Peak' },
      { colour: '#e0523a', label: 'Ridge top' },
      { colour: '#f39c4a', label: 'Spur (a ridge running downhill)' },
      { colour: '#f7d774', label: 'Upper slope' },
      { colour: '#b8d98a', label: 'Mid slope' },
      { colour: '#6fc0a0', label: 'Lower slope' },
      { colour: '#3a8fb7', label: 'Gully (creek line or draw)' },
      { colour: '#1f4e9c', label: 'Valley floor' },
      { colour: '#b38b5d', label: 'Saddle (low point on a ridge)' },
      { colour: '#3b3b3b', label: 'Cliff' },
      { colour: '#d9d9d9', label: 'Flat ground' },
    ],
  },
  canopyHeight: {
    kind: 'ramp',
    title: 'Tree height',
    unit: 'm',
    about: 'Tall trees loft embers higher and further, and flames that reach the crowns make a crown fire that is far harder to stop.',
    stops: [{ colour: '#3f82c8', label: '0' }, { colour: '#7ac6a7', label: '10' }, { colour: '#f4e04d', label: '20' }, { colour: '#e15e2c', label: '30' }, { colour: '#6a1150', label: '40+' }],
    gradient: 'linear-gradient(to right, #3f82c8 0%, #5da4b8 13%, #7ac6a7 25%, #b7d37a 38%, #f4e04d 50%, #eb9f3d 63%, #e15e2c 75%, #a6383e 88%, #6a1150 100%)', extra: [{ colour: '#00000000', label: 'No trees (under 2 m)' }],
  },
  canopyCover: {
    kind: 'ramp',
    title: 'Tree cover',
    unit: '%',
    about: 'Dense tree cover shades and dampens the fuel below, but touching crowns can carry a crown fire from tree to tree.',
    stops: [{ colour: '#3f82c8', label: '0' }, { colour: '#7ac6a7', label: '25' }, { colour: '#f4e04d', label: '50' }, { colour: '#e15e2c', label: '75' }, { colour: '#6a1150', label: '100' }],
    gradient: 'linear-gradient(to right, #3f82c8 0%, #5da4b8 13%, #7ac6a7 25%, #b7d37a 38%, #f4e04d 50%, #eb9f3d 63%, #e15e2c 75%, #a6383e 88%, #6a1150 100%)',
  },
  elevatedHazard: {
    kind: 'classes',
    title: 'Shrub (ladder fuel) hazard',
    unit: 'score 0–4',
    about: 'Shrubs are the ladder that lets flames climb from the ground into the tree crowns: the higher the hazard, the taller and hotter the fire.',
    classes: [
      { colour: '#c9d6e2', label: 'None', note: 'no shrubs' },
      { colour: '#3f82c8', label: 'Low', note: 'few or small shrubs' },
      { colour: '#f4e04d', label: 'Moderate', note: 'scattered shrubs' },
      { colour: '#f28c28', label: 'High', note: 'continuous shrubs' },
      { colour: '#cf2f2f', label: 'Very high', note: 'dense, tall shrubs' },
      { colour: '#6a1150', label: 'Extreme', note: 'thick, tall, dry shrubs' },
      { colour: '#00000000', label: 'Not fuel (rock, water, cleared ground)' },
    ],
  },
  elevatedHeight: {
    kind: 'ramp',
    title: 'Shrub height',
    unit: 'm',
    about: 'Flames are at least as tall as the shrubs, and shrubs that reach the tree crowns let a fire climb into the canopy.',
    stops: [{ colour: '#3f82c8', label: '0' }, { colour: '#4bb3c4', label: '0.5' }, { colour: '#a8d98a', label: '1' }, { colour: '#f4e04d', label: '1.5' }, { colour: '#f28c28', label: '2' }, { colour: '#cf2f2f', label: '2.5' }, { colour: '#6a1150', label: '3+' }],
    gradient: 'linear-gradient(to right, #3f82c8 0%, #48a7c5 13%, #7ac6a7 25%, #bbdb7b 38%, #f4e04d 50%, #f3a131 63%, #e15e2c 75%, #b62837 88%, #6a1150 100%)', extra: [{ colour: '#00000000', label: 'No shrub layer' }],
  },
  surfaceHazard: {
    kind: 'classes',
    title: 'Leaf litter hazard',
    unit: 'score 0–4',
    about: 'Fallen leaves, bark and twigs are what a fire burns first: the deeper the litter, the hotter and faster the flaming edge.',
    classes: [
      { colour: '#c9d6e2', label: 'None', note: 'bare ground' },
      { colour: '#3f82c8', label: 'Low', note: 'thin litter, little to burn' },
      { colour: '#f4e04d', label: 'Moderate', note: 'patchy litter' },
      { colour: '#f28c28', label: 'High', note: 'a good cover of litter' },
      { colour: '#cf2f2f', label: 'Very high', note: 'deep litter' },
      { colour: '#6a1150', label: 'Extreme', note: 'very deep litter that burns fiercely' },
      { colour: '#00000000', label: 'Not fuel (rock, water, cleared ground)' },
    ],
  },
  nearSurfaceHazard: {
    kind: 'classes',
    title: 'Grass and low shrub hazard',
    unit: 'score 0–4',
    about: 'Grass, bracken and low shrubs up to about knee height carry a fire quickly and make its flames taller.',
    classes: [
      { colour: '#c9d6e2', label: 'None', note: 'nothing near the ground' },
      { colour: '#3f82c8', label: 'Low', note: 'sparse and short' },
      { colour: '#f4e04d', label: 'Moderate', note: 'patchy' },
      { colour: '#f28c28', label: 'High', note: 'a continuous cover' },
      { colour: '#cf2f2f', label: 'Very high', note: 'dense and deep' },
      { colour: '#6a1150', label: 'Extreme', note: 'very dense: flames climb easily' },
      { colour: '#00000000', label: 'Not fuel (rock, water, cleared ground)' },
    ],
  },
  barkHazard: {
    kind: 'classes',
    title: 'Bark hazard (embers)',
    unit: 'score 0–4',
    about: 'Stringybark and ribbon bark launch burning embers far ahead of the fire, so high bark hazard means spot fires are likely.',
    classes: [
      { colour: '#3f82c8', label: 'Low', note: 'smooth bark: few embers' },
      { colour: '#f4e04d', label: 'Moderate', note: 'some loose bark' },
      { colour: '#f28c28', label: 'High', note: 'rough or ribbon bark' },
      { colour: '#cf2f2f', label: 'Very high', note: 'heavy loose bark' },
      { colour: '#6a1150', label: 'Extreme', note: 'heavy stringybark or ribbon bark: showers of embers' },
      { colour: '#00000000', label: 'Not fuel (rock, water, cleared ground)' },
    ],
  },
  grassCuring: {
    kind: 'ramp',
    title: 'Grass curing (dryness)',
    unit: '%',
    about: 'Dry, golden (cured) grass burns fast and fiercely, while green grass hardly burns at all.',
    stops: [{ colour: '#3f82c8', label: '0' }, { colour: '#7ac6a7', label: '25' }, { colour: '#f4e04d', label: '50' }, { colour: '#e15e2c', label: '75' }, { colour: '#6a1150', label: '100' }],
    gradient: 'linear-gradient(to right, #3f82c8 0%, #5da4b8 13%, #7ac6a7 25%, #b7d37a 38%, #f4e04d 50%, #eb9f3d 63%, #e15e2c 75%, #a6383e 88%, #6a1150 100%)', extra: [{ colour: '#00000000', label: 'Not grass' }],
  },
  fireHistoryKind: {
    kind: 'classes',
    title: 'Last fire: wildfire or planned burn',
    unit: '',
    about: 'A recent planned burn has already used up the fuel and can anchor a control line; the years-since-fire layer shows how long ago each place burnt.',
    classes: [
      { colour: '#d1462f', label: 'Wildfire' },
      { colour: '#2b6cb0', label: 'Prescribed burn or back burn' },
      { colour: '#e0b23c', label: 'Fire of unrecorded type' },
      { colour: '#9a9a9a', label: 'No fire on record' },
    ],
  },
  homeDensity: {
    kind: 'classes',
    title: 'Homes nearby',
    unit: 'homes/ha',
    about: 'Homes are what most needs protecting: the denser the houses, the more people at risk and the more places an ember can start a fire.',
    classes: [
      { colour: '#3f82c8', label: 'under 0.3 · a few scattered homes' },
      { colour: '#7ac6a7', label: '0.3–1 · rural homes on big blocks' },
      { colour: '#f4e04d', label: '1–3 · rural residential' },
      { colour: '#e15e2c', label: '3–8 · large suburban blocks' },
      { colour: '#6a1150', label: '8 or more · suburban streets and town centres' },
      { colour: '#00000000', label: 'No homes within about 150 m' },
    ],
  },
  roadAccess: {
    kind: 'classes',
    title: 'Distance to nearest road or trail',
    unit: 'm',
    about: 'Roads and fire trails are where trucks can reach, make a stand or get out: the further from one, the longer the walk and the harder the retreat.',
    classes: [
      { colour: '#3f82c8', label: 'under 50 m · right beside it' },
      { colour: '#5ebbb8', label: '50–150 m · a short walk' },
      { colour: '#c6dc72', label: '150–300 m · a walk in' },
      { colour: '#f3ae37', label: '300–600 m · well off the road' },
      { colour: '#d6422e', label: '600–1 200 m · remote' },
      { colour: '#6a1150', label: 'over 1 200 m · very remote' },
    ],
  },
  windSpeed: {
    kind: 'ramp',
    title: 'Wind speed near the ground',
    unit: 'km/h',
    about: 'Wind is the biggest driver of a fire: it speeds the fire up sharply, and ridges and gaps funnel it hardest.',
    stops: [{ colour: '#3f82c8', label: '0' }, { colour: '#4bb3c4', label: '10' }, { colour: '#a8d98a', label: '20' }, { colour: '#f4e04d', label: '30' }, { colour: '#f28c28', label: '40' }, { colour: '#cf2f2f', label: '50' }, { colour: '#6a1150', label: '60+' }],
    gradient: 'linear-gradient(to right, #3f82c8 0%, #48a7c5 13%, #7ac6a7 25%, #bbdb7b 38%, #f4e04d 50%, #f3a131 63%, #e15e2c 75%, #b62837 88%, #6a1150 100%)',
  },
};

export function legendFor(kind: OverlayKind): Legend | null {
  return kind === 'none' ? null : (LEGENDS[kind] ?? null);
}

/** CSS linear-gradient for a ramp legend. */
export function rampGradient(stops: readonly LegendStop[]): string {
  const n = stops.length;
  return `linear-gradient(to right, ${stops.map((s, i) => `${s.colour} ${((100 * i) / Math.max(1, n - 1)).toFixed(1)}%`).join(', ')})`;
}

/**
 * Legend published by the renderer (src/render legendFor → LegendSpec), described structurally so the UI does not
 * depend on the renderer being present. When available it is preferred: its colours are exactly what the 3-D view
 * paints (e.g. the arrival ramp spans the burnt period so far).
 */
export interface ExternalLegend {
  title: string;
  units: string;
  kind: 'continuous' | 'classes' | 'categorical' | 'cyclic';
  entries: { value: number; colour: string; label: string; words?: string }[];
  gradient?: string;
  noData?: { colour: string; label: string };
  note?: string;
}

/** What makes a legend dynamic: the arrival ramp spans the burnt period so far; the ground-height ramp spans the site. */
export interface LegendRequest {
  arrivalMaxSeconds?: number;
  isochroneMinutes?: number;
  /** Lowest and highest ground of the scenario (m): the 'elevation' heat map and its legend stretch over it. */
  elevationRange?: readonly [number, number];
}

export type LegendProvider = (overlay: OverlayKind, ctx: LegendRequest) => ExternalLegend | null;

/** Convert a renderer legend to the UI format, keeping the UI's teaching text and per-class meanings. */
export function fromExternalLegend(ext: ExternalLegend, fallback: Legend | null): Legend {
  const about = ext.note ?? fallback?.about ?? '';
  if (ext.kind === 'continuous') {
    const l: Legend = { kind: 'ramp', title: ext.title, unit: ext.units, about, stops: ext.entries.map((e) => withWords({ colour: e.colour, label: e.label }, e.words)) };
    if (ext.gradient) l.gradient = ext.gradient;
    if (ext.noData) l.extra = [{ colour: ext.noData.colour, label: ext.noData.label }];
    return l;
  }
  if (ext.kind === 'cyclic') {
    const classes = ext.entries.map((e) => withWords({ colour: e.colour, label: e.label }, e.words));
    if (ext.noData) classes.push({ colour: ext.noData.colour, label: ext.noData.label });
    return { kind: 'classes', title: ext.title, unit: ext.units, about, classes };
  }
  const notes = fallback?.kind === 'classes' && fallback.classes.length === ext.entries.length ? fallback.classes.map((c) => c.note) : [];
  const classes = ext.entries.map((e, i) => {
    const c: LegendStop & { note?: string } = withWords({ colour: e.colour, label: e.label }, e.words);
    const note = notes[i] ?? e.words;
    if (note) c.note = note;
    return c;
  });
  if (ext.noData) classes.push({ colour: ext.noData.colour, label: ext.noData.label });
  return { kind: 'classes', title: ext.title, unit: ext.units, about, classes };
}

function withWords<T extends LegendStop>(stop: T, words: string | undefined): T {
  if (words) stop.words = words;
  return stop;
}

/**
 * The legend of a heat map: the renderer's (exact colours, the site's own ground-height range, plain-English words for
 * each stop) with the UI's teaching text, else the UI's own (the 2-D map paints with those). null for 'none'.
 */
export function overlayLegend(overlay: OverlayKind, provider: LegendProvider | null, req: LegendRequest = {}): Legend | null {
  const own = legendFor(overlay);
  if (provider && overlay !== 'none') {
    try {
      const ext = provider(overlay, req);
      if (ext) return fromExternalLegend(ext, own);
    } catch (e) {
      console.warn('[FireSim] renderer legend failed; using the built-in one', e);
    }
  }
  return own;
}

/** The plain-English words of a class or stop: its own gloss, else the meaning note of a class. */
export function stopWords(s: LegendStop & { note?: string }): string {
  return s.words ?? s.note ?? '';
}
