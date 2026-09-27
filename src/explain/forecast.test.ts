/**
 * Forecast analysis (spec §10.3): wind changes (circular-mean windows, merge < 2 h), afternoon peak (minimum AFDRS
 * forest M_A), C-Haines vectors (§8.10), the weatherAt vector-mean vector (§14), the §5.2a inversion prediction,
 * foehn / Froude helpers, and the engine's forecastInsights cards — on synthetic series and on the bundled
 * Open-Meteo replays (Warrumbungles 13 Jan 2013 southerly change, Gospers 19 Dec 2019, Budawangs 31 Dec 2019).
 */
import { describe, expect, it } from 'vitest';
import type { PressureLevelData, WeatherHour, WeatherSeries } from '../core/types';
import { InsightEngine } from './engine';
import {
  afternoonPeaks,
  cHaines,
  detectWindChanges,
  foehnAloft,
  forestMa,
  froudeFromLevels,
  predictInversion,
  rain24,
  weatherAtMs,
  windowWind,
} from './forecast';
import { DOCTRINE } from './text';
import { readOpenMeteoFixture } from './testing/openMeteo';
import { TEST_ORIGIN, TestWorld } from './testing/simState';

const HR = 3.6e6;

/** Hourly series from t0 (unix ms), n hours, each hour from `f(i, t)` over a mild default. */
function series(t0: number, n: number, f: (i: number, t: number) => Partial<WeatherHour>, extra: Partial<WeatherSeries> = {}): WeatherSeries {
  const hours: WeatherHour[] = [];
  for (let i = 0; i < n; i++) {
    const t = t0 + i * HR;
    hours.push({ time: t, temperature: 20, relativeHumidity: 50, windSpeed10: 5, windDir10: 270, cloudCover: 20, precipitation: 0, ...f(i, t) });
  }
  return { kind: 'fixture', source: 'test', location: { ...TEST_ORIGIN }, timezone: 'Australia/Sydney', hours, ...extra };
}

describe('windowWind and weatherAtMs', () => {
  it('circular mean across north; vector-mean interpolation (spec §14: 350°/10° 5 m/s → 0°, 4.92 m/s)', () => {
    const s = series(0, 2, (i) => ({ windDir10: i === 0 ? 350 : 10, windSpeed10: 5 }));
    const w = windowWind(s.hours, 0, HR);
    expect(Math.min(w.dir, 360 - w.dir)).toBeLessThan(1e-6);
    const mid = weatherAtMs(s, HR / 2)!;
    expect(Math.min(mid.windDir10, 360 - mid.windDir10)).toBeLessThan(1e-6);
    expect(mid.windSpeed10).toBeCloseTo(4.924, 3);
  });
});

describe('C-Haines (spec §8.10 vectors)', () => {
  const hour = (t850: number, t700: number, td850: number): WeatherHour => ({
    time: 0,
    temperature: 30,
    relativeHumidity: 20,
    windSpeed10: 5,
    windDir10: 270,
    pressureLevels: [
      { hPa: 850, height: 1500, temperature: t850, relativeHumidity: 20, dewPoint: td850, windSpeed: 10, windDir: 300 },
      { hPa: 700, height: 3100, temperature: t700, relativeHumidity: 20, windSpeed: 12, windDir: 300 },
    ],
  });
  it.each([
    [20, 6, -5, 11.17, 5.0],
    [28, 12, -10, 13.0, 6.0],
    [15, 5, 10, 3.67, 3.0],
  ])('T850 %d, T700 %d, Td850 %d → %d', (t850, t700, td, ch, ca) => {
    const r = cHaines(hour(t850, t700, td))!;
    expect(r.ch).toBeCloseTo(ch, 2);
    expect(r.ca).toBeCloseTo(ca, 6);
    expect(r.surfaceSubstituted).toBe(false);
  });
  it('uses the 2 m values when 850 hPa is below the grid-point surface, and flags it; null without levels', () => {
    const h = hour(20, 6, -5);
    h.dewPoint = 0;
    const r = cHaines(h, 1600)!;
    expect(r.surfaceSubstituted).toBe(true);
    expect(r.ca).toBeCloseTo(0.5 * (30 - 6) - 2, 6);
    expect(cHaines({ ...h, pressureLevels: [] })).toBeNull();
  });
  it('spec §14 preset vector: T850 29.1, T700 15.1 → CA 5.0', () => {
    expect(cHaines(hour(29.1, 15.1, 29.1 - 24))!.ca).toBeCloseTo(5.0, 6);
    // CB 7.0 needs a dew-point depression ≥ 30 K (capped): CB = 30/3 − 1 = 9 → 5 + 4/2 = 7.
    expect(cHaines(hour(29.1, 15.1, -5))!.cb).toBeCloseTo(7.0, 6);
    expect(cHaines(hour(29.1, 15.1, -5))!.ch).toBeCloseTo(12.0, 6);
  });
});

