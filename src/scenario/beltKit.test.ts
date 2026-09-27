/**
 * Belt weather kit and manual entry (spec §11.5, D38, D39; §14 "psychrometer (9), kbdiFromDf").
 */
import { describe, expect, it } from 'vitest';
import type { WeatherSeries } from '../core/types';
import { dewPointC, pressureIsa } from '../core/physics';
import { droughtFactorFromX, droughtXLimit } from '../fuel/moisture/drought';
import { applyBeltKitToForecast, beltKitReading, beltKitSeries, beltLapseRate, beltOffsetWeight, kbdiFromDf, kitWindTo10m, manualDrought, manualSeriesFromReadings, normaliseManualSeries, psychrometerRh } from './beltKit';
import { lapseRate } from '../fuel/moisture/air';
import { solarPosition } from '../terrain';
import { MESSAGES } from './messages';
import { clearnessAt, rainBetween, weatherAt } from './weather';

const H = 3.6e6;
const LOC = { lat: -33.715, lon: 150.285 };

describe('psychrometer (D38): 9 vectors (T/T_w at 0, 1000, 2000 m ISA; p 1013.3 / 898.7 / 795.0 hPa)', () => {
  it('ISA pressures', () => {
    expect(pressureIsa(0)).toBeCloseTo(1013.3, 0);
    expect(pressureIsa(1000)).toBeCloseTo(898.7, 1);
    expect(pressureIsa(2000)).toBeCloseTo(795.0, 1);
  });
  it.each([
    [25, 15, [32.6, 35.0, 37.2]],
    [30, 18, [29.6, 31.7, 33.7]],
    [35, 19, [19.9, 22.0, 24.0]],
  ] as const)('%d / %d °C', (T, Tw, want) => {
    [0, 1000, 2000].forEach((z, i) => {
      expect(psychrometerRh(T, Tw, pressureIsa(z))).toBeCloseTo(want[i]!, 1);
      // beltKitReading uses ISA at the reading elevation by default.
      expect(beltKitReading({ dryBulb: T, wetBulb: Tw, windKmh: 10, windDir: 300, time: 0, elevation: z }).relativeHumidity).toBeCloseTo(want[i]!, 1);
    });
  });
  it('§14: RH(25/15 °C, 898.7 hPa) = 35.0 %', () => expect(psychrometerRh(25, 15, 898.7)).toBeCloseTo(35.0, 1));
  it('wet bulb warmer than dry bulb is rejected; saturated gives 100 %', () => {
    expect(Number.isNaN(psychrometerRh(20, 21, 1000))).toBe(true);
    expect(() => beltKitReading({ dryBulb: 20, wetBulb: 22, windKmh: 0, windDir: 0, time: 0 })).toThrow();
    expect(psychrometerRh(20, 20, 1000)).toBeCloseTo(100, 6);
  });
});

describe('kit wind 2 m → 10 m open (D39, FBI-TG Table 3.4)', () => {
  it('×1.25 open, ×1.67 woodland, ×2.4 forest; default open', () => {
    expect(kitWindTo10m(36)).toBeCloseTo(12.5, 9);
    expect(kitWindTo10m(36, 'woodland')).toBeCloseTo(16.7, 9);
    expect(kitWindTo10m(36, 'forest')).toBeCloseTo(24, 9);
    const r = beltKitReading({ dryBulb: 30, wetBulb: 18, windKmh: 18, windDir: 315, time: 5, exposure: 'forest' });
    expect(r.windSpeed10).toBeCloseTo(12, 9);
    expect(r.dewPoint).toBeCloseTo(dewPointC(30, r.relativeHumidity), 9);
  });
});

