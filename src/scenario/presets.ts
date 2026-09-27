/**
 * Designed weather presets `WEATHER_PRESETS[id].build(start, hours, site)` (spec §11.3, D46) [H].
 *
 * Diurnal shape by LMST hour h: D(h) = 0.5 − 0.5·cos(π(h − 6)/9) for 6 ≤ h ≤ 15, else
 * 0.5 + 0.5·cos(π((h − 15) mod 24)/15); T = T_min + (T_max − T_min)·D, T_d constant per air mass,
 * U10 = U_n + (U_d − U_n)·D, gust = factor·U10, constant cloud, no radiation (insolation uses clear sky × cloud), no rain.
 * Stamps: hourly, and every 10 min inside [t_c − 1 h, t_c + 2 h] of a change.
 * Change at t_c: blend f = logistic((t − t_c)/7.5 min) (renormalised to reach exactly 0/1 at t_c ∓ 30 min, see
 * SCENARIO_PARAMS.presetChangeHalfWidthMin); speed (1 − f)·U_pre + f·U_post and direction along the shortest arc,
 * U_pre diurnal, U_post not; T = T_diurnal − ΔT·smoothstep(0, 2 h, t − t_c), T_d → T_d,post over the same ramp.
 * Reference elevation (D46): sourceElevation = the domain median elevation z_s. Upper air (upperAirSource 'preset'):
 * 850 (1500 m), 700 (3100 m), 500 (5800 m) hPa with winds 1.3/1.6/2.0 × the day surface wind, temperatures forced
 * non-superadiabatic above z_s: T850 = max(T850_tab, T_max − 9.8·(1.5 − z_s/1000)), T700 = T850 − (T850_tab − T700_tab),
 * T500 = T700 − 20 K; Td850 from the table, RH700/RH500 from the table.
 */
import type { LatLon, PressureLevelData, WeatherHour, WeatherSeries } from '../core/types';
import { dewPointC, logistic, rhFromTd, lmstHour } from '../core/physics';
import { angleDiffDeg, smoothstep, wrapDeg } from '../core/units';
import { SCENARIO_PARAMS } from './params';
import { lmstMidnight, lmstToUtc } from './time';

const H = 3.6e6;
const MIN = 60_000;

export type PresetId = 'hot-nw-sw-change' | 'calm-night-katabatic' | 'mild-spring-hr' | 'catastrophic-black-summer';
export type RatingName = 'No rating' | 'Moderate' | 'High' | 'Extreme' | 'Catastrophic';

/** Where a preset is run: its location (LMST longitude) and the reference elevation z_s (domain median, D46). */
export interface PresetSite {
  location: LatLon;
  sourceElevation: number;
  timezone?: string;
  /** Climatological annual rainfall to attach (demo table), optional. */
  annualRainfall?: number;
}

export interface PresetChange {
  /** LMST hour of t_c on the start's LMST day. */
  lmst: number;
  dir: number;
  /** Post-change 10 m wind (m/s): `speed` for `holdH` hours, then `settle` via smoothstep(holdH, holdH + 0.5 h). */
  speed: number;
  holdH?: number;
  settle?: number;
  gust?: number;
  /** Cooling ΔT (K) and post-change dew point (°C), both over smoothstep(0, 2 h, t − t_c). */
  dT: number;
  tdPost: number;
}

export interface WeatherPresetDef {
  id: PresetId;
  name: string;
  description: string;
  /** Canonical date (local month / day) and start (LMST hour): the UI default; the FBI chip is defined there. */
  canonical: { month: number; day: number; startLmst: number };
  tMin: number;
  tMax: number;
  td: number;
  wind: { dir: number; day: number; night: number; gust: number };
  change?: PresetChange;
  /** Cloud cover (%). */
  cloud: number;
  df: number;
  kbdi: number;
  /** Sea-level-referenced air mass of the table: T850, T700, Td850 (°C), RH700, RH500 (%). */
  upper: { t850: number; t700: number; td850: number; rh700: number; rh500: number };
  /** The chip (§11.3): at `lmst` on the canonical date, FFDI (where the spec states it) and AFDRS-parity FBI at z_s for dry shrubby forest. */
  chip: { lmst: number; ffdi?: number; fbi: number; rating: RatingName };
  nightTemplate?: { dThetaMax: number; hInv: number };
}

