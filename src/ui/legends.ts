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

const LEGENDS: Record<Exclude<OverlayKind, 'none'>, Legend> = {
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
};

export function legendFor(kind: OverlayKind): Legend | null {
  return kind === 'none' ? null : LEGENDS[kind];
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
  entries: { value: number; colour: string; label: string }[];
  gradient?: string;
  noData?: { colour: string; label: string };
  note?: string;
}

export type LegendProvider = (overlay: OverlayKind, ctx: { arrivalMaxSeconds?: number; isochroneMinutes?: number }) => ExternalLegend | null;

/** Convert a renderer legend to the UI format, keeping the UI's teaching text and per-class meanings. */
export function fromExternalLegend(ext: ExternalLegend, fallback: Legend | null): Legend {
  const about = ext.note ?? fallback?.about ?? '';
  if (ext.kind === 'continuous') {
    const l: Legend = { kind: 'ramp', title: ext.title, unit: ext.units, about, stops: ext.entries.map((e) => ({ colour: e.colour, label: e.label })) };
    if (ext.gradient) l.gradient = ext.gradient;
    if (ext.noData) l.extra = [{ colour: ext.noData.colour, label: ext.noData.label }];
    return l;
  }
  if (ext.kind === 'cyclic') {
    const classes = ext.entries.map((e) => ({ colour: e.colour, label: e.label }));
    if (ext.noData) classes.push({ colour: ext.noData.colour, label: ext.noData.label });
    return { kind: 'classes', title: ext.title, unit: ext.units, about, classes };
  }
  const notes = fallback?.kind === 'classes' && fallback.classes.length === ext.entries.length ? fallback.classes.map((c) => c.note) : [];
  const classes = ext.entries.map((e, i) => {
    const c: LegendStop & { note?: string } = { colour: e.colour, label: e.label };
    const note = notes[i];
    if (note) c.note = note;
    return c;
  });
  if (ext.noData) classes.push({ colour: ext.noData.colour, label: ext.noData.label });
  return { kind: 'classes', title: ext.title, unit: ext.units, about, classes };
}
