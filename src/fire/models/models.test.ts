/**
 * Spec vectors for the non-Mk2 point models: flame height (§6.2), Vesta 2012 (§6.3), McArthur Mk5/FFDI (§6.4),
 * CSIRO grass (§6.5), heath refit / v1.0 (§6.6), pine (§6.7).
 */
import { describe, expect, it } from 'vitest';
import { byramFlameLength, byramIntensity, flameHeightShrub, flameHeightVesta, fuelAvailabilityWet, slopeFactor } from './common';
import { grassPhiC, grassRos, grassStateFromLoad } from './grass';
import { heathRefitRos, heathRefitSI, heathV1Damping, heathV1Ros } from './heath';
import { ffdi, legacyFfdiRating, mk5 } from './mcarthur';
import { createPineOut, pineCore, pineLitterMoisture } from './pine';
import { expectVector } from './testUtil';
import { vesta2012Ros } from './vesta2012';

describe('slope factor (D2, D3)', () => {
  it('SF(−40…40) vectors of spec §7.3 (17 values)', () => {
    const v: [number, string][] = [
      [-40, '0.516'], [-30, '0.533'], [-20, '0.571'], [-10, '0.667'], [-5, '0.773'], [0, '1'], [5, '1.414'], [10, '2'], [15, '2.828'],
      [20, '4'], [25, '5.657'], [30, '8'], [35, '11.314'], [40, '16'],
    ];
    for (const [t, s] of v) expectVector(slopeFactor(t), s, 0, `SF(${t})`);
    expect(slopeFactor(50)).toBe(16);
    expect(slopeFactor(-80)).toBeGreaterThanOrEqual(0.5);
    expect(slopeFactor(NaN)).toBe(1);
    // Kataburn never below 0.5 and monotone in θ.
    let prev = 0;
    for (let t = -60; t <= 45; t += 0.5) {
      const s = slopeFactor(t);
      expect(s).toBeGreaterThanOrEqual(prev);
      expect(s).toBeGreaterThanOrEqual(0.5);
      prev = s;
    }
  });
});

describe('flame height and intensity helpers', () => {
  it('Vesta FH (1000 m/h, H_el 1.5) = 7.96 m', () => expectVector(flameHeightVesta(1000, 1.5), '7.96'));
  it('Byram flame length 1.35, 2.56, 3.52, 5.36 m at 500, 2000, 4000, 10 000 kW/m', () => {
    ['1.35', '2.56', '3.52', '5.36'].forEach((v, i) => expectVector(byramFlameLength([500, 2000, 4000, 10000][i]!), v));
  });
  it('Byram factor: 18600·(w/10)·(R/3600) = 0.5167·w·R', () => expect(byramIntensity(10, 3600)).toBeCloseTo(18600, 8));
});

describe('Vesta 2012 (spec §6.3)', () => {
  it('U10 30, FHS_s 3.5, FHS_ns 3, H_ns 20 cm, M 6, FA 1, WRF 3 → 1402 m/h', () => {
    expectVector(vesta2012Ros(30, 3.5, 3, 20, 6, 1, 3), 1402, 1);
  });
  it('30 m/h × φ below U = 5 km/h; φ = 2.31 at M ≤ 4 and 0 above 20 %', () => {
    expect(vesta2012Ros(4, 3.5, 3, 20, 7, 1, 3)).toBeCloseTo(30 * 18.35 * 7 ** -1.495, 8);
    expect(vesta2012Ros(4, 3.5, 3, 20, 3, 1, 3)).toBeCloseTo(69.3, 8);
    expect(vesta2012Ros(40, 3.5, 3, 20, 21, 1, 3)).toBe(0);
  });
});