describe('detectWindChanges (spec §10.3)', () => {
  const t0 = Date.UTC(2025, 11, 20, 0);
  it('a sharp 90° change at 15:00 → one change, timed at the first post-change sample', () => {
    const s = series(t0, 24, (i) => (i < 15 ? { windDir10: 315, windSpeed10: 30 / 3.6 } : { windDir10: 225, windSpeed10: 35 / 3.6 }));
    const ch = detectWindChanges(s, t0, t0 + 24 * HR);
    expect(ch.length).toBe(1);
    expect(ch[0]!.time).toBe(t0 + 15 * HR);
    expect(ch[0]!.hour).toBe(t0 + 14 * HR); // max |Δdir| window pair
    expect(ch[0]!.shift).toBeCloseTo(90, 6);
    expect(ch[0]!.fromDir).toBeCloseTo(315, 6);
    expect(ch[0]!.toDir).toBeCloseTo(225, 6);
    expect(ch[0]!.postSpeed * 3.6).toBeCloseTo(35, 6);
  });
  it('no change when the post-change wind is below 15 km/h, or the turn is below 45°', () => {
    const weak = series(t0, 24, (i) => (i < 15 ? { windDir10: 315, windSpeed10: 30 / 3.6 } : { windDir10: 225, windSpeed10: 12 / 3.6 }));
    expect(detectWindChanges(weak, t0, t0 + 24 * HR)).toEqual([]);
    const small = series(t0, 24, (i) => (i < 15 ? { windDir10: 315, windSpeed10: 30 / 3.6 } : { windDir10: 275, windSpeed10: 35 / 3.6 }));
    expect(detectWindChanges(small, t0, t0 + 24 * HR)).toEqual([]);
    const veer = series(t0, 24, (i) => ({ windDir10: 200 + 8 * i, windSpeed10: 25 / 3.6 }));
    expect(detectWindChanges(veer, t0, t0 + 24 * HR)).toEqual([]);
  });
  it('changes < 2 h apart merge (a fast veer is one change); changes 8 h apart stay separate', () => {
    const fast = series(t0, 24, (i) => ({ windDir10: i < 10 ? 0 : i < 14 ? 30 * (i - 9) : 150, windSpeed10: 25 / 3.6 }));
    expect(detectWindChanges(fast, t0, t0 + 24 * HR).length).toBe(1);
    const two = series(t0, 30, (i) => ({ windDir10: i < 6 ? 0 : i < 14 ? 90 : 200, windSpeed10: 25 / 3.6 }));
    const ch = detectWindChanges(two, t0, t0 + 30 * HR);
    expect(ch.map((c) => (c.time - t0) / HR)).toEqual([6, 14]);
  });
  it('Warrumbungles 13 Jan 2013: the evening southerly change (≈ 18:00 AEST, NW → SSW, ≥ 15 km/h)', () => {
    const s = readOpenMeteoFixture('replay-warrumbungles-2013-01-12.json');
    const ch = detectWindChanges(s, s.hours[0]!.time, s.hours[s.hours.length - 1]!.time);
    expect(ch.length).toBe(1);
    expect(ch[0]!.time).toBe(Date.UTC(2013, 0, 13, 8)); // 18:00 AEST
    expect(ch[0]!.fromDir).toBeGreaterThan(280);
    expect(ch[0]!.toDir).toBeGreaterThan(180);
    expect(ch[0]!.toDir).toBeLessThan(240);
    expect(ch[0]!.postSpeed * 3.6).toBeGreaterThan(25);
  });
  it('Gospers 19 Dec 2019 evening change detected; Budawangs 31 Dec 2019 (post-change wind < 15 km/h) not', () => {
    const g = readOpenMeteoFixture('replay-gospers-2019-12-19.json');
    const gc = detectWindChanges(g, g.hours[0]!.time, g.hours[0]!.time + 24 * HR);
    expect(gc.length).toBe(1);
    expect(gc[0]!.shift).toBeGreaterThanOrEqual(45);
    const b = readOpenMeteoFixture('replay-budawangs-2019-12-30.json');
    expect(detectWindChanges(b, b.hours[0]!.time, b.hours[b.hours.length - 1]!.time)).toEqual([]);
  });
});

