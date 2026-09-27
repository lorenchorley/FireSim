/**
 * Open-Meteo requests and parsing (spec §11.1–§11.2, D34, D48; endpoints verified live in doc 08b §5–7).
 *
 * - URL builders for the forecast API (best_match surface + a profile model with pressure levels), the
 *   historical-forecast API (ecmwf_ifs, 2016+), the ERA5 archive (hourly before 2016, daily history for KBDI) and the
 *   pressure-level fallbacks (ecmwf_ifs025, then gfs_seamless). Never `bom_access_global` (all-null live).
 * - {@link parseOpenMeteoHourly}: response → {@link WeatherSeries}. Times from `utc_offset_seconds`; units read from
 *   `hourly_units` (km/h, kn, mph → m/s; °F → °C; 'undefined' = absent); all-null variables dropped; isolated nulls
 *   interpolated across gaps ≤ 3 h; required fields checked; clearness k_t stamped at the hour mid-point.
 * - {@link parseOpenMeteoDaily}, {@link dailyFromHourly}: daily rain/Tmax/Tmin (local civil days).
 */
import type { DailyWeather, LatLon, PressureLevelData, WeatherHour, WeatherSeries, WeatherSourceKind, WindAtHeight } from '../core/types';
import { dewPointC } from '../core/physics';
import { angleDiffDeg, clamp, wrapDeg } from '../core/units';
import { clearSkyIrradiance, cloudAttenuation, solarPosition } from '../terrain';
import { SCENARIO_PARAMS } from './params';
import { civilDate } from './time';

// ─────────────────────────────────────────────────────────────────────────────
// Variables and URLs
// ─────────────────────────────────────────────────────────────────────────────

/** The 22 surface variables of the verified forecast request (doc 08b §5, fixtures). */
export const OM_SURFACE_VARS = [
  'temperature_2m',
  'relative_humidity_2m',
  'dew_point_2m',
  'precipitation',
  'cloud_cover',
  'shortwave_radiation',
  'direct_radiation',
  'diffuse_radiation',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'wind_speed_80m',
  'wind_direction_80m',
  'wind_speed_120m',
  'wind_direction_120m',
  'wind_speed_180m',
  'wind_direction_180m',
  'boundary_layer_height',
  'cape',
  'vapour_pressure_deficit',
  'soil_moisture_0_to_1cm',
  'surface_pressure',
] as const;

export const OM_LEVELS = [925, 850, 700, 500] as const;
const LEVEL_FIELDS = ['temperature', 'relative_humidity', 'wind_speed', 'wind_direction', 'geopotential_height'] as const;
/** The 20 pressure-level variables (5 fields × 925/850/700/500 hPa). */
export const OM_LEVEL_VARS: string[] = OM_LEVELS.flatMap((p) => LEVEL_FIELDS.map((f) => `${f}_${p}hPa`));
/** The 42 hourly variables of the forecast / historical-forecast requests. */
export const OM_HOURLY_VARS: string[] = [...OM_SURFACE_VARS, ...OM_LEVEL_VARS];
/** ERA5 archive hourly variables: no 80/120/180 m wind and no pressure levels; 100 m wind instead (doc 08b §6). */
export const OM_ERA5_VARS = [
  'temperature_2m',
  'relative_humidity_2m',
  'dew_point_2m',
  'precipitation',
  'cloud_cover',
  'shortwave_radiation',
  'direct_radiation',
  'diffuse_radiation',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'wind_speed_100m',
  'wind_direction_100m',
  'boundary_layer_height',
  'cape',
  'vapour_pressure_deficit',
  'soil_moisture_0_to_7cm',
  'surface_pressure',
] as const;
export const OM_DAILY_VARS = ['precipitation_sum', 'temperature_2m_max', 'temperature_2m_min'] as const;

/** Surface models in fallback order (D34) and the pressure-level fallbacks. */
export const SURFACE_MODELS = ['best_match', 'ecmwf_ifs'] as const;
export const LEVEL_MODELS = ['ecmwf_ifs025', 'gfs_seamless'] as const;

