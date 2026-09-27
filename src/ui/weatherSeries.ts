/**
 * Weather-series helpers for the UI: interpolation for the Weather timeline / weather chip, and builders that turn
 * manual and belt-weather-kit entries into a {@link WeatherSeries} for `WeatherMode { kind: 'manual' }`.
 * Pure functions, unit-tested.
 */
import type { LatLon, WeatherHour, WeatherSeries, WeatherSourceKind } from '../core/types';
import { kmhToMs, uvToWind, windToUV } from '../core/units';
import { dewPoint } from './weatherCalc';
import { DEFAULT_TZ } from './format';

/** Linear interpolation of a series at a time (wind interpolated as vectors); clamped at the ends. */
export function weatherAt(series: WeatherSeries, time: number): WeatherHour {
  const hs = series.hours;
  if (hs.length === 0) throw new Error('weatherAt: empty series');
  if (time <= hs[0]!.time) return hs[0]!;
  if (time >= hs[hs.length - 1]!.time) return hs[hs.length - 1]!;
  let lo = 0;
  let hi = hs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (hs[mid]!.time <= time) lo = mid;
    else hi = mid;
  }
  const a = hs[lo]!;
  const b = hs[hi]!;
  const t = (time - a.time) / (b.time - a.time);
  const L = (x: number, y: number): number => x + (y - x) * t;
  const [ua, va] = windToUV(a.windSpeed10, a.windDir10);
  const [ub, vb] = windToUV(b.windSpeed10, b.windDir10);
  const [speedVec, dir] = uvToWind(L(ua, ub), L(va, vb));
  // Vector averaging shrinks the speed during a direction change; interpolate the magnitude separately.
  const speed = L(a.windSpeed10, b.windSpeed10);
  const out: WeatherHour = {
    time,
    temperature: L(a.temperature, b.temperature),
    relativeHumidity: L(a.relativeHumidity, b.relativeHumidity),
    windSpeed10: speed,
    windDir10: speedVec > 1e-6 ? dir : a.windDir10,
  };
  if (a.windGust10 !== undefined && b.windGust10 !== undefined) out.windGust10 = L(a.windGust10, b.windGust10);
  if (a.cloudCover !== undefined && b.cloudCover !== undefined) out.cloudCover = L(a.cloudCover, b.cloudCover);
  if (a.dewPoint !== undefined && b.dewPoint !== undefined) out.dewPoint = L(a.dewPoint, b.dewPoint);
  return out;
}

export interface ManualWeatherInput {
  location: LatLon;
  /** Unix ms of the reading / scenario start. */
  start: number;
  /** Hours to cover after `start` (the series also gets 1 h before for spin-up). */
  hours: number;
  temperature: number;
  relativeHumidity: number;
  windKmh: number;
  /** Direction FROM (deg). */
  windDir: number;
  droughtFactor?: number;
  /** Optional wind change (e.g. a forecast south-westerly change) at an absolute time. */
  change?: { time: number; windKmh: number; windDir: number; temperature?: number; relativeHumidity?: number } | null;
  kind?: Extract<WeatherSourceKind, 'manual' | 'belt-kit'>;
  source?: string;
  timezone?: string;
}

/**
 * Build an hourly series from manual / belt-kit values. Conditions stay as entered (the user knows the local
 * weather; the simulation adds its own diurnal and terrain effects). A wind change ramps over 30 minutes at
 * `change.time` (an extra record is inserted on each side so the change is sharp in the timeline).
 */
export function manualSeries(inp: ManualWeatherInput): WeatherSeries {
  const kind = inp.kind ?? 'manual';
  const H = 3600_000;
  const start = Math.floor(inp.start / 60_000) * 60_000;
  const end = start + Math.max(1, Math.ceil(inp.hours)) * H;
  const before = {
    temperature: inp.temperature,
    relativeHumidity: inp.relativeHumidity,
    windSpeed10: kmhToMs(inp.windKmh),
    windDir10: inp.windDir,
  };
  const ch = inp.change ?? null;
  const after = ch
    ? {
        temperature: ch.temperature ?? inp.temperature,
        relativeHumidity: ch.relativeHumidity ?? inp.relativeHumidity,
        windSpeed10: kmhToMs(ch.windKmh),
        windDir10: ch.windDir,
      }
    : before;
  const times = new Set<number>();
  for (let t = start - H; t <= end + H; t += H) times.add(t);
  if (ch && ch.time > start - H && ch.time < end + H) {
    times.add(ch.time - 15 * 60_000);
    times.add(ch.time + 15 * 60_000);
  }
  const hours: WeatherHour[] = [...times]
    .sort((a, b) => a - b)
    .map((t) => {
      const v = !ch || t <= ch.time - 15 * 60_000 ? before : after;
      return { time: t, ...v, dewPoint: dewPoint(v.temperature, v.relativeHumidity) };
    });
  const s: WeatherSeries = {
    kind,
    source: inp.source ?? (kind === 'belt-kit' ? 'Belt weather kit reading' : 'Manual entry'),
    location: { ...inp.location },
    timezone: inp.timezone ?? DEFAULT_TZ,
    hours,
  };
  if (inp.droughtFactor !== undefined) s.droughtFactor = inp.droughtFactor;
  return s;
}

/** Extract evenly spaced samples of a series for charting between two times. */
export function sampleSeries(series: WeatherSeries, t0: number, t1: number, n: number): WeatherHour[] {
  const out: WeatherHour[] = [];
  if (series.hours.length === 0 || n < 2) return out;
  for (let i = 0; i < n; i++) out.push(weatherAt(series, t0 + ((t1 - t0) * i) / (n - 1)));
  return out;
}
