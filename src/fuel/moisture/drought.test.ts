import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { DailyWeather } from '../../core/types';
import {
  droughtFactor,
  droughtFactorFromX,
  droughtFactorNoble,
  droughtState,
  droughtXLimit,
  kbdiFromDf,
  kbdiIncrement,
  kbdiPass,
  kbdiSeries,
} from './drought';

const FIX = fileURLToPath(new URL('../../../tests/fixtures/live/', import.meta.url));

interface OmDaily {
  utc_offset_seconds: number;
  daily: { time: string[]; precipitation_sum: number[]; temperature_2m_max: number[]; temperature_2m_min: number[] };
}
const readDaily = (file: string): DailyWeather[] => {
  const j = JSON.parse(readFileSync(FIX + file, 'utf8')) as OmDaily;
  return j.daily.time.map((date, i) => ({ date, rain: j.daily.precipitation_sum[i]!, tMax: j.daily.temperature_2m_max[i]!, tMin: j.daily.temperature_2m_min[i]! }));
};

/** Demo-site annual rainfall table (spec §5.7) [K, UNVERIFIED approximations of BoM climatology]. */
const ANNUAL_RAIN: Record<string, number> = { katoomba: 1400, grose: 1100, kanangra: 900, thredbo: 1500, gospers: 750, budawangs: 1250, barrington: 1300, warrumbungles: 750 };

describe('KBDI (spec §5.7)', () => {
  it('daily increment vectors', () => {
    expect(kbdiIncrement(100, 30, 1000)).toBeCloseTo(1.945, 3);
    expect(kbdiIncrement(50, 30, 1000)).toBeCloseTo(2.888, 3);
    expect(kbdiIncrement(100, 30, 1400)).toBeCloseTo(2.9, 2); // doc 04 §3.9: escarpment R 1400 mm
    expect(kbdiIncrement(100, 9.9, 1000)).toBe(0); // cold-day rule (D19)
    expect(kbdiIncrement(203.2, 40, 1000)).toBe(0);
  });

  it('removes the first 5 mm of each rain spell once (K 100, cold days, rain 3, 4, 2 mm → 100, 98, 96)', () => {
    const days: DailyWeather[] = [3, 4, 2].map((rain, i) => ({ date: `2020-01-0${i + 1}`, rain, tMax: 5 }));
    const k = kbdiPass(days, 1000, 100);
    expect(k[0]).toBeCloseTo(100, 9);
    expect(k[1]).toBeCloseTo(98, 9);
    expect(k[2]).toBeCloseTo(96, 9);
    // A dry day ends the spell: the next rain loses its first 5 mm again.
    const k2 = kbdiPass([...days, { date: '2020-01-04', rain: 0, tMax: 5 }, { date: '2020-01-05', rain: 6, tMax: 5 }], 1000, 100);
    expect(k2[4]).toBeCloseTo(95, 9);
  });

  it('stays within [0, 203.2]', () => {
    const hot: DailyWeather[] = Array.from({ length: 400 }, (_, i) => ({ date: `d${i}`, rain: 0, tMax: 45 }));
    const s = kbdiSeries(hot, 600);
    expect(Math.max(...s)).toBeLessThanOrEqual(203.2);
    const wet = kbdiPass([{ date: 'x', rain: 500, tMax: 20 }], 1000, 150);
    expect(wet[0]).toBe(0);
  });

  // Spec §5.7 fixture results (table R, two passes) to ±3 mm; spec §5.8 DF to ±0.3.
  const CASES: [string, string, number, number][] = [
    ['replay-gospers-2019-12-19-daily365.json', 'gospers', 125.4, 10.0],
    ['replay-grose-2019-12-19-daily365.json', 'grose', 118.6, 9.88],
    ['replay-kanangra-2019-12-17-daily365.json', 'kanangra', 76.1, 8.86],
    ['replay-budawangs-2019-12-30-daily365.json', 'budawangs', 118.9, 9.89],
    ['replay-thredbo-2020-01-02-daily365.json', 'thredbo', 63.9, 8.45],
    ['replay-katoomba-2013-10-16-daily365.json', 'katoomba', 74.9, 8.83],
    ['replay-warrumbungles-2013-01-12-daily365.json', 'warrumbungles', 145.9, 10.0],
    ['openmeteo-archive-katoomba-365d.json', 'katoomba', 58.2, 8.23],
  ];
  it.each(CASES)('%s → KBDI %s ≈ %f, DF ≈ %f', (file, site, kbdi, df) => {
    const daily = readDaily(file);
    expect(daily.length).toBe(365);
    const k = kbdiSeries(daily, ANNUAL_RAIN[site]!);
    const kLast = k[k.length - 1]!;
    expect(Math.abs(kLast - kbdi)).toBeLessThanOrEqual(0.1); // spec tolerance ±3 mm; the recomputation matches to 0.1
    const d = droughtFactor(kLast, daily.slice(-20).map((x) => x.rain));
    expect(Math.abs(d - df)).toBeLessThanOrEqual(0.02);
    const st = droughtState(daily, ANNUAL_RAIN[site]);
    expect(st.kbdi).toBeCloseTo(kLast, 9);
    expect(st.df).toBeCloseTo(d, 9);
  });

  it('two passes matter on dry sites (gospers one pass 120.8, grose 116.0)', () => {
    const g = kbdiPass(readDaily('replay-gospers-2019-12-19-daily365.json'), 750, 0);
    expect(g[g.length - 1]!).toBeCloseTo(120.8, 1);
    const r = kbdiPass(readDaily('replay-grose-2019-12-19-daily365.json'), 1100, 0);
    expect(r[r.length - 1]!).toBeCloseTo(116.0, 1);
  });

  it('katoomba now (2026-09-27): archive to 09-21 + forecast past_days local-day aggregates → KBDI 64.6, DF 8.47', () => {
    const archive = readDaily('openmeteo-archive-katoomba-365d.json');
    const fc = JSON.parse(readFileSync(FIX + 'openmeteo-forecast-katoomba.json', 'utf8')) as {
      hourly: { time: string[]; temperature_2m: number[]; precipitation: number[] };
    };
    // Local-day aggregates of the forecast hourly data (times are local clock time, utc_offset 36000).
    const agg = new Map<string, { rain: number; tMax: number; tMin: number }>();
    fc.hourly.time.forEach((t, i) => {
      const day = t.slice(0, 10);
      const a = agg.get(day) ?? { rain: 0, tMax: -Infinity, tMin: Infinity };
      a.rain += fc.hourly.precipitation[i]!;
      a.tMax = Math.max(a.tMax, fc.hourly.temperature_2m[i]!);
      a.tMin = Math.min(a.tMin, fc.hourly.temperature_2m[i]!);
      agg.set(day, a);
    });
    const last = archive[archive.length - 1]!.date;
    const daily = [...archive];
    for (const [date, a] of agg) if (date > last && date < '2026-09-27') daily.push({ date, rain: a.rain, tMax: a.tMax, tMin: a.tMin });
    const hist = daily.slice(-365);
    expect(hist[hist.length - 1]!.date).toBe('2026-09-26');
    const st = droughtState(hist, 1400);
    expect(Math.abs(st.kbdi - 64.6)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(st.df - 8.47)).toBeLessThanOrEqual(0.02);
  });
});