describe('afternoon peak, rain and inversion', () => {
  it('the peak is the hour of minimum forest M_A (hot, dry hour), one per local day', () => {
    // Hottest / driest at 04 UTC (≈ 14:01 LMST at 150.3° E).
    const t0 = Date.UTC(2025, 10, 1, 14); // local midnight-ish
    const s = series(t0, 48, (_i, t) => {
      const hUtc = new Date(t).getUTCHours();
      const d = Math.cos(((hUtc - 4) / 24) * 2 * Math.PI);
      return { temperature: 22 + 10 * d, relativeHumidity: 45 - 25 * d };
    });
    const p = afternoonPeaks(s, t0, t0 + 47 * HR, TEST_ORIGIN.lon);
    expect(p.length).toBe(2);
    for (const x of p) {
      expect(new Date(x.time).getUTCHours()).toBe(4);
      expect(x.lmst).toBeCloseTo(14.02, 1);
      expect(x.ma).toBeCloseTo(forestMa(s.hours.find((h) => h.time === x.time)!, TEST_ORIGIN.lon), 9);
    }
    expect(p[0]!.date).not.toBe(p[1]!.date);
  });
  it('rain24 sums the 24 h before a time', () => {
    const s = series(0, 30, (i) => ({ precipitation: i === 3 || i === 20 ? 2 : 0 }));
    expect(rain24(s, 28 * HR)).toBe(2); // (4 h, 28 h]
    expect(rain24(s, 20 * HR)).toBe(4); // (−4 h, 20 h]
    expect(rain24(s, 2 * HR)).toBe(0);
  });
  it('predictInversion: a calm clear night builds a ≥ 3 K pool with a break after sunrise; a windy cloudy night does not', () => {
    const start = Date.UTC(2025, 9, 15, 11); // 22:00 AEDT
    const calm = series(start - 30 * HR, 72, () => ({ windSpeed10: 1, cloudCover: 0, temperature: 12, relativeHumidity: 70 }));
    const inv = predictInversion(calm, start, TEST_ORIGIN.lat, TEST_ORIGIN.lon)!;
    expect(inv.dThetaAtSunrise).toBeGreaterThanOrEqual(3);
    expect(inv.tBreak).toBeGreaterThan(inv.sunrise);
    expect(inv.sunrise).toBeGreaterThan(start);
    expect(inv.wet).toBe(false);
    const windy = series(start - 30 * HR, 72, () => ({ windSpeed10: 9, cloudCover: 100 }));
    const w = predictInversion(windy, start, TEST_ORIGIN.lat, TEST_ORIGIN.lon);
    expect(w === null || w.dThetaAtSunrise < 3).toBe(true);
  });
});

