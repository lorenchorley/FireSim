/**
 * Spec §14 atmosphere test vectors (§8.1–§8.10): stretch ratio, C_D (2), κ fallback 0.7831, Q_h (4), slope flow (4),
 * first-layer fraction (2), C-Haines (3 + preset), Briggs (2), N_c (5).
 */
import { describe, expect, it } from 'vitest';
import { atmosCellSize, canopyDrag, stretchRatio } from './grid';
import { logLawKappa } from './profile';
import { anabaticSpeed, crownLayerFraction, expLayerFraction, katabaticSpeed, netRadiation, sensibleHeatFlux } from './surface';
import { interpolateHour } from './weatherInterp';
import { briggsRise, byramNc, cHaines, plumeColumn, pyroFirepowerThreshold } from './plume';
import { buildProfile } from './profile';
import { airDensity, exner } from '../core/physics';

/** §14 tolerance: half a unit of the last printed digit, or ±0.1 % for closed forms, whichever is larger. */
function near(actual: number, expected: number, lastDigit: number): void {
  const tol = Math.max(lastDigit / 2, Math.abs(expected) * 1e-3);
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol + 1e-12);
}

describe('§8.1 grid vectors', () => {
  it('stretch ratio: 24 levels / 3000 m, Δζ₁ 25 → 1.1211; 20 / 3000, Δζ₁ 30 → 1.148', () => {
    near(stretchRatio(24, 25, 3000), 1.1211, 1e-4);
    near(stretchRatio(20, 30, 3000), 1.148, 1e-3);
  });
  it('Δx_a = clamp(extent/N_tier, 100, 270): 9 km → 200/150 m; 3 km → 100 m; 12 km → 267/200 m', () => {
    expect(atmosCellSize(9000, 'standard')).toBeCloseTo(200, 6);
    expect(atmosCellSize(9000, 'high')).toBeCloseTo(150, 6);
    expect(atmosCellSize(3000, 'standard')).toBe(100);
    expect(atmosCellSize(12000, 'standard')).toBeCloseTo(266.67, 1);
    expect(atmosCellSize(12000, 'high')).toBeCloseTo(200, 6);
  });
  it('C_D (D51): H̄ 20 m → 0.030; grass (z₀ 0.01, z₁ 15 m) → 0.0030', () => {
    near(canopyDrag(20, 15).cd, 0.03, 1e-3);
    near(canopyDrag(0, 15).cd, 0.003, 1e-4);
    expect(canopyDrag(0, 15).z0).toBe(0.01);
  });
});

describe('§8.2 κ', () => {
  it('open log-law fallback ln(10/0.03)/ln(z/0.03) = 0.7831 at 50 m', () => {
    near(logLawKappa(50), 0.7831, 1e-4);
  });
});

describe('§8.6 surface heat flux Q_h', () => {
  it('Q_sw 564, N 0, T 300 K, A 0.10, KBDI < 50 → 165.2 W/m² (Q* 388.8)', () => {
    near(netRadiation(564, 0.1, 300, 0), 388.8, 0.1);
    near(sensibleHeatFlux(564, 0.1, 300, 0, 20), 165.2, 0.1);
  });
  it('KBDI 150 (B = 4) → 264.4', () => {
    near(sensibleHeatFlux(564, 0.1, 300, 0, 150), 264.4, 0.1);
  });
  it('night T 288 K, N 0 → −33.04; N 1 → −10.27', () => {
    near(sensibleHeatFlux(0, 0.1, 288, 0, 20), -33.04, 0.01);
    near(sensibleHeatFlux(0, 0.1, 288, 1, 20), -10.27, 0.01);
  });
});

describe('§8.6 slope flows (ρc_pT = 1.2·1005·293)', () => {
  const rho = 1.2;
  const T = 293;
  it('upslope Q_h 300, Δz 300 m → 1.84 m/s; Q_h 150, Δz 200 → 1.28', () => {
    near(anabaticSpeed(300, 300, rho, T), 1.84, 0.01);
    near(anabaticSpeed(150, 200, rho, T), 1.28, 0.01);
  });
  it('downslope Q_h −30, L 1000, sin α 0.3, Δz 300 → 2.30; Q_h −20, L 500, sin α 0.2, Δz 150 → 1.39', () => {
    near(katabaticSpeed(-30, 300, 1000, 0.3, rho, T), 2.3, 0.01);
    near(katabaticSpeed(-20, 150, 500, 0.2, rho, T), 1.39, 0.01);
  });
  it('no flow for the wrong sign of Q_h', () => {
    expect(anabaticSpeed(-10, 300, rho, T)).toBe(0);
    expect(katabaticSpeed(10, 300, 1000, 0.3, rho, T)).toBe(0);
  });
});

describe('§8.7 fire heat profile', () => {
  it('first-layer fraction 1 − e^{−Δz₁/α_g}: 0.330 (Δz₁ 20, α_g 50) / 0.632 (Δz₁ 60, α_g 60)', () => {
    near(expLayerFraction(0, 20, Math.max(50, 20)), 0.33, 1e-3);
    near(expLayerFraction(0, 60, Math.max(50, 60)), 0.632, 1e-3);
  });
  it('canopy share passes below H_o,eff and is deposited above it', () => {
    expect(crownLayerFraction(0, 20, 25)).toBe(0);
    expect(crownLayerFraction(0, 1e6, 25)).toBeCloseTo(1, 12);
  });
  it('Exner 1/Π: 1.03 at 900 hPa, 1.07 at 800 hPa', () => {
    near(1 / exner(900), 1.03, 0.01);
    near(1 / exner(800), 1.07, 0.01);
  });
});

