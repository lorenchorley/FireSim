/**
 * Closed-form ember physics vectors (spec §9.6, §9.7, §14 "embers" row, §5.10 P_ig, §8.10 Briggs).
 */
import { describe, expect, it } from 'vitest';
import { RHO_REF } from '../core/physics';
import {
  albiniBurnoutTime,
  albiniFallHeight,
  barkEngagement,
  briggsPlumeRise,
  burnoutFallCoefficient,
  convectiveNumber,
  emissionPerUnitLength,
  fallIntegral,
  fallTime,
  ignitionProbability,
  lineBuoyancyFlux,
  onsetRamp,
  terminalVelocityCylinder,
  terminalVelocityPlate,
} from './physics';
import { EMBER_PARAMS } from './params';

const rel = (a: number, b: number): number => Math.abs(a - b) / Math.abs(b);

describe('aerodynamics and burnout (§9.6) [V doc 06 §3.1–3.2]', () => {
  it('terminal velocity table (ρ_a 1.1, C_d 1.2)', () => {
    expect(terminalVelocityPlate(300, 0.002, RHO_REF)).toBeCloseTo(2.99, 2);
    expect(terminalVelocityPlate(300, 0.004, RHO_REF)).toBeCloseTo(4.22, 2);
    expect(terminalVelocityCylinder(400, 0.005, RHO_REF)).toBeCloseTo(4.83, 2);
  });

  it('Albini burnout τ = 24.3·v_t0 and z_b = v_t0·τ/2 (v_t0 5 m/s → 121.7 s, 304 m)', () => {
    expect(albiniBurnoutTime(5)).toBeCloseTo(121.7, 1);
    expect(albiniFallHeight(5)).toBeCloseTo(304, 0);
    expect(albiniFallHeight(5)).toBeCloseTo((5 * albiniBurnoutTime(5)) / 2, 6);
    expect(EMBER_PARAMS.albiniK).toBeCloseTo(24.34, 2);
  });

  it('burning fall heights: E2 (n 1/4, floor 0.3) z* = 0.8005·v_t0·τ_b; E4 (n 1, no floor) = 0.5', () => {
    expect(burnoutFallCoefficient(0.25, 0.3)).toBeCloseTo(0.8005, 4);
    expect(burnoutFallCoefficient(1, 0)).toBeCloseTo(0.5, 12);
    // with the 0.3 floor the E4 fall height would be 0.545 (why E4 has no floor)
    expect(burnoutFallCoefficient(1, 0.3)).toBeCloseTo(0.545, 3);
    expect(burnoutFallCoefficient(0.5, 0.3)).toBeGreaterThan(0.6);
  });

  it('fallIntegral is exact against a fine numerical quadrature and additive over sub-intervals', () => {
    for (const [n, floor] of [[0.25, 0.3], [0.5, 0.3], [1, 0], [1, 0.3]] as const) {
      const tau = 250;
      let num = 0;
      const N = 200000;
      for (let q = 0; q < N; q++) {
        const a = ((q + 0.5) / N) * tau;
        num += Math.max(floor, Math.pow(1 - a / tau, n)) * (tau / N);
      }
      expect(rel(fallIntegral(tau, n, floor, 0, tau), num)).toBeLessThan(1e-5);
      const parts = fallIntegral(tau, n, floor, 0, 100) + fallIntegral(tau, n, floor, 100, 249) + fallIntegral(tau, n, floor, 249, 300);
      expect(parts).toBeCloseTo(fallIntegral(tau, n, floor, 0, tau), 9);
    }
  });

  it('fallTime inverts fallIntegral (power-law and floor segments) and is +∞ beyond the burnout capacity', () => {
    for (const [n, floor] of [[0.25, 0.3], [0.5, 0.3], [1, 0], [0.5, 0]] as const) {
      const tau = 300;
      for (const a0 of [0, 50, 280]) {
        const cap = fallIntegral(tau, n, floor, a0, tau);
        for (const f of [0.1, 0.5, 0.9, 0.999]) {
          const t = fallTime(tau, n, floor, a0, f * cap);
          expect(t).toBeGreaterThanOrEqual(0);
          expect(a0 + t).toBeLessThanOrEqual(tau + 1e-9);
          expect(fallIntegral(tau, n, floor, a0, a0 + t)).toBeCloseTo(f * cap, 6);
        }
        expect(fallTime(tau, n, floor, a0, 1.001 * cap + 1e-6)).toBe(Infinity);
      }
    }
    expect(fallTime(100, 0.5, 0.3, 0, 0)).toBe(0);
    expect(fallTime(100, 0.5, 0.3, 100, 1)).toBe(Infinity);
  });
});