describe('McArthur Mk5 and FFDI (spec §6.4)', () => {
  it('FFDI(35, 15, 40, 10) = 61.39 → W 15: R 1105 m/h, Z 15.97 m, S 3.70 km', () => {
    const f = ffdi(35, 15, 40, 10);
    expectVector(f, '61.39');
    const r = mk5(f, 15);
    expectVector(r.rosMh, 1105, 1);
    expectVector(r.flameHeight, '15.97');
    expectVector(r.spottingKm, '3.70');
  });
  it('FFDI(30, 20, 30, 10) = 34.53', () => expectVector(ffdi(30, 20, 30, 10), '34.53'));
  it('V9 winds: (T 34, RH 18, DF 10) FFDI 25/50/100 at 7.5/37.1/66.7 km/h; S 1.29/2.95/6.25 km at W 15', () => {
    const u = [7.5, 37.1, 66.7];
    const f = [25, 50, 100];
    const s = ['1.29', '2.95', '6.25'];
    u.forEach((uu, i) => {
      const fv = ffdi(34, 18, uu, 10);
      expect(Math.abs(fv - f[i]!) / f[i]!).toBeLessThan(0.005);
      expectVector(mk5(fv, 15).spottingKm, s[i]!);
    });
  });
  it('legacy NSW bands', () => {
    expect([5, 12, 30, 60, 80, 120].map(legacyFfdiRating)).toEqual(['Low–Moderate', 'High', 'Very High', 'Severe', 'Extreme', 'Catastrophic']);
  });
});

describe('CSIRO grassland (spec §6.5)', () => {
  it('natural U 10, M 8, C 90 → 1854 m/h', () => expectVector(grassRos(10, 8, 90, 'natural', 1), 1854, 1));
  it('natural U 30, M 5, C 100 → 8205 m/h, FH 3.39 m, I (5 t/ha) 21 196 kW/m', () => {
    const r = grassRos(30, 5, 100, 'natural', 1);
    expectVector(r, 8205, 1);
    expectVector(2.66 * (r / 3600) ** 0.295, '3.39');
    expectVector(byramIntensity(5, r), 21196, 1);
  });
  it('eaten-out continuous at 5 km/h (Spark, D13): M 5 C 100: 320/321; M 8 C 90: 218/219', () => {
    expectVector(grassRos(4.99, 5, 100, 'eatenOut', 1), 320, 1);
    expectVector(grassRos(5, 5, 100, 'eatenOut', 1), 321, 1);
    expectVector(grassRos(4.99, 8, 90, 'eatenOut', 1), 218, 1);
    expectVector(grassRos(5, 8, 90, 'eatenOut', 1), 219, 1);
    // FBI-TG form halves at the switch.
    expect(grassRos(4.99, 5, 100, 'eatenOut', 1, true) / grassRos(5, 5, 100, 'eatenOut', 1, true)).toBeGreaterThan(1.9);
  });
  it('φC(20, 50, 70, 80, 90, 100) = 0.01, 0.17, 0.60, 0.82, 0.94, 1.00', () => {
    ['0.01', '0.17', '0.60', '0.82', '0.94', '1.00'].forEach((v, i) => expectVector(grassPhiC([20, 50, 70, 80, 90, 100][i]!), v));
  });
  it('grass state from load; natural and grazed continuous at 5 km/h', () => {
    expect([7, 6, 5, 3, 2].map(grassStateFromLoad)).toEqual(['natural', 'natural', 'grazed', 'grazed', 'eatenOut']);
    for (const st of ['natural', 'grazed'] as const) {
      const a = grassRos(4.999, 6, 100, st, 1);
      const b = grassRos(5, 6, 100, st, 1);
      expect(Math.abs(a - b) / b).toBeLessThan(0.002);
    }
  });
});

