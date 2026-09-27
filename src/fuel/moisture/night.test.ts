import { describe, expect, it } from 'vitest';
import type { StableNightInput } from '../../core/types';
import { initialStableNight, stableNight, stableNightGate } from '../../core/physics';
import { solarPosition, sunTimes } from '../../terrain';
import { hoursSinceSunrise, spinUpStableNight } from './night';
import { diurnalSeries } from './testing';

const H = 3.6e6;
const nightIn = (time: number, u10 = 1, cloud = 0): StableNightInput => ({ time, sunElevation: -10, hoursSinceSunrise: 15, u10, cloudPct: cloud, rain24: 0 });

describe('stableNight() (spec §5.2a, core/physics)', () => {
  it('growth on a calm clear night from 0 (Δθ_max 5): 3 h → 3.16 K, 6 h → 4.32 K', () => {
    const s = initialStableNight(null);
    stableNight(s, nightIn(3 * H), 3 * 3600);
    expect(s.dTheta).toBeCloseTo(3.16, 2);
    expect(s.gate).toBe(1);
    stableNight(s, nightIn(6 * H), 3 * 3600);
    expect(s.dTheta).toBeCloseTo(4.32, 2);
    expect(s.sn).toBe(1);
  });

  it('windy spell (g = 0) from 4 K for 1 h → 1.47 K', () => {
    const s = { ...initialStableNight(null), dTheta: 4 };
    stableNight(s, nightIn(H, 8), 3600);
    expect(s.gate).toBe(0);
    expect(s.dTheta).toBeCloseTo(1.47, 2);
    expect(s.sn).toBeCloseTo(1.47 / 3, 2);
  });

  it('is exact for any Δt: one 6 h step = 2160 steps of 10 s', () => {
    const a = initialStableNight(null);
    stableNight(a, nightIn(6 * H, 3.8, 40), 6 * 3600);
    const b = initialStableNight(null);
    for (let i = 1; i <= 2160; i++) stableNight(b, nightIn(i * 10000, 3.8, 40), 10);
    expect(b.dTheta).toBeCloseTo(a.dTheta, 9);
  });

  it('sunrise with Δθ_sr 4.5 K: 1 h later 3.21 K, 0 at t_break (3.5 h), +1.5 h after rain', () => {
    const tSr = 1_000 * H;
    const s = { ...initialStableNight(null), dTheta: 4.5 };
    const day = (hrs: number, rain24 = 0): StableNightInput => ({ time: tSr + hrs * H, sunElevation: 5 + hrs * 10, hoursSinceSunrise: hrs, u10: 1, cloudPct: 0, rain24 });
    stableNight(s, day(0), 0);
    expect(s.dThetaAtSunrise).toBeCloseTo(4.5, 9);
    expect(s.tBreak).toBe(tSr + 3.5 * H);
    stableNight(s, day(1), 3600);
    expect(s.dTheta).toBeCloseTo(3.21, 2);
    stableNight(s, day(3.5), 2.5 * 3600);
    expect(s.dTheta).toBe(0);
    const w = { ...initialStableNight(null), dTheta: 4.5 };
    stableNight(w, day(0, 3), 0);
    expect(w.tBreak).toBe(tSr + 5 * H);
  });

  it('a step spanning sunrise is split: night part, then day part (hourly = 10 s trajectory)', () => {
    const tSr = 2_000 * H;
    const inp = (t: number): StableNightInput => {
      const hss = (t - tSr) / H;
      return { time: t, sunElevation: hss >= 0 ? hss * 10 : -5, hoursSinceSunrise: hss >= 0 ? hss : hss + 24, u10: 1, cloudPct: 0, rain24: 0 };
    };
    const a = { ...initialStableNight(null), dTheta: 3 };
    stableNight(a, inp(tSr + 0.4 * H), 3600); // 0.6 h night + 0.4 h day
    const b = { ...initialStableNight(null), dTheta: 3 };
    for (let t = tSr - 0.6 * H + 10000; t <= tSr + 0.4 * H + 1; t += 10000) stableNight(b, inp(t), 10);
    expect(a.tSunrise).toBe(tSr);
    expect(b.tSunrise!).toBeGreaterThanOrEqual(tSr);
    expect(Math.abs(b.tSunrise! - tSr)).toBeLessThanOrEqual(10000);
    expect(a.dTheta).toBeCloseTo(b.dTheta, 2);
  });

  it('Δθ never increases by day and is continuous at sunrise (≤ 0.3 K per 600 s)', () => {
    const tSr = 3_000 * H;
    const s = { ...initialStableNight({ dThetaMax: 6, hInv: 150 }), dTheta: 5.9 };
    let prev = s.dTheta;
    for (let t = tSr - H; t <= tSr + 5 * H; t += 600000) {
      const hss = (t - tSr) / H;
      stableNight(s, { time: t, sunElevation: hss * 12, hoursSinceSunrise: hss >= 0 ? hss : hss + 24, u10: 1, cloudPct: 0, rain24: 0 }, 600);
      expect(Math.abs(s.dTheta - prev)).toBeLessThan(0.3);
      if (hss > 0) expect(s.dTheta).toBeLessThanOrEqual(prev + 1e-12);
      prev = s.dTheta;
    }
    expect(s.dTheta).toBe(0);
  });

  it('breakEta from the 3-D atmosphere moves t_break', () => {
    const s = { ...initialStableNight(null), dTheta: 4 };
    stableNight(s, { time: 10 * H, sunElevation: 3, hoursSinceSunrise: 0.1, u10: 1, cloudPct: 0, rain24: 0, breakEta: 7200 }, 360);
    expect(s.tBreak).toBe(10 * H + 7200e3);
  });

  it('gate: smooth in wind (3–5 m/s) and cloud (37.5–62.5 %)', () => {
    expect(stableNightGate(2, 0)).toBe(1);
    expect(stableNightGate(4, 0)).toBeCloseTo(0.5, 9);
    expect(stableNightGate(6, 0)).toBe(0);
    expect(stableNightGate(1, 50)).toBeCloseTo(0.5, 9);
    expect(stableNightGate(1, 70)).toBe(0);
  });
});

