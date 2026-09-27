/**
 * AFDRS Fire Behaviour Index and ratings (spec §6.11) [V FBI-TG v1.0 §2; D14, D41].
 *
 * FBI = floor(linear interpolation of the metric between breakpoints at FBI 0, 6, 12, 24, 50, 100; above the last
 * breakpoint interpolate to FBI 200 at 90 000 kW/m and extrapolate linearly beyond). The FBI shown to users is always
 * the AFDRS-parity value of {@link afdrsFbi}: Vesta 2012 (FA = 0.1·DF) for forest, CSIRO grass, heath 2024 or pine, with
 * AFDRS moisture M_A, flat ground and the type's steady-state row — the spread itself uses Vesta Mk2 (D41).
 */
import { lmstHour, localDate } from '../../core/physics';
import { FuelType, type FuelFamily, type WeatherHour } from '../../core/types';
import { afdrsMoistureFor } from './afdrsMoisture';
import { BYRAM, flameHeightGrass, flameHeightShrub, flameHeightVesta, fuelAvailabilityAfdrs, fuelAvailabilityWet } from './common';
import { classOverrides, familyOf, fuelRow, grassWafFor, moistureFamilyOf } from './fuelRef';
import { grassRos, grassStateFromLoad } from './grass';
import { heathRefitRos, heathWaf } from './heath';
import { FIRE_MODEL_PARAMS, getFireModelOptions, type FireModelOptions } from './params';
import { createPineOut, pineCore } from './pine';
import { vesta2012Ros } from './vesta2012';
import { understoreyHeight } from './vestaMk2';

export type FbiTableId = 'forest' | 'grass' | 'shrub' | 'savanna';

/** One FBI table: FBI `levels` at metric `breakpoints` (kW/m, or m/h for `metric: 'ros'`). */
export interface FbiTable {
  breakpoints: readonly number[];
  levels: readonly number[];
  metric: 'intensity' | 'ros';
}

const SIX = [0, 6, 12, 24, 50, 100] as const;

/** FBI-TG v1.0 (2022, published) tables [V]. */
export const FBI_TABLES_FBITG: Readonly<Record<FbiTableId, FbiTable>> = Object.freeze({
  forest: { breakpoints: [0, 100, 750, 4000, 10000, 30000], levels: SIX, metric: 'intensity' },
  grass: { breakpoints: [0, 50, 2000, 9000, 17500, 25000], levels: SIX, metric: 'intensity' },
  shrub: { breakpoints: [0, 50, 500, 4000, 20000, 40000], levels: SIX, metric: 'intensity' },
  savanna: { breakpoints: [0, 100, 4000, 17500, 25000], levels: [0, 6, 12, 50, 100], metric: 'intensity' },
});

/** PyroXL 2024 variant (data behind a switch, D14; UNVERIFIED which is operational, spec §16 items 2–3). */
export const FBI_TABLES_PYROXL_2024: Readonly<Record<FbiTableId, FbiTable>> = Object.freeze({
  forest: FBI_TABLES_FBITG.forest,
  grass: { breakpoints: [0, 100, 3000, 9000, 17500, 25000], levels: SIX, metric: 'intensity' },
  shrub: { breakpoints: [0, 1250, 2300, 3800, 7000, 14000], levels: SIX, metric: 'ros' },
  savanna: { breakpoints: [0, 100, 3000, 9000, 17500, 25000], levels: SIX, metric: 'intensity' },
});

export const fbiTables = (variant: FireModelOptions['fbiTables']): Readonly<Record<FbiTableId, FbiTable>> =>
  variant === 'pyroxl2024' ? FBI_TABLES_PYROXL_2024 : FBI_TABLES_FBITG;

/** FBI (integer, floored) of a metric value on one table. */
export function fbiFromMetric(metric: number, table: FbiTable): number {
  if (!(metric > 0)) return 0;
  const bp = table.breakpoints;
  const lv = table.levels;
  const n = bp.length - 1;
  const top = FIRE_MODEL_PARAMS.fbi;
  if (metric >= bp[n]!) return Math.floor(lv[n]! + ((top.topFbi - lv[n]!) * (metric - bp[n]!)) / (top.topMetric - bp[n]!));
  for (let i = 1; i <= n; i++) {
    if (metric < bp[i]!) return Math.floor(lv[i - 1]! + ((lv[i]! - lv[i - 1]!) * (metric - bp[i - 1]!)) / (bp[i]! - bp[i - 1]!));
  }
  return 0;
}