describe('kbdiFromDf (§11.5)', () => {
  it('inverts DF(K, x = x_lim(K)) (no recent rain) for DF 6…9.9; 0 below the K = 0 value; cap at 10', () => {
    for (const df of [6, 7, 8, 8.5, 9, 9.5, 9.9]) {
      const k = kbdiFromDf(df);
      expect(k).toBeGreaterThan(0);
      expect(k).toBeLessThanOrEqual(203.2);
      expect(droughtFactorFromX(k, Math.min(1, droughtXLimit(k)))).toBeCloseTo(df, 3);
    }
    expect(kbdiFromDf(5)).toBe(0);
    expect(kbdiFromDf(3)).toBe(0);
    expect(droughtFactorFromX(kbdiFromDf(10), Math.min(1, droughtXLimit(kbdiFromDf(10))))).toBeCloseTo(10, 3);
    expect(kbdiFromDf(7)).toBeLessThan(kbdiFromDf(8));
  });
  it('manual drought: DF only → KBDI inferred; KBDI only → DF at x_lim; neither → DF 7 / KBDI 60 + warning', () => {
    const a = manualDrought(8);
    expect(a.kbdi).toBeCloseTo(kbdiFromDf(8), 9);
    expect(a.warnings[0]).toContain('inferred');
    const b = manualDrought(undefined, 100);
    expect(b.df).toBeCloseTo(droughtFactorFromX(100, Math.min(1, droughtXLimit(100))), 9);
    expect(manualDrought()).toEqual({ df: 7, kbdi: 60, warnings: [MESSAGES.droughtDefaults] });
    expect(manualDrought(9, 150)).toEqual({ df: 9, kbdi: 150, warnings: [] });
  });
});

describe('manual series (§11.5)', () => {
  const r = (time: number, T: number, dir: number, speed = 5) => ({ time, temperature: T, relativeHumidity: 30, windSpeed10: speed, windDir10: dir });
  it('readings interpolate linearly (wind as u/v); nearest held outside; cloud defaults to 0 with a note', () => {
    const { series, warnings } = manualSeriesFromReadings([r(2 * H, 30, 350), r(0, 20, 10)], { location: LOC, from: -24 * H, to: 10 * H, sourceElevation: 950, droughtFactor: 9 });
    expect(series.hours.map((h) => h.time / H)).toEqual([-24, 0, 2, 10]);
    expect(weatherAt(series, H).temperature).toBeCloseTo(25, 9);
    expect(weatherAt(series, H).windSpeed10).toBeCloseTo(4.92, 2);
    expect(weatherAt(series, -10 * H).temperature).toBe(20);
    expect(weatherAt(series, 8 * H).temperature).toBe(30);
    expect(series.hours.every((h) => h.cloudCover === 0)).toBe(true);
    expect(warnings).toContain(MESSAGES.manualNoCloud);
    expect(series.sourceElevation).toBe(950);
    expect(series.upperAirSource).toBeUndefined();
    expect(series.droughtFactor).toBe(9);
    expect(series.kbdi).toBeCloseTo(kbdiFromDf(9), 9);
  });
  it('a single reading is held for the whole run (no diurnal shape)', () => {
    const { series } = manualSeriesFromReadings([r(0, 33, 300)], { location: LOC, from: -24 * H, to: 6 * H, cloudCover: 20 });
    for (let t = -24 * H; t <= 6 * H; t += H) {
      const w = weatherAt(series, t);
      expect(w.temperature).toBe(33);
      expect(w.cloudCover).toBe(20);
    }
  });
  it('normalises a UI series (sorted, dew point filled, drought, site elevation)', () => {
    const ui: WeatherSeries = {
      kind: 'belt-kit',
      source: 'Belt weather kit reading',
      location: LOC,
      timezone: 'Australia/Sydney',
      hours: [
        { time: H, temperature: 32, relativeHumidity: 15, windSpeed10: 8, windDir10: 315 },
        { time: 0, temperature: 32, relativeHumidity: 15, windSpeed10: 8, windDir10: 315 },
      ],
      droughtFactor: 8,
    };
    const { series } = normaliseManualSeries(ui, { from: -24 * H, to: 5 * H, sourceElevation: 1000 });
    expect(series.kind).toBe('belt-kit');
    expect(series.hours.map((h) => h.time / H)).toEqual([-24, 0, 1, 5]);
    expect(series.hours[1]!.dewPoint).toBeCloseTo(dewPointC(32, 15), 9);
    expect(series.sourceElevation).toBe(1000);
    expect(series.kbdi).toBeCloseTo(kbdiFromDf(8), 9);
  });
  it('beltKitSeries converts readings with the psychrometer and the wind ratio', () => {
    const { series, readings } = beltKitSeries([{ dryBulb: 25, wetBulb: 15, windKmh: 20, windDir: 300, time: 0, elevation: 1000 }], { location: LOC, from: -H, to: 4 * H });
    expect(readings[0]!.relativeHumidity).toBeCloseTo(35.0, 1);
    expect(series.hours[1]!.windSpeed10).toBeCloseTo((20 / 3.6) * 1.25, 9);
    expect(series.sourceElevation).toBe(1000);
    expect(series.kind).toBe('belt-kit');
  });
});

