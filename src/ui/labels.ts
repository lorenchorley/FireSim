/**
 * Plain-language labels used across the UI (fuel types, spread drivers, landforms, insight severities, build steps).
 * Kept in sync with src/render/palette.ts, which uses the same wording in the 3-D legends.
 */
import { FuelType, Landform, SpreadDriver, type InsightSeverity } from '../core/types';
import type { BuildProgress } from '../scenario/request';

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
