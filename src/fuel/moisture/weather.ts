/**
 * Weather-series helpers for the moisture spin-up (spec §5.6) and the stable-night spin-up (§5.2a).
 *
 * `seriesWeatherAt` is a local adapter of the normative `weatherAt(t)` of scenario/ (spec §11.2): instantaneous
 * fields interpolate linearly between stamps (wind as u/v vectors), precipitation is piecewise-constant over the
 * preceding hour (rate = P/1 h), the clearness k_t interpolates between its mid-hour stamps (time − 30 min).
 */
import type { WeatherHour, WeatherSeries } from '../../core/types';
import { dewPointC } from '../../core/physics';
import { uvToWind, windToUV } from '../../core/units';

/** Index of the last stamp with time ≤ t (−1 before the first). */
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

/** Interpolated weather at t (unix ms); held constant before the first and after the last stamp. */
export function seriesWeatherAt(series: WeatherSeries, t: number): WeatherHour {
  const hs = series.hours;
  if (hs.length === 0) throw new Error('seriesWeatherAt: empty weather series');
  const i = stampIndex(hs, t);
  if (i < 0) return { ...hs[0]!, time: t, precipitation: 0 };
  if (i >= hs.length - 1) return { ...hs[hs.length - 1]!, time: t, precipitation: t === hs[i]!.time ? hs[i]!.precipitation : 0 };
  const a = hs[i]!;
  const b = hs[i + 1]!;
  const f = (t - a.time) / (b.time - a.time);
  const [ua, va] = windToUV(a.windSpeed10, a.windDir10);
  const [ub, vb] = windToUV(b.windSpeed10, b.windDir10);
  const [ws, wd] = uvToWind(ua + (ub - ua) * f, va + (vb - va) * f);
  const tC = a.temperature + (b.temperature - a.temperature) * f;
  const rh = a.relativeHumidity + (b.relativeHumidity - a.relativeHumidity) * f;
  const tdA = a.dewPoint ?? dewPointC(a.temperature, a.relativeHumidity);
  const tdB = b.dewPoint ?? dewPointC(b.temperature, b.relativeHumidity);
  // Precipitation of the hour ending at the next stamp (piecewise constant over the preceding hour).
  const precip = f === 0 ? a.precipitation : b.precipitation;
  return {
    time: t,
    temperature: tC,
    relativeHumidity: rh,
    dewPoint: tdA + (tdB - tdA) * f,
    windSpeed10: ws,
    windDir10: wd,
    windGust10: lin(a.windGust10, b.windGust10, f),
    cloudCover: lin(a.cloudCover, b.cloudCover, f),
    shortwaveRadiation: lin(a.shortwaveRadiation, b.shortwaveRadiation, f),
    directRadiation: lin(a.directRadiation, b.directRadiation, f),
    diffuseRadiation: lin(a.diffuseRadiation, b.diffuseRadiation, f),
    clearness: clearnessAt(hs, t),
    precipitation: precip ?? 0,
    boundaryLayerHeight: lin(a.boundaryLayerHeight, b.boundaryLayerHeight, f),
    surfacePressure: lin(a.surfacePressure, b.surfacePressure, f),
  };
}

/** Clearness k_t at t from the mid-hour stamps (hour.time − 30 min); undefined when the series has none. */
export function clearnessAt(hs: readonly WeatherHour[], t: number): number | undefined {
  const tm = t + 1.8e6; // compare against stamp times shifted by −30 min
  const i = stampIndex(hs, tm);
  const pick = (j: number): number | undefined => {
    const v = hs[j]?.clearness;
    return v !== undefined && Number.isFinite(v) ? v : undefined;
  };
  if (i < 0) return pick(0);
  const a = pick(i);
  const b = pick(i + 1);
  if (a === undefined || b === undefined || i + 1 >= hs.length) return a ?? b;
  const f = (tm - hs[i]!.time) / (hs[i + 1]!.time - hs[i]!.time);
  return a + (b - a) * f;
}

/** Rain (mm) in the 24 h before t from the hourly stamps (each stamp's precipitation = its preceding hour). */
export function rainBefore(series: WeatherSeries, t: number, hours = 24): number {
  let s = 0;
  const t0 = t - hours * 3.6e6;
  for (const h of series.hours) if (h.time > t0 && h.time <= t) s += h.precipitation ?? 0;
  return s;
}