describe('belt-kit readings in a forecast run (§11.5)', () => {
  const fc: WeatherSeries = {
    kind: 'forecast',
    source: 'fc',
    location: LOC,
    timezone: 'Australia/Sydney',
    sourceElevation: 700,
    hours: Array.from({ length: 13 }, (_, i) => ({ time: i * H, temperature: 30, relativeHumidity: 20, dewPoint: dewPointC(30, 20), windSpeed10: 6, windDir10: 300 })),
  };
  it('offset weight: full at the reading, linear decay to 0 over 3 h, 1 h lead-in', () => {
    expect(beltOffsetWeight(5 * H, 5 * H)).toBe(1);
    expect(beltOffsetWeight(6.5 * H, 5 * H)).toBeCloseTo(0.5, 9);
    expect(beltOffsetWeight(8 * H, 5 * H)).toBe(0);
    expect(beltOffsetWeight(4.5 * H, 5 * H)).toBeCloseTo(0.5, 9);
    expect(beltOffsetWeight(3 * H, 5 * H)).toBe(0);
  });
  it('T offset = reading − lapse-corrected forecast at the reading elevation; WindEdit 1 km at the reading', () => {
    const reading = beltKitReading({ dryBulb: 28, wetBulb: 16, windKmh: 20, windDir: 250, time: 4 * H, elevation: 1000, location: { lat: LOC.lat + 0.009, lon: LOC.lon } });
    const out = applyBeltKitToForecast(fc, [reading], { origin: LOC, t0: 2 * H, siteElevation: 900 });
    // Forecast at 1000 m: 30 − 6.5·0.3 = 28.05 → offset −0.05 K.
    const dT = 28 - (30 - 6.5 * 0.3);
    expect(weatherAt(out.series, 4 * H).temperature).toBeCloseTo(30 + dT, 6);
    expect(weatherAt(out.series, 5.5 * H).temperature).toBeCloseTo(30 + dT * 0.5, 6);
    expect(weatherAt(out.series, 7 * H).temperature).toBeCloseTo(30, 6);
    expect(weatherAt(out.series, 2 * H).temperature).toBeCloseTo(30, 6);
    const tdFc = dewPointC(30, 20) - 1.8 * 0.3;
    expect(weatherAt(out.series, 4 * H).dewPoint).toBeCloseTo(reading.dewPoint - tdFc + dewPointC(30, 20), 6);
    expect(out.edits).toHaveLength(1);
    const e = out.edits[0]!;
    expect(e.radius).toBe(1000);
    expect(e.time).toBe(7200);
    expect(e.dir).toBe(250);
    expect(e.x).toBeCloseTo(0, 6);
    expect(e.y).toBeCloseTo(1000, -1);
    expect(fc.hours).toHaveLength(13); // input untouched
  });
});