export const OM_FORECAST_BASE = 'https://api.open-meteo.com/v1/forecast';
export const OM_HISTORICAL_BASE = 'https://historical-forecast-api.open-meteo.com/v1/forecast';
export const OM_ARCHIVE_BASE = 'https://archive-api.open-meteo.com/v1/archive';

const coord = (v: number): string => v.toFixed(3);
const locQuery = (loc: LatLon): string => `latitude=${coord(loc.lat)}&longitude=${coord(loc.lon)}`;

export interface ForecastUrlOptions {
  model?: string;
  pastDays?: number;
  forecastDays?: number;
  vars?: readonly string[];
}

/** Forecast API (now / forecast / recent past): `timezone=UTC`, `wind_speed_unit=ms` (§11.1). */
export function forecastUrl(loc: LatLon, o: ForecastUrlOptions = {}): string {
  const P = SCENARIO_PARAMS;
  const past = clamp(Math.round(o.pastDays ?? P.forecastPastDays), 0, P.maxPastDays);
  const fc = clamp(Math.round(o.forecastDays ?? P.forecastDays), 1, P.maxForecastDays);
  return (
    `${OM_FORECAST_BASE}?${locQuery(loc)}&models=${o.model ?? 'best_match'}&past_days=${past}&forecast_days=${fc}` +
    `&timezone=UTC&wind_speed_unit=ms&hourly=${(o.vars ?? OM_HOURLY_VARS).join(',')}`
  );
}

/** Historical-forecast API (2016 ≤ t0 < now − 92 d), ecmwf_ifs by default (§11.1). Dates are UTC 'yyyy-mm-dd'. */
export function historicalForecastUrl(loc: LatLon, startDate: string, endDate: string, model = 'ecmwf_ifs', vars: readonly string[] = OM_HOURLY_VARS): string {
  return (
    `${OM_HISTORICAL_BASE}?${locQuery(loc)}&models=${model}&start_date=${startDate}&end_date=${endDate}` +
    `&timezone=UTC&wind_speed_unit=ms&hourly=${vars.join(',')}`
  );
}

/** ERA5 archive, hourly (t0 < 2016) (§11.1). */
export function archiveHourlyUrl(loc: LatLon, startDate: string, endDate: string, vars: readonly string[] = OM_ERA5_VARS): string {
  return (
    `${OM_ARCHIVE_BASE}?${locQuery(loc)}&models=era5&start_date=${startDate}&end_date=${endDate}` +
    `&timezone=UTC&wind_speed_unit=ms&hourly=${vars.join(',')}`
  );
}

/** ERA5 archive, daily rain / Tmax / Tmin in local (Australia/Sydney) days (§11.1, doc 08b §6). */
export function archiveDailyUrl(loc: LatLon, startDate: string, endDate: string, vars: readonly string[] = OM_DAILY_VARS): string {
  return (
    `${OM_ARCHIVE_BASE}?${locQuery(loc)}&start_date=${startDate}&end_date=${endDate}` +
    `&daily=${vars.join(',')}&timezone=Australia%2FSydney&wind_speed_unit=ms`
  );
}

/** Pressure-level-only request for the level fallbacks (§11.1: ecmwf_ifs025 3-hourly, then gfs_seamless). */
export function levelFallbackUrl(loc: LatLon, model: string, o: { pastDays?: number; forecastDays?: number; startDate?: string; endDate?: string }): string {
  if (o.startDate && o.endDate) return historicalForecastUrl(loc, o.startDate, o.endDate, model, OM_LEVEL_VARS);
  return forecastUrl(loc, { model, pastDays: o.pastDays ?? SCENARIO_PARAMS.forecastPastDays, forecastDays: o.forecastDays ?? SCENARIO_PARAMS.forecastDays, vars: OM_LEVEL_VARS });
}

// ─────────────────────────────────────────────────────────────────────────────
// Response types
// ─────────────────────────────────────────────────────────────────────────────

