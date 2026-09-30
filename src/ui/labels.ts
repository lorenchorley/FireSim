/**
 * Plain-language labels used across the UI (fuel types, spread drivers, landforms, insight severities, build steps).
 * Kept in sync with src/render/palette.ts, which uses the same wording in the 3-D legends.
 */
import type { DatasetRole } from '../core/datasets';
import { FuelType, Landform, SpreadDriver, type InsightSeverity } from '../core/types';
import type { BuildDatasetProgress, BuildProgress } from '../scenario/request';
import type { IconName } from './icons';

export const FUEL_LABELS: Record<FuelType, string> = {
  [FuelType.NonFuel]: 'Rock / cleared',
  [FuelType.Water]: 'Water',
  [FuelType.Grassland]: 'Grassland',
  [FuelType.GrassyWoodland]: 'Grassy woodland',
  [FuelType.DryForestShrubby]: 'Dry forest (shrubby)',
  [FuelType.DryForestGrassy]: 'Dry forest (grassy)',
  [FuelType.WetForest]: 'Wet forest',
  [FuelType.Rainforest]: 'Rainforest',
  [FuelType.Heath]: 'Heath',
  [FuelType.AlpineHeathGrass]: 'Alpine heath / grass',
  [FuelType.SnowGumWoodland]: 'Snow gum woodland',
  [FuelType.PinePlantation]: 'Pine plantation',
  [FuelType.Urban]: 'Urban',
};

export const DRIVER_LABELS: Record<SpreadDriver, string> = {
  [SpreadDriver.None]: 'Not burnt',
  [SpreadDriver.Wind]: 'Wind',
  [SpreadDriver.Slope]: 'Slope',
  [SpreadDriver.WindAndSlope]: 'Wind + slope',
  [SpreadDriver.Fuel]: 'Heavy fuel',
  [SpreadDriver.DryFuel]: 'Dry fuel',
  [SpreadDriver.Spotting]: 'Spotting',
  [SpreadDriver.LateralVorticity]: 'Lee-slope sideways run (VLS)',
  [SpreadDriver.Eruptive]: 'Eruptive / chimney',
  [SpreadDriver.FireInducedWind]: 'Fire-induced wind',
  [SpreadDriver.Backing]: 'Backing / flanking',
  [SpreadDriver.Junction]: 'Junction zone',
};

export const LANDFORM_LABELS: Record<Landform, string> = {
  [Landform.Flat]: 'Flat ground',
  [Landform.Ridge]: 'Ridge top',
  [Landform.Spur]: 'Spur',
  [Landform.UpperSlope]: 'Upper slope',
  [Landform.MidSlope]: 'Mid slope',
  [Landform.LowerSlope]: 'Lower slope',
  [Landform.Gully]: 'Gully',
  [Landform.ValleyFloor]: 'Valley floor',
  [Landform.Saddle]: 'Saddle',
  [Landform.Peak]: 'Peak',
  [Landform.Cliff]: 'Cliff',
};

/** Severity names follow doc 10 §9.1: Danger (red), Watch Out (amber), Insight (blue); never colour alone. */
export const SEVERITY_LABELS: Record<InsightSeverity, string> = {
  danger: 'Danger',
  watch: 'Watch out',
  info: 'Insight',
};

/**
 * The build steps in the order scenario/build.ts really runs them (terrain → canopy → vegetation → fire history →
 * weather → drought → fuel → places → done: fuel needs the drought factor, KBDI and the month). The fuel-moisture
 * spin-up is not a build step: it runs in the simulation worker when the run starts.
 */
export const BUILD_STEPS: { step: BuildProgress['step']; label: string }[] = [
  { step: 'terrain', label: 'Terrain (elevation, slope, gullies)' },
  { step: 'canopy', label: 'Tree canopy height' },
  { step: 'vegetation', label: 'Vegetation map' },
  { step: 'fireHistory', label: 'Fire history' },
  { step: 'weather', label: 'Weather' },
  { step: 'drought', label: 'Drought (rain history)' },
  { step: 'fuel', label: 'Fuel model' },
  { step: 'places', label: 'Roads, homes and place names' },
  { step: 'done', label: 'Ready' },
];

export type BuildStepState = 'done' | 'active' | 'pending';

/**
 * States of the {@link BUILD_STEPS} rows for a progress event. `reached` is the furthest step index seen so far (pass
 * the previous result's `reached`, -1 at the start): the ticks never go backwards, and a step not in the list (an
 * older or newer builder) keeps the rows as they were. 'done' ticks every row.
 */
export function buildStepStates(step: BuildProgress['step'], reached = -1): { states: BuildStepState[]; reached: number } {
  const i = BUILD_STEPS.findIndex((s) => s.step === step);
  const cur = step === 'done' ? BUILD_STEPS.length - 1 : Math.max(reached, i);
  const states = BUILD_STEPS.map((_, k): BuildStepState => (step === 'done' || k < cur ? 'done' : k === cur ? 'active' : 'pending'));
  return { states, reached: cur };
}

/** Upper-case first letter. */
export const capitalise = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/**
 * Names of the data sets by id (the same titles as the data-set records, scenario/datasetRecords*.ts and estimate.ts), for
 * the rows that appear on the Building screen while the ledger counts them. 'context-file' is the one bundled or stored
 * file that holds all five places layers.
 */
