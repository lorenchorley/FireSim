/**
 * Colours and colour ramps of the 3-D scene (pure; shared by the texture bakers, the shaders' lookup tables and the
 * legends so that what the trainee sees always matches the legend).
 *
 * Colours are sRGB hex strings. Ramps are piecewise-linear in sRGB between stops at increasing positions. Sequential
 * ramps are ordered by luminance so they stay readable with red–green colour-vision deficiency (doc 09 §9).
 */
import { FireHistoryKind, FuelType, Landform, SpreadDriver, type InsightSeverity } from '../core/types';

/** sRGB colour with components 0–1. */
export type Rgb = [number, number, number];

export interface RampStop {
  /** Position of the stop (ramp units, e.g. hours, km/h, %). */
  at: number;
  colour: string;
}

export function hexToRgb(hex: string): Rgb {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
  const n = parseInt(h.slice(0, 6), 16);
  if (!Number.isFinite(n) || h.length < 6) throw new Error(`hexToRgb: bad colour '${hex}'`);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToHex(c: Rgb): string {
  const b = (v: number): string =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${b(c[0])}${b(c[1])}${b(c[2])}`;
}

/** sRGB (0–1) → linear light (0–1), per component. */
export const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const linearToSrgb = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

export function rgbToLinear(c: Rgb): Rgb {
  return [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])];
}

export function mixRgb(a: Rgb, b: Rgb, t: number, out: Rgb = [0, 0, 0]): Rgb {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}

/** Relative luminance (WCAG) of an sRGB colour. */
export function luminance(c: Rgb): number {
  const l = rgbToLinear(c);
  return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
}

/** A compiled ramp: stops with parsed colours, for fast repeated sampling. */
export interface Ramp {
  stops: readonly RampStop[];
  pos: Float64Array;
  rgb: Rgb[];
  /** Log-scale ramp: positions are interpolated in log10 space (all stops must be > 0). */
  log: boolean;
}

export function makeRamp(stops: RampStop[], opts: { log?: boolean } = {}): Ramp {
  if (stops.length < 1) throw new Error('makeRamp: no stops');
  for (let s = 1; s < stops.length; s++) if (!(stops[s]!.at > stops[s - 1]!.at)) throw new Error('makeRamp: stops must increase');
  const log = !!opts.log;
  if (log && stops[0]!.at <= 0) throw new Error('makeRamp: log ramp stops must be > 0');
  return {
    stops,
    pos: Float64Array.from(stops.map((s) => (log ? Math.log10(s.at) : s.at))),
    rgb: stops.map((s) => hexToRgb(s.colour)),
    log,
  };
}

/** Sample a ramp at a value (clamped to the end stops). NaN gives the first stop. */
export function sampleRamp(r: Ramp, value: number, out: Rgb = [0, 0, 0]): Rgb {
  let v = r.log ? Math.log10(Math.max(value, 1e-12)) : value;
  if (!Number.isFinite(v)) v = r.pos[0]!;
  const n = r.pos.length;
  if (n === 1 || v <= r.pos[0]!) return copyRgb(r.rgb[0]!, out);
  if (v >= r.pos[n - 1]!) return copyRgb(r.rgb[n - 1]!, out);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (r.pos[mid]! <= v) lo = mid;
    else hi = mid;
  }
  const t = (v - r.pos[lo]!) / (r.pos[hi]! - r.pos[lo]!);
  return mixRgb(r.rgb[lo]!, r.rgb[hi]!, t, out);
}

/** Step (class) lookup: the colour of the last stop whose position is ≤ value. */
export function sampleClasses(r: Ramp, value: number, out: Rgb = [0, 0, 0]): Rgb {
  const v = r.log ? Math.log10(Math.max(value, 1e-12)) : value;
  let idx = 0;
  for (let s = 0; s < r.pos.length; s++) if (v >= r.pos[s]!) idx = s;
  return copyRgb(r.rgb[idx]!, out);
}

/** Cyclic ramp over 0–360° (stops at increasing angles in [0, 360); wraps from the last stop to the first). */
export function sampleCyclic(r: Ramp, deg: number, out: Rgb = [0, 0, 0]): Rgb {
  const d = ((deg % 360) + 360) % 360;
  const n = r.pos.length;
  for (let s = 0; s < n; s++) {
    const a = r.pos[s]!;
    const b = s + 1 < n ? r.pos[s + 1]! : r.pos[0]! + 360;
    const dd = d < a && s === 0 ? d + 360 : d;
    if (dd >= a && dd < b) return mixRgb(r.rgb[s]!, r.rgb[(s + 1) % n]!, (dd - a) / (b - a), out);
  }
  // d before the first stop: between the last stop (−360) and the first.
  const a = r.pos[n - 1]! - 360;
  const b = r.pos[0]!;
  return mixRgb(r.rgb[n - 1]!, r.rgb[0]!, (d - a) / (b - a), out);
}

function copyRgb(c: Rgb, out: Rgb): Rgb {
  out[0] = c[0];
  out[1] = c[1];
  out[2] = c[2];
  return out;
}

/** 256-entry RGBA8 lookup table (sRGB) of a ramp between `lo` and `hi` (linear positions), for shader LUTs. */
export function rampLut(r: Ramp, lo: number, hi: number, size = 256): Uint8Array {
  const out = new Uint8Array(size * 4);
  const c: Rgb = [0, 0, 0];
  for (let i = 0; i < size; i++) {
    sampleRamp(r, lo + ((hi - lo) * i) / (size - 1), c);
    out[i * 4] = Math.round(c[0] * 255);
    out[i * 4 + 1] = Math.round(c[1] * 255);
    out[i * 4 + 2] = Math.round(c[2] * 255);
    out[i * 4 + 3] = 255;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Natural ground palette (terrain base colour when no imagery is available)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ground colour per fuel type as seen from the air: canopy colour (dominant when cover is high) and the floor colour
 * under / between the crowns. Sandstone country of the Blue Mountains reads olive-grey from above; wet gullies and
 * rainforest are darker and greener; heath is grey-green with pale sandstone showing through.
 */
export const FUEL_GROUND: Record<FuelType, { canopy: string; floor: string }> = {
  [FuelType.NonFuel]: { canopy: '#8f8a7d', floor: '#a89c86' },
  [FuelType.Water]: { canopy: '#36596e', floor: '#36596e' },
  [FuelType.Grassland]: { canopy: '#7d8a4a', floor: '#a9a36a' },
  [FuelType.GrassyWoodland]: { canopy: '#687445', floor: '#9e9a66' },
  [FuelType.DryForestShrubby]: { canopy: '#5d6a40', floor: '#7d7456' },
  [FuelType.DryForestGrassy]: { canopy: '#627043', floor: '#8b8659' },
  [FuelType.WetForest]: { canopy: '#46633a', floor: '#5e5a41' },
  [FuelType.Rainforest]: { canopy: '#2e4f2e', floor: '#3f4a32' },
  [FuelType.Heath]: { canopy: '#77785a', floor: '#9b9376' },
  [FuelType.AlpineHeathGrass]: { canopy: '#838a5f', floor: '#a3a078' },
  [FuelType.SnowGumWoodland]: { canopy: '#6c7a52', floor: '#9c9a74' },
  [FuelType.PinePlantation]: { canopy: '#34502f', floor: '#5b5039' },
  [FuelType.Urban]: { canopy: '#6f7760', floor: '#9d9a94' },
};

/** Cured (dry) grass colour; green grass is FUEL_GROUND[Grassland].canopy. */
export const CURED_GRASS = '#c9b777';
/** Leaf litter tint mixed into the forest floor with the surface fuel hazard score. */
export const LITTER = '#6e5638';
/** Exposed sandstone / cliff rock and the soil of the terrain skirt. */
export const ROCK = '#a4927a';
export const ROCK_DARK = '#6d5f50';
export const SOIL = '#5a4838';

// ─────────────────────────────────────────────────────────────────────────────
// Categorical overlay palettes
// ─────────────────────────────────────────────────────────────────────────────

export const FUEL_TYPE_LABELS: Record<FuelType, string> = {
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

/** Distinct, saturated colours for the fuel-type overlay (natural hues so they stay intuitive). */
export const FUEL_TYPE_COLOURS: Record<FuelType, string> = {
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

/** Dominant spread driver colours (based on ColorBrewer "Paired", re-ordered so related drivers look related). */
export const DRIVER_COLOURS: Record<SpreadDriver, string> = {
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

/** Insight severity colours (Danger red, Watch Out amber, Insight blue — doc 10 §9.1). */
export const SEVERITY_COLOURS: Record<InsightSeverity, string> = {
  info: '#2f80ed',
  watch: '#f2a900',
  danger: '#e02424',
};

/** Marker colours. */
export const MARKER_COLOURS = {
  user: '#1a73e8',
  ignition: '#e02424',
  spot: '#ff8c1a',
  focus: '#ffffff',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Sequential / diverging ramps
// ─────────────────────────────────────────────────────────────────────────────

/** Arrival time (fraction 0 = ignition … 1 = latest): deep indigo → magenta → orange → yellow (plasma-like). */
export const ARRIVAL_RAMP = makeRamp([
  { at: 0, colour: '#2a0f78' },
  { at: 0.2, colour: '#6a00a8' },
  { at: 0.4, colour: '#b12a90' },
  { at: 0.6, colour: '#e16462' },
  { at: 0.8, colour: '#fca636' },
  { at: 1, colour: '#f0f921' },
]);

/** Rate of spread (km/h, log). */
export const ROS_RAMP = makeRamp(
  [
    { at: 0.05, colour: '#fff7bc' },
    { at: 0.2, colour: '#fee391' },
    { at: 0.5, colour: '#fec44f' },
    { at: 1, colour: '#fe9929' },
    { at: 2, colour: '#ec7014' },
    { at: 4, colour: '#cc4c02' },
    { at: 8, colour: '#8c2d04' },
    { at: 15, colour: '#4a1402' },
  ],
  { log: true },
);

/**
 * Fireline intensity (kW/m) classes with suppression meaning (commonly used Australian guidance, e.g. Cheney 1990 /
 * NSW RFS training): < 500 hand tools; 500–2000 tankers & machinery; 2000–4000 limit of direct attack by heavy
 * machinery; 4000–10 000 indirect attack only; 10 000–30 000 crown fire likely; > 30 000 uncontrollable.
 */
export const INTENSITY_CLASSES = makeRamp([
  { at: 0, colour: '#bfe3a1' },
  { at: 500, colour: '#f7e36b' },
  { at: 2000, colour: '#f6a13a' },
  { at: 4000, colour: '#e4572e' },
  { at: 10000, colour: '#a51d2d' },
  { at: 30000, colour: '#4d0b2e' },
]);

/** Dead fine fuel moisture (%): dry browns → moist blue-greens (BrBG). */
export const MOISTURE_RAMP = makeRamp([
  { at: 3, colour: '#8c510a' },
  { at: 6, colour: '#d8b365' },
  { at: 9, colour: '#f6e8c3' },
  { at: 13, colour: '#c7eae5' },
  { at: 18, colour: '#5ab4ac' },
  { at: 25, colour: '#01665e' },
]);

/** Total fine fuel load (t/ha): YlOrBr. */
export const FUEL_LOAD_RAMP = makeRamp([
  { at: 0, colour: '#ffffe5' },
  { at: 5, colour: '#fff7bc' },
  { at: 10, colour: '#fee391' },
  { at: 15, colour: '#fec44f' },
  { at: 20, colour: '#fe9929' },
  { at: 25, colour: '#ec7014' },
  { at: 30, colour: '#cc4c02' },
  { at: 40, colour: '#8c2d04' },
]);

/** Years since fire: recently burnt (light) → long unburnt (dark green). */
export const TSF_RAMP = makeRamp([
  { at: 0, colour: '#fff7bc' },
  { at: 2, colour: '#f7fcb9' },
  { at: 5, colour: '#c2e699' },
  { at: 10, colour: '#78c679' },
  { at: 20, colour: '#31a354' },
  { at: 30, colour: '#006837' },
  { at: 50, colour: '#00331a' },
]);
export const TSF_NO_RECORD = '#9a9a9a';

/**
 * Slope classes (deg): < 10 benign; 10–20 fire speeds up markedly; > 20 beyond the validated range of every
 * operational model; > 24–27 flame attachment likely (Wu et al. 2000; Fan et al. 2025 — doc 01); > 35 very steep.
 */
export const SLOPE_CLASSES = makeRamp([
  { at: 0, colour: '#f0f7e6' },
  { at: 5, colour: '#c7e6b0' },
  { at: 10, colour: '#fde68a' },
  { at: 15, colour: '#fbbf57' },
  { at: 20, colour: '#f2711c' },
  { at: 25, colour: '#c81d25' },
  { at: 35, colour: '#5c0a3a' },
]);

/**
 * Aspect (direction the slope faces), cyclic. In the Southern Hemisphere north- and west-facing slopes get the most
 * (afternoon) sun and carry the driest fuel, so they are warm colours; south-facing slopes are cool.
 */
export const ASPECT_RAMP = makeRamp([
  { at: 0, colour: '#e6550d' },
  { at: 45, colour: '#fd8d3c' },
  { at: 90, colour: '#fdd0a2' },
  { at: 135, colour: '#bcbddc' },
  { at: 180, colour: '#6a51a3' },
  { at: 225, colour: '#9e9ac8' },
  { at: 270, colour: '#fdae6b' },
  { at: 315, colour: '#d94801' },
]);
export const FLAT_COLOUR = '#d9d9d9';

/** Insolation on the slope (W/m²): shade (deep blue) → full sun (pale yellow). */
export const INSOLATION_RAMP = makeRamp([
  { at: 0, colour: '#1d2c4c' },
  { at: 150, colour: '#3f3f7a' },
  { at: 350, colour: '#8b3f7e' },
  { at: 550, colour: '#d9534f' },
  { at: 750, colour: '#f79d39' },
  { at: 950, colour: '#fce38a' },
  { at: 1100, colour: '#fffbe0' },
]);

/** Hazard / potential score 0–1 (VLS, attachment, trench, dead man zone): pale yellow → orange → red → magenta. */
export const HAZARD_RAMP = makeRamp([
  { at: 0, colour: '#fff7bc' },
  { at: 0.25, colour: '#fec44f' },
  { at: 0.5, colour: '#fe9929' },
  { at: 0.75, colour: '#d7301f' },
  { at: 1, colour: '#7a0177' },
]);

/** Ember landing density (brands per hectare per hour, log scale). */
export const LANDING_RAMP = makeRamp(
  [
    { at: 0.1, colour: '#fee391' },
    { at: 1, colour: '#fe9929' },
    { at: 10, colour: '#cc4c02' },
    { at: 100, colour: '#662506' },
  ],
  { log: true },
);

/**
 * Wind speed (m/s) for particles and arrows: calm grey-blue → white → cyan → blue → violet. Deliberately cool colours:
 * yellow–orange streaks over a burning landscape read as fire or embers (integration review).
 */
export const WIND_RAMP = makeRamp([
  { at: 0, colour: '#a7b8c8' },
  { at: 4, colour: '#f4f9ff' },
  { at: 8, colour: '#a8ecff' },
  { at: 12, colour: '#4cc3ff' },
  { at: 17, colour: '#4f7bff' },
  { at: 25, colour: '#b25cff' },
]);

/** Potential-temperature anomaly (K): cold air blue, neutral white, warm plume red. */
export const THETA_RAMP = makeRamp([
  { at: -6, colour: '#2166ac' },
  { at: -3, colour: '#67a9cf' },
  { at: -1, colour: '#d1e5f0' },
  { at: 0, colour: '#f7f7f7' },
  { at: 1, colour: '#fddbc7' },
  { at: 3, colour: '#ef8a62' },
  { at: 8, colour: '#b2182b' },
  { at: 20, colour: '#67001f' },
]);

/** Vertical velocity (m/s) for volume wind particles: sinking blue, rising red. */
export const UPDRAFT_RAMP = makeRamp([
  { at: -3, colour: '#3b8bd9' },
  { at: -0.5, colour: '#bcdcf5' },
  { at: 0, colour: '#f2f2f2' },
  { at: 0.5, colour: '#ffd0a8' },
  { at: 3, colour: '#ff6a3d' },
  { at: 8, colour: '#d7191c' },
]);

/** Ember colour by temperature fraction (0 cold … 1 hot): blackbody-like. */
export const EMBER_RAMP = makeRamp([
  { at: 0, colour: '#3a0804' },
  { at: 0.25, colour: '#b3200a' },
  { at: 0.5, colour: '#ff6a14' },
  { at: 0.75, colour: '#ffbe45' },
  { at: 1, colour: '#fff6d8' },
]);

// ─────────────────────────────────────────────────────────────────────────────
// Heat maps of the data layers (layers rework)
//
// One colour language for every measure that can be shown as a heat map: COOL = LITTLE, WARM = MUCH. Blue is the lowest
// value, then teal, green, yellow, orange, red and a deep plum for the most. There is no green-versus-red pairing (it
// is the one that red-green colour-blind people cannot separate) and the hazard ratings keep the same colours in every
// hazard layer, so "orange" means "High" whether it is leaf litter, shrubs or bark. palette.test.ts checks the ramps
// with colour-blindness simulations (protan / deutan / tritan).
// ─────────────────────────────────────────────────────────────────────────────

/** Anchor colours of the heat-map language, lowest to highest. */
export const HEAT_COLOURS = {
  blue: '#3f82c8',
  teal: '#4bb3c4',
  green: '#a8d98a',
  yellow: '#f4e04d',
  orange: '#f28c28',
  red: '#cf2f2f',
  plum: '#6a1150',
} as const;

/** The master sequential ramp on 0 … 1 (blue → teal → green → yellow → orange → red → plum). */
export const AMOUNT_RAMP = makeRamp([
  { at: 0, colour: HEAT_COLOURS.blue },
  { at: 1 / 6, colour: HEAT_COLOURS.teal },
  { at: 2 / 6, colour: HEAT_COLOURS.green },
  { at: 3 / 6, colour: HEAT_COLOURS.yellow },
  { at: 4 / 6, colour: HEAT_COLOURS.orange },
  { at: 5 / 6, colour: HEAT_COLOURS.red },
  { at: 1, colour: HEAT_COLOURS.plum },
]);

/**
 * A ramp over the given increasing values (any units) whose colours are the master ramp sampled at evenly spaced
 * fractions: the first value is the coolest colour, the last the warmest. `log` interpolates in log10.
 */
export function amountRamp(values: readonly number[], opts: { log?: boolean } = {}): Ramp {
  if (values.length < 2) throw new Error('amountRamp: needs at least two values');
  const c: Rgb = [0, 0, 0];
  return makeRamp(
    values.map((at, i) => ({ at, colour: rgbToHex(sampleRamp(AMOUNT_RAMP, i / (values.length - 1), c)) })),
    opts,
  );
}

/** Colours of `n` classes, coolest first, sampled evenly from the master ramp. */
export function amountClassColours(n: number): string[] {
  const c: Rgb = [0, 0, 0];
  return Array.from({ length: n }, (_, i) => rgbToHex(sampleRamp(AMOUNT_RAMP, n === 1 ? 0 : i / (n - 1), c)));
}

/** Standard hazard ratings (Overall Fuel Hazard Assessment Guide), lowest to highest. */
export const HAZARD_RATING_LABELS = ['Low', 'Moderate', 'High', 'Very high', 'Extreme'] as const;

/** Colour of each hazard rating (same in every hazard layer) and of "none" (no fuel of that layer at all). */
export const HAZARD_RATING_COLOURS: readonly string[] = [HEAT_COLOURS.blue, HEAT_COLOURS.yellow, HEAT_COLOURS.orange, HEAT_COLOURS.red, HEAT_COLOURS.plum];
export const HAZARD_NONE_COLOUR = '#c9d6e2';

/** Ground height (m): the master ramp stretched over the height range of the site (the range comes from the legend context). */
export const ELEVATION_RAMP = AMOUNT_RAMP;

/** Tree canopy height (m) and cover (%), shrub height (m), grass curing (%) and near-surface wind speed (km/h); stops are evenly spaced so legend labels line up with the colour bar. */
export const CANOPY_HEIGHT_RAMP = amountRamp([0, 10, 20, 30, 40]);
export const CANOPY_COVER_RAMP = amountRamp([0, 25, 50, 75, 100]);
export const ELEVATED_HEIGHT_RAMP = amountRamp([0, 0.5, 1, 1.5, 2, 2.5, 3]);
export const CURING_RAMP = amountRamp([0, 25, 50, 75, 100]);
export const WIND_SPEED_RAMP = amountRamp([0, 10, 20, 30, 40, 50, 60]);

/** Landform classes (Terrain.landform codes) by position on the slope: high and exposed = warm, low and sheltered = cool. */
export const LANDFORM_LABELS: Record<Landform, string> = {
  [Landform.Flat]: 'Flat ground',
  [Landform.Ridge]: 'Ridge top',
  [Landform.Spur]: 'Spur (a ridge running downhill)',
  [Landform.UpperSlope]: 'Upper slope',
  [Landform.MidSlope]: 'Mid slope',
  [Landform.LowerSlope]: 'Lower slope',
  [Landform.Gully]: 'Gully (creek line or draw)',
  [Landform.ValleyFloor]: 'Valley floor',
  [Landform.Saddle]: 'Saddle (low point on a ridge)',
  [Landform.Peak]: 'Peak',
  [Landform.Cliff]: 'Cliff',
};

export const LANDFORM_COLOURS: Record<Landform, string> = {
  [Landform.Flat]: '#d9d9d9',
  [Landform.Ridge]: '#e0523a',
  [Landform.Spur]: '#f39c4a',
  [Landform.UpperSlope]: '#f7d774',
  [Landform.MidSlope]: '#b8d98a',
  [Landform.LowerSlope]: '#6fc0a0',
  [Landform.Gully]: '#3a8fb7',
  [Landform.ValleyFloor]: '#1f4e9c',
  [Landform.Saddle]: '#b38b5d',
  [Landform.Peak]: '#8c1c13',
  [Landform.Cliff]: '#3b3b3b',
};

/** Last recorded fire (FireHistoryKind codes) for the fire-history heat map. "No record" is the shared grey of the years-since-fire map. */
export const FIRE_HISTORY_LABELS: Record<FireHistoryKind, string> = {
  [FireHistoryKind.Unknown]: 'Fire of unrecorded type',
  [FireHistoryKind.Wildfire]: 'Wildfire',
  [FireHistoryKind.PrescribedBurn]: 'Prescribed burn or back burn',
};
export const FIRE_HISTORY_COLOURS: Record<FireHistoryKind, string> = {
  [FireHistoryKind.Unknown]: '#e0b23c',
  [FireHistoryKind.Wildfire]: '#d1462f',
  [FireHistoryKind.PrescribedBurn]: '#2b6cb0',
};