describe('plume relations', () => {
  it('line buoyancy flux table (doc 06 eq 9, χ = 1, ρ 1.1, T 303 K)', () => {
    expect(lineBuoyancyFlux(1000, 1.1, 303, 1)).toBeCloseTo(29.3, 1);
    expect(lineBuoyancyFlux(10000, 1.1, 303, 1)).toBeCloseTo(293, 0);
    expect(Math.cbrt(lineBuoyancyFlux(20000, 1.1, 303, 1))).toBeCloseTo(8.4, 1);
    expect(lineBuoyancyFlux(0, 1.1, 303)).toBe(0);
  });

  it('Byram N_c (doc 06 table: 10 MW/m, U 5 → 4.7; 1 MW/m, U 3 → 2.2)', () => {
    expect(convectiveNumber(lineBuoyancyFlux(10000, 1.1, 303, 1), 5, 0)).toBeCloseTo(4.7, 1);
    expect(convectiveNumber(lineBuoyancyFlux(1000, 1.1, 303, 1), 3, 0)).toBeCloseTo(2.2, 1);
  });

  it('Briggs vectors (§8.10: ρ 1.2, T 293): 1 GW U 5 N 0.01 → F 8837, windy 677, calm 1533 → 677 m; 10 GW → 1459 m', () => {
    const b = briggsPlumeRise(1e9, 5, 0.01);
    expect(b.flux).toBeCloseTo(8837, -1);
    expect(b.windy).toBeCloseTo(677, 0);
    expect(b.calm).toBeCloseTo(1533, -1);
    expect(b.rise).toBeCloseTo(677, 0);
    expect(briggsPlumeRise(1e10, 5, 0.01).rise).toBeCloseTo(1459, 0);
  });

  it('1 km × 10 MW/m line fire, N 0.01, U 10 → plume top 1.2 km ± 30 % (§9.7)', () => {
    // heat entering the plume χ_c·I·L with ρ 1.1, T 303 K (doc 06 §3.3 worked example)
    const b = briggsPlumeRise(EMBER_PARAMS.transport.chi * 1e7 * 1000, 10, 0.01, 1.1, 303);
    expect(b.rise).toBeGreaterThan(1200 * 0.7);
    expect(b.rise).toBeLessThan(1200 * 1.3);
    const noChi = briggsPlumeRise(1e10, 10, 0.01, 1.1, 303);
    expect(noChi.flux).toBeCloseTo(9.3e4, -3);
    expect(noChi.rise).toBeCloseTo(1175, -1);
  });
});

describe('Schroeder P_ig (§5.10) [V behave ignite.cpp]', () => {
  it('vectors at T_f 30 °C and 20 °C', () => {
    const m30 = [3, 5, 6, 7, 10, 12, 15, 20, 25];
    const p30 = [0.811, 0.61, 0.529, 0.458, 0.293, 0.214, 0.129, 0.049, 0.014];
    m30.forEach((m, q) => expect(ignitionProbability(30, m)).toBeCloseTo(p30[q]!, 3));
    expect(ignitionProbability(20, 5)).toBeCloseTo(0.571, 3);
    expect(ignitionProbability(20, 10)).toBeCloseTo(0.267, 3);
  });

  it('is monotone decreasing in M and bounded', () => {
    let prev = 1;
    for (let m = 0; m <= 40; m += 0.5) {
      const p = ignitionProbability(35, m);
      expect(p).toBeLessThanOrEqual(prev + 1e-12);
      expect(p).toBeGreaterThanOrEqual(0);
      prev = p;
    }
    expect(ignitionProbability(30, 6) / ignitionProbability(30, 18)).toBeGreaterThan(5);
  });
});

describe('emission per unit front length (§9.2, D52)', () => {
  it('reference 10 MW/m, BH 3, e = g = 1 → 9e-5 m⁻¹ s⁻¹ = 324 brands km⁻¹ h⁻¹', () => {
    const q = emissionPerUnitLength(10000, 3, 20);
    expect(q).toBeCloseTo(9e-5, 10);
    expect(q * 1000 * 3600).toBeCloseTo(324, 6);
  });

  it('bark hazard triples per score; onset ramp and bark engagement', () => {
    expect(emissionPerUnitLength(10000, 3, 20) / emissionPerUnitLength(10000, 2, 20)).toBeCloseTo(3, 12);
    expect(onsetRamp(500)).toBe(0);
    expect(onsetRamp(1250)).toBeCloseTo(0.5, 12);
    expect(onsetRamp(2000)).toBe(1);
    expect(barkEngagement(1)).toBe(0);
    expect(barkEngagement(4.5)).toBeCloseTo(0.5, 12);
    expect(barkEngagement(12)).toBe(1);
    expect(emissionPerUnitLength(400, 4, 20)).toBe(0);
  });
});
