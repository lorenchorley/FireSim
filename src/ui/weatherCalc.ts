/**
 * Weather arithmetic the UI needs directly (pure, unit-tested):
 *  - belt-weather-kit psychrometry: relative humidity from dry- and wet-bulb readings, dew point;
 *  - the Beaufort scale with land cues, so a firefighter without an anemometer can estimate wind;
 *  - McArthur Forest Fire Danger Index and an AFDRS-style rating label/colour;
 *  - dead fine fuel moisture from T and RH (Matthews et al. 2010, as used in the AFDRS; FBI-TG eqs 3.48–3.50);
 *  - wind-change detection in a weather series (for the Weather timeline and "change coming" markers).
 *
 * The data layer (src/data/weather.ts) owns the authoritative versions used by the simulation; these are for live
 * feedback while the user types, and for the mocks.
 */
import type { WeatherHour } from '../core/types';
import { angleDiffDeg, msToKmh } from '../core/units';

// ───────────────────────────── psychrometry ─────────────────────────────

/** Saturation vapour pressure over water (hPa), Bolton (1980). */
export function saturationVapourPressure(tC: number): number {
  return 6.112 * Math.exp((17.67 * tC) / (tC + 243.5));
}

/** Standard-atmosphere pressure (hPa) at an elevation (m ASL). Mountain sites matter: ~900 hPa at 1000 m. */
export function pressureAtElevation(elevationM: number): number {
  return 1013.25 * Math.pow(1 - 2.25577e-5 * Math.max(-500, elevationM), 5.25588);
}

/**
 * Psychrometer coefficient (per °C) for a ventilated (sling / whirling) psychrometer such as the one in an RFS
 * belt weather kit: 6.62 × 10⁻⁴ over a wet bulb, 5.84 × 10⁻⁴ over an iced bulb (WMO No. 8 values).
 */
export const PSYCHROMETER_A_WATER = 6.62e-4;
export const PSYCHROMETER_A_ICE = 5.84e-4;

/**
 * Relative humidity (%) from dry-bulb and wet-bulb temperatures (°C) of a ventilated psychrometer:
 *   e = e_s(T_w) − A·p·(T − T_w),   RH = 100·e / e_s(T).
 * Returns NaN when the wet bulb reads warmer than the dry bulb (a reading error), clamps to 0–100 otherwise.
 */
export function relativeHumidityFromWetBulb(dryC: number, wetC: number, pressureHpa = 1013.25): number {
  if (!Number.isFinite(dryC) || !Number.isFinite(wetC)) return NaN;
  if (wetC > dryC + 0.05) return NaN;
  const a = wetC < 0 ? PSYCHROMETER_A_ICE : PSYCHROMETER_A_WATER;
  const e = saturationVapourPressure(wetC) - a * pressureHpa * (dryC - wetC);
  const rh = (100 * e) / saturationVapourPressure(dryC);
  return Math.min(100, Math.max(0, rh));
}

/** Dew point (°C) from temperature (°C) and RH (%) (Magnus form, Bolton constants). */
export function dewPoint(tC: number, rh: number): number {
  const e = (Math.max(0.1, Math.min(100, rh)) / 100) * saturationVapourPressure(tC);
  const g = Math.log(e / 6.112);
  return (243.5 * g) / (17.67 - g);
}

// ───────────────────────────── Beaufort ─────────────────────────────

export interface BeaufortForce {
  force: number;
  name: string;
  /** Lower bound (km/h, inclusive) of the 10 m mean wind. */
  minKmh: number;
  /** Upper bound (km/h, exclusive); Infinity for force 12. */
  maxKmh: number;
  /** What you see on land (so it can be estimated without an anemometer). */
  cue: string;
}