describe('heath (spec §6.6)', () => {
  const W = 0.667;
  it('refit (30, 6) → 3860.6, SI 1.00; (10, 10) → 694.5, SI 0.85; (5, 12) → 181.5, SI 0.41; (40, 5, H 2.0) → 8079.2', () => {
    expectVector(heathRefitRos(30, 6, 1.3, W), '3860.6', 1);
    expectVector(heathRefitSI(30, 6, 1.3, W), '1.00');
    expectVector(heathRefitRos(10, 10, 1.3, W), '694.5', 1);
    expectVector(heathRefitSI(10, 10, 1.3, W), '0.85');
    const logit = Math.log(heathRefitSI(10, 10, 1.3, W) / (1 - heathRefitSI(10, 10, 1.3, W)));
    expectVector(logit, '1.7147');
    expectVector(heathRefitRos(5, 12, 1.3, W), '181.5', 1);
    expectVector(heathRefitSI(5, 12, 1.3, W), '0.41');
    expectVector(heathRefitRos(40, 5, 2.0, W), '8079.2', 1);
  });
  it('v1.0 (30, 6) → 3495.8; (10, 10) → 760.6 (damping 0.802)', () => {
    expectVector(heathV1Ros(30, 6, 1.3, W), '3495.8', 1);
    expectVector(heathV1Ros(10, 10, 1.3, W), '760.6', 1);
    expectVector(heathV1Damping(10, 10), '0.802');
  });
  it('heath at 3860.6 m/h and 20 t/ha: I = 39 892 kW/m, FH = 12.99 m', () => {
    const i = byramIntensity(20, 3860.6);
    expectVector(i, 39892, 1);
    expectVector(flameHeightShrub(i), '12.99');
  });
});

describe('pine (spec §6.7)', () => {
  const pineAt = (rh: number, t: number, df: number, u10: number, kbdi: number) => {
    const m = pineLitterMoisture(rh, t);
    const fa = fuelAvailabilityWet(df, kbdi, 4);
    const o = createPineOut();
    pineCore(u10, m, fa, 10, 2, 2, 10, 1.0, 1.0, 20, 4, df, false, o);
    return { m, fa, o };
  };
  it('RH 20, T 30, DF 10, U10 30, KBDI 100 (C1 0.762)', () => {
    const { m, fa, o } = pineAt(20, 30, 10, 30, 100);
    expectVector(m, '6.09');
    expectVector(fa, '0.927');
    expectVector(o.rSurf, 1081, 1);
    expectVector(o.fhSurf, '6.11');
    expectVector(o.wSurf, '12.97');
    expectVector(o.iSurf, 7245, 1);
    expectVector(o.iCrit, 3811, 1);
    expectVector(o.standWind, '16.17');
    expectVector(o.rActive, 1970, 1);
    // Spec 0.451 was computed with the rounded Byram factor 0.5167 (I_surf 7245.8); the exact 18600/36000 gives 0.4504.
    expect(Math.abs(o.cfb - 0.451)).toBeLessThan(0.001);
    expectVector(o.ros, 1481, 1);
    expectVector(o.flameHeight, '12.37');
    expectVector(o.intensity, 13128, 1);
  });
  it('KBDI 200 (C1 1): FA 0.998, R_surf 1648, I_surf 11 905, CFB 1, ROS 1970, FH 20.0', () => {
    const { fa, o } = pineAt(20, 30, 10, 30, 200);
    expectVector(fa, '0.998');
    expectVector(o.rSurf, 1648, 1);
    expectVector(o.iSurf, 11905, 1);
    expect(o.cfb).toBe(1);
    expectVector(o.ros, 1970, 1);
    expectVector(o.flameHeight, '20.0');
  });
  it('RH 40, T 25, DF 8, U10 15: M 8.57; KBDI 100: FA 0.740, R_surf 172, I_surf 920 < I_crit 4307, ROS 172; KBDI 200: FA 0.950, ROS 323, I 2222', () => {
    const a = pineAt(40, 25, 8, 15, 100);
    expectVector(a.m, '8.57');
    expectVector(a.fa, '0.740');
    expectVector(a.o.rSurf, 172, 1);
    expectVector(a.o.iSurf, 920, 1);
    expectVector(a.o.iCrit, 4307, 1);
    expect(a.o.cfb).toBe(0);
    expectVector(a.o.ros, 172, 1);
    const b = pineAt(40, 25, 8, 15, 200);
    expectVector(b.fa, '0.950');
    expectVector(b.o.ros, 323, 1);
    expectVector(b.o.intensity, 2222, 1);
  });
});