export interface OpenMeteoResponse {
  latitude: number;
  longitude: number;
  elevation?: number;
  utc_offset_seconds?: number;
  timezone?: string;
  hourly_units?: Record<string, string>;
  hourly?: Record<string, (number | string | null)[]>;
  daily_units?: Record<string, string>;
  daily?: Record<string, (number | string | null)[]>;
  error?: boolean;
  reason?: string;
}

export interface ParseHourlyOptions {
  kind?: WeatherSourceKind;
  /** Provenance, e.g. "Open-Meteo best_match forecast". */
  source?: string;
  /** Display time zone (default Australia/Sydney). */
  timezone?: string;
}

export interface ParseHourlyResult {
  series: WeatherSeries;
  /** Required variables (T, RH, 10 m wind speed/direction) that are absent or have a gap > 3 h. */
  missingRequired: string[];
  /** Number of complete pressure levels. */
  levels: number;
  /** Variables present in the response (after dropping all-null / 'undefined' ones). */
  present: string[];
}

export class WeatherParseError extends Error {
  override readonly name = 'WeatherParseError';
}

// ─────────────────────────────────────────────────────────────────────────────
// Parsing helpers
// ─────────────────────────────────────────────────────────────────────────────

const H_MS = 3.6e6;

/** Epoch ms of an Open-Meteo time value: ISO local time minus the response's single utc_offset_seconds, or unixtime (s). */
export function parseOmTime(v: number | string | null, offsetS: number): number {
  if (typeof v === 'number') return v * 1000;
  if (typeof v !== 'string') return NaN;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(v);
  if (!m) return NaN;
  const t = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, m[6] ? +m[6] : 0);
  return t - offsetS * 1000;
}

/** Converter to SI (°C, m/s, %, W/m², mm, m, hPa, kPa) for an Open-Meteo unit; null for an absent variable. */
function converter(unit: string | undefined): ((x: number) => number) | null {
  if (unit === undefined) return (x) => x;
  const u = unit.trim();
  if (u === 'undefined' || u === '') return null;
  switch (u) {
    case 'km/h':
      return (x) => x / 3.6;
    case 'kn':
    case 'knots':
      return (x) => x * 0.514444;
    case 'mph':
    case 'mp/h':
      return (x) => x * 0.44704;
    case '°F':
      return (x) => ((x - 32) * 5) / 9;
    case 'inch':
      return (x) => x * 25.4;
    case 'ft':
      return (x) => x * 0.3048;
    case 'Pa':
      return (x) => x / 100;
    default:
      return (x) => x;
  }
}

/**
 * Numeric column with nulls as NaN, converted to SI, or null when the variable is absent (missing, unit 'undefined',
 * or null for every hour).
 */
function column(json: OpenMeteoResponse, name: string, n: number): Float64Array | null {
  const raw = json.hourly?.[name];
  if (!Array.isArray(raw)) return null;
  const conv = converter(json.hourly_units?.[name]);
  if (!conv) return null;
  const out = new Float64Array(n);
  let any = false;
  for (let i = 0; i < n; i++) {
    const v = raw[i];
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[i] = conv(v);
      any = true;
    } else out[i] = NaN;
  }
  return any ? out : null;
}

/**
 * Fill runs of NaN whose duration (last missing − first missing + one step) is ≤ maxGapMs and that have valid values
 * on both sides, by linear interpolation in time (angles by the shortest arc). Returns the longest unfilled interior
 * run (ms) and whether the ends are missing.
 */
