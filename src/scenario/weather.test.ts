/** `weatherAt` (spec §11.2, §14 extra vector) and series utilities. */
import { describe, expect, it } from 'vitest';
import type { WeatherHour, WeatherSeries } from '../core/types';
import { parseOpenMeteoHourly, clearSkyGhi } from './openMeteo';
import { fixture } from './testing';
import { clearnessAt, ghiAt, insertStamp, rainBetween, seriesCovers, trimSeries, weatherAt } from './weather';

const H = 3.6e6;
const mk = (hours: WeatherHour[]): WeatherSeries => ({ kind: 'manual', source: 't', location: { lat: -33.7, lon: 150.3 }, timezone: 'Australia/Sydney', hours });
const hr = (time: number, o: Partial<WeatherHour> = {}): WeatherHour => ({ time, temperature: 20, relativeHumidity: 50, windSpeed10: 5, windDir10: 0, ...o });

describe('weatherAt (§11.2)', () => {
  it('§14 vector: 350° 5 m/s and 10° 5 m/s at the midpoint → 0°, 4.92 m/s (vector mean)', () => {
    const s = mk([hr(0, { windDir10: 350 }), hr(H, { windDir10: 10 })]);
    const w = weatherAt(s, H / 2);
    expect(w.windSpeed10).toBeCloseTo(4.92, 2);
    expect(Math.min(w.windDir10, 360 - w.windDir10)).toBeLessThan(1e-9);
  });
  it('scalars linear, ends held, profile and levels interpolated by key', () => {
    const lv = (T: number, dir: number) => [{ hPa: 850, height: 1500, temperature: T, relativeHumidity: 40, windSpeed: 10, windDir: dir }];
    const s = mk([
      hr(0, { temperature: 10, cloudCover: 0, windProfile: [{ heightAGL: 80, speed: 6, dir: 90 }], pressureLevels: lv(10, 270) }),
      hr(2 * H, { temperature: 20, cloudCover: 50, windProfile: [{ heightAGL: 80, speed: 6, dir: 90 }], pressureLevels: lv(20, 270) }),
    ]);
    const w = weatherAt(s, H);
    expect(w.temperature).toBeCloseTo(15, 9);
    expect(w.cloudCover).toBeCloseTo(25, 9);
    expect(w.windProfile![0]!.speed).toBeCloseTo(6, 9);
    expect(w.pressureLevels![0]!.temperature).toBeCloseTo(15, 9);
    expect(weatherAt(s, -5 * H).temperature).toBe(10);
    expect(weatherAt(s, 9 * H).temperature).toBe(20);
  });
  it('precipitation is piecewise-constant over the preceding hour', () => {
    const s = mk([hr(0, { precipitation: 0 }), hr(H, { precipitation: 2 }), hr(2 * H, { precipitation: 0 })]);
    expect(weatherAt(s, 0.1 * H).precipitation).toBe(2);
    expect(weatherAt(s, H).precipitation).toBe(2);
    expect(weatherAt(s, 1.5 * H).precipitation).toBe(0);
    expect(rainBetween(s, 0, 2 * H)).toBe(2);
  });
  it('clearness interpolates between mid-hour stamps; ghi(t) = k_t(t)·GHI_clear(t)', () => {
    const s = mk([hr(0, { clearness: 0.5 }), hr(H, { clearness: 1.0 })]);
    expect(clearnessAt(s, 0.5 * H)).toBeCloseTo(1.0, 9); // stamp of the second hour sits at 0.5 h
    expect(clearnessAt(s, 0)).toBeCloseTo(0.75, 9);
    const f = parseOpenMeteoHourly(fixture('openmeteo-forecast-katoomba.json')).series;
    const t = Date.UTC(2026, 8, 21, 2, 15);
    const g = ghiAt(f, t)!;
    expect(g).toBeCloseTo(clearnessAt(f, t)! * clearSkyGhi(t, f.location.lat, f.location.lon, 715), 6);
    expect(g).toBeGreaterThan(600);
    expect(ghiAt(mk([hr(0)]), 0)).toBeUndefined();
  });
  it('trimSeries keeps one stamp beyond each end; seriesCovers', () => {
    const s = mk(Array.from({ length: 10 }, (_, i) => hr(i * H)));
    const t = trimSeries(s, 2.5 * H, 5.5 * H);
    expect(t.hours.map((h) => h.time / H)).toEqual([2, 3, 4, 5, 6]);
    expect(seriesCovers(t, 2.5 * H, 5.5 * H)).toBe(true);
    expect(seriesCovers(t, 1 * H, 5.5 * H)).toBe(false);
  });
});

