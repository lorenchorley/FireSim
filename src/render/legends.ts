/**
 * Legends and shader colour scales of the terrain overlays (pure; no Three.js).
 *
 * Both the legend the UI draws and the lookup table (LUT) the terrain shader samples come from the same ramps in
 * palette.ts, through {@link overlayScale}, so the colours on the ground always match the legend.
 *
 * Overlay values are stored in the units shown in the legend (km/h, kW/m, %, t/ha, years, degrees, W/m², seconds for
 * arrival) — conversion from the SI simulation fields happens once, when the overlay field is built (fields.ts).
 */
import { FireHistoryKind, FuelType, Landform, SpreadDriver, FUEL_TYPE_COUNT } from '../core/types';
import type { OverlayKind } from './layers';
import {
  ARRIVAL_RAMP,
  ASPECT_RAMP,
  CANOPY_COVER_RAMP,
  CANOPY_HEIGHT_RAMP,
  CURING_RAMP,
  DRIVER_COLOURS,
  DRIVER_LABELS,
  ELEVATED_HEIGHT_RAMP,
  ELEVATION_RAMP,
  FIRE_HISTORY_COLOURS,
  FIRE_HISTORY_LABELS,
  FLAT_COLOUR,
  FUEL_LOAD_RAMP,
  FUEL_TYPE_COLOURS,
  FUEL_TYPE_LABELS,
  INSOLATION_RAMP,
  INTENSITY_CLASSES,
  MOISTURE_RAMP,
  HAZARD_NONE_COLOUR,
  HAZARD_RAMP,
  HAZARD_RATING_COLOURS,
  HAZARD_RATING_LABELS,
  LANDFORM_COLOURS,
  LANDFORM_LABELS,
  LANDING_RAMP,
  ROS_RAMP,
  SLOPE_CLASSES,
  THETA_RAMP,
  TSF_NO_RECORD,
  TSF_RAMP,
  UPDRAFT_RAMP,
  WIND_RAMP,
  WIND_SPEED_RAMP,
  amountClassColours,
  hexToRgb,
  makeRamp,
  rgbToHex,
  sampleClasses,
  sampleCyclic,
  sampleRamp,
  type Ramp,
  type Rgb,
} from './palette';

/** How the legend should be drawn. */
export type LegendKind = 'continuous' | 'classes' | 'categorical' | 'cyclic';

export interface LegendEntry {
  /** Value in legend units (class lower bound for 'classes', category code for 'categorical'). */
  value: number;
  /** sRGB hex colour. */
  colour: string;
  label: string;
  /** Optional plain-English gloss of this stop or class (e.g. "fresh breeze", "thin litter, little to burn"). */
  words?: string;
}

export interface LegendSpec {
  overlay: OverlayKind | 'crossSection' | 'wind' | 'updraft';
  title: string;
  /** Units of `entries[].value` (display string, e.g. "km/h"). */
  units: string;
  kind: LegendKind;
  /** Continuous: ramp stops in increasing order; classes: class lower bounds; categorical: one per category. */
  entries: LegendEntry[];
  /** For continuous / cyclic ramps: a CSS gradient (left = first entry) the UI can use for a colour bar. */
  gradient?: string;
  /** True if the continuous ramp is logarithmic (tick positions should be spaced in log10). */
  log?: boolean;
  /** Colour/label for cells with no data (e.g. "no fire record", "flat"). */
  noData?: { colour: string; label: string };
  /** One teaching sentence shown under the legend. */
  note?: string;
}

/** Context that makes some legends dynamic (arrival time spans the burnt period so far). */
export interface LegendContext {
  /** Latest arrival time to show on the ramp (s from scenario start). Default 6 h. */
  arrivalMaxSeconds?: number;
  /** Isochrone spacing (min) to mention in the arrival legend. */
  isochroneMinutes?: number;
  /**
   * Lowest and highest ground (m) of the scenario: the 'elevation' heat map stretches its colours over this range
   * (rounded outwards to nice numbers, see {@link niceElevationRange}). The scale and the legend must be given the same
   * range; SceneView.legend() does. Without it the legend only says "lowest … highest" and the scale spans 0 – 1 000 m.
   */
  elevationRange?: readonly [number, number];
}

const DEFAULT_ARRIVAL_MAX = 6 * 3600;