/** Beaufort scale (WMO / BoM km/h bands) with land descriptions. */
export const BEAUFORT: readonly BeaufortForce[] = [
  { force: 0, name: 'Calm', minKmh: 0, maxKmh: 1, cue: 'Smoke rises straight up.' },
  { force: 1, name: 'Light air', minKmh: 1, maxKmh: 6, cue: 'Smoke drifts; leaves barely move.' },
  { force: 2, name: 'Light breeze', minKmh: 6, maxKmh: 12, cue: 'Wind felt on the face; leaves rustle.' },
  { force: 3, name: 'Gentle breeze', minKmh: 12, maxKmh: 20, cue: 'Leaves and small twigs constantly moving; flags extend.' },
  { force: 4, name: 'Moderate breeze', minKmh: 20, maxKmh: 29, cue: 'Raises dust and loose paper; small branches move.' },
  { force: 5, name: 'Fresh breeze', minKmh: 29, maxKmh: 39, cue: 'Small trees in leaf begin to sway.' },
  { force: 6, name: 'Strong breeze', minKmh: 39, maxKmh: 50, cue: 'Large branches move; wires whistle.' },
  { force: 7, name: 'Near gale', minKmh: 50, maxKmh: 62, cue: 'Whole trees move; hard to walk into the wind.' },
  { force: 8, name: 'Gale', minKmh: 62, maxKmh: 75, cue: 'Twigs break off trees; walking is difficult.' },
  { force: 9, name: 'Strong gale', minKmh: 75, maxKmh: 89, cue: 'Branches break; slight structural damage.' },
  { force: 10, name: 'Storm', minKmh: 89, maxKmh: 103, cue: 'Trees uprooted; considerable damage.' },
  { force: 11, name: 'Violent storm', minKmh: 103, maxKmh: 118, cue: 'Widespread damage.' },
  { force: 12, name: 'Hurricane', minKmh: 118, maxKmh: Infinity, cue: 'Devastation.' },
];

/** Beaufort force for a wind speed in km/h (negative/NaN → calm). */
export function beaufortFromKmh(kmh: number): BeaufortForce {
  const v = Number.isFinite(kmh) && kmh > 0 ? kmh : 0;
  for (const b of BEAUFORT) if (v < b.maxKmh) return b;
  return BEAUFORT[BEAUFORT.length - 1]!;
}

/** A representative speed (km/h, rounded) for a Beaufort force, used when the user picks a force by its cue. */
export function beaufortRepresentativeKmh(force: number): number {
  const b = BEAUFORT[Math.max(0, Math.min(12, Math.round(force)))]!;
  if (!Number.isFinite(b.maxKmh)) return 125;
  if (b.force === 0) return 0;
  return Math.round((b.minKmh + b.maxKmh - 1) / 2);
}

// ───────────────────────────── fire danger ─────────────────────────────

/**
 * McArthur Mk5 Forest Fire Danger Index (Noble, Bary & Gill 1980):
 *   FFDI = 2·exp(−0.450 + 0.987·ln D − 0.0345·H + 0.0338·T + 0.0234·V)
 * D drought factor (0–10), H RH (%), T air temperature (°C), V 10 m open wind (km/h).
 */
export function ffdi(tC: number, rh: number, windKmh: number, droughtFactor: number): number {
  const d = Math.max(0.01, Math.min(10, droughtFactor));
  return 2 * Math.exp(-0.45 + 0.987 * Math.log(d) - 0.0345 * rh + 0.0338 * tC + 0.0234 * Math.max(0, windKmh));
}

export type RatingKey = 'none' | 'moderate' | 'high' | 'extreme' | 'catastrophic';

export interface RatingStyle {
  key: RatingKey;
  label: string;
  /** Background colour of the rating pill (AFDRS sign colours). */
  colour: string;
  /** Text colour with ≥ 7:1 contrast on `colour`. */
  textColour: string;
}

const RATING_STYLES: Record<RatingKey, RatingStyle> = {
  none: { key: 'none', label: 'No rating', colour: '#e8eaed', textColour: '#111418' },
  moderate: { key: 'moderate', label: 'Moderate', colour: '#62b346', textColour: '#0b1a05' },
  high: { key: 'high', label: 'High', colour: '#ffd23f', textColour: '#1a1400' },
  extreme: { key: 'extreme', label: 'Extreme', colour: '#f47b20', textColour: '#1a0a00' },
  catastrophic: { key: 'catastrophic', label: 'Catastrophic', colour: '#9e1b1b', textColour: '#ffffff' },
};

/**
 * AFDRS rating from an index using the AFDRS thresholds 12 / 24 / 50 / 100 (FBI-TG §2.3). Applied to FFDI it is an
 * approximation (the AFDRS thresholds were chosen to line up with the old FFDI bands), so callers label it "approx.".
 */
export function ratingFromIndex(index: number): RatingStyle {
  if (!Number.isFinite(index) || index < 12) return RATING_STYLES.none;
  if (index < 24) return RATING_STYLES.moderate;
  if (index < 50) return RATING_STYLES.high;
  if (index < 100) return RATING_STYLES.extreme;
  return RATING_STYLES.catastrophic;
}

