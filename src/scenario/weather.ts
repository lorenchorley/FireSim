/**
 * The normative weather interpolation `weatherAt(series, t)` (spec §11.2, D48) and series utilities.
 *
 * - Instantaneous fields (T, RH, T_d, cloud, BLH, pressure, CAPE, VPD, profile and level values) interpolate
 *   linearly between stamps; winds as u/v vectors (speed = |mean vector|), also for the profile and the levels.
 * - Precipitation is piecewise-constant over the preceding hour: for t in (stamp − 1 h, stamp] the value is the
 *   stamp's hourly amount (mm in that hour, i.e. the rate in mm/h). A stamp closer than 1 h to the previous one
 *   holds the rain since that stamp (rate = amount / interval), so stamp sums stay exact.
 * - Radiation: the clearness k_t (stamped at hour − 30 min by the parser) interpolates linearly between its
 *   mid-hour stamps and `ghi(t) = k_t(t)·GHI_clear(t)` ({@link ghiAt}), which sim passes to
 *   `insolation(terrain, t, { ghi, cloudCover })`. Hourly-mean radiation fields are returned as the stamp values.
 * Before the first / after the last stamp the nearest stamp is held.
 */
import type { PressureLevelData, WeatherHour, WeatherSeries, WindAtHeight } from '../core/types';
import { dewPointC } from '../core/physics';
import { uvToWind, windToUV } from '../core/units';
import { clearSkyGhi } from './openMeteo';

const H = 3.6e6;

/** Index of the last stamp with time ≤ t (−1 before the first). Binary search. */
export function stampIndex(hours: readonly WeatherHour[], t: number): number {
  let lo = 0;
  let hi = hours.length - 1;
  if (hi < 0 || t < hours[0]!.time) return -1;
  if (t >= hours[hi]!.time) return hi;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (hours[m]!.time <= t) lo = m;
    else hi = m;
  }
  return lo;
}

const lin = (a: number | undefined, b: number | undefined, f: number): number | undefined =>
  a === undefined || !Number.isFinite(a) ? b : b === undefined || !Number.isFinite(b) ? a : a + (b - a) * f;

function windMix(sa: number, da: number, sb: number, db: number, f: number): [number, number] {
  const [ua, va] = windToUV(sa, da);
  const [ub, vb] = windToUV(sb, db);
  const [s, d] = uvToWind(ua + (ub - ua) * f, va + (vb - va) * f);
  return s < 1e-9 ? [0, f < 0.5 ? da : db] : [s, d];
}

function profileMix(a: WindAtHeight[] | undefined, b: WindAtHeight[] | undefined, f: number): WindAtHeight[] | undefined {
  if (!a || !b) return f < 0.5 ? (a ?? b) : (b ?? a);
  const out: WindAtHeight[] = [];
  for (const pa of a) {
    const pb = b.find((q) => q.heightAGL === pa.heightAGL);
    if (!pb) continue;
    const [s, d] = windMix(pa.speed, pa.dir, pb.speed, pb.dir, f);
    out.push({ heightAGL: pa.heightAGL, speed: s, dir: d });
  }
  return out.length ? out : undefined;
}

function levelsMix(a: PressureLevelData[] | undefined, b: PressureLevelData[] | undefined, f: number): PressureLevelData[] | undefined {
  if (!a || !b) return f < 0.5 ? (a ?? b) : (b ?? a);
  const out: PressureLevelData[] = [];
  for (const la of a) {
    const lb = b.find((q) => q.hPa === la.hPa);
    if (!lb) continue;
    const [s, d] = windMix(la.windSpeed, la.windDir, lb.windSpeed, lb.windDir, f);
    const T = la.temperature + (lb.temperature - la.temperature) * f;
    const rh = la.relativeHumidity + (lb.relativeHumidity - la.relativeHumidity) * f;
    const tdA = la.dewPoint ?? dewPointC(la.temperature, la.relativeHumidity);
    const tdB = lb.dewPoint ?? dewPointC(lb.temperature, lb.relativeHumidity);
    out.push({ hPa: la.hPa, height: la.height + (lb.height - la.height) * f, temperature: T, relativeHumidity: rh, dewPoint: tdA + (tdB - tdA) * f, windSpeed: s, windDir: d });
  }
  return out.length ? out : undefined;
}

