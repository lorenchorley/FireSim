/**
 * The local weather-series adapter used by the spin-up (spec §5.6) and the stable-night spin-up (§5.2a): vector-mean
 * wind (§14 extra vector), precipitation of the preceding hour as a rate, clearness at the hour mid-point (D48),
 * rain of the last 24 h.
 */
import { describe, expect, it } from 'vitest';
import type { WeatherHour, WeatherSeries } from '../../core/types';
import { clearnessAt, rainBefore, seriesWeatherAt, stampIndex } from './weather';

const H = 3.6e6;
const hour = (i: number, o: Partial<WeatherHour> = {}): WeatherHour => ({
  time: i * H,
  temperature: 20 + i,
  relativeHumidity: 50,
  windSpeed10: 5,
  windDir10: 0,
  precipitation: 0,
  ...o,
});
const series = (hours: WeatherHour[]): WeatherSeries => ({ kind: 'preset', source: 'test', location: { lat: -33.7, lon: 150.3 }, timezone: 'Australia/Sydney', hours });

describe('seriesWeatherAt (local adapter of weatherAt, spec §11.2)', () => {
  it('wind interpolates as u/v vectors: 350° and 10° at 5 m/s → 0°, 4.92 m/s at the midpoint', () => {
    const s = series([hour(0, { windDir10: 350 }), hour(1, { windDir10: 10 })]);
    const w = seriesWeatherAt(s, 0.5 * H);
    expect(w.windSpeed10).toBeCloseTo(4.924, 3);
    expect(Math.min(w.windDir10, 360 - w.windDir10)).toBeLessThan(1e-6);
    expect(w.temperature).toBeCloseTo(20.5, 9);
  });

  it('precipitation is the hour ending at the next stamp (piecewise constant), 0 outside the series', () => {
    const s = series([hour(0), hour(1, { precipitation: 4 }), hour(2, { precipitation: 1 })]);
    expect(seriesWeatherAt(s, 0.25 * H).precipitation).toBe(4);
    expect(seriesWeatherAt(s, 1 * H).precipitation).toBe(4);
    expect(seriesWeatherAt(s, 1.5 * H).precipitation).toBe(1);
    expect(seriesWeatherAt(s, 2 * H).precipitation).toBe(1);
    expect(seriesWeatherAt(s, 3 * H).precipitation).toBe(0);
    expect(seriesWeatherAt(s, -H).precipitation).toBe(0);
    expect(seriesWeatherAt(s, -H).temperature).toBe(20); // held before the first stamp
    expect(stampIndex(s.hours, 1.5 * H)).toBe(1);
  });

  it('clearness k_t is stamped at the hour mid-point (time − 30 min) and interpolated (D48)', () => {
    const s = series([hour(0, { clearness: 0.2 }), hour(1, { clearness: 0.6 }), hour(2, { clearness: 1.0 })]);
    expect(clearnessAt(s.hours, 0.5 * H)).toBeCloseTo(0.6, 9); // mid-point of the hour ending at stamp 1
    expect(clearnessAt(s.hours, 1 * H)).toBeCloseTo(0.8, 9);
    expect(clearnessAt(series([hour(0), hour(1)]).hours, 0.5 * H)).toBeUndefined();
  });

  it('rainBefore sums the stamps in (t − 24 h, t]', () => {
    const hs = Array.from({ length: 30 }, (_, i) => hour(i, { precipitation: 1 }));
    expect(rainBefore(series(hs), 29 * H, 24)).toBe(24);
    expect(rainBefore(series(hs), 5 * H, 24)).toBe(6);
  });
});