describe('§8.10 C-Haines, Briggs, N_c', () => {
  it('C-Haines (20, 6, −5) → 11.17; (28, 12, −10) → 13.0; (15, 5, 10) → 3.67', () => {
    near(cHaines(20, 6, -5).ch, 11.17, 0.01);
    near(cHaines(28, 12, -10).ch, 13.0, 0.1);
    near(cHaines(15, 5, 10).ch, 3.67, 0.01);
  });
  it('preset hot-nw at z_s 800 m: T850 29.1, T700 15.1, Td850 −6 → CA 5.0, CB 7.0, CH 12.0', () => {
    const r = cHaines(29.1, 15.1, -6);
    near(r.ca, 5.0, 0.1);
    near(r.cb, 7.0, 0.1);
    near(r.ch, 12.0, 0.1);
  });
  it('Briggs (ρ 1.2, T 293): 1 GW, U 5, N 0.01 → F 8837, windy 677 m, calm 1533 m → 677 m; 10 GW → 1459 m', () => {
    const b = briggsRise(1e9, 5, 1e-4, 1.2, 293);
    near(b.F, 8837, 1);
    near(b.windy, 677, 1);
    near(b.calm, 1533, 1);
    near(b.rise, 677, 1);
    near(briggsRise(1e10, 5, 1e-4, 1.2, 293).rise, 1459, 1);
  });
  it('Briggs finite for a superadiabatic layer (N² < 0 floored)', () => {
    const b = briggsRise(1e9, 5, -5e-4, 1.2, 293);
    expect(Number.isFinite(b.rise)).toBe(true);
  });
  it('N_c: (ρ 1.1, T 300) 20 MW/m, U 5, R 0.5 → 13.0; (1.15, 305) 10 MW/m U 5 → 4.45, U 3 → 20.6; 1 MW/m U 3 (1.1, 303) → 2.17', () => {
    near(byramNc(20e6, 5, 0.5, 1.1, 300), 13.0, 0.1);
    near(byramNc(10e6, 5, 0, 1.15, 305), 4.45, 0.01);
    near(byramNc(10e6, 3, 0, 1.15, 305), 20.6, 0.1);
    near(byramNc(1e6, 3, 0, 1.1, 303), 2.17, 0.01);
  });
  it('N_c capped and finite when U·ê − R ≤ 0.5 m/s', () => {
    const v = byramNc(10e6, 0.2, 0.5, 1.1, 300);
    expect(v).toBe(100);
    expect(byramNc(1e5, -3, 0.5, 1.1, 300)).toBeGreaterThan(0);
  });
  it('N_c ∝ 1/p: +27.4 % at 2000 m ISA vs sea level', () => {
    // ρT = p/R_d ⇒ ratio = p0/p(2000).
    const r1 = byramNc(5e6, 6, 0.5, airDensity(15, 1013.25), 288.15);
    const r2 = byramNc(5e6, 6, 0.5, airDensity(2, 794.95), 275.15);
    near(r2 / r1 - 1, 0.274, 0.002);
  });
});

describe('§14 weather interpolation (local copy of the §11.2 weatherAt wind rule)', () => {
  it('350° 5 m/s and 10° 5 m/s at the midpoint → 0°, 4.92 m/s (vector mean)', () => {
    const a = { time: 0, temperature: 20, relativeHumidity: 40, windSpeed10: 5, windDir10: 350 };
    const b = { time: 3600e3, temperature: 22, relativeHumidity: 30, windSpeed10: 5, windDir10: 10 };
    const m = interpolateHour(a, b, 0.5);
    near(m.windSpeed10, 4.92, 0.01);
    expect(Math.min(m.windDir10, 360 - m.windDir10)).toBeLessThan(1e-6);
    near(m.temperature, 21, 1e-3);
  });
});

describe('§8.10 PFT (P2, optional)', () => {
  it('moist sounding: the 1-D plume reaches its LCL, free convection above it gives a finite positive PFT', () => {
    const levels = [
      { hPa: 850, height: 1500, temperature: 19, relativeHumidity: 70, windSpeed: 8, windDir: 300 },
      { hPa: 700, height: 3100, temperature: 7, relativeHumidity: 60, windSpeed: 12, windDir: 300 },
      { hPa: 500, height: 5850, temperature: -10, relativeHumidity: 50, windSpeed: 18, windDir: 300 },
    ];
    const w = { time: Date.UTC(2025, 0, 5, 4), temperature: 30, relativeHumidity: 55, windSpeed10: 5, windDir10: 300, pressureLevels: levels };
    const s = { kind: 'fixture' as const, source: 't', location: { lat: -33.7, lon: 150.3 }, timezone: 'Australia/Sydney', hours: [w], sourceElevation: 300, upperAirSource: 'model' as const };
    const p = buildProfile(w, s, 300, 300);
    const pl = plumeColumn(p, 2e10, 5e5, 300, 1.1, 303);
    expect(Number.isFinite(pl.lclASL)).toBe(true);
    const r = pyroFirepowerThreshold(p, pl, 300);
    expect(r).not.toBeNull();
    expect(r!.zfcAGL).toBeGreaterThanOrEqual(pl.lclASL - 300 - 1e-6);
    expect(r!.pft).toBeGreaterThan(0);
    expect(Number.isFinite(r!.pft)).toBe(true);
  });
});
