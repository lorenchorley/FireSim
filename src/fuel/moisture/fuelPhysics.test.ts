import { describe, expect, it } from 'vitest';
import { esat } from '../../core/physics';
import {
  columnEmc,
  dewStore,
  dewTerm,
  droughtDamping,
  ignitionProbability,
  relaxMoisture,
  timeLagRatio,
  vanWagnerEd,
  vanWagnerEw,
  vanWagnerRate,
} from './fuelPhysics';
import { forestMoisture } from './afdrs';
import { esatFast, vanWagnerEdFast, vanWagnerRateFast } from './fastMath';

describe('Van Wagner time-lag ratio f_τ (spec §5.5)', () => {
  it.each([
    [30, 5, 30, 1.0],
    [15, 20, 35, 0.609],
    [20, 10, 30, 0.851],
    [60, 5, 15, 2.274],
    [80, 2, 12, 4.693],
  ])('f_τ(H %d, W %d km/h, T %d) = %f', (h, w, t, f) => {
    expect(timeLagRatio(h, w, t)).toBeCloseTo(f, 3);
  });

  it('is clamped to [0.3, 5]', () => {
    expect(timeLagRatio(1, 60, 45)).toBeGreaterThanOrEqual(0.3);
    expect(timeLagRatio(99, 0, -5)).toBe(5);
  });

  it('the exponential update is stable and monotone for any Δt (3 h, 24 h)', () => {
    for (const dt of [600, 3 * 3600, 24 * 3600]) {
      for (const [m0, eq] of [
        [30, 6],
        [4, 20],
      ] as const) {
        const m = relaxMoisture(m0, eq, 0.3, dt);
        expect(m).toBeGreaterThanOrEqual(Math.min(m0, eq) - 1e-9);
        expect(m).toBeLessThanOrEqual(Math.max(m0, eq) + 1e-9);
      }
    }
    // Drying uses τ = 1.5 h, wetting τ = 2 h (f_τ = 1): after one τ, 1/e of the gap remains.
    expect(relaxMoisture(20, 10, 1, 1.5 * 3600)).toBeCloseTo(10 + 10 / Math.E, 9);
    expect(relaxMoisture(10, 20, 1, 2 * 3600)).toBeCloseTo(20 - 10 / Math.E, 9);
  });
});

describe('Schroeder ignition probability (spec §5.10)', () => {
  it.each([
    [30, 3, 0.811],
    [30, 5, 0.61],
    [30, 6, 0.529],
    [30, 7, 0.458],
    [30, 10, 0.293],
    [30, 12, 0.214],
    [30, 15, 0.129],
    [30, 20, 0.049],
    [30, 25, 0.014],
    [20, 5, 0.571],
    [20, 10, 0.267],
  ])('P_ig(T_f %d, M %d) = %f', (t, m, p) => {
    expect(Math.abs(ignitionProbability(t, m) - p)).toBeLessThanOrEqual(0.0015);
  });
  it('is 0 for saturated fuel and monotone in M', () => {
    expect(ignitionProbability(20, 60)).toBe(0);
    let prev = 2;
    for (let m = 2; m < 40; m++) {
      const p = ignitionProbability(25, m);
      expect(p).toBeLessThanOrEqual(prev);
      prev = p;
    }
  });
});

describe('Van Wagner EMC and dew', () => {
  it('E_d and E_w are ordered (drying above wetting) and increase with H', () => {
    let prev = -1;
    for (let h = 5; h <= 95; h += 10) {
      expect(vanWagnerEd(h, 20)).toBeGreaterThan(vanWagnerEw(h, 20));
      expect(vanWagnerEd(h, 20)).toBeGreaterThan(prev);
      prev = vanWagnerEd(h, 20);
    }
  });
  it('dew accumulates when T_f < T_d, capped at 0.09 mm/h, dries by day; D ≤ 40 pp', () => {
    expect(dewStore(0, 5, 6, 0, 1)).toBeCloseTo(0.02, 9);
    expect(dewStore(0, 0, 10, 0, 1)).toBeCloseTo(0.09, 9);
    expect(dewStore(0.2, 20, 10, 300, 1)).toBeCloseTo(0, 9);
    expect(dewTerm(0.15)).toBeCloseTo(50 > 40 ? 40 : 50, 9);
    expect(dewTerm(0.03)).toBeCloseTo(10, 9);
  });
  it('drought damping halves terrain contrasts at DF 10', () => {
    expect(droughtDamping(7)).toBe(1);
    expect(droughtDamping(10)).toBeCloseTo(0.5, 9);
  });
});

