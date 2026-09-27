/**
 * Drought state: metric Keetch–Byram Drought Index (spec §5.7, D19) and the Griffiths (1999) drought factor with the
 * Finkele et al. (2006) limit (spec §5.8, D18), plus the inverse `kbdiFromDf` (§11.5) and Noble (1980) DF for
 * comparison.
 *
 * KBDI (K, mm, 0–203.2), daily in date order, T = Tmax (°C), R = annual rainfall (mm) [V doc 04 §3.9]:
 *   ET = T < 10 ? 0 : max(0, 1e-3·(203.2 − K)·(0.968·e^{0.0875T + 1.5552} − 8.30)/(1 + 10.88·e^{−0.001736R}))
 *   K  = min(203.2, K + ET) (ET before rain); the first 5 mm of each rain spell is removed once.
 * Always two passes over the history (pass 1 from 0, pass 2 from pass 1's final K) [H D19].
 */
import type { DailyWeather } from '../../core/types';

/** KBDI upper bound (mm). */
export const KBDI_MAX = 203.2;
/** Interception removed once per rain spell (mm) [V Finkele 2006]. */
export const KBDI_SPELL_INTERCEPTION = 5;
/** Cold-day rule: no evapotranspiration when Tmax < 10 °C [H D19, NCAR / Liu et al.]. */
export const KBDI_COLD_DAY_C = 10;

/** Daily KBDI increment dK (mm) at KBDI K, daily max temperature (°C), annual rainfall (mm). */
export function kbdiIncrement(k: number, tMaxC: number, annualRainMm: number): number {
  if (!(tMaxC >= KBDI_COLD_DAY_C)) return 0;
  const et = (1e-3 * (KBDI_MAX - k) * (0.968 * Math.exp(0.0875 * tMaxC + 1.5552) - 8.3)) / (1 + 10.88 * Math.exp(-0.001736 * annualRainMm));
  return et > 0 ? et : 0;
}

/**
 * One KBDI pass from `k0`: returns the value at the end of each day. Missing rain counts as 0 and a missing Tmax as
 * a cold day (no ET), so gaps never dry the soil.
 */
export function kbdiPass(daily: readonly DailyWeather[], annualRainMm: number, k0 = 0): number[] {
  const out = new Array<number>(daily.length);
  let k = Math.min(KBDI_MAX, Math.max(0, k0));
  let removed = 0; // interception already removed in the current spell
  for (let i = 0; i < daily.length; i++) {
    const d = daily[i]!;
    k = Math.min(KBDI_MAX, k + kbdiIncrement(k, d.tMax, annualRainMm));
    const p = Number.isFinite(d.rain) && d.rain > 0 ? d.rain : 0;
    if (p > 0) {
      const rem = Math.min(p, Math.max(0, KBDI_SPELL_INTERCEPTION - removed));
      removed += rem;
      k = Math.max(0, k - (p - rem));
    } else removed = 0;
    out[i] = k;
  }
  return out;
}

/** KBDI per day after the two-pass cyclic spin-up (pass-2 values; the last entry is the KBDI of the last day). */
export function kbdiSeries(daily: DailyWeather[], annualRainfall: number): number[] {
  if (daily.length === 0) return [];
  const p1 = kbdiPass(daily, annualRainfall, 0);
  return kbdiPass(daily, annualRainfall, p1[p1.length - 1]!);
}

/** Finkele (2006) limit on the rain-recency factor x at KBDI K. The branches meet at K = 20. */
export const droughtXLimit = (k: number): number => (k < 20 ? 1 / (1 + 0.1135 * k) : 75 / (270.525 - 1.267 * k));

/** Griffiths DF from KBDI and a (limited) rain-recency factor x. */
export function droughtFactorFromX(k: number, x: number): number {
  const df = (10.5 * (1 - Math.exp(-(k + 30) / 40)) * (41 * x * x + x)) / (40 * x * x + x + 1);
  return Math.min(10, df);
}

/**
 * Rain-recency factor x (before the Finkele limit) from daily rain, `rain[last]` = the most recent day, whose N is
 * `nLast` (1 for yesterday, 0.8 for today). Events are maximal runs of consecutive days with P > 2 mm; per event
 * x_e = N^1.3/(N^1.3 + P − 2) with N = days since the event's wettest day; x = min(1, min_e x_e).
 */
export function rainRecencyX(rain: readonly number[], nLast = 1): number {
  let x = 1;
  const n = rain.length;
  let i = 0;
  while (i < n) {
    if (rain[i]! > 2) {
      let p = 0;
      let wet = i;
      let j = i;
      for (; j < n && rain[j]! > 2; j++) {
        p += rain[j]!;
        if (rain[j]! > rain[wet]!) wet = j;
      }
      let nDays = n - 1 - wet + nLast;
      if (nDays < 0.8) nDays = 0.8;
      const n13 = nDays ** 1.3;
      const xe = n13 / (n13 + p - 2);
      if (xe < x) x = xe;
      i = j;
    } else i++;
  }
  return x;
}

