/**
 * Stable-night (cold-pool) spin-up over a weather series (spec §5.2a, §12.2 init): Δθ = 0 at
 * max(seriesStart, t0 − 24 h), then `stableNight()` (core/physics) is integrated over the series to t0, so a 07:00
 * start inherits the night's cold pool. sim/ calls {@link spinUpStableNight}; the moisture spin-up re-integrates
 * the same state alongside its own 168 h window.
 */
import type { StableNightInput, StableNightState, WeatherSeries } from '../../core/types';
import { initialStableNight, stableNight } from '../../core/physics';
import { solarPosition, sunTimes } from '../../terrain';
import { rainBefore, seriesWeatherAt } from './weather';

/** Hours since the most recent sunrise at t (the previous day's before today's sunrise). */
export function hoursSinceSunrise(t: number, lat: number, lon: number): number {
  let rise = sunTimes(t, lat, lon).sunrise;
  if (!Number.isFinite(rise)) return NaN;
  if (rise > t) rise = sunTimes(t - 86400000, lat, lon).sunrise;
  return (t - rise) / 3.6e6;
}

/** `StableNightInput` at time t from the series (grid-point wind, cloud, rain of the last 24 h) and the sun. */
export function stableNightInputAt(series: WeatherSeries, t: number, rain24?: number): StableNightInput {
  const { lat, lon } = series.location;
  const w = seriesWeatherAt(series, t);
  return {
    time: t,
    sunElevation: solarPosition(t, lat, lon).elevation,
    hoursSinceSunrise: hoursSinceSunrise(t, lat, lon),
    u10: w.windSpeed10,
    cloudPct: w.cloudCover ?? 0,
    rain24: rain24 ?? rainBefore(series, t, 24),
  };
}

/**
 * Integrate the stable-night state from `from` to `to` over the series in sub-steps of `stepS` seconds, in place.
 * The rain of the last 24 h is refreshed hourly.
 */
export function integrateStableNight(s: StableNightState, series: WeatherSeries, from: number, to: number, stepS = 600): void {
  let t = from;
  let rain24 = rainBefore(series, t, 24);
  let rainAt = t;
  while (t < to - 1) {
    const tn = Math.min(to, t + stepS * 1000);
    if (tn - rainAt >= 3.6e6) {
      rain24 = rainBefore(series, tn, 24);
      rainAt = tn;
    }
    stableNight(s, stableNightInputAt(series, tn, rain24), (tn - t) / 1000);
    t = tn;
  }
}

/**
 * Stable-night state at t0 (spec §5.2a initialise): Δθ = 0 at max(seriesStart, t0 − `hours`), integrated to t0.
 * The template comes from `series.nightTemplate` (default { 5 K, 150 m }).
 */
export function spinUpStableNight(series: WeatherSeries, t0: number, hours = 24, stepS = 600): StableNightState {
  const s = initialStableNight(series.nightTemplate);
  if (series.hours.length === 0) return s;
  const from = Math.max(series.hours[0]!.time, t0 - hours * 3.6e6);
  integrateStableNight(s, series, from, t0, stepS);
  return s;
}
