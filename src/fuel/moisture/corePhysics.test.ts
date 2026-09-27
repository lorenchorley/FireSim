/**
 * Vectors of the shared helpers in src/core/physics.ts (spec §0.3, §14 row "core/physics"; owner: fuel/moisture).
 * stableNight() itself is covered in night.test.ts. Reference values recomputed independently (Python).
 */
import { describe, expect, it } from 'vitest';
import {
  airDensity,
  dewPointC,
  esat,
  exner,
  localDate,
  lmstHour,
  logistic,
  pressureIsa,
  rhFromTd,
  season,
  stableNight,
  stableNightGate,
  initialStableNight,
  theta,
  vpdKpa,
} from '../../core/physics';

describe('core/physics helpers (spec §0.3)', () => {
  it('esat (Bolton 1980, hPa)', () => {
    expect(esat(0)).toBeCloseTo(6.112, 6);
    expect(esat(20)).toBeCloseTo(23.3695, 3);
    expect(esat(35)).toBeCloseTo(56.3116, 3);
    expect(esat(-10)).toBeCloseTo(2.8677, 3);
  });

  it('dewPointC is the exact inverse of esat; rhFromTd round-trips and clamps', () => {
    for (const t of [-5, 10, 25, 40])
      for (const rh of [5, 30, 60, 99]) {
        const td = dewPointC(t, rh);
        expect(rhFromTd(t, td)).toBeCloseTo(rh, 9);
      }
    expect(dewPointC(20, 100)).toBeCloseTo(20, 9);
    expect(rhFromTd(20, 25)).toBe(100);
    expect(Number.isFinite(dewPointC(20, 0))).toBe(true); // RH clamped to 0.1 %
  });

  it('ISA pressure 1013.3 / 898.7 / 795.0 hPa at 0 / 1000 / 2000 m (§11.5 vectors)', () => {
    expect(pressureIsa(0)).toBeCloseTo(1013.25, 6);
    expect(pressureIsa(1000)).toBeCloseTo(898.75, 1);
    expect(pressureIsa(2000)).toBeCloseTo(794.95, 1);
  });

  it('exner, θ, air density, VPD, logistic', () => {
    expect(exner(1000)).toBe(1);
    expect(theta(20, 900)).toBeCloseTo(302.108, 2);
    expect(airDensity(20, 1013.25)).toBeCloseTo(1.20433, 4);
    expect(vpdKpa(30, 20)).toBeCloseTo(3.3965, 3);
    expect(vpdKpa(30, 120)).toBe(0);
    expect(logistic(0)).toBe(0.5);
  });

  it('localDate (UTC date of ms + 12 h) and season; lmstHour at 150.3° E', () => {
    expect(localDate(Date.UTC(2019, 9, 25, 13))).toBe('2019-10-26'); // NPWS local-midnight stamp
    expect(localDate(Date.UTC(2013, 0, 12, 0))).toBe('2013-01-12'); // NPWS UTC-midnight stamp
    expect(season(Date.UTC(2019, 11, 19, 3))).toBe(2019);
    expect(season(Date.UTC(2020, 0, 2, 3))).toBe(2019);
    expect(season(Date.UTC(2020, 7, 2, 3))).toBe(2020);
    expect(lmstHour(Date.UTC(2026, 9, 15, 4), 150.3)).toBeCloseTo(14.02, 9);
    expect(lmstHour(Date.UTC(2026, 9, 15, 20), 150.3)).toBeCloseTo(6.02, 9);
  });

  it('stableNight gate edges: 1 calm & clear, 0.5 at 4 m/s, 0 at ≥ 5 m/s or ≥ 62.5 % cloud', () => {
    expect(stableNightGate(0, 0)).toBe(1);
    expect(stableNightGate(4, 0)).toBeCloseTo(0.5, 12);
    expect(stableNightGate(5, 0)).toBe(0);
    expect(stableNightGate(0, 50)).toBeCloseTo(0.5, 12);
    expect(stableNightGate(0, 62.5)).toBe(0);
    expect(stableNightGate(NaN, NaN)).toBe(1);
  });

  it('stableNight is exact for any Δt on a partly gated night (g = 0.5): one 4 h step = 1440 steps of 10 s', () => {
    const a = { ...initialStableNight(null), dTheta: 1 };
    const b = { ...a };
    const inp = { time: 0, sunElevation: -30, hoursSinceSunrise: 15, u10: 4, cloudPct: 0, rain24: 0 };
    stableNight(a, inp, 4 * 3600);
    for (let i = 0; i < 1440; i++) stableNight(b, { ...inp, time: (i + 1) * 10000 }, 10);
    expect(a.dTheta).toBeCloseTo(b.dTheta, 9);
    // Equilibrium of g = 0.5: (g·Δθ_max/3 h)/(g/3 h + (1 − g)/1 h) = 5·(1/6)/(1/6 + 1/2) = 1.25 K.
    const c = { ...initialStableNight(null) };
    stableNight(c, inp, 100 * 3600);
    expect(c.dTheta).toBeCloseTo(1.25, 9);
    expect(c.sn).toBeCloseTo(1.25 / 3, 9);
    expect(c.gate).toBeCloseTo(0.5, 12);
  });
});