/**
 * Drought factor (0–10) from yesterday's KBDI and the last 20 days of rain (`rainLast20[19]` = yesterday, N = 1).
 * `rainTodayMm` (rain of the scenario day before t0) joins as the most recent day with N = 0.8.
 * Vectors: (K 0; N 1, 20 mm) 0.8; (K 50; 7, 20) 7.9; (K 100; 3, 50) 2.6.
 */
export function droughtFactor(kbdi: number, rainLast20: number[], rainTodayMm?: number): number {
  const rain = rainLast20.slice(-20).map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  let nLast = 1;
  if (rainTodayMm !== undefined && Number.isFinite(rainTodayMm) && rainTodayMm > 0) {
    rain.push(rainTodayMm);
    nLast = 0; // today's wettest day → N = 0 → 0.8
  }
  const x = Math.min(1, rainRecencyX(rain, nLast), droughtXLimit(kbdi));
  return droughtFactorFromX(kbdi, x);
}

/**
 * Noble et al. (1980) drought factor, kept for comparison only (D18) [K verify: Noble, Bary & Gill 1980]:
 * DF = 0.191(I + 104)(N + 1)^1.5 / (3.52(N + 1)^1.5 + P − 1), capped at 10; N = days since rain, P = its amount (mm).
 */
export function droughtFactorNoble(kbdi: number, daysSinceRain: number, lastRainMm: number): number {
  const n = Math.max(0, daysSinceRain) + 1;
  const n15 = n ** 1.5;
  const df = (0.191 * (kbdi + 104) * n15) / (3.52 * n15 + Math.max(0, lastRainMm) - 1);
  return Math.min(10, Math.max(0, df));
}

/**
 * KBDI consistent with a user-entered DF and no recent rain (spec §11.5): the smallest K ∈ [0, 203.2] with
 * DF(K, x = x_lim(K)) = df (scan for the first bracket, then bisection). DF below the no-rain value at K = 0 (5.54)
 * returns 0; DF at or above the cap returns the first K where DF reaches 10.
 */
export function kbdiFromDf(df: number): number {
  const f = (k: number): number => droughtFactorFromX(k, Math.min(1, droughtXLimit(k)));
  if (!(df > f(0))) return 0;
  const target = Math.min(df, 10);
  const step = 0.5;
  let lo = 0;
  let hi = -1;
  for (let k = step; k <= KBDI_MAX + 1e-9; k += step) {
    if (f(k) >= target) {
      hi = k;
      break;
    }
    lo = k;
  }
  if (hi < 0) return KBDI_MAX;
  for (let it = 0; it < 50; it++) {
    const mid = 0.5 * (lo + hi);
    if (f(mid) >= target) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** Result of {@link droughtState}. */
export interface DroughtState {
  kbdi: number;
  df: number;
  /** Pass-2 KBDI per day of `daily`. */
  kbdiDaily: number[];
  annualRainfall: number;
  warnings: string[];
}

/**
 * KBDI and DF for a scenario from its daily history (365 days ending yesterday). `annualRainfall` falls back to
 * 1.25 × the history total [H §5.7]. With no history: DF 7 and KBDI 60 with a warning (§11.5).
 */
export function droughtState(daily: DailyWeather[] | undefined, annualRainfall?: number, rainTodayMm?: number): DroughtState {
  const warnings: string[] = [];
  if (!daily || daily.length === 0) {
    warnings.push('No daily rainfall history: drought factor 7 and KBDI 60 assumed.');
    return { kbdi: 60, df: 7, kbdiDaily: [], annualRainfall: annualRainfall ?? NaN, warnings };
  }
  let r = annualRainfall;
  if (!(r !== undefined && r > 0)) {
    let tot = 0;
    for (const d of daily) tot += Number.isFinite(d.rain) && d.rain > 0 ? d.rain : 0;
    r = (1.25 * tot * 365) / Math.max(365, daily.length);
    warnings.push(`Annual rainfall unknown: using 1.25 × the last ${daily.length} days (${r.toFixed(0)} mm).`);
  }
  if (daily.length < 300) warnings.push(`Only ${daily.length} days of rainfall history: KBDI may under-read.`);
  const kbdiDaily = kbdiSeries(daily, r);
  const kbdi = kbdiDaily[kbdiDaily.length - 1]!;
  const df = droughtFactor(kbdi, daily.slice(-20).map((d) => d.rain), rainTodayMm);
  return { kbdi, df, kbdiDaily, annualRainfall: r, warnings };
}