/** Map any rating string (AFDRS or legacy FFDI categories) to a display style. */
export function ratingStyle(label: string | undefined | null): RatingStyle {
  const s = (label ?? '').toLowerCase().trim();
  if (s.includes('catastrophic') || s.includes('code red')) return RATING_STYLES.catastrophic;
  if (s.includes('extreme') || s.includes('severe')) return { ...RATING_STYLES.extreme, label: titleCase(label ?? '') || 'Extreme' };
  if (s.includes('high')) return { ...RATING_STYLES.high, label: titleCase(label ?? '') || 'High' };
  if (s.includes('moderate') || s === 'low' || s.includes('low-')) return { ...RATING_STYLES.moderate, label: titleCase(label ?? '') || 'Moderate' };
  return RATING_STYLES.none;
}

function titleCase(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

// ───────────────────────────── dead fuel moisture ─────────────────────────────

export type MoisturePeriod = 'sunny-afternoon' | 'day' | 'night';

/**
 * Dead fine fuel moisture (%) in dry eucalypt forest from T (°C) and RH (%) (Matthews et al. 2010 as used in the
 * AFDRS; FBI-TG eqs 3.48–3.50): sunny afternoon 2.76 + 0.124·RH − 0.0187·T; overcast/other daylight
 * 3.60 + 0.169·RH − 0.0450·T; night 3.08 + 0.198·RH − 0.0483·T.
 */
export function deadFuelMoisture(tC: number, rh: number, period: MoisturePeriod): number {
  switch (period) {
    case 'sunny-afternoon':
      return 2.76 + 0.124 * rh - 0.0187 * tC;
    case 'day':
      return 3.6 + 0.169 * rh - 0.045 * tC;
    case 'night':
      return 3.08 + 0.198 * rh - 0.0483 * tC;
  }
}

/** Period for {@link deadFuelMoisture} from the local hour (Oct–Mar convention; cloud ≥ 50 % → not "sunny"). */
export function moisturePeriod(localHour: number, cloudCover = 0): MoisturePeriod {
  if (localHour >= 12 && localHour < 17 && cloudCover < 50) return 'sunny-afternoon';
  if (localHour >= 7 && localHour < 19) return 'day';
  return 'night';
}

// ───────────────────────────── wind changes ─────────────────────────────

export interface WindChange {
  /** Unix ms when the new direction is established. */
  time: number;
  fromDir: number;
  toDir: number;
  /** Signed turn (deg): negative = anticlockwise (backing), positive = clockwise (veering). */
  turn: number;
  speedBeforeKmh: number;
  speedAfterKmh: number;
}

/**
 * Detect significant wind changes in an hourly series: the direction turns by ≥ `minTurn` degrees within
 * `windowHours` and the post-change 10 m wind is ≥ `minSpeedKmh` (defaults 45°, 2 h, 15 km/h, after doc 10 card S11
 * and doc 09 "Wind change coming"). Consecutive detections of the same change are merged (first time reported).
 */
export function detectWindChanges(
  hours: readonly WeatherHour[],
  opts: { minTurn?: number; windowHours?: number; minSpeedKmh?: number } = {},
): WindChange[] {
  const minTurn = opts.minTurn ?? 45;
  const windowMs = (opts.windowHours ?? 2) * 3600_000;
  const minSpeed = opts.minSpeedKmh ?? 15;
  const out: WindChange[] = [];
  let lastChangeEnd = -Infinity;
  for (let a = 0; a < hours.length; a++) {
    const ha = hours[a]!;
    if (ha.time < lastChangeEnd) continue;
    for (let b = a + 1; b < hours.length; b++) {
      const hb = hours[b]!;
      if (hb.time - ha.time > windowMs) break;
      const turn = angleDiffDeg(hb.windDir10, ha.windDir10);
      const after = msToKmh(hb.windSpeed10);
      if (Math.abs(turn) >= minTurn && after >= minSpeed && msToKmh(ha.windSpeed10) >= 3) {
        out.push({ time: hb.time, fromDir: ha.windDir10, toDir: hb.windDir10, turn, speedBeforeKmh: msToKmh(ha.windSpeed10), speedAfterKmh: after });
        lastChangeEnd = hb.time + windowMs;
        break;
      }
    }
  }
  return out;
}

// ───────────────────────────── plume regime ─────────────────────────────

export type PlumeRegime = 'wind-driven' | 'mixed' | 'plume-dominated';

/** Byram convective-number regime: < 2 wind-driven, > 10 plume-dominated (Morvan & Frangieh 2018; doc 02). */
export function plumeRegime(nc: number): PlumeRegime {
  if (!Number.isFinite(nc) || nc < 2) return 'wind-driven';
  return nc > 10 ? 'plume-dominated' : 'mixed';
}