export function fillGaps(times: ArrayLike<number>, v: Float64Array, maxGapMs: number, angular = false): { longestGapMs: number; leading: number; trailing: number } {
  const n = v.length;
  let longest = 0;
  let first = 0;
  while (first < n && !(v[first] === v[first])) first++;
  let last = n - 1;
  while (last >= 0 && !(v[last] === v[last])) last--;
  if (first >= n) return { longestGapMs: Infinity, leading: n, trailing: n };
  let i = first;
  while (i < last) {
    if (v[i + 1] === v[i + 1]) {
      i++;
      continue;
    }
    // Missing run (i+1 .. j-1), valid at i and j.
    let j = i + 1;
    while (j <= last && !(v[j] === v[j])) j++;
    const t0 = times[i]!;
    const t1 = times[j]!;
    const step = (t1 - t0) / (j - i);
    const dur = times[j - 1]! - times[i + 1]! + step;
    if (dur <= maxGapMs + 1) {
      const a = v[i]!;
      const b = v[j]!;
      const d = angular ? angleDiffDeg(b, a) : b - a;
      for (let k = i + 1; k < j; k++) {
        const f = (times[k]! - t0) / (t1 - t0);
        v[k] = angular ? wrapDeg(a + d * f) : a + d * f;
      }
    } else longest = Math.max(longest, dur);
    i = j;
  }
  return { longestGapMs: longest, leading: first, trailing: n - 1 - last };
}

const REQUIRED = ['temperature_2m', 'relative_humidity_2m', 'wind_speed_10m', 'wind_direction_10m'] as const;

/** Clear-sky GHI (W/m²) at an instant for a site (clearness reference, §11.2). */
export function clearSkyGhi(ms: number, lat: number, lon: number, altitude: number): number {
  const sun = solarPosition(ms, lat, lon);
  if (!(sun.elevation > 0)) return 0;
  return clearSkyIrradiance(sun.elevation, altitude, SCENARIO_PARAMS.linkeTurbidity, sun.distanceAU).ghi;
}

/**
 * Clearness k_t of each hour (§11.2, D48): Open-Meteo radiation is the mean of the preceding hour, so
 * k_t = clamp(GHI_hour / GHI_clear(t − 30 min), 0, 1.2). Where the clear-sky GHI is below 20 W/m² (night, twilight)
 * k_t is copied from the nearest daylight hour, or from cloudAttenuation(cloud) if the series has none.
 */