describe('Drought factor (spec §5.8)', () => {
  /** A single event of P mm N days ago (N = 1 is yesterday). */
  const one = (n: number, p: number): number[] => {
    const r = new Array<number>(20).fill(0);
    r[20 - n] = p;
    return r;
  };
  it.each([
    [0, 1, 20, 0.8],
    [0, 3, 20, 3.5],
    [50, 7, 20, 7.9],
    [100, 7, 20, 9.1],
    [150, 14, 20, 10.0],
    [100, 3, 50, 2.6],
    [150, 10, 50, 8.4],
  ])('DF(K %d; N %d, P %d) = %f', (k, n, p, df) => {
    expect(Math.abs(droughtFactor(k, one(n, p)) - df)).toBeLessThanOrEqual(0.05);
  });

  it('x_lim branches meet at K = 20 (0.30581 vs 0.30589)', () => {
    expect(droughtXLimit(19.9999)).toBeCloseTo(0.30581, 4);
    expect(droughtXLimit(20)).toBeCloseTo(0.30589, 4);
  });

  it('events: runs of days > 2 mm, N from the wettest day, smallest x wins; today counts with N = 0.8', () => {
    const r = new Array<number>(20).fill(0);
    r[15] = 10; // 5 days ago
    r[16] = 30; // 4 days ago — wettest day of the event
    const two = droughtFactor(100, r);
    const single = droughtFactor(100, one(4, 40));
    expect(two).toBeCloseTo(single, 9);
    // Rain ≤ 2 mm is not an event.
    expect(droughtFactor(80, one(1, 2))).toBeCloseTo(droughtFactor(80, new Array(20).fill(0)), 9);
    // Today's rain (N = 0.8) wets more than yesterday's.
    expect(droughtFactor(80, new Array(20).fill(0), 10)).toBeLessThan(droughtFactor(80, one(1, 10)));
    // Yesterday + today form one event with N = 0.8 at the wettest day (today).
    const yt = one(1, 5);
    const x = droughtFactor(80, yt, 20);
    expect(x).toBeCloseTo(droughtFactorFromX(80, Math.min(0.8 ** 1.3 / (0.8 ** 1.3 + 25 - 2), droughtXLimit(80))), 9);
  });

  it('kbdiFromDf inverts DF with no recent rain (x = x_lim)', () => {
    expect(kbdiFromDf(3)).toBe(0);
    for (const df of [6.5, 7, 8, 8.5, 9, 9.5, 9.9]) {
      const k = kbdiFromDf(df);
      expect(droughtFactorFromX(k, Math.min(1, droughtXLimit(k)))).toBeCloseTo(df, 3);
    }
    const k10 = kbdiFromDf(10);
    expect(droughtFactorFromX(k10, droughtXLimit(k10))).toBeCloseTo(10, 6);
    expect(kbdiFromDf(8)).toBeLessThan(kbdiFromDf(9));
  });

  it('Noble (1980) comparison DF behaves (dry → high, fresh rain → low, cap 10)', () => {
    expect(droughtFactorNoble(150, 30, 5)).toBe(10);
    expect(droughtFactorNoble(50, 1, 40)).toBeLessThan(droughtFactorNoble(50, 10, 40));
  });

  it('droughtState falls back to DF 7 / KBDI 60 without history and to 1.25 × total without R', () => {
    const none = droughtState(undefined);
    expect(none.df).toBe(7);
    expect(none.kbdi).toBe(60);
    expect(none.warnings.length).toBe(1);
    const daily = readDaily('replay-grose-2019-12-19-daily365.json');
    const st = droughtState(daily);
    const tot = daily.reduce((s, d) => s + d.rain, 0);
    expect(st.annualRainfall).toBeCloseTo(1.25 * tot, 6);
    expect(st.warnings.some((w) => /Annual rainfall/.test(w))).toBe(true);
  });
});