describe('profile helpers (foehn, Froude)', () => {
  const lv = (hPa: number, height: number, T: number, ws: number, wd: number): PressureLevelData => ({ hPa, height, temperature: T, relativeHumidity: 20, windSpeed: ws, windDir: wd });
  it('foehnAloft: 850 or 700 hPa wind from 250–320° at ≥ 15 m/s', () => {
    const h = (a: PressureLevelData[]): WeatherHour => ({ time: 0, temperature: 30, relativeHumidity: 15, windSpeed10: 8, windDir10: 300, pressureLevels: a });
    expect(foehnAloft(h([lv(850, 1500, 20, 18, 290)]))).toEqual({ dir: 290, speed: 18 });
    expect(foehnAloft(h([lv(850, 1500, 20, 12, 290), lv(700, 3100, 8, 16, 320)]))).toEqual({ dir: 320, speed: 16 });
    expect(foehnAloft(h([lv(850, 1500, 20, 18, 200)]))).toBeNull();
    expect(foehnAloft(h([lv(850, 1500, 20, 14, 290)]))).toBeNull();
  });
  it('froudeFromLevels: U/(N·H) with N² from θ(850), θ(700); Infinity when neutral/unstable', () => {
    const h: WeatherHour = { time: 0, temperature: 20, relativeHumidity: 50, windSpeed10: 5, windDir10: 270, pressureLevels: [lv(850, 1500, 15, 10, 270), lv(700, 3100, 5, 14, 270)] };
    const fr = froudeFromLevels(h, 600);
    // θ850 = 288.15·(1000/850)^0.2857, θ700 = 278.15·(1000/700)^0.2857.
    const t1 = 288.15 * Math.pow(1000 / 850, 0.2857);
    const t2 = 278.15 * Math.pow(1000 / 700, 0.2857);
    const N = Math.sqrt((9.81 / ((t1 + t2) / 2)) * ((t2 - t1) / 1600));
    expect(fr).toBeCloseTo(12 / (N * 600), 1);
    const unstable: WeatherHour = { ...h, pressureLevels: [lv(850, 1500, 15, 10, 270), lv(700, 3100, -12, 14, 270)] };
    expect(froudeFromLevels(unstable, 600)).toBe(Infinity);
  });
});