export interface WeatherPreset extends WeatherPresetDef {
  /** Build the series from `start − presetSpinupHours` to `start + hours` (unix ms, h). */
  build(start: number, hours: number, site: PresetSite): WeatherSeries;
  /** Canonical start (unix ms) in `year` at longitude `lonDeg`. */
  canonicalStart(lonDeg: number, year: number): number;
}

/** Diurnal shape D(h) ∈ [0, 1] of the LMST hour (§11.3): 0 at 06:00, 1 at 15:00. */
export function presetDiurnal(h: number): number {
  const hh = ((h % 24) + 24) % 24;
  if (hh >= 6 && hh <= 15) return 0.5 - 0.5 * Math.cos((Math.PI * (hh - 6)) / 9);
  return 0.5 + 0.5 * Math.cos((Math.PI * ((((hh - 15) % 24) + 24) % 24)) / 15);
}

/** Change blend f(t) ∈ [0, 1] (logistic, τ = 7.5 min, renormalised to exactly 0 / 1 at t_c ∓ W). */
export function changeBlend(t: number, tc: number): number {
  const P = SCENARIO_PARAMS;
  const tau = P.presetChangeTauMin * MIN;
  const w = P.presetChangeHalfWidthMin * MIN;
  const d = t - tc;
  if (d <= -w) return 0;
  if (d >= w) return 1;
  const l0 = logistic(-w / tau);
  const l1 = logistic(w / tau);
  return (logistic(d / tau) - l0) / (l1 - l0);
}

const DEFS: WeatherPresetDef[] = [
  {
    id: 'hot-nw-sw-change',
    name: 'Hot NW wind ahead of a SW change',
    description: '36 °C, 12 % RH, NW 35–45 km/h; a gusty south-westerly change arrives mid-afternoon (15:00).',
    canonical: { month: 12, day: 20, startLmst: 11 },
    tMin: 22,
    tMax: 36,
    td: 2,
    wind: { dir: 310, day: 11, night: 6, gust: 1.5 },
    change: { lmst: 15, dir: 230, speed: 12, holdH: 1, settle: 9, gust: 1.8, dT: 8, tdPost: 10 },
    cloud: 10,
    df: 9,
    kbdi: 120,
    upper: { t850: 22, t700: 8, td850: -6, rh700: 15, rh500: 20 },
    chip: { lmst: 14.5, ffdi: 62.6, fbi: 75, rating: 'Extreme' },
  },
  {
    id: 'calm-night-katabatic',
    name: 'Calm night – katabatic drainage',
    description: 'Clear, still night: cold air drains down slopes and valleys, a thermal belt forms mid-slope.',
    canonical: { month: 3, day: 15, startLmst: 19 },
    tMin: 8,
    tMax: 24,
    td: 6,
    wind: { dir: 270, day: 2, night: 1.5, gust: 1.3 },
    cloud: 0,
    df: 7,
    kbdi: 60,
    upper: { t850: 16, t700: 6, td850: 4, rh700: 40, rh500: 40 },
    chip: { lmst: 21, fbi: 6, rating: 'No rating' },
    nightTemplate: { dThetaMax: 6, hInv: 150 },
  },
  {
    id: 'mild-spring-hr',
    name: 'Mild spring hazard-reduction day',
    description: '20 °C, 45 % RH, light SE breeze: typical prescribed-burn weather.',
    canonical: { month: 10, day: 15, startLmst: 10 },
    tMin: 8,
    tMax: 20,
    td: 7.7,
    wind: { dir: 130, day: 4.5, night: 1.5, gust: 1.4 },
    cloud: 20,
    df: 8,
    kbdi: 60,
    upper: { t850: 10, t700: 0, td850: 2, rh700: 45, rh500: 40 },
    chip: { lmst: 15, ffdi: 6.0, fbi: 16, rating: 'Moderate' },
  },
  {
    id: 'catastrophic-black-summer',
    name: 'Catastrophic Black-Summer-like day',
    description: '42 °C, 6 % RH, NW 50–60 km/h in long drought (DF 10): mass spotting, pyroconvection and a late SW change.',
    canonical: { month: 12, day: 30, startLmst: 10 },
    tMin: 28,
    tMax: 42,
    td: -3,
    wind: { dir: 315, day: 15, night: 10, gust: 1.6 },
    change: { lmst: 18, dir: 225, speed: 13, dT: 10, tdPost: 8 },
    cloud: 5,
    df: 10,
    kbdi: 170,
    upper: { t850: 28, t700: 12, td850: -10, rh700: 10, rh500: 15 },
    chip: { lmst: 15, ffdi: 147, fbi: 109, rating: 'Catastrophic' },
  },
];