describe('stable-night spin-up over a series', () => {
  it('a 19:00 LMST start on the calm-night preset (15 Mar) begins with ≈ 1.3 K (this sun model: 1.46 K)', () => {
    const lon = 150.3;
    const lmstMidnight = Date.UTC(2026, 2, 15) - (lon / 15) * H;
    const t0 = lmstMidnight + 19 * H;
    const series = diurnalSeries(t0 - 48 * H, 60, { tMin: 8, tMax: 24, td: 6, uDay: 2, uNight: 1.5, cloud: 0, dir: 270 }, { lat: -33.715, lon }, 900, { dThetaMax: 6, hInv: 150 });
    const s = spinUpStableNight(series, t0);
    expect(s.dThetaMax).toBe(6);
    expect(s.dTheta).toBeGreaterThan(1.0);
    expect(s.dTheta).toBeLessThan(1.6);
    // A 07:00 start the next morning inherits the night's cold pool.
    const s7 = spinUpStableNight(series, t0 + 12 * H);
    expect(s7.dTheta).toBeGreaterThan(2);
    const sr = sunTimes(t0 + 12 * H, -33.715, lon).sunrise;
    expect(s7.tSunrise).not.toBeNull();
    expect(Math.abs(s7.tSunrise! - sr)).toBeLessThan(15 * 60000);
  });

  it('hoursSinceSunrise is positive after sunrise and refers to the previous sunrise at night', () => {
    const t = Date.UTC(2026, 9, 15, 4); // 14:00 AEST
    const hss = hoursSinceSunrise(t, -33.7, 150.3);
    expect(hss).toBeGreaterThan(8);
    expect(hss).toBeLessThan(10);
    expect(solarPosition(t, -33.7, 150.3).elevation).toBeGreaterThan(0);
    const tn = Date.UTC(2026, 9, 15, 16); // 02:00 AEST
    expect(hoursSinceSunrise(tn, -33.7, 150.3)).toBeGreaterThan(18);
  });
});