describe('InsightEngine.forecastInsights', () => {
  /** Hot NW day with a SW change at 16:00 AEDT, preset upper air (C-Haines 13.5), DF 10. */
  function hotDay(start: number): WeatherSeries {
    return series(
      start - 24 * HR,
      60,
      (_i, t) => {
        const local = (new Date(t).getUTCHours() + 11) % 24;
        const pre = t < start + 6 * HR;
        const d = Math.cos(((local - 15) / 24) * 2 * Math.PI);
        return {
          temperature: pre ? 30 + 10 * d : 26,
          relativeHumidity: pre ? 20 - 12 * d : 45,
          windDir10: pre ? 315 : 225,
          windSpeed10: (pre ? 45 : 50) / 3.6,
          cloudCover: 5,
          pressureLevels: [
            { hPa: 850, height: 1500, temperature: 29, relativeHumidity: 7, dewPoint: -10, windSpeed: 20, windDir: 300 },
            { hPa: 700, height: 3150, temperature: 12, relativeHumidity: 10, windSpeed: 22, windDir: 290 },
          ],
        };
      },
      { upperAirSource: 'preset', droughtFactor: 10, kbdi: 120 },
    );
  }

  it('hot day: wind change (danger, with its time), afternoon peak, deep drought, pyroconvection (danger), S13 and foehn', () => {
    const w = new TestWorld();
    const start = Date.UTC(2025, 11, 19, 23); // 10:00 AEDT 20 Dec
    const eng = new InsightEngine(w.terrain, w.derived, w.fuel, w.features);
    const ins = eng.forecastInsights(hotDay(start), start, 8 * 3600, TEST_ORIGIN.lon);
    const by = (k: string) => ins.filter((i) => i.key === k);
    const wc = by('wind-change:domain');
    expect(wc.length).toBe(1);
    expect(wc[0]!.severity).toBe('danger');
    expect(wc[0]!.time).toBe(6 * 3600);
    expect(wc[0]!.body).toContain('4:00 pm');
    expect(wc[0]!.body).toContain('south-west');
    expect(by('high-drought:domain')[0]?.severity).toBe('watch');
    const pyro = by('pyroconvection-risk:domain');
    expect(pyro[0]?.severity).toBe('danger');
    expect(pyro[0]!.factors.some((f) => f.label === 'C-Haines' && f.value === 'about 14')).toBe(true);
    const ap = by('afternoon-peak:domain');
    expect(ap.some((i) => i.severity === 'info')).toBe(true);
    expect(ap.some((i) => i.severity === 'watch' && i.title === 'Hot, dry and windy')).toBe(true);
    expect(by('general:foehn:domain').length).toBe(1);
    const ids = new Set(ins.map((i) => i.id));
    expect(ids.size).toBe(ins.length);
    for (const i of ins) {
      expect(i.safety!.endsWith(DOCTRINE)).toBe(true);
      expect(i.time).toBeGreaterThanOrEqual(0);
      expect(i.body).not.toMatch(/NaN|undefined|\?/);
    }
  });

  it('mild day: no wind change, drought, pyroconvection, S13 or foehn; synthetic upper air gives the "unavailable" note only when FFDI ≥ 25', () => {
    const w = new TestWorld();
    const start = Date.UTC(2025, 9, 15, 0);
    const eng = new InsightEngine(w.terrain, w.derived, w.fuel, w.features);
    const mild = series(start - 24 * HR, 60, () => ({ windSpeed10: 3, windDir10: 200, temperature: 18, relativeHumidity: 60 }), { droughtFactor: 5, kbdi: 40 });
    const kinds = eng.forecastInsights(mild, start, 6 * 3600, TEST_ORIGIN.lon).map((i) => i.kind);
    expect(kinds.filter((k) => k !== 'afternoon-peak' && k !== 'inversion-break')).toEqual([]);
    const hotSynth = hotDay(Date.UTC(2025, 11, 19, 23));
    hotSynth.upperAirSource = 'synthetic';
    const e2 = new InsightEngine(w.terrain, w.derived, w.fuel, w.features);
    const p = e2.forecastInsights(hotSynth, Date.UTC(2025, 11, 19, 23), 8 * 3600, TEST_ORIGIN.lon).filter((i) => i.kind === 'pyroconvection-risk');
    expect(p.length).toBe(1);
    expect(p[0]!.severity).toBe('info');
    expect(p[0]!.body).toContain('Upper-air data unavailable for this date');
  });

  it('night start on a calm clear night: expected inversion break the next morning (watch)', () => {
    const w = new TestWorld();
    const start = Date.UTC(2025, 9, 15, 11); // 22:00 AEDT
    const eng = new InsightEngine(w.terrain, w.derived, w.fuel, w.features);
    const calm = series(start - 30 * HR, 72, () => ({ windSpeed10: 1, cloudCover: 0, temperature: 12, relativeHumidity: 70, windDir10: 180 }));
    const inv = eng.forecastInsights(calm, start, 12 * 3600, TEST_ORIGIN.lon).filter((i) => i.kind === 'inversion-break');
    expect(inv.length).toBe(1);
    expect(inv[0]!.severity).toBe('watch');
    expect(inv[0]!.time).toBeGreaterThan(8 * 3600); // after sunrise (≈ 06:00, 8 h after the start)
    expect(inv[0]!.body).toMatch(/expected about \d+:\d\d am/);
  });

  it('Warrumbungles replay: the forecast wind-change card of 13 Jan 2013 is on the timeline at 18:00 AEST', () => {
    const s = readOpenMeteoFixture('replay-warrumbungles-2013-01-12.json');
    const w = new TestWorld();
    const eng = new InsightEngine(w.terrain, w.derived, w.fuel, w.features);
    const start = Date.UTC(2013, 0, 13, 0); // 10:00 AEST
    const wc = eng.forecastInsights(s, start, 10 * 3600, s.location.lon).filter((i) => i.kind === 'wind-change');
    expect(wc.length).toBe(1);
    expect(wc[0]!.time).toBe(8 * 3600);
    expect(wc[0]!.body).toMatch(/swinging from the north-west to the (south|south-west)/);
  });

  it('Katoomba forecast fixture with model pressure levels: pyroconvection severity is consistent with C-Haines and the hourly FFDI', () => {
    const s = readOpenMeteoFixture('openmeteo-forecast-katoomba.json');
    expect(s.upperAirSource).toBe('model');
    const w = new TestWorld();
    const eng = new InsightEngine(w.terrain, w.derived, w.fuel, w.features);
    const start = s.hours[24]!.time;
    const ins = eng.forecastInsights(s, start, 5 * 24 * 3600, s.location.lon);
    for (const i of ins) expect(i.safety!.endsWith(DOCTRINE)).toBe(true);
    const p = ins.filter((i) => i.kind === 'pyroconvection-risk');
    for (const x of p) expect(['watch', 'danger']).toContain(x.severity);
  });
});