/** Human label for a duration in seconds: "0 min", "45 min", "1 h 30", "6 h". */
export function formatDuration(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} h` : `${h} h ${String(r).padStart(2, '0')}`;
}

/** Round a ramp span to a "nice" arrival maximum (multiple of 15 min up to 2 h, then 30 min, then 1 h). */
export function niceArrivalMax(seconds: number): number {
  const s = Math.max(seconds, 15 * 60);
  const step = s <= 2 * 3600 ? 900 : s <= 6 * 3600 ? 1800 : 3600;
  return Math.ceil(s / step) * step;
}

function gradientCss(r: Ramp, lo: number, hi: number, n = 9, cyclic = false): string {
  const c: Rgb = [0, 0, 0];
  const parts: string[] = [];
  for (let s = 0; s < n; s++) {
    const t = s / (n - 1);
    const v = r.log ? 10 ** (Math.log10(lo) + (Math.log10(hi) - Math.log10(lo)) * t) : lo + (hi - lo) * t;
    if (cyclic) sampleCyclic(r, v, c);
    else sampleRamp(r, v, c);
    parts.push(`${rgbToHex(c)} ${Math.round(t * 100)}%`);
  }
  return `linear-gradient(to right, ${parts.join(', ')})`;
}

function stopsLegend(r: Ramp, fmt: (v: number) => string): LegendEntry[] {
  return r.stops.map((s) => ({ value: s.at, colour: s.colour, label: fmt(s.at) }));
}

const fmtNum = (v: number): string => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(1).replace(/\.0$/, '') : String(v));

/** Fuel types actually used by the NSW catalogue, in display order. */
const FUEL_ORDER: FuelType[] = [
  FuelType.Grassland,
  FuelType.GrassyWoodland,
  FuelType.DryForestGrassy,
  FuelType.DryForestShrubby,
  FuelType.WetForest,
  FuelType.Rainforest,
  FuelType.Heath,
  FuelType.AlpineHeathGrass,
  FuelType.SnowGumWoodland,
  FuelType.PinePlantation,
  FuelType.Urban,
  FuelType.NonFuel,
  FuelType.Water,
];

const DRIVER_ORDER: SpreadDriver[] = [
  SpreadDriver.Wind,
  SpreadDriver.Slope,
  SpreadDriver.WindAndSlope,
  SpreadDriver.Fuel,
  SpreadDriver.DryFuel,
  SpreadDriver.Spotting,
  SpreadDriver.LateralVorticity,
  SpreadDriver.Eruptive,
  SpreadDriver.FireInducedWind,
  SpreadDriver.Backing,
  SpreadDriver.Junction,
];

/**
 * Legend for an overlay (null for 'none'). Labels are plain-language and colour-vision safe ramps are used for
 * the sequential layers (palette.ts).
 */
export function legendFor(overlay: OverlayKind, ctx: LegendContext = {}): LegendSpec | null {
  switch (overlay) {
    case 'none':
      return null;
    case 'arrival': {
      const max = niceArrivalMax(ctx.arrivalMaxSeconds ?? DEFAULT_ARRIVAL_MAX);
      const n = 5;
      const entries: LegendEntry[] = [];
      const c: Rgb = [0, 0, 0];
      for (let s = 0; s < n; s++) {
        const t = s / (n - 1);
        sampleRamp(ARRIVAL_RAMP, t, c);
        entries.push({ value: t * max, colour: rgbToHex(c), label: formatDuration(t * max) });
      }
      const iso = ctx.isochroneMinutes ?? 0;
      return {
        overlay,
        title: 'Fire arrival time',
        units: 'time since start',
        kind: 'continuous',
        entries,
        gradient: gradientCss(ARRIVAL_RAMP, 0, 1),
        noData: { colour: '#00000000', label: 'Not burnt (yet)' },
        note:
          iso > 0
            ? `Lines every ${formatDuration(iso * 60)}: where they bunch up the fire was slow, where they spread apart it ran.`
            : 'Dark = burnt first, bright = burnt most recently.',
      };
    }
    case 'ros':
      return {
        overlay,
        title: 'Rate of spread',
        units: 'km/h',
        kind: 'continuous',
        log: true,
        entries: stopsLegend(ROS_RAMP, fmtNum),
        gradient: gradientCss(ROS_RAMP, ROS_RAMP.stops[0]!.at, ROS_RAMP.stops[ROS_RAMP.stops.length - 1]!.at),
        noData: { colour: '#00000000', label: 'Not burnt' },
        note: 'Walking pace uphill off-track is only about 1–2 km/h.',
      };
    case 'intensity':
      return {
        overlay,
        title: 'Fireline intensity',
        units: 'kW/m',
        kind: 'classes',
        entries: [
          { value: 0, colour: INTENSITY_CLASSES.stops[0]!.colour, label: '< 500 · hand tools' },
          { value: 500, colour: INTENSITY_CLASSES.stops[1]!.colour, label: '500–2 000 · tankers, machinery' },
          { value: 2000, colour: INTENSITY_CLASSES.stops[2]!.colour, label: '2 000–4 000 · limit of direct attack' },
          { value: 4000, colour: INTENSITY_CLASSES.stops[3]!.colour, label: '4 000–10 000 · indirect attack only' },
          { value: 10000, colour: INTENSITY_CLASSES.stops[4]!.colour, label: '10 000–30 000 · crown fire likely' },
          { value: 30000, colour: INTENSITY_CLASSES.stops[5]!.colour, label: '> 30 000 · uncontrollable' },
        ],
        noData: { colour: '#00000000', label: 'Not burnt' },
        note: 'Suppression guide classes (approximate). Intensity is at the time the fire arrived.',
      };
    case 'driver':
      return {
        overlay,
        title: 'Why it burnt this way',
        units: '',
        kind: 'categorical',
        entries: DRIVER_ORDER.map((d) => ({ value: d, colour: DRIVER_COLOURS[d], label: DRIVER_LABELS[d] })),
        noData: { colour: '#00000000', label: 'Not burnt' },
        note: 'The main reason for the spread rate where the fire arrived.',
      };
    case 'moisture':
      return {
        overlay,
        title: 'Dead fuel (litter) moisture',
        units: '%',
        kind: 'continuous',
        entries: stopsLegend(MOISTURE_RAMP, (v) => `${v}%`),
        gradient: gradientCss(MOISTURE_RAMP, MOISTURE_RAMP.stops[0]!.at, MOISTURE_RAMP.stops[MOISTURE_RAMP.stops.length - 1]!.at),
        note: 'Below about 6% fine fuel ignites from embers easily; above about 20% it barely burns.',
      };
    case 'fuelLoad':
      return {
        overlay,
        title: 'Fine fuel load',
        units: 't/ha',
        kind: 'continuous',
        entries: stopsLegend(FUEL_LOAD_RAMP, (v) => `${v}`),
        gradient: gradientCss(FUEL_LOAD_RAMP, 0, 40),
        note: 'Litter + near-surface + elevated + bark fuel that burns in the flaming front.',
      };
    case 'fuelType':
      return {
        overlay,
        title: 'Fuel type',
        units: '',
        kind: 'categorical',
        entries: FUEL_ORDER.map((f) => ({ value: f, colour: FUEL_TYPE_COLOURS[f], label: FUEL_TYPE_LABELS[f] })),
      };
    case 'timeSinceFire':
      return {
        overlay,
        title: 'Years since last fire',
        units: 'years',
        kind: 'continuous',
        entries: stopsLegend(TSF_RAMP, (v) => `${v}`),
        gradient: gradientCss(TSF_RAMP, 0, 50),
        noData: { colour: TSF_NO_RECORD, label: 'No fire on record' },
        note: 'Litter and shrubs build up for 10–20 years after a fire, so long-unburnt country carries hotter fire.',
      };
    case 'slope':
      return {
        overlay,
        title: 'Slope',
        units: '°',
        kind: 'classes',
        entries: [
          { value: 0, colour: SLOPE_CLASSES.stops[0]!.colour, label: '0–5°' },
          { value: 5, colour: SLOPE_CLASSES.stops[1]!.colour, label: '5–10°' },
          { value: 10, colour: SLOPE_CLASSES.stops[2]!.colour, label: '10–15° · fire about 2× faster uphill' },
          { value: 15, colour: SLOPE_CLASSES.stops[3]!.colour, label: '15–20° · about 3× faster' },
          { value: 20, colour: SLOPE_CLASSES.stops[4]!.colour, label: '20–25° · beyond tested models' },
          { value: 25, colour: SLOPE_CLASSES.stops[5]!.colour, label: '25–35° · flames may attach' },
          { value: 35, colour: SLOPE_CLASSES.stops[6]!.colour, label: '> 35° · very steep / cliff' },
        ],
        note: 'True slope (not exaggerated). Fire roughly doubles its speed for every 10° uphill.',
      };
    case 'aspect':
      return {
        overlay,
        title: 'Aspect (way the slope faces)',
        units: '°',
        kind: 'cyclic',
        entries: [
          { value: 0, colour: rgbToHex(sampleCyclic(ASPECT_RAMP, 0)), label: 'N' },
          { value: 90, colour: rgbToHex(sampleCyclic(ASPECT_RAMP, 90)), label: 'E' },
          { value: 180, colour: rgbToHex(sampleCyclic(ASPECT_RAMP, 180)), label: 'S' },
          { value: 270, colour: rgbToHex(sampleCyclic(ASPECT_RAMP, 270)), label: 'W' },
        ],
        gradient: gradientCss(ASPECT_RAMP, 0, 360, 13, true),
        noData: { colour: FLAT_COLOUR, label: 'Flat' },
        note: 'North- and west-facing slopes get the afternoon sun: their fuel is driest (warm colours).',
      };
    case 'insolation':
      return {
        overlay,
        title: 'Sun on the slope now',
        units: 'W/m²',
        kind: 'continuous',
        entries: stopsLegend(INSOLATION_RAMP, (v) => `${v}`),
        gradient: gradientCss(INSOLATION_RAMP, 0, 1100),
        note: 'Sunlit slopes heat up, dry their fuel and draw air (and fire) uphill.',
      };
    case 'vls':
    case 'attach':
    case 'trench':
    case 'dmz':
      return {
        overlay,
        title: HAZARD_TITLES[overlay].title,
        units: 'score 0–1',
        kind: 'continuous',
        entries: stopsLegend(HAZARD_RAMP, (v) => (v === 0 ? 'low' : v === 1 ? 'high' : `${v}`)),
        gradient: gradientCss(HAZARD_RAMP, 0, 1),
        note: HAZARD_TITLES[overlay].note,
      };
    case 'landing':
      return {
        overlay,
        title: 'Where embers are landing',
        units: 'brands/ha/h',
        kind: 'continuous',
        entries: stopsLegend(LANDING_RAMP, (v) => `${v}`),
        gradient: gradientCss(LANDING_RAMP, 0.1, 100),
        note: 'Spot fires start where embers land in dry, fine fuel. Dense landings ahead of the front can merge into a new fire front.',
      };
    case 'elevation':
    case 'landform':
    case 'canopyHeight':
    case 'canopyCover':
    case 'elevatedHazard':
    case 'elevatedHeight':
    case 'surfaceHazard':
    case 'nearSurfaceHazard':
    case 'barkHazard':
    case 'grassCuring':
    case 'fireHistoryKind':
    case 'homeDensity':
    case 'roadAccess':
    case 'windSpeed':
      return dataLegend(overlay, ctx);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Data layers as heat maps (layers rework)
// ─────────────────────────────────────────────────────────────────────────────

/** The data-layer heat maps of the layers rework (everything {@link legendFor} does not describe above). */
export type DataOverlayKind = Extract<
  OverlayKind,
  | 'elevation'
  | 'landform'
  | 'canopyHeight'
  | 'canopyCover'
  | 'elevatedHazard'
  | 'elevatedHeight'
  | 'surfaceHazard'
  | 'nearSurfaceHazard'
  | 'barkHazard'
  | 'grassCuring'
  | 'fireHistoryKind'
  | 'homeDensity'
  | 'roadAccess'
  | 'windSpeed'
>;

/** Thousands separated by a plain space, like the intensity legend ("2 000"). */
export const fmtThousands = (v: number): string => {
  const r = Math.round(v);
  const a = String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return r < 0 ? `−${a}` : a;
};

const TRANSPARENT = '#00000000';

const NICE_STEPS = [5, 10, 20, 25, 50, 100, 150, 200, 250, 300, 400, 500, 1000, 2000, 5000];

/**
 * Rounds the height range of a site outwards to a tight scale with four equal round steps
 * (e.g. 312 – 1 047 m → 300 – 1 100 m in steps of 200 m). The scale and the legend both use this.
 */
export function niceElevationRange(min: number, max: number): { lo: number; hi: number; step: number } {
  const lo0 = Number.isFinite(min) ? min : 0;
  const hi0 = Number.isFinite(max) && max > lo0 ? max : lo0 + 1;
  const span = hi0 - lo0;
  const grid = span < 50 ? 5 : span < 200 ? 10 : span < 600 ? 25 : span < 2000 ? 50 : 100;
  const lo = Math.floor(lo0 / grid) * grid;
  for (const step of NICE_STEPS) {
    if (step * 4 >= span && lo + 4 * step >= hi0) return { lo, hi: lo + 4 * step, step };
  }
  const step = Math.ceil((hi0 - lo) / 4 / 1000) * 1000;
  return { lo, hi: lo + 4 * step, step };
}

const DEFAULT_ELEVATION_RANGE = { lo: 0, hi: 1000, step: 250 } as const;

/** A continuous legend for a ramp with a numeric label and a gloss at every stop. */
function rampSpec(
  overlay: DataOverlayKind,
  title: string,
  units: string,
  ramp: Ramp,
  labels: readonly string[],
  words: readonly string[],
  note: string,
  noData?: { colour: string; label: string },
): LegendSpec {
  const lo = ramp.stops[0]!.at;
  const hi = ramp.stops[ramp.stops.length - 1]!.at;
  const spec: LegendSpec = {
    overlay,
    title,
    units,
    kind: 'continuous',
    entries: ramp.stops.map((st, i) => ({ value: st.at, colour: st.colour, label: labels[i]!, words: words[i]! })),
    gradient: gradientCss(ramp, lo, hi),
    note,
  };
  if (noData) spec.noData = noData;
  return spec;
}

/** Class boundaries (lower bounds of each class) of the hazard layers, from the fuel module's OFHAG rating scale (fuel/hazard.ts ratingFromFhs). */
export const HAZARD_CLASS_BOUNDS = {
  /** Surface, near-surface and elevated: None below 0.5, then the nearest of Low = 1, Moderate = 2, High = 3, Very high = 3.5, Extreme = 4. */
  fuel: [0, 0.5, 1.5, 2.5, 3.25, 3.75],
  /** Bark has its own scale: Low = 0, Moderate = 1, High = 2, Very high = 3, Extreme = 4. */
  bark: [0, 0.5, 1.5, 2.5, 3.5],
} as const;

interface HazardSpec {
  title: string;
  bounds: readonly number[];
  labels: readonly string[];
  colours: readonly string[];
  words: readonly string[];
  note: string;
}

const FUEL_HAZARD_LABELS = ['None', ...HAZARD_RATING_LABELS] as const;
const FUEL_HAZARD_COLOURS = [HAZARD_NONE_COLOUR, ...HAZARD_RATING_COLOURS] as const;

const HAZARD_SPECS: Record<'surfaceHazard' | 'nearSurfaceHazard' | 'elevatedHazard' | 'barkHazard', HazardSpec> = {
  surfaceHazard: {
    title: 'Leaf litter hazard',
    bounds: HAZARD_CLASS_BOUNDS.fuel,
    labels: FUEL_HAZARD_LABELS,
    colours: FUEL_HAZARD_COLOURS,
    words: ['bare ground', 'thin litter, little to burn', 'patchy litter', 'a good cover of litter', 'deep litter', 'very deep litter that burns fiercely'],
    note: 'Fallen leaves, bark and twigs are what a fire burns first: the deeper the litter, the hotter and faster the flaming edge.',
  },
  nearSurfaceHazard: {
    title: 'Grass and low shrub hazard',
    bounds: HAZARD_CLASS_BOUNDS.fuel,
    labels: FUEL_HAZARD_LABELS,
    colours: FUEL_HAZARD_COLOURS,
    words: ['nothing near the ground', 'sparse and short', 'patchy', 'a continuous cover', 'dense and deep', 'very dense: flames climb easily'],
    note: 'Grass, bracken and low shrubs up to about knee height carry a fire quickly and make its flames taller.',
  },
  elevatedHazard: {
    title: 'Shrub (ladder fuel) hazard',
    bounds: HAZARD_CLASS_BOUNDS.fuel,
    labels: FUEL_HAZARD_LABELS,
    colours: FUEL_HAZARD_COLOURS,
    words: ['no shrubs', 'few or small shrubs', 'scattered shrubs', 'continuous shrubs', 'dense, tall shrubs', 'thick, tall, dry shrubs'],
    note: 'Shrubs are the ladder that lets flames climb from the ground into the tree crowns: the higher the hazard, the taller and hotter the fire.',
  },
  barkHazard: {
    title: 'Bark hazard (embers)',
    bounds: HAZARD_CLASS_BOUNDS.bark,
    labels: HAZARD_RATING_LABELS,
    colours: HAZARD_RATING_COLOURS,
    words: ['smooth bark: few embers', 'some loose bark', 'rough or ribbon bark', 'heavy loose bark', 'heavy stringybark or ribbon bark: showers of embers'],
    note: 'Stringybark and ribbon bark launch burning embers far ahead of the fire, so high bark hazard means spot fires are likely.',
  },
};

/** Ramp of the hazard classes (stops at the class lower bounds) for the shader LUT. */
function hazardRamp(spec: HazardSpec): Ramp {
  return makeRamp(spec.bounds.map((at, i) => ({ at, colour: spec.colours[i]! })));
}

/** Home density classes (homes per hectare within about 150 m): lower bounds, labels and colours. */
export const HOME_DENSITY_CLASSES = {
  bounds: [0.05, 0.3, 1, 3, 8],
  labels: ['under 0.3 · a few scattered homes', '0.3–1 · rural homes on big blocks', '1–3 · rural residential', '3–8 · large suburban blocks', '8 or more · suburban streets and town centres'],
} as const;

/** Distance to the nearest road or trail (m): lower bounds, labels. */
export const ROAD_ACCESS_CLASSES = {
  bounds: [0, 50, 150, 300, 600, 1200],
  labels: ['under 50 m · right beside it', '50–150 m · a short walk', '150–300 m · a walk in', '300–600 m · well off the road', '600–1 200 m · remote', 'over 1 200 m · very remote'],
} as const;

function classRamp(bounds: readonly number[], colours: readonly string[], log = false): Ramp {
  return makeRamp(
    bounds.map((at, i) => ({ at, colour: colours[i]! })),
    { log },
  );
}

const HOME_RAMP = classRamp(HOME_DENSITY_CLASSES.bounds, amountClassColours(HOME_DENSITY_CLASSES.bounds.length), true);
const ROAD_RAMP = classRamp(ROAD_ACCESS_CLASSES.bounds, amountClassColours(ROAD_ACCESS_CLASSES.bounds.length));

/** Order in which the landform classes are listed (high and exposed first). */
const LANDFORM_ORDER: Landform[] = [
  Landform.Peak,
  Landform.Ridge,
  Landform.Spur,
  Landform.UpperSlope,
  Landform.MidSlope,
  Landform.LowerSlope,
  Landform.Gully,
  Landform.ValleyFloor,
  Landform.Saddle,
  Landform.Cliff,
  Landform.Flat,
];

const NOT_FUEL: { colour: string; label: string } = { colour: TRANSPARENT, label: 'Not fuel (rock, water, cleared ground)' };

function dataLegend(overlay: DataOverlayKind, ctx: LegendContext): LegendSpec {
  switch (overlay) {
    case 'elevation': {
      const note = 'Fire runs faster uphill, ridges catch the wind first, and on a still night cold air drains down into the low ground.';
      if (!ctx.elevationRange) {
        // No range known: say where the ends are rather than print heights that might be wrong.
        const stops = [0, 0.5, 1];
        const c: Rgb = [0, 0, 0];
        const words = ['lowest ground', 'in between', 'highest ground'];
        return {
          overlay,
          title: 'Ground height above sea level',
          units: 'm',
          kind: 'continuous',
          entries: stops.map((v, i) => ({ value: v, colour: rgbToHex(sampleRamp(ELEVATION_RAMP, v, c)), label: ['Lowest', 'Middle', 'Highest'][i]!, words: words[i]! })),
          gradient: gradientCss(ELEVATION_RAMP, 0, 1),
          note,
        };
      }
      const { lo, step } = niceElevationRange(ctx.elevationRange[0], ctx.elevationRange[1]);
      const c: Rgb = [0, 0, 0];
      const entries: LegendEntry[] = [];
      for (let i = 0; i <= 4; i++) {
        const v = lo + i * step;
        entries.push({ value: v, colour: rgbToHex(sampleRamp(ELEVATION_RAMP, i / 4, c)), label: fmtThousands(v), words: ['valley floors and low ground', 'lower slopes', 'mid height', 'upper slopes', 'ridge tops and high ground'][i]! });
      }
      return { overlay, title: 'Ground height above sea level', units: 'm', kind: 'continuous', entries, gradient: gradientCss(ELEVATION_RAMP, 0, 1), note };
    }
    case 'landform':
      return {
        overlay,
        title: 'Landform (ridge, slope, gully)',
        units: '',
        kind: 'categorical',
        entries: LANDFORM_ORDER.map((l) => ({ value: l, colour: LANDFORM_COLOURS[l], label: LANDFORM_LABELS[l] })),
        note: 'Gullies act like chimneys that fire races up, ridge tops and spurs are exposed to the wind, and cliffs and flat ground slow a fire down.',
      };
    case 'canopyHeight':
      return rampSpec(
        overlay,
        'Tree height',
        'm',
        CANOPY_HEIGHT_RAMP,
        ['0', '10', '20', '30', '40+'],
        ['low scrub and young trees', 'low woodland', 'forest', 'tall forest', 'very tall forest'],
        'Tall trees loft embers higher and further, and flames that reach the crowns make a crown fire that is far harder to stop.',
        { colour: TRANSPARENT, label: 'No trees (under 2 m)' },
      );
    case 'canopyCover':
      return rampSpec(
        overlay,
        'Tree cover',
        '%',
        CANOPY_COVER_RAMP,
        ['0', '25', '50', '75', '100'],
        ['open ground', 'scattered trees', 'open woodland', 'closed forest', 'crowns touching'],
        'Dense tree cover shades and dampens the fuel below, but touching crowns can carry a crown fire from tree to tree.',
      );
    case 'elevatedHazard':
    case 'surfaceHazard':
    case 'nearSurfaceHazard':
    case 'barkHazard': {
      const h = HAZARD_SPECS[overlay];
      return {
        overlay,
        title: h.title,
        units: 'score 0–4',
        kind: 'classes',
        entries: h.bounds.map((v, i) => ({ value: v, colour: h.colours[i]!, label: h.labels[i]!, words: h.words[i]! })),
        noData: NOT_FUEL,
        note: h.note,
      };
    }
    case 'elevatedHeight':
      return rampSpec(
        overlay,
        'Shrub height',
        'm',
        ELEVATED_HEIGHT_RAMP,
        ['0', '0.5', '1', '1.5', '2', '2.5', '3+'],
        ['ground level', 'knee height', 'waist height', 'chest height', 'head height', 'above head height', 'taller than a person'],
        'Flames are at least as tall as the shrubs, and shrubs that reach the tree crowns let a fire climb into the canopy.',
        { colour: TRANSPARENT, label: 'No shrub layer' },
      );
    case 'grassCuring':
      return rampSpec(
        overlay,
        'Grass curing (dryness)',
        '%',
        CURING_RAMP,
        ['0', '25', '50', '75', '100'],
        ['fresh and green', 'mostly green', 'half dry', 'mostly dry', 'fully dry and golden'],
        'Dry, golden (cured) grass burns fast and fiercely, while green grass hardly burns at all.',
        { colour: TRANSPARENT, label: 'Not grass' },
      );
    case 'fireHistoryKind': {
      const order = [FireHistoryKind.Wildfire, FireHistoryKind.PrescribedBurn, FireHistoryKind.Unknown];
      return {
        overlay,
        title: 'Last fire: wildfire or planned burn',
        units: '',
        kind: 'categorical',
        entries: order.map((k) => ({ value: k, colour: FIRE_HISTORY_COLOURS[k], label: FIRE_HISTORY_LABELS[k] })),
        noData: { colour: TSF_NO_RECORD, label: 'No fire on record' },
        note: 'A recent planned burn has already used up the fuel and can anchor a control line; the years-since-fire layer shows how long ago each place burnt.',
      };
    }
    case 'homeDensity':
      return {
        overlay,
        title: 'Homes nearby',
        units: 'homes/ha',
        kind: 'classes',
        entries: HOME_DENSITY_CLASSES.bounds.map((v, i) => ({ value: v, colour: HOME_RAMP.stops[i]!.colour, label: HOME_DENSITY_CLASSES.labels[i]! })),
        noData: { colour: TRANSPARENT, label: 'No homes within about 150 m' },
        note: 'Homes are what most needs protecting: the denser the houses, the more people at risk and the more places an ember can start a fire.',
      };
    case 'roadAccess':
      return {
        overlay,
        title: 'Distance to nearest road or trail',
        units: 'm',
        kind: 'classes',
        entries: ROAD_ACCESS_CLASSES.bounds.map((v, i) => ({ value: v, colour: ROAD_RAMP.stops[i]!.colour, label: ROAD_ACCESS_CLASSES.labels[i]! })),
        note: 'Roads and fire trails are where trucks can reach, make a stand or get out: the further from one, the longer the walk and the harder the retreat.',
      };
    case 'windSpeed':
      return rampSpec(
        overlay,
        'Wind speed near the ground',
        'km/h',
        WIND_SPEED_RAMP,
        ['0', '10', '20', '30', '40', '50', '60+'],
        ['calm', 'light breeze', 'moderate breeze', 'fresh breeze', 'strong breeze', 'near gale', 'gale'],
        'Wind is the biggest driver of a fire: it speeds the fire up sharply, and ridges and gaps funnel it hardest.',
      );
  }
}

const HAZARD_TITLES: Record<'vls' | 'attach' | 'trench' | 'dmz', { title: string; note: string }> = {
  vls: {
    title: 'Sideways run on lee slopes (VLS)',
    note: 'Steep slopes facing away from a strong wind can make fire run sideways across the slope and shower embers downwind.',
  },
  attach: {
    title: 'Flame attachment / blow-up potential',
    note: 'On slopes steeper than about 22° flames lie down on the fuel and the fire can suddenly accelerate uphill.',
  },
  trench: {
    title: 'Gullies and chimneys',
    note: 'Narrow, steep gullies channel hot gases like a chimney: fire can race up them far faster than up an open slope.',
  },
  dmz: {
    title: 'Dead man zone (wind change)',
    note: 'The flank that becomes a head fire when the forecast wind change arrives. Never be here without a safe refuge.',
  },
};

/** Legend of the vertical cross-section (potential-temperature anomaly). */
export function crossSectionLegend(): LegendSpec {
  return {
    overlay: 'crossSection',
    title: 'Air temperature vs surroundings',
    units: 'K',
    kind: 'continuous',
    entries: stopsLegend(THETA_RAMP, (v) => (v > 0 ? `+${v}` : `${v}`)),
    gradient: gradientCss(THETA_RAMP, -6, 20),
    note: 'Red = warm rising air (fire plume, sunny slopes); blue = cold sinking air (night drainage into valleys). Arrows show the wind in the section; cyan arrows blow against the main wind.',
  };
}

/** Legend of the wind particles ('surface' colours by speed, 'volume' by vertical velocity). */
export function windLegend(mode: 'surface' | 'volume'): LegendSpec {
  if (mode === 'volume') {
    return {
      overlay: 'updraft',
      title: 'Vertical air motion',
      units: 'm/s',
      kind: 'continuous',
      entries: stopsLegend(UPDRAFT_RAMP, (v) => (v > 0 ? `+${v}` : `${v}`)),
      gradient: gradientCss(UPDRAFT_RAMP, -3, 8),
      note: 'Red streaks rise (plume, sunny slopes), blue streaks sink.',
    };
  }
  return {
    overlay: 'wind',
    title: 'Wind speed',
    units: 'km/h',
    kind: 'continuous',
    entries: WIND_RAMP.stops.map((s) => ({ value: Math.round(s.at * 3.6), colour: s.colour, label: `${Math.round(s.at * 3.6)}` })),
    gradient: gradientCss(WIND_RAMP, 0, 25),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shader colour scales
// ─────────────────────────────────────────────────────────────────────────────

/** How the terrain shader maps an overlay value to a LUT coordinate. */
export type ScaleMode = 'ramp' | 'classes' | 'categorical' | 'cyclic';

export interface OverlayScale {
  mode: ScaleMode;
  /** Value range mapped onto the LUT (legend units; in log10 when `log`). Categorical: code c → texel c. */
  lo: number;
  hi: number;
  log: boolean;
  /** 256 × 1 RGBA8 (sRGB) LUT. Alpha 0 marks "transparent" (e.g. unused categories). */
  lut: Uint8Array;
  /** sRGB colour for no-data cells, alpha 0 = transparent. */
  noData: [number, number, number, number];
}

export const LUT_SIZE = 256;

/** Precompiled step ramps for the class overlays (same stops as the legend). */
const lutCache = new Map<string, OverlayScale>();

function buildLut(size: number, colourAt: (u: number, out: Rgb) => Rgb | null): Uint8Array {
  const out = new Uint8Array(size * 4);
  const c: Rgb = [0, 0, 0];
  for (let i = 0; i < size; i++) {
    const u = (i + 0.5) / size;
    const col = colourAt(u, c);
    if (!col) continue;
    out[i * 4] = Math.round(col[0] * 255);
    out[i * 4 + 1] = Math.round(col[1] * 255);
    out[i * 4 + 2] = Math.round(col[2] * 255);
    out[i * 4 + 3] = 255;
  }
  return out;
}

const noDataOf = (hex: string | null, alpha = 1): [number, number, number, number] => {
  if (!hex) return [0, 0, 0, 0];
  const c = hexToRgb(hex);
  return [c[0], c[1], c[2], alpha];
};

function continuousScale(r: Ramp, lo: number, hi: number, noData: string | null = null): OverlayScale {
  const log = r.log;
  const a = log ? Math.log10(lo) : lo;
  const b = log ? Math.log10(hi) : hi;
  const lut = buildLut(LUT_SIZE, (u, out) => sampleRamp(r, log ? 10 ** (a + (b - a) * u) : a + (b - a) * u, out));
  return { mode: 'ramp', lo: a, hi: b, log, lut, noData: noDataOf(noData) };
}

function classScale(r: Ramp, lo: number, hi: number, log = false): OverlayScale {
  const a = log ? Math.log10(lo) : lo;
  const b = log ? Math.log10(hi) : hi;
  const lut = buildLut(LUT_SIZE, (u, out) => sampleClasses(r, log ? 10 ** (a + (b - a) * u) : a + (b - a) * u, out));
  return { mode: 'classes', lo: a, hi: b, log, lut, noData: [0, 0, 0, 0] };
}

function categoricalScale(colours: Record<number, string>, count: number): OverlayScale {
  const lut = new Uint8Array(LUT_SIZE * 4);
  for (let c = 0; c < count; c++) {
    const hex = colours[c];
    if (!hex) continue;
    const rgb = hexToRgb(hex);
    lut[c * 4] = Math.round(rgb[0] * 255);
    lut[c * 4 + 1] = Math.round(rgb[1] * 255);
    lut[c * 4 + 2] = Math.round(rgb[2] * 255);
    lut[c * 4 + 3] = 255;
  }
  return { mode: 'categorical', lo: 0, hi: LUT_SIZE, log: false, lut, noData: [0, 0, 0, 0] };
}

/** Intensity classes on a log axis so the 500 kW/m boundary is resolved by the 256-texel LUT. */
const INTENSITY_LOG = makeRamp(
  INTENSITY_CLASSES.stops.map((s, i) => ({ at: i === 0 ? 1 : s.at, colour: s.colour })),
  { log: true },
);

/**
 * The LUT and value mapping the terrain shader uses for an overlay. The shader computes
 * u = (f(v) − lo)/(hi − lo) with f = log10 when `log` (ramps/classes), texel = v for categorical, or u = v/360 for
 * the cyclic aspect ramp, and samples the LUT with NEAREST filtering.
 */
export function overlayScale(overlay: OverlayKind, ctx: LegendContext = {}): OverlayScale | null {
  if (overlay === 'none') return null;
  if (overlay === 'arrival') {
    // Arrival LUT spans 0 … max; not cached (dynamic range).
    const max = niceArrivalMax(ctx.arrivalMaxSeconds ?? DEFAULT_ARRIVAL_MAX);
    const lut = buildLut(LUT_SIZE, (u, out) => sampleRamp(ARRIVAL_RAMP, u, out));
    return { mode: 'ramp', lo: 0, hi: max, log: false, lut, noData: [0, 0, 0, 0] };
  }
  const hit = lutCache.get(overlay);
  if (hit) return overlay === 'elevation' ? elevationScale(hit, ctx) : hit;
  let s: OverlayScale;
  switch (overlay) {
    case 'ros':
      s = continuousScale(ROS_RAMP, 0.05, 15);
      break;
    case 'intensity':
      s = classScale(INTENSITY_LOG, 10, 100000, true);
      break;
    case 'driver':
      s = categoricalScale(DRIVER_COLOURS as Record<number, string>, 12);
      // "None" (not burnt) stays transparent.
      s.lut[SpreadDriver.None * 4 + 3] = 0;
      break;
    case 'moisture':
      s = continuousScale(MOISTURE_RAMP, 3, 25);
      break;
    case 'fuelLoad':
      s = continuousScale(FUEL_LOAD_RAMP, 0, 40);
      break;
    case 'fuelType':
      s = categoricalScale(FUEL_TYPE_COLOURS as Record<number, string>, FUEL_TYPE_COUNT);
      break;
    case 'timeSinceFire':
      s = continuousScale(TSF_RAMP, 0, 50, TSF_NO_RECORD);
      break;
    case 'slope':
      s = classScale(SLOPE_CLASSES, 0, 60);
      break;
    case 'aspect': {
      const lut = buildLut(LUT_SIZE, (u, out) => sampleCyclic(ASPECT_RAMP, u * 360, out));
      s = { mode: 'cyclic', lo: 0, hi: 360, log: false, lut, noData: noDataOf(FLAT_COLOUR) };
      break;
    }
    case 'insolation':
      s = continuousScale(INSOLATION_RAMP, 0, 1100);
      break;
    case 'vls':
    case 'attach':
    case 'trench':
    case 'dmz':
      s = continuousScale(HAZARD_RAMP, 0, 1);
      break;
    case 'landing':
      s = continuousScale(LANDING_RAMP, 0.1, 100);
      break;
    case 'elevation': {
      // One shared LUT over 0 … 1; the value range of the site is applied through lo / hi (never cached: it changes per site).
      const base = continuousScale(ELEVATION_RAMP, 0, 1);
      lutCache.set(overlay, base);
      return elevationScale(base, ctx);
    }
    case 'landform':
      s = categoricalScale(LANDFORM_COLOURS as Record<number, string>, 11);
      break;
    case 'canopyHeight':
      s = continuousScale(CANOPY_HEIGHT_RAMP, 0, 40);
      break;
    case 'canopyCover':
      s = continuousScale(CANOPY_COVER_RAMP, 0, 100);
      break;
    case 'surfaceHazard':
    case 'nearSurfaceHazard':
    case 'elevatedHazard':
    case 'barkHazard':
      s = classScale(hazardRamp(HAZARD_SPECS[overlay]), 0, 4);
      break;
    case 'elevatedHeight':
      s = continuousScale(ELEVATED_HEIGHT_RAMP, 0, 3);
      break;
    case 'grassCuring':
      s = continuousScale(CURING_RAMP, 0, 100);
      break;
    case 'fireHistoryKind':
      s = categoricalScale(FIRE_HISTORY_COLOURS as Record<number, string>, 3);
      s.noData = noDataOf(TSF_NO_RECORD);
      break;
    case 'homeDensity':
      s = classScale(HOME_RAMP, 0.03, 30, true);
      break;
    case 'roadAccess':
      s = classScale(ROAD_RAMP, 0, 1500);
      break;
    case 'windSpeed':
      s = continuousScale(WIND_SPEED_RAMP, 0, 60);
      break;
  }
  lutCache.set(overlay, s);
  return s;
}

/** The elevation scale for a site: the shared LUT stretched over the nice height range of the legend context. */
function elevationScale(base: OverlayScale, ctx: LegendContext): OverlayScale {
  const { lo, hi } = ctx.elevationRange ? niceElevationRange(ctx.elevationRange[0], ctx.elevationRange[1]) : DEFAULT_ELEVATION_RANGE;
  return { ...base, lo, hi };
}

/**
 * CPU equivalent of the shader lookup (tests, 2-D minimaps, "value under the finger" readouts). Returns sRGB 0–1 and
 * alpha (0 = transparent), or null for no-data that is transparent.
 */
export function overlayColour(scale: OverlayScale, value: number): [number, number, number, number] | null {
  if (!Number.isFinite(value) || value <= NO_DATA_THRESHOLD) return scale.noData[3] > 0 ? scale.noData : null;
  let texel: number;
  if (scale.mode === 'categorical') texel = Math.round(value);
  else {
    let u: number;
    if (scale.mode === 'cyclic') u = (((value % 360) + 360) % 360) / 360;
    else {
      const f = scale.log ? Math.log10(Math.max(value, 1e-12)) : value;
      u = (f - scale.lo) / (scale.hi - scale.lo);
    }
    texel = Math.floor(Math.min(0.99999, Math.max(0, u)) * LUT_SIZE);
  }
  if (texel < 0 || texel >= LUT_SIZE) return null;
  const a = scale.lut[texel * 4 + 3]! / 255;
  if (a === 0) return null;
  return [scale.lut[texel * 4]! / 255, scale.lut[texel * 4 + 1]! / 255, scale.lut[texel * 4 + 2]! / 255, a];
}

/** Sentinel stored in float overlay textures for "no data" (NaN is unreliable in GLSL). Float32-exact. */
export const NO_DATA = Math.fround(-1e30);
/** Values at or below this are treated as no data. */
export const NO_DATA_THRESHOLD = -1e29;
/** Sentinel for "not burnt" arrival times (+∞ in the simulation). Float32-exact. */
export const NOT_BURNT = Math.fround(1e30);