describe('stamp insertion keeps the series semantics (belt-kit offset shape, §11.5)', () => {
  const insert = (s: WeatherSeries, t: number): WeatherSeries => {
    const hours = s.hours.map((h) => ({ ...h }));
    const ins = insertStamp({ ...s, hours }, t);
    if (ins.nextPrecipitation !== undefined) hours[ins.nextIndex] = { ...hours[ins.nextIndex]!, precipitation: ins.nextPrecipitation };
    hours.splice(ins.nextIndex, 0, ins.hour);
    return { ...s, hours };
  };
  it('rain totals and rain rates are unchanged (no double counting of the split hour)', () => {
    const s = mk([hr(0, { precipitation: 1 }), hr(H, { precipitation: 3 }), hr(2 * H, { precipitation: 0.5 }), hr(3 * H, { precipitation: 0 })]);
    const s2 = insert(insert(s, 1.25 * H), 2.9 * H);
    expect(s2.hours.map((h) => h.time / H)).toEqual([0, 1, 1.25, 2, 2.9, 3]);
    expect(rainBetween(s2, -H, 3 * H)).toBeCloseTo(rainBetween(s, -H, 3 * H), 12);
    expect(rainBetween(s2, 0, 2 * H)).toBeCloseTo(3.5, 12);
    for (const t of [0.5, 1, 1.1, 1.25, 1.6, 2, 2.5, 2.9, 2.95, 3]) expect(weatherAt(s2, t * H).precipitation, `t=${t}`).toBeCloseTo(weatherAt(s, t * H).precipitation!, 12);
  });
  it('clearness keeps its mid-hour stamping and scalars stay exact', () => {
    const f = parseOpenMeteoHourly(fixture('openmeteo-forecast-katoomba.json')).series;
    const t = Date.UTC(2026, 8, 21, 1, 20);
    const f2 = insert(f, t);
    expect(f2.hours.length).toBe(f.hours.length + 1);
    for (let m = -90; m <= 90; m += 10) {
      const q = t + m * 60e3;
      expect(clearnessAt(f2, q)!).toBeCloseTo(clearnessAt(f, q)!, 9);
      expect(ghiAt(f2, q)!).toBeCloseTo(ghiAt(f, q)!, 6);
      expect(weatherAt(f2, q).temperature).toBeCloseTo(weatherAt(f, q).temperature, 9);
      expect(weatherAt(f2, q).windSpeed10).toBeCloseTo(weatherAt(f, q).windSpeed10, 9);
    }
  });
});

describe('physical validation of the parsed forecasts (D48)', () => {
  it.each(['openmeteo-forecast-katoomba.json', 'replay-gospers-2019-12-19.json', 'replay-katoomba-2013-10-16.json'])(
    '%s: ghi(t) = k_t·GHI_clear conserves the hourly radiation energy (sum over sunny hours within 1 %)',
    (name) => {
      const s = parseOpenMeteoHourly(fixture(name)).series;
      let model = 0;
      let given = 0;
      for (let i = 1; i < s.hours.length; i++) {
        const h = s.hours[i]!;
        if ((h.shortwaveRadiation ?? 0) < 100) continue;
        let m = 0;
        for (let q = 0; q < 30; q++) m += ghiAt(s, h.time - H + (q + 0.5) * 120e3)!;
        model += m / 30;
        given += h.shortwaveRadiation!;
      }
      expect(given).toBeGreaterThan(0);
      expect(Math.abs(model / given - 1)).toBeLessThan(0.01);
    },
  );
  it('weatherAt reproduces every stamp exactly (wind via u/v) and never leaves the stamp envelope between stamps', () => {
    const s = parseOpenMeteoHourly(fixture('openmeteo-forecast-katoomba.json')).series;
    for (let i = 0; i + 1 < s.hours.length; i += 7) {
      const a = s.hours[i]!;
      const b = s.hours[i + 1]!;
      const w = weatherAt(s, a.time);
      expect(w.temperature).toBeCloseTo(a.temperature, 9);
      expect(w.windSpeed10).toBeCloseTo(a.windSpeed10, 9);
      if (a.windSpeed10 > 0.1) expect(Math.abs(((w.windDir10 - a.windDir10 + 540) % 360) - 180)).toBeLessThan(1e-6);
      const m = weatherAt(s, (a.time + b.time) / 2);
      expect(m.temperature).toBeGreaterThanOrEqual(Math.min(a.temperature, b.temperature) - 1e-9);
      expect(m.temperature).toBeLessThanOrEqual(Math.max(a.temperature, b.temperature) + 1e-9);
      expect(m.windSpeed10).toBeLessThanOrEqual(Math.max(a.windSpeed10, b.windSpeed10) + 1e-9); // |mean vector| ≤ max
      expect(m.relativeHumidity).toBeGreaterThanOrEqual(0);
      expect(m.relativeHumidity).toBeLessThanOrEqual(100);
    }
  });
});