describe('fast tables match the exact functions', () => {
  it('esat, E_d and k to < 1e-5 relative', () => {
    for (let t = -20; t <= 55; t += 0.37) expect(Math.abs(esatFast(t) / esat(t) - 1)).toBeLessThan(1e-5);
    for (let h = 1; h <= 100; h += 0.73) {
      for (const t of [0, 15, 32.3, 45]) {
        expect(Math.abs(vanWagnerEdFast(h, t) - vanWagnerEd(h, t))).toBeLessThan(1e-4);
        expect(Math.abs(vanWagnerRateFast(h, Math.sqrt(12), t) / vanWagnerRate(h, 12, t) - 1)).toBeLessThan(1e-4);
      }
    }
  });
});

/**
 * Spec §5.4 calibration check: 15 Oct 14:00 LMST at 33.7° S (sun 49.9° / 301.7°), clear-sky DNI 900, DHI 110 W/m²,
 * 30° slopes, T 25 °C, RH 30 %, U10 15 km/h, WRF 3.5, c 0.6, LAI 1.5. Spec: E_ref 4.82 %, anomalies NW −0.62,
 * N −0.19, W −0.46, E +1.42, S +1.09, SE +1.62, NW − SE −2.24 (band [−3.5, −1.2]).
 * This implementation of the §5.4 equations (isotropic slope diffuse) gives E_ref 4.98 and NW − SE −2.41: within
 * the acceptance band; the per-aspect values agree to ±0.13 pp (see the module report for the deviation note).
 */
describe('anomaly calibration case (spec §5.4, V7)', () => {
  const h = 49.9;
  const az = 301.7;
  const DNI = 900;
  const DHI = 110;
  const uF = 15 / 3.6 / (2 * 3.5);
  const base = { tC: 25, rh: 30, cover: 0.6, lai: 1.5, sunElevDeg: h, uF, cloudFrac: 0 };
  const beta = (30 * Math.PI) / 180;
  const sx = Math.sin((az * Math.PI) / 180) * Math.cos((h * Math.PI) / 180);
  const sy = Math.cos((az * Math.PI) / 180) * Math.cos((h * Math.PI) / 180);
  const sz = Math.sin((h * Math.PI) / 180);
  const ref = columnEmc({ ...base, direct: DNI * sz, diffuse: DHI });
  const anomaly = (aspect: number): number => {
    const a = (aspect * Math.PI) / 180;
    const cosi = Math.max(0, sx * Math.sin(beta) * Math.sin(a) + sy * Math.sin(beta) * Math.cos(a) + sz * Math.cos(beta));
    return columnEmc({ ...base, direct: DNI * cosi, diffuse: (DHI * (1 + Math.cos(beta))) / 2 }).e - ref.e;
  };
  it('reference column E_ref ≈ 4.82 % and below the AFDRS period-1 value 6.01 by < 1.5 pp (no calibration log)', () => {
    expect(ref.e).toBeGreaterThan(4.82 - 0.2);
    expect(ref.e).toBeLessThan(4.82 + 0.2);
    expect(forestMoisture(1, 25, 30)).toBeCloseTo(6.01, 2);
    expect(Math.abs(forestMoisture(1, 25, 30) - ref.e)).toBeLessThan(1.5);
  });
  it('per-aspect anomalies match the spec to ±0.15 pp and NW − SE lies in [−3.5, −1.2]', () => {
    const spec: [number, number][] = [
      [315, -0.62],
      [0, -0.19],
      [270, -0.46],
      [90, 1.42],
      [180, 1.09],
      [135, 1.62],
    ];
    for (const [asp, v] of spec) expect(Math.abs(anomaly(asp) - v)).toBeLessThan(0.15);
    const d = anomaly(315) - anomaly(135);
    expect(d).toBeGreaterThan(-3.5);
    expect(d).toBeLessThan(-1.2);
  });
});