export const DATASET_TITLES: Readonly<Record<string, string>> = Object.freeze({
  terrain: 'Ground height',
  imagery: 'Aerial photo',
  'vegetation-svtm': 'Vegetation map',
  'canopy-height': 'Tree canopy height',
  'fire-history': 'Fire history',
  weather: 'Weather',
  'upper-air': 'Upper-air profile',
  'drought-history': 'Rainfall history and drought',
  roads: 'Roads and tracks',
  'fire-trails': 'Fire trails',
  homes: 'Homes (address points)',
  zones: 'Residential and built-up zones',
  'place-names': 'Place names',
  'context-file': 'Map file of roads, homes and names',
  'fuel-derived': 'Fuel map',
  'fuel-moisture': 'Fuel moisture at the start',
  'user-edits': 'Your input',
  'bundled-site': 'Bundled demo site',
  'area-pack': 'Saved area pack',
});

/** Title of a data set id, or the id in words when it is not a known one. */
export function datasetTitle(id: string): string {
  return DATASET_TITLES[id] ?? capitalise(id.replace(/[-_]+/g, ' '));
}

/** Icon of a data set: by id for the places layers (they share a role), else by role. */
const DATASET_ID_ICONS: Readonly<Record<string, IconName>> = {
  roads: 'road',
  'fire-trails': 'route',
  homes: 'home',
  zones: 'polygon',
  'place-names': 'text',
  'context-file': 'road',
  'upper-air': 'cloud',
  'drought-history': 'droplet',
  'bundled-site': 'database',
  'area-pack': 'download',
  'fuel-moisture': 'droplet',
  'user-edits': 'edit',
};
const DATASET_ROLE_ICONS: Readonly<Record<DatasetRole, IconName>> = {
  terrain: 'terrain',
  imagery: 'image',
  vegetation: 'leaf',
  canopy: 'tree',
  fuel: 'flame',
  fireHistory: 'history',
  weather: 'thermometer',
  upperAir: 'cloud',
  context: 'map',
  derived: 'tune',
  user: 'edit',
  bundle: 'database',
  pack: 'download',
};
const TAG_ROLE: Readonly<Record<string, DatasetRole>> = { terrain: 'terrain', imagery: 'imagery', 'vegetation-svtm': 'vegetation', 'canopy-height': 'canopy', 'fire-history': 'fireHistory', weather: 'weather', 'fuel-derived': 'fuel' };

export function datasetIcon(id: string, role?: DatasetRole): IconName {
  return DATASET_ID_ICONS[id] ?? DATASET_ROLE_ICONS[role ?? TAG_ROLE[id] ?? 'derived'];
}

/**
 * The build step a data set belongs to (for nesting its row under the step on the Building screen): by id, else by role.
 * The aerial photo sits with the terrain (it is draped on the ground), the whole-bundle and pack records and the user's
 * input with "Ready".
 */
export function datasetStep(id: string, role?: DatasetRole): BuildProgress['step'] {
  const byId: Record<string, BuildProgress['step']> = {
    terrain: 'terrain',
    imagery: 'terrain',
    'canopy-height': 'canopy',
    'vegetation-svtm': 'vegetation',
    'fire-history': 'fireHistory',
    weather: 'weather',
    'upper-air': 'weather',
    'drought-history': 'drought',
    'fuel-derived': 'fuel',
    'fuel-moisture': 'fuel',
    'context-file': 'places',
  };
  if (byId[id]) return byId[id]!;
  const byRole: Partial<Record<DatasetRole, BuildProgress['step']>> = { terrain: 'terrain', imagery: 'terrain', canopy: 'canopy', vegetation: 'vegetation', fireHistory: 'fireHistory', weather: 'weather', upperAir: 'weather', fuel: 'fuel', context: 'places', derived: 'fuel' };
  return (role && byRole[role]) || (['roads', 'fire-trails', 'homes', 'zones', 'place-names'].includes(id) ? 'places' : 'done');
}

/** Where the bytes of a data set mostly came from so far (by bytes; a data set may mix sources, e.g. bundled + stored). */
export type ArrivalOrigin = 'live' | 'saved' | 'bundled' | 'none';

/** One Building-screen row of a data set as counted by the ledger: its main origin, its size text and whether it failed. */
export interface Arrival {
  id: string;
  title: string;
  origin: ArrivalOrigin;
  /** '1.8 MB', 'up to 957.0 KB' (network bytes whose wire size was not reported are an upper bound), '' when nothing came. */
  size: string;
  bytes: number;
  requests: number;
  /** Every request so far failed (nothing arrived). */
  failed: boolean;
}

/** The Building screen's view of one ledger entry. `formatBytes` is passed in (core/datasets.ts) so this file stays light. */
export function arrivalOf(d: BuildDatasetProgress, formatBytes: (b: number) => string): Arrival {
  const saved = d.cacheBytes + d.packBytes;
  const top = Math.max(d.networkBytes, saved, d.bundledBytes);
  const origin: ArrivalOrigin = top <= 0 ? 'none' : top === d.bundledBytes && d.bundledBytes > 0 ? 'bundled' : top === d.networkBytes ? 'live' : 'saved';
  const upTo = d.networkUnmeasuredBytes > 0;
  const size = d.bytes > 0 ? `${upTo ? 'up to ' : ''}${formatBytes(d.bytes)}` : '';
  return { id: d.id, title: datasetTitle(d.id), origin, size, bytes: d.bytes, requests: d.requests, failed: d.requests > 0 && d.failures >= d.requests && d.bytes <= 0 };
}
