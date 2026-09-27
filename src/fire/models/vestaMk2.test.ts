/** Spec §6.2 Vesta Mk2 vectors (+ mixing, gate, low wind, R0 floor) and §5.9 availability vectors. */
import { describe, expect, it } from 'vitest';
import { fuelAvailabilityMk2, fuelAvailabilityWet, wetForestC1 } from './common';
import { expectVector } from './testUtil';
import { createMk2Out, mk2InRange, mk2PhiM, understoreyHeight, vestaMk2Core } from './vestaMk2';

const run = (u10: number, m: number, fa: number, fl: number, hu: number, wrf: number, normalised = false) => {
  const o = createMk2Out();
  vestaMk2Core(u10, m, fa, fl, hu, wrf, normalised, o);
  return o;
};

describe('Vesta Mk2 (spec §6.2)', () => {
  const cases: [number, number, number, number, number, [string, string, string, string, string, string, string], number][] = [
    [30, 6, 10, 15, 1.5, ['0.868', '487.4', '1680.9', '2611.7', '1.000', '0.466', '2114.2'], 2],
    [10, 8, 8, 15, 1.0, ['0.657', '119.8', '420.5', '534.4', '0.981', '0.000', '414.9'], 2],
    [40, 5, 10, 15, 1.5, ['0.943', '699.8', '2317.2', '3999.7', '1.000', '0.992', '3986.6'], 3],
  ];
  for (const [u10, m, df, fl, hu, v, phase] of cases) {
    it(`(${u10}, ${m}, ${df}, ${fl}, ${hu}) WRF 3`, () => {
      const o = run(u10, m, fuelAvailabilityMk2(df), fl, hu, 3);
      expectVector(o.fme, v[0], 0, 'FME');
      expectVector(o.r1, v[1], 1, 'R1');
      expectVector(o.r2, v[2], 1, 'R2');
      expectVector(o.r3, v[3], 1, 'R3');
      expectVector(o.p2, v[4], 0, 'P2');
      expectVector(o.p3, v[5], 0, 'P3');
      expectVector(o.rw, v[6], 1, 'ROS');
      expect(o.phase).toBe(phase);
    });
  }

  it('wet forest (30, 8, 10, 18, 1.5; WRF 5, KBDI 100): C1 0.430, FME 0.239, ROS 330.0', () => {
    expectVector(wetForestC1(100, 5), '0.430');
    const fa = fuelAvailabilityWet(10, 100, 5);
    const o = run(30, 8, fa, 18, 1.5, 5);
    expectVector(o.fme, '0.239');
    expectVector(o.rw, '330.0', 1);
  });

  it('WRF 5 (30, 6, 10, 5, 1.0): coded 1478, normalised 1262, P2 0.822', () => {
    const fa = fuelAvailabilityMk2(10);
    const c = run(30, 6, fa, 5, 1.0, 5, false);
    const n = run(30, 6, fa, 5, 1.0, 5, true);
    expectVector(c.rw, 1478, 1);
    expectVector(n.rw, 1262, 1);
    expectVector(c.p2, '0.822');
  });

  it('P3 gate (80, 4, 10, 1, 0.2; WRF 5): R2 296.8, ROS 296.8 (no gate would give 9669)', () => {
    const o = run(80, 4, fuelAvailabilityMk2(10), 1, 0.2, 5);
    expectVector(o.r2, '296.8', 1);
    expect(o.p3).toBe(0);
    expectVector(o.rw, '296.8', 1);
    // Without the gate the phase-3 term dominates: P3 = logistic(...) ≈ 1 → ≈ 9669 m/h.
    const p3NoGate = 1 / (1 + Math.exp(-(-32.3074 + 0.2951 * 80 + 26.8734 * o.fme)));
    const noGate = o.r1 * (1 - o.p2) + o.r2 * o.p2 * (1 - p3NoGate) + o.r3 * p3NoGate;
    expect(o.p2).toBeGreaterThan(0.5);
    expectVector(noGate, 9669, 1);
  });

  it('low wind (M 8, DF 10, FL 16.4, H_u 1.058, WRF 3.5): FME 0.690, R0 20.7; U10 0 → mix 10.2, R_w 20.7; 1/3.6/5/10', () => {
    const fa = fuelAvailabilityMk2(10);
    const o0 = run(0, 8, fa, 16.4, 1.058, 3.5);
    // Spec prints FME 0.690: φM(8)·FA(10) = 0.69189·0.99843 = 0.6908 (truncated in the spec; R0 20.7 = 30·0.6908).
    expect(Math.abs(o0.fme - 0.690)).toBeLessThan(0.001);
    expectVector(o0.r0, '20.7', 0);
    expectVector(o0.rosMix, '10.2', 0);
    expectVector(o0.rw, '20.7', 0);
    expectVector(run(1, 8, fa, 16.4, 1.058, 3.5).rw, '46.8', 0);
    const o36 = run(3.6, 8, fa, 16.4, 1.058, 3.5);
    expectVector(o36.rw, '156.7', 0);
    expectVector(o36.p2, '0.856');
    expectVector(run(5, 8, fa, 16.4, 1.058, 3.5).rw, '218.6', 0);
    expectVector(run(10, 8, fa, 16.4, 1.058, 3.5).rw, '415.0', 0);
  });

  it('H_u of the DryForestShrubby row is 1.058 m; R0 = 30·FME and R_w ≥ R0 everywhere (D44)', () => {
    expectVector(understoreyHeight(3.3, 2.0), '1.058');
    expect(understoreyHeight(0, 0)).toBe(0.05);
    for (let u = 0; u <= 80; u += 0.5)
      for (let m = 3; m <= 26; m += 1.5) {
        const o = run(u, m, 0.9, 12, 1, 3.5);
        expect(o.r0).toBeCloseTo(30 * o.fme, 10);
        expect(o.rw).toBeGreaterThanOrEqual(o.r0);
      }
  });

  it('D21 ramp: R1 continuous in u and equal to the coded R1 for u ≤ 2 and u ≥ 3', () => {
    const fme = 0.7;
    const coded = (u: number) => 1000 * (u > 2 ? 0.03 + 0.05024 * (u - 1) ** 0.92628 * 1.2 ** 0.79928 : 0.03) * fme;
    for (const u of [0.5, 1.5, 2, 3, 3.5, 6, 20]) expect(run(u * 3, 4, fme, 12, 1, 3).r1).toBeCloseTo(coded(u), 6);
    let prev = run(2 * 3, 4, fme, 12, 1, 3).r1;
    for (let u = 2.01; u <= 3; u += 0.01) {
      const r = run(u * 3, 4, fme, 12, 1, 3).r1;
      expect(Math.abs(r - prev)).toBeLessThan(5);
      prev = r;
    }
  });

  it('φM table and availability vectors (spec §5.9, doc 03 §3.5)', () => {
    const phi = [1.0, 0.87, 0.69, 0.51, 0.37, 0.23, 0.17];
    [4, 6, 8, 10, 12, 15, 20].forEach((m, i) => expectVector(mk2PhiM(m), phi[i]!.toFixed(2)));
    expect(mk2PhiM(25)).toBe(0);
    const fa = ['0.136', '0.285', '0.504', '0.723', '0.872', '0.950', '0.984', '0.998'];
    [3, 4, 5, 6, 7, 8, 9, 10].forEach((df, i) => expectVector(fuelAvailabilityMk2(df), fa[i]!));
    expectVector(wetForestC1(100, 4), '0.762');
    const wet: Record<number, string[]> = {
      3.5: ['0.939', '0.966', '0.983', '0.993', '0.998'],
      4.5: ['0.061', '0.298', '0.736', '0.954', '0.998'],
      5: ['0.010', '0.034', '0.345', '0.893', '0.998'],
    };
    for (const [w, vals] of Object.entries(wet)) [0, 50, 100, 150, 200].forEach((kbdi, i) => expectVector(fuelAvailabilityWet(10, kbdi, Number(w)), vals[i]!));
    expect(wetForestC1(37, 3)).toBe(1);
  });

  it('validated range: 5 ≤ U10 ≤ 70, 4 ≤ M ≤ 20, WRF ∈ [3, 5]', () => {
    expect(mk2InRange(30, 6, 3)).toBe(true);
    expect(mk2InRange(4, 6, 3)).toBe(false);
    expect(mk2InRange(30, 21, 3)).toBe(false);
    expect(mk2InRange(30, 6, 2.5)).toBe(false);
  });

  it('monotone: ROS rises with wind and falls with moisture (FL 15, WRF 3.5)', () => {
    let prev = 0;
    for (let u = 0; u <= 100; u += 1) {
      const r = run(u, 7, 0.95, 15, 1.2, 3.5).rw;
      expect(r).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = r;
    }
    prev = Infinity;
    for (let m = 3; m <= 25; m += 0.5) {
      const r = run(30, m, 0.95, 15, 1.2, 3.5).rw;
      expect(r).toBeLessThanOrEqual(prev + 1e-9);
      prev = r;
    }
  });
});