/**
 * FBI table of a fuel (spec §6.1): forest for vesta2/pine; savanna for GrassyWoodland, Urban and the eaten-out
 * wetland classes 35/48; grass for other grass-family fuels; shrub for heath.
 */
export function fbiTableFor(type: FuelType, fuelClass?: number, family: FuelFamily = familyOf(type, fuelClass)): FbiTableId | null {
  switch (family) {
    case 'vesta2':
    case 'pine':
      return 'forest';
    case 'heath':
      return 'shrub';
    case 'grass':
      if (type === FuelType.GrassyWoodland || type === FuelType.Urban || fuelClass === 35 || fuelClass === 48) return 'savanna';
      return 'grass';
    default:
      return null;
  }
}

export type FireDangerRatingName = 'No rating' | 'Moderate' | 'High' | 'Extreme' | 'Catastrophic';

/** AFDRS rating of an FBI: 0–11 No rating, 12–23 Moderate, 24–49 High, 50–99 Extreme, ≥ 100 Catastrophic [V]. */
export function ratingFromFbi(fbi: number): FireDangerRatingName {
  if (fbi >= 100) return 'Catastrophic';
  if (fbi >= 50) return 'Extreme';
  if (fbi >= 24) return 'High';
  if (fbi >= 12) return 'Moderate';
  return 'No rating';
}

// [K] approximate AFDRS palette; verify against the AFDRS style guide (spec §16 item 17).
const RATING_COLOURS: Record<FireDangerRatingName, string> = {
  'No rating': '#ffffff',
  Moderate: '#64bf30',
  High: '#ffd200',
  Extreme: '#f78100',
  Catastrophic: '#c8102e',
};

/** Rating and colour of an FBI (ARCHITECTURE name kept; its argument is the FBI). "No rating" has a `#e0e0e0` border. */
export function fireDangerRating(fbi: number): { rating: FireDangerRatingName; colour: string; border?: string } {
  const rating = ratingFromFbi(fbi);
  return rating === 'No rating' ? { rating, colour: RATING_COLOURS[rating], border: '#e0e0e0' } : { rating, colour: RATING_COLOURS[rating] };
}

export interface AfdrsFbiOptions {
  fuelClass?: number;
  /** Grass curing (%) for grass-family types (default 100, [H]). */
  curing?: number;
  /** Rain in the last 48 h (mm) and hours since it stopped (heath MC2). */
  rain48?: number;
  hoursSinceRain?: number;
  /** FBI table variant (default: the current model options). */
  fbiTables?: FireModelOptions['fbiTables'];
  /** Override M_A (%) instead of evaluating the AFDRS moisture equations. */
  moisture?: number;
}

export interface AfdrsFbiResult {
  fbi: number;
  rating: string;
  /** Head intensity (kW/m) of the parity model. */
  intensity: number;
  /** Head ROS (m/h, flat) of the parity model. */
  ros: number;
  /** AFDRS moisture M_A used (%). */
  moisture: number;
  fuelAvailability: number;
  flameHeight: number;
  model: string;
  table: FbiTableId | null;
  /** FBI of the same fire on the other table variant (FBI-TG v1.0 ↔ PyroXL 2024), and whether its rating differs (D14). */
  fbiVariant: number;
  ratingDiffers: boolean;
}

const PINE_SCRATCH = createPineOut();

/**
 * AFDRS-parity FBI and rating for a fuel type and one weather hour (D41; spec §6.11).
 * @param lonDeg longitude for local mean solar time (moisture period)
 * @param df drought factor; @param kbdi Keetch–Byram drought index (wet forest, pine)
 */