/** Surface state of a preset at an instant (no allocation of the upper air). */
export interface PresetState {
  temperature: number;
  dewPoint: number;
  windSpeed10: number;
  windDir10: number;
  gust: number;
  /** Day surface wind used for the upper levels. */
  dayWind: number;
  /** Change blend f. */
  f: number;
}

/** Evaluate a preset's surface weather at t (tc = change instant or NaN). */
export function presetStateAt(p: WeatherPresetDef, t: number, lonDeg: number, tc: number): PresetState {
  const D = presetDiurnal(lmstHour(t, lonDeg));
  let T = p.tMin + (p.tMax - p.tMin) * D;
  let td = p.td;
  const uPre = p.wind.night + (p.wind.day - p.wind.night) * D;
  let speed = uPre;
  let dir = p.wind.dir;
  let gustF = p.wind.gust;
  let dayWind = p.wind.day;
  let f = 0;
  const c = p.change;
  if (c && Number.isFinite(tc)) {
    f = changeBlend(t, tc);
    const dt = t - tc;
    const hold = (c.holdH ?? Infinity) * H;
    const uPost = c.settle !== undefined && Number.isFinite(hold) ? c.speed + (c.settle - c.speed) * smoothstep(hold, hold + 0.5 * H, dt) : c.speed;
    speed = (1 - f) * uPre + f * uPost;
    dir = wrapDeg(p.wind.dir + f * angleDiffDeg(c.dir, p.wind.dir));
    gustF = (1 - f) * p.wind.gust + f * (c.gust ?? p.wind.gust);
    dayWind = (1 - f) * p.wind.day + f * c.speed;
    const r = smoothstep(0, 2 * H, dt);
    T -= c.dT * r;
    td = p.td + (c.tdPost - p.td) * r;
  }
  return { temperature: T, dewPoint: td, windSpeed10: speed, windDir10: dir, gust: gustF * speed, dayWind, f };
}

/** Preset upper air at reference elevation z_s (§11.3, D46): 850 hPa is dropped when z_s ≥ 1500 m. */
export function presetUpperAir(p: WeatherPresetDef, zs: number, dayWind: number, dirFrom: number): PressureLevelData[] {
  const P = SCENARIO_PARAMS;
  const [l850, l700, l500] = P.presetLevels as unknown as [{ hPa: number; height: number; windFactor: number }, { hPa: number; height: number; windFactor: number }, { hPa: number; height: number; windFactor: number }];
  const g = P.dryAdiabaticKPerKm;
  const t850 = Math.max(p.upper.t850, p.tMax - g * (l850.height / 1000 - zs / 1000));
  let t700 = t850 - (p.upper.t850 - p.upper.t700);
  if (zs >= l850.height) t700 = Math.max(p.upper.t700, p.tMax - g * (l700.height / 1000 - zs / 1000)); // [H] extension above 1500 m
  const t500 = t700 - P.presetT500Drop;
  const out: PressureLevelData[] = [];
  if (zs < l850.height) {
    const td850 = Math.min(p.upper.td850, t850);
    out.push({ hPa: l850.hPa, height: l850.height, temperature: t850, relativeHumidity: rhFromTd(t850, td850), dewPoint: td850, windSpeed: l850.windFactor * dayWind, windDir: dirFrom });
  }
  out.push({ hPa: l700.hPa, height: l700.height, temperature: t700, relativeHumidity: p.upper.rh700, dewPoint: dewPointC(t700, p.upper.rh700), windSpeed: l700.windFactor * dayWind, windDir: dirFrom });
  out.push({ hPa: l500.hPa, height: l500.height, temperature: t500, relativeHumidity: p.upper.rh500, dewPoint: dewPointC(t500, p.upper.rh500), windSpeed: l500.windFactor * dayWind, windDir: dirFrom });
  return out;
}