/**
 * Accumulation window (ms) of stamp j's precipitation: the preceding hour, or the interval since the previous stamp
 * when that is shorter (sub-hourly stamps, e.g. those inserted by {@link insertStamp}), so that summing the stamps
 * (rainBetween, the moisture rain memory, the daily aggregates) never counts an hour twice.
 */
function precipWindow(hs: readonly WeatherHour[], j: number): number {
  return j > 0 ? Math.min(H, Math.max(1, hs[j]!.time - hs[j - 1]!.time)) : H;
}

/**
 * Precipitation rate (mm/h) at t: piecewise-constant over each stamp's accumulation window (the preceding hour for
 * hourly data, so the value is the stamp's hourly amount).
 */
function precipAt(hs: readonly WeatherHour[], i: number, t: number): number {
  // The first stamp at or after t.
  const j = i >= 0 && hs[i]!.time === t ? i : i + 1;
  const h = hs[j];
  if (!h || h.precipitation === undefined) return 0;
  const win = precipWindow(hs, j);
  return h.time - t < win ? (h.precipitation * H) / win : 0;
}

/** Clearness k_t at t from the mid-hour stamps (hour.time − 30 min); undefined when the series has none. */
export function clearnessAt(series: WeatherSeries, t: number): number | undefined {
  const hs = series.hours;
  const tm = t + 1.8e6;
  const i = stampIndex(hs, tm);
  const pick = (j: number): number | undefined => {
    const v = hs[j]?.clearness;
    return v !== undefined && Number.isFinite(v) ? v : undefined;
  };
  if (i < 0) return pick(0);
  const a = pick(i);
  const b = i + 1 < hs.length ? pick(i + 1) : undefined;
  if (a === undefined || b === undefined) return a ?? b;
  const f = (tm - hs[i]!.time) / (hs[i + 1]!.time - hs[i]!.time);
  return a + (b - a) * f;
}

/**
 * Global horizontal irradiance at t (W/m²): k_t(t)·GHI_clear(t) at the series location and source elevation, or
 * undefined when the series has no radiation (presets, manual: insolation uses clear sky × cloud).
 */
export function ghiAt(series: WeatherSeries, t: number): number | undefined {
  const k = clearnessAt(series, t);
  if (k === undefined) return undefined;
  return k * clearSkyGhi(t, series.location.lat, series.location.lon, series.sourceElevation ?? 0);
}

/** Interpolated weather at t (unix ms) (spec §11.2). Always returns a fresh object. */
export function weatherAt(series: WeatherSeries, t: number): WeatherHour {
  const hs = series.hours;
  if (hs.length === 0) throw new Error('weatherAt: empty weather series');
  const i = stampIndex(hs, t);
  let a: WeatherHour;
  let b: WeatherHour;
  let f: number;
  if (i < 0) {
    a = b = hs[0]!;
    f = 0;
  } else if (i >= hs.length - 1) {
    a = b = hs[hs.length - 1]!;
    f = 0;
  } else {
    a = hs[i]!;
    b = hs[i + 1]!;
    f = (t - a.time) / (b.time - a.time);
  }
  const [ws, wd] = windMix(a.windSpeed10, a.windDir10, b.windSpeed10, b.windDir10, f);
  const tC = a.temperature + (b.temperature - a.temperature) * f;
  const rh = a.relativeHumidity + (b.relativeHumidity - a.relativeHumidity) * f;
  const tdA = a.dewPoint ?? dewPointC(a.temperature, a.relativeHumidity);
  const tdB = b.dewPoint ?? dewPointC(b.temperature, b.relativeHumidity);
  const out: WeatherHour = { time: t, temperature: tC, relativeHumidity: rh, dewPoint: tdA + (tdB - tdA) * f, windSpeed10: ws, windDir10: wd };
  const set = (k: keyof WeatherHour, v: number | undefined): void => {
    if (v !== undefined) (out as unknown as Record<string, number>)[k] = v;
  };
  set('windGust10', lin(a.windGust10, b.windGust10, f));
  set('cloudCover', lin(a.cloudCover, b.cloudCover, f));
  set('boundaryLayerHeight', lin(a.boundaryLayerHeight, b.boundaryLayerHeight, f));
  set('cape', lin(a.cape, b.cape, f));
  set('surfacePressure', lin(a.surfacePressure, b.surfacePressure, f));
  set('vpd', lin(a.vpd, b.vpd, f));
  // Hourly means of the hour containing t (the stamp ending it).
  const hm = f > 0 ? b : a;
  set('shortwaveRadiation', hm.shortwaveRadiation);
  set('directRadiation', hm.directRadiation);
  set('diffuseRadiation', hm.diffuseRadiation);
  set('clearness', clearnessAt(series, t));
  out.precipitation = precipAt(hs, i, t);
  const prof = profileMix(a.windProfile, b.windProfile, f);
  if (prof) out.windProfile = prof;
  const lv = levelsMix(a.pressureLevels, b.pressureLevels, f);
  if (lv) out.pressureLevels = lv;
  return out;
}