export function afdrsFbi(fuelType: FuelType, w: WeatherHour, lonDeg: number, df: number, kbdi: number, opts: AfdrsFbiOptions = {}): AfdrsFbiResult {
  const cls = opts.fuelClass;
  const family = familyOf(fuelType, cls);
  const mf = moistureFamilyOf(fuelType, cls);
  const row = fuelRow(fuelType);
  const lmst = lmstHour(w.time, lonDeg);
  const month = Number(localDate(w.time).slice(5, 7));
  const cloudFrac = (w.cloudCover ?? 0) / 100;
  const m = opts.moisture ?? afdrsMoistureFor(mf, w.temperature, w.relativeHumidity, lmst, month, cloudFrac, opts.rain48 ?? 0, opts.hoursSinceRain ?? 48);
  const u10 = 3.6 * w.windSpeed10;
  const tableId = fbiTableFor(fuelType, cls, family);
  const tables = fbiTables(opts.fbiTables ?? getFireModelOptions().fbiTables);
  let ros = 0;
  let intensity = 0;
  let fh = 0;
  let fa = 1;
  let model = 'none';
  switch (family) {
    case 'vesta2': {
      fa = fuelAvailabilityAfdrs(df, mf === 'wetForest', kbdi, row.wrf);
      ros = vesta2012Ros(u10, row.fhsS, row.fhsNs, 100 * row.hNs, m, fa, row.wrf);
      fh = flameHeightVesta(ros, row.hEl);
      let wf = fa * (Math.min(row.s, 10) + row.ns);
      if (fh > 1) wf += fa * row.el;
      if (fh > 0.66 * row.hO) wf += 0.5 * fa * row.canopy;
      intensity = BYRAM * wf * ros;
      model = 'Vesta 2012 (AFDRS forest)';
      break;
    }
    case 'pine': {
      fa = fuelAvailabilityWet(df, kbdi, row.wrf);
      pineCore(u10, m, fa, row.s, row.ns, row.el, row.canopy, understoreyHeight(row.fhsEl, row.hEl), row.hEl, row.hO, row.wrf, df, false, PINE_SCRATCH);
      ros = PINE_SCRATCH.ros;
      intensity = PINE_SCRATCH.intensity;
      fh = PINE_SCRATCH.flameHeight;
      model = 'AFDRS pine';
      break;
    }
    case 'grass': {
      const ov = classOverrides(cls);
      const state = ov?.grassState ?? row.grassState ?? grassStateFromLoad(row.s + row.ns);
      const curing = Math.max(0, Math.min(100, (opts.curing ?? FIRE_MODEL_PARAMS.afdrs.defaultCuring) + (ov?.curingOffset ?? 0)));
      ros = grassRos(u10, m, curing, state, grassWafFor(fuelType, row.cover), FIRE_MODEL_PARAMS.afdrs.eatenOutFbitg);
      const l = row.s + row.ns;
      intensity = BYRAM * Math.min(6, Math.max(1, l)) * ros;
      fh = flameHeightGrass(ros, state === 'natural');
      model = 'CSIRO grassland (AFDRS)';
      break;
    }
    case 'heath': {
      ros = heathRefitRos(u10, m, row.hEl, heathWaf(false));
      intensity = BYRAM * (row.s + row.ns + row.el) * ros;
      fh = flameHeightShrub(intensity);
      model = 'AFDRS heath (2024)';
      break;
    }
    default:
      break;
  }
  const variant = opts.fbiTables ?? getFireModelOptions().fbiTables;
  const other = fbiTables(variant === 'pyroxl2024' ? 'fbitg' : 'pyroxl2024');
  const fbiOn = (t: Readonly<Record<FbiTableId, FbiTable>>): number => {
    const table = tableId ? t[tableId] : null;
    return table ? fbiFromMetric(table.metric === 'ros' ? ros : intensity, table) : 0;
  };
  const fbi = fbiOn(tables);
  const fbiVariant = fbiOn(other);
  const rating = ratingFromFbi(fbi);
  return {
    fbi, rating, intensity, ros, moisture: m, fuelAvailability: fa, flameHeight: fh, model, table: tableId, fbiVariant,
    ratingDiffers: ratingFromFbi(fbiVariant) !== rating,
  };
}