describe('belt-kit offset: physical consistency with the moisture model (§5.2, D43) and the series semantics', () => {
  // A rainy, partly cloudy afternoon forecast (hourly), grid point at 700 m, stamped on whole UTC hours.
  const T0 = Date.UTC(2026, 9, 15, 0); // 10:00 AEST
  const fc: WeatherSeries = {
    kind: 'forecast',
    source: 'fc',
    location: LOC,
    timezone: 'Australia/Sydney',
    sourceElevation: 700,
    hours: Array.from({ length: 13 }, (_, i) => ({
      time: T0 + i * H,
      temperature: 24 + i * 0.3,
      relativeHumidity: 40,
      dewPoint: dewPointC(24 + i * 0.3, 40),
      windSpeed10: 6,
      windDir10: 300,
      precipitation: i % 3 === 0 ? 1.2 : 0.4,
      clearness: 0.5 + 0.03 * i,
      boundaryLayerHeight: 2000,
    })),
  };
  const relief = 450;
  const reading = beltKitReading({ dryBulb: 25.5, wetBulb: 17, windKmh: 18, windDir: 280, time: T0 + 3.4 * H, elevation: 1000 });

  it('the adjusted forecast, lapsed with the D43 rate of fuel/moisture, reproduces the reading at its elevation', () => {
    const out = applyBeltKitToForecast(fc, [reading], { origin: LOC, t0: T0, siteElevation: 950, relief });
    const w = weatherAt(out.series, reading.time);
    const sun = solarPosition(reading.time, LOC.lat, LOC.lon);
    const gamma = lapseRate(sun.elevation, relief, 2000);
    expect(gamma).toBeGreaterThan(6.5); // late morning, mixed layer deeper than the relief → towards 9.8 K/km
    expect(beltLapseRate(fc, weatherAt(fc, reading.time), reading.time, relief)).toBeCloseTo(gamma, 12);
    const dz = (1000 - 700) / 1000;
    expect(w.temperature - gamma * dz).toBeCloseTo(reading.temperature, 6);
    expect(w.dewPoint! - 1.8 * dz).toBeCloseTo(reading.dewPoint, 6);
    // Without the relief the standard 6.5 K/km is used.
    expect(beltLapseRate(fc, weatherAt(fc, reading.time), reading.time)).toBe(6.5);
  });

  it('inserted shape stamps keep the rain totals, the rain rate and the clearness (no double counting)', () => {
    const out = applyBeltKitToForecast(fc, [reading], { origin: LOC, t0: T0, siteElevation: 950, relief });
    expect(out.series.hours.length).toBe(fc.hours.length + 3);
    const a = fc.hours[0]!.time;
    const b = fc.hours[fc.hours.length - 1]!.time;
    expect(rainBetween(out.series, a - H, b)).toBeCloseTo(rainBetween(fc, a - H, b), 9);
    for (let m = 0; m <= 12 * 60; m += 7) {
      const t = a + m * 60e3;
      expect(weatherAt(out.series, t).precipitation!).toBeCloseTo(weatherAt(fc, t).precipitation!, 9);
      expect(clearnessAt(out.series, t)!).toBeCloseTo(clearnessAt(fc, t)!, 9);
      expect(weatherAt(out.series, t).windSpeed10).toBeCloseTo(weatherAt(fc, t).windSpeed10, 9);
    }
    // Stamps stay sorted and unique; RH stays physical.
    for (let i = 1; i < out.series.hours.length; i++) expect(out.series.hours[i]!.time).toBeGreaterThan(out.series.hours[i - 1]!.time);
    for (const h of out.series.hours) {
      expect(h.relativeHumidity).toBeGreaterThan(0);
      expect(h.relativeHumidity).toBeLessThanOrEqual(100);
      expect(h.dewPoint!).toBeLessThanOrEqual(h.temperature + 1e-9);
    }
  });

  it('two readings: the later one is reproduced exactly (offsets compose against the adjusted forecast)', () => {
    const r2 = beltKitReading({ dryBulb: 27, wetBulb: 17.5, windKmh: 22, windDir: 290, time: T0 + 4.5 * H, elevation: 1000 });
    const out = applyBeltKitToForecast(fc, [reading, r2], { origin: LOC, t0: T0, siteElevation: 950, relief });
    const g2 = beltLapseRate(fc, weatherAt(fc, r2.time), r2.time, relief);
    expect(weatherAt(out.series, r2.time).temperature - g2 * 0.3).toBeCloseTo(r2.temperature, 6);
    expect(out.edits.map((e) => e.id)).toEqual(['belt-kit-1', 'belt-kit-2']);
  });
});