export function stampClearness(hours: WeatherHour[], lat: number, lon: number, altitude: number): void {
  const P = SCENARIO_PARAMS;
  const n = hours.length;
  const kt = new Float64Array(n).fill(NaN);
  let anyGhi = false;
  for (let i = 0; i < n; i++) {
    const h = hours[i]!;
    if (h.shortwaveRadiation === undefined || !Number.isFinite(h.shortwaveRadiation)) continue;
    anyGhi = true;
    const clear = clearSkyGhi(h.time - 1.8e6, lat, lon, altitude);
    if (clear >= P.clearSkyMinGhi) kt[i] = clamp(h.shortwaveRadiation / clear, 0, P.clearnessMax);
  }
  if (!anyGhi) return;
  // Nearest daylight value (by stamp index distance, ties → earlier) for the night hours.
  const prev = new Int32Array(n);
  let p = -1;
  for (let i = 0; i < n; i++) {
    if (kt[i] === kt[i]) p = i;
    prev[i] = p;
  }
  let nx = -1;
  for (let i = n - 1; i >= 0; i--) {
    if (kt[i] === kt[i]) nx = i;
    let v = kt[i]!;
    if (!(v === v)) {
      const a = prev[i]!;
      const b = nx;
      const ta = a >= 0 ? hours[i]!.time - hours[a]!.time : Infinity;
      const tb = b >= 0 ? hours[b]!.time - hours[i]!.time : Infinity;
      if (ta === Infinity && tb === Infinity) v = cloudAttenuation(hours[i]!.cloudCover ?? 0);
      else v = ta <= tb ? kt[a]! : kt[b]!;
    }
    hours[i]!.clearness = v;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hourly parser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse an Open-Meteo hourly response into a {@link WeatherSeries} (spec §11.2). Hours outside the span where all
 * required variables are valid are trimmed; interior required gaps > 3 h are reported in `missingRequired` (the
 * caller then tries the next model). Throws {@link WeatherParseError} for a response without an hourly block.
 */
export function parseOpenMeteoHourly(json: unknown, opts: ParseHourlyOptions = {}): ParseHourlyResult {
  const r = json as OpenMeteoResponse | null;
  if (!r || typeof r !== 'object') throw new WeatherParseError('Open-Meteo: empty response');
  if (r.error) throw new WeatherParseError(`Open-Meteo error: ${r.reason ?? 'unknown'}`);
  const tRaw = r.hourly?.time;
  if (!Array.isArray(tRaw) || tRaw.length === 0) throw new WeatherParseError('Open-Meteo: response has no hourly data');
  const P = SCENARIO_PARAMS;
  const offset = Number(r.utc_offset_seconds ?? 0);
  const nAll = tRaw.length;
  const times = new Float64Array(nAll);
  for (let i = 0; i < nAll; i++) times[i] = parseOmTime(tRaw[i] ?? null, offset);

  const present: string[] = [];
  const cols = new Map<string, Float64Array>();
  for (const name of Object.keys(r.hourly ?? {})) {
    if (name === 'time') continue;
    const c = column(r, name, nAll);
    if (!c) continue;
    const angular = name.startsWith('wind_direction');
    fillGaps(times, c, P.maxGapHours * H_MS, angular);
    cols.set(name, c);
    present.push(name);
  }

  // Required variables: absent or with an interior gap > 3 h → missing; the valid span is where all are valid.
  const missingRequired: string[] = [];
  let lo = 0;
  let hi = nAll - 1;
  for (const name of REQUIRED) {
    const c = cols.get(name);
    if (!c) {
      missingRequired.push(name);
      continue;
    }
    let a = 0;
    while (a < nAll && !(c[a] === c[a])) a++;
    let b = nAll - 1;
    while (b >= 0 && !(c[b] === c[b])) b--;
    lo = Math.max(lo, a);
    hi = Math.min(hi, b);
    for (let i = a; i <= b; i++) {
      if (!(c[i] === c[i])) {
        missingRequired.push(name);
        break;
      }
    }
  }
  if (missingRequired.length || hi < lo) {
    return {
      series: emptySeries(r, opts),
      missingRequired: missingRequired.length ? missingRequired : [...REQUIRED],
      levels: 0,
      present,
    };
  }

  const get = (name: string, i: number): number | undefined => {
    const c = cols.get(name);
    if (!c) return undefined;
    const v = c[i]!;
    return v === v ? v : undefined;
  };

  // Complete pressure levels (all five fields present in the response).
  const levelHpa: number[] = [];
  const levelRe = /^geopotential_height_(\d+)hPa$/;
  for (const name of cols.keys()) {
    const m = levelRe.exec(name);
    if (!m) continue;
    const p = Number(m[1]);
    if (LEVEL_FIELDS.every((f) => cols.has(`${f}_${p}hPa`))) levelHpa.push(p);
  }
  levelHpa.sort((a, b) => b - a);
  const useLevels = levelHpa.length >= P.minPressureLevels;

  // Wind profile heights present (speed and direction).
  const heights: number[] = [];
  const windRe = /^wind_speed_(\d+)m$/;
  for (const name of cols.keys()) {
    const m = windRe.exec(name);
    if (!m) continue;
    const z = Number(m[1]);
    if (z !== 10 && cols.has(`wind_direction_${z}m`)) heights.push(z);
  }
  heights.sort((a, b) => a - b);

  const hours: WeatherHour[] = [];
  for (let i = lo; i <= hi; i++) {
    const t = times[i]!;
    if (!Number.isFinite(t)) continue;
    const tC = get('temperature_2m', i)!;
    const rh = clamp(get('relative_humidity_2m', i)!, 0, 100);
    const h: WeatherHour = {
      time: t,
      temperature: tC,
      relativeHumidity: rh,
      dewPoint: get('dew_point_2m', i) ?? dewPointC(tC, rh),
      windSpeed10: Math.max(0, get('wind_speed_10m', i)!),
      windDir10: wrapDeg(get('wind_direction_10m', i)!),
    };
    const gust = get('wind_gusts_10m', i);
    if (gust !== undefined) h.windGust10 = Math.max(gust, h.windSpeed10);
    if (heights.length) {
      const prof: WindAtHeight[] = [];
      for (const z of heights) {
        const s = get(`wind_speed_${z}m`, i);
        const d = get(`wind_direction_${z}m`, i);
        if (s !== undefined && d !== undefined) prof.push({ heightAGL: z, speed: Math.max(0, s), dir: wrapDeg(d) });
      }
      if (prof.length) h.windProfile = prof;
    }
    if (useLevels) {
      const lv: PressureLevelData[] = [];
      for (const p of levelHpa) {
        const T = get(`temperature_${p}hPa`, i);
        const RH = get(`relative_humidity_${p}hPa`, i);
        const Z = get(`geopotential_height_${p}hPa`, i);
        const S = get(`wind_speed_${p}hPa`, i);
        const D = get(`wind_direction_${p}hPa`, i);
        if (T === undefined || RH === undefined || Z === undefined || S === undefined || D === undefined) continue;
        const rhc = clamp(RH, 0.1, 100);
        lv.push({ hPa: p, height: Z, temperature: T, relativeHumidity: rhc, dewPoint: dewPointC(T, rhc), windSpeed: Math.max(0, S), windDir: wrapDeg(D) });
      }
      if (lv.length) h.pressureLevels = lv;
    }
    const opt = (key: keyof WeatherHour, name: string, lo2 = -Infinity, hi2 = Infinity): void => {
      const v = get(name, i);
      if (v !== undefined) (h as unknown as Record<string, number>)[key] = clamp(v, lo2, hi2);
    };
    opt('cloudCover', 'cloud_cover', 0, 100);
    opt('shortwaveRadiation', 'shortwave_radiation', 0);
    opt('directRadiation', 'direct_radiation', 0);
    opt('diffuseRadiation', 'diffuse_radiation', 0);
    opt('precipitation', 'precipitation', 0);
    opt('boundaryLayerHeight', 'boundary_layer_height', 0);
    opt('cape', 'cape', 0);
    opt('vpd', 'vapour_pressure_deficit', 0);
    opt('surfacePressure', 'surface_pressure', 0);
    hours.push(h);
  }
  const series = emptySeries(r, opts);
  series.hours = hours;
  series.upperAirSource = useLevels ? 'model' : 'synthetic';
  stampClearness(hours, r.latitude, r.longitude, series.sourceElevation ?? 0);
  return { series, missingRequired, levels: useLevels ? levelHpa.length : 0, present };
}

function emptySeries(r: OpenMeteoResponse, opts: ParseHourlyOptions): WeatherSeries {
  const s: WeatherSeries = {
    kind: opts.kind ?? 'forecast',
    source: opts.source ?? 'Open-Meteo',
    location: { lat: Number(r.latitude), lon: Number(r.longitude) },
    timezone: opts.timezone ?? SCENARIO_PARAMS.timezone,
    hours: [],
  };
  if (r.elevation !== undefined && Number.isFinite(r.elevation)) s.sourceElevation = Number(r.elevation);
  return s;
}

/**
 * Copy the pressure levels of `levels` (e.g. an ecmwf_ifs025 level-only response) onto the hours of `series`
 * (linear in time between level stamps, matched by hPa; hours outside the level series are left without levels).
 * Returns the number of hours that received levels; sets `upperAirSource = 'model'` when any did.
 */
export function mergePressureLevels(series: WeatherSeries, levels: WeatherSeries): number {
  const src = levels.hours.filter((h) => h.pressureLevels && h.pressureLevels.length >= SCENARIO_PARAMS.minPressureLevels);
  if (src.length === 0) return 0;
  let j = 0;
  let count = 0;
  for (const h of series.hours) {
    while (j + 1 < src.length && src[j + 1]!.time <= h.time) j++;
    const a = src[j]!;
    const b = src[Math.min(j + 1, src.length - 1)]!;
    if (h.time < a.time - 1.5 * H_MS || h.time > b.time + 1.5 * H_MS) continue;
    const f = b.time > a.time ? clamp((h.time - a.time) / (b.time - a.time), 0, 1) : 0;
    const out: PressureLevelData[] = [];
    for (const la of a.pressureLevels!) {
      const lb = b.pressureLevels!.find((q) => q.hPa === la.hPa) ?? la;
      const L = (x: number, y: number): number => x + (y - x) * f;
      const rh = L(la.relativeHumidity, lb.relativeHumidity);
      const T = L(la.temperature, lb.temperature);
      out.push({
        hPa: la.hPa,
        height: L(la.height, lb.height),
        temperature: T,
        relativeHumidity: rh,
        dewPoint: dewPointC(T, rh),
        windSpeed: L(la.windSpeed, lb.windSpeed),
        windDir: wrapDeg(la.windDir + angleDiffDeg(lb.windDir, la.windDir) * f),
      });
    }
    h.pressureLevels = out;
    count++;
  }
  if (count > 0) series.upperAirSource = 'model';
  return count;
}

// ─────────────────────────────────────────────────────────────────────────────
// Daily
// ─────────────────────────────────────────────────────────────────────────────

/** Parse an Open-Meteo daily response (precipitation_sum, temperature_2m_max/min) into dated records; days with a null
 * rain or Tmax are dropped (the archive returns nulls for days after its last date). */
export function parseOpenMeteoDaily(json: unknown): DailyWeather[] {
  const r = json as OpenMeteoResponse | null;
  const d = r?.daily;
  const time = d?.time;
  if (!d || !Array.isArray(time)) return [];
  const rain = d['precipitation_sum'] ?? [];
  const tmax = d['temperature_2m_max'] ?? [];
  const tmin = d['temperature_2m_min'] ?? [];
  const cR = converter(r?.daily_units?.['precipitation_sum']) ?? ((x: number) => x);
  const cT = converter(r?.daily_units?.['temperature_2m_max']) ?? ((x: number) => x);
  const out: DailyWeather[] = [];
  for (let i = 0; i < time.length; i++) {
    const date = typeof time[i] === 'string' ? (time[i] as string).slice(0, 10) : typeof time[i] === 'number' ? new Date((time[i] as number) * 1000).toISOString().slice(0, 10) : '';
    const p = rain[i];
    const t = tmax[i];
    if (!date || typeof p !== 'number' || typeof t !== 'number') continue;
    const rec: DailyWeather = { date, rain: Math.max(0, cR(p)), tMax: cT(t) };
    const tn = tmin[i];
    if (typeof tn === 'number') rec.tMin = cT(tn);
    out.push(rec);
  }
  return out;
}

/**
 * Local-day aggregates of an hourly series (rain = Σ precipitation, Tmax / Tmin of temperature_2m), grouped by the
 * civil date of each stamp in `tz` (the Open-Meteo daily convention). Only complete days (≥ 20 stamps) are returned.
 */
export function dailyFromHourly(series: WeatherSeries, tz = SCENARIO_PARAMS.timezone, minStamps = 20): DailyWeather[] {
  const byDate = new Map<string, { rain: number; tMax: number; tMin: number; n: number }>();
  for (const h of series.hours) {
    const date = civilDate(h.time, tz);
    let e = byDate.get(date);
    if (!e) byDate.set(date, (e = { rain: 0, tMax: -Infinity, tMin: Infinity, n: 0 }));
    e.rain += h.precipitation ?? 0;
    if (h.temperature > e.tMax) e.tMax = h.temperature;
    if (h.temperature < e.tMin) e.tMin = h.temperature;
    e.n++;
  }
  const out: DailyWeather[] = [];
  for (const [date, e] of [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (e.n >= minStamps) out.push({ date, rain: Math.round(e.rain * 100) / 100, tMax: e.tMax, tMin: e.tMin });
  }
  return out;
}

/** Mean annual precipitation (mm) from a multi-year daily response; NaN when fewer than 300 days are present. */
export function annualRainfallFromDaily(daily: DailyWeather[]): number {
  if (daily.length < 300) return NaN;
  let s = 0;
  for (const d of daily) s += d.rain;
  return (s * 365.25) / daily.length;
}