/** Stamp times: hourly (whole UTC hours) plus every 10 min inside [t_c − 1 h, t_c + 2 h]. */
function stampTimes(from: number, to: number, tc: number): number[] {
  const P = SCENARIO_PARAMS;
  const out: number[] = [];
  const w0 = tc - P.presetChangeWindowBeforeH * H;
  const w1 = tc + P.presetChangeWindowAfterH * H;
  const inWindow = (t: number): boolean => Number.isFinite(tc) && t >= w0 && t <= w1;
  for (let t = Math.floor(from / H) * H; t <= Math.ceil(to / H) * H; t += H) if (!inWindow(t)) out.push(t);
  if (Number.isFinite(tc)) {
    const step = P.presetChangeStampMin * MIN;
    for (let t = w0; t <= w1 + 1; t += step) if (t >= from - H && t <= to + H) out.push(t);
  }
  return out.sort((a, b) => a - b);
}

function makePreset(def: WeatherPresetDef): WeatherPreset {
  return {
    ...def,
    canonicalStart(lonDeg: number, year: number): number {
      const date = `${year}-${String(def.canonical.month).padStart(2, '0')}-${String(def.canonical.day).padStart(2, '0')}`;
      return lmstToUtc(date, def.canonical.startLmst, lonDeg);
    },
    build(start: number, hours: number, site: PresetSite): WeatherSeries {
      const P = SCENARIO_PARAMS;
      const lon = site.location.lon;
      const zs = site.sourceElevation;
      const tc = def.change ? lmstMidnight(start, lon) + def.change.lmst * H : NaN;
      const from = start - P.presetSpinupHours * H;
      const to = start + Math.max(1, hours) * H + H;
      const out: WeatherHour[] = [];
      for (const t of stampTimes(from, to, tc)) {
        const s = presetStateAt(def, t, lon, tc);
        const T = s.temperature;
        const td = Math.min(s.dewPoint, T);
        out.push({
          time: t,
          temperature: T,
          relativeHumidity: rhFromTd(T, td),
          dewPoint: td,
          windSpeed10: s.windSpeed10,
          windDir10: s.windDir10,
          windGust10: s.gust,
          cloudCover: def.cloud,
          precipitation: 0,
          pressureLevels: presetUpperAir(def, zs, s.dayWind, s.windDir10),
        });
      }
      const series: WeatherSeries = {
        kind: 'preset',
        source: `Preset: ${def.name} (designed weather, FireSim)`,
        location: { ...site.location },
        sourceElevation: zs,
        timezone: site.timezone ?? P.timezone,
        hours: out,
        droughtFactor: def.df,
        kbdi: def.kbdi,
        rainLast20: new Array<number>(20).fill(0),
        upperAirSource: 'preset',
      };
      if (site.annualRainfall !== undefined) series.annualRainfall = site.annualRainfall;
      if (def.nightTemplate) series.nightTemplate = { ...def.nightTemplate };
      return series;
    },
  };
}

/** The four presets by id (spec §11.3 table). */
export const WEATHER_PRESETS: Readonly<Record<PresetId, WeatherPreset>> = Object.freeze(
  Object.fromEntries(DEFS.map((d) => [d.id, makePreset(d)])) as Record<PresetId, WeatherPreset>,
);

/** Preset ids in display order. */
export const PRESET_IDS: readonly PresetId[] = DEFS.map((d) => d.id);

export const isPresetId = (id: string): id is PresetId => Object.prototype.hasOwnProperty.call(WEATHER_PRESETS, id);