/**
 * A new stamp at t for insertion into `series` (e.g. the belt-kit offset shape, §11.5) that keeps the series'
 * semantics: instantaneous fields from {@link weatherAt}; hourly-mean radiation of the hour containing t; the clearness
 * of t − 30 min (the parser's mid-hour stamping, so {@link clearnessAt} is unchanged); and the precipitation of the
 * stamp that follows t split in time, so accumulated rain is unchanged. Returns the stamp and, when a following stamp
 * shares its accumulation window, that stamp's reduced precipitation (the caller applies it after inserting).
 */
export function insertStamp(series: WeatherSeries, t: number): { hour: WeatherHour; nextIndex: number; nextPrecipitation?: number } {
  const hs = series.hours;
  const h = weatherAt(series, t);
  const k = clearnessAt(series, t - 1.8e6);
  if (k !== undefined) h.clearness = k;
  else delete h.clearness;
  const i = stampIndex(hs, t);
  const j = i + 1; // the stamp after t (t is not an existing stamp)
  const next = hs[j];
  delete h.precipitation;
  if (next && next.precipitation !== undefined) {
    const winStart = next.time - precipWindow(hs, j);
    const share = t > winStart ? (t - winStart) / (next.time - winStart) : 0;
    h.precipitation = next.precipitation * share;
    return { hour: h, nextIndex: j, nextPrecipitation: next.precipitation - h.precipitation };
  }
  if (!next && i >= 0 && hs[i]!.precipitation !== undefined) h.precipitation = 0;
  return { hour: h, nextIndex: j };
}

/** First and last stamp times of a series (NaN when empty). */
export function seriesSpan(series: WeatherSeries): { start: number; end: number } {
  const hs = series.hours;
  return hs.length ? { start: hs[0]!.time, end: hs[hs.length - 1]!.time } : { start: NaN, end: NaN };
}

/** True when the series has stamps covering [from, to]. */
export const seriesCovers = (series: WeatherSeries, from: number, to: number): boolean => {
  const { start, end } = seriesSpan(series);
  return start <= from && end >= to;
};

/** Keep only stamps inside [from, to] plus one stamp on each side (so interpolation at the ends stays exact). */
export function trimSeries(series: WeatherSeries, from: number, to: number): WeatherSeries {
  const hs = series.hours;
  let a = 0;
  while (a + 1 < hs.length && hs[a + 1]!.time <= from) a++;
  let b = hs.length - 1;
  while (b - 1 >= 0 && hs[b - 1]!.time >= to) b--;
  return { ...series, hours: hs.slice(a, b + 1) };
}

/** Sum of precipitation (mm) in (from, to] from the stamps (each holds the rain of its accumulation window). */
export function rainBetween(series: WeatherSeries, from: number, to: number): number {
  let s = 0;
  for (const h of series.hours) if (h.time > from && h.time <= to) s += h.precipitation ?? 0;
  return s;
}
