/**
 * Spec §7.2–§7.10 and §8.10 test vectors of the spread building blocks (spec §14 "fire/spread" row):
 * Δt_f bound (7), hybrid head (5, incl. the Kataburn bound), SF (17), ellipse speeds (calm 30°, windy, downslope
 * wind), breach (5), amplifier A and G (7), build (5), VLS (6), lee separation (5), junction geometry (5), N_c (5).
 * Tolerance (§14): half a unit of the last printed digit or ±0.1 %, whichever is larger.
 */
import { describe, expect, it } from 'vitest';
import { SpreadDriver } from '../../core/types';
import { attributeDriver, createAttributionInput } from './attribution';
import {
  alignmentWeight, amplifierGain, attachmentScore, breachProbability, buildFraction, byramConvectiveNumber, cflBoundDt, createEllipseSpeedsOut,
  createHybridOut, ellipseSpeeds, gullySteer, finishHybrid, hybridHeadDeg, junctionBoost, junctionGeometric, leeAlignment, leeSeparation,
  lineIgnitionOrigin, offsetEllipseSpeed, relaxEngagement, slopeFactor, vlsLateralRate, vlsScore,
} from './math';

function vec(actual: number, printed: string | number, minAbs = 0, label = ''): void {
  const s = String(printed);
  const expected = Number(s);
  const dot = s.indexOf('.');
  const dec = dot < 0 ? 0 : s.length - dot - 1;
  const tol = Math.max(0.5 * 10 ** -dec, 0.001 * Math.abs(expected), minAbs);
  if (!(Math.abs(actual - expected) <= tol)) expect.fail(`${label}: expected ${s} ± ${tol.toPrecision(3)}, got ${actual}`);
}

describe('§7.2 corrected CFL bound (D1)', () => {
  const d = Math.SQRT1_2;
  it('bound vectors (ν 0.2, diagonal front unless stated)', () => {
    vec(cflBoundDt(1, d, d, 20), '8.13', 0, 'Δx 20 R 1');
    vec(cflBoundDt(1, 1, 0, 20), '10.0', 0, 'axis');
    vec(cflBoundDt(3, d, d, 20), '2.71', 0, 'Δx 20 R 3');
    vec(cflBoundDt(1, d, d, 30), '12.19', 0, 'Δx 30 R 1');
    vec(cflBoundDt(6, d, d, 30), '2.03', 0, 'Δx 30 R 6');
  });
  it('viscosity sensitivity ν 0 / 0.1 / 0.4 at Δx 20, R 1', () => {
    vec(cflBoundDt(1, d, d, 20, 0), '12.73');
    vec(cflBoundDt(1, d, d, 20, 0.1), '9.92');
    vec(cflBoundDt(1, d, d, 20, 0.4), '5.97');
    expect(cflBoundDt(0, d, d, 20)).toBe(Infinity);
  });
});

describe('§7.3 slope factor (D2, D3) and hybrid head', () => {
  it('SF(−40…40)', () => {
    const tab: [number, string][] = [
      [-40, '0.516'], [-35, '0.523'], [-30, '0.533'], [-25, '0.548'], [-20, '0.571'], [-15, '0.607'], [-10, '0.667'], [-5, '0.773'], [0, '1'],
      [5, '1.414'], [10, '2'], [15, '2.828'], [20, '4'], [25, '5.657'], [30, '8'], [35, '11.314'], [40, '16'],
    ];
    for (const [th, v] of tab) vec(slopeFactor(th), v, 0, `SF(${th})`);
    expect(slopeFactor(50)).toBe(16); // cap (D4)
    for (let th = -90; th < 0; th += 5) expect(slopeFactor(th)).toBeGreaterThanOrEqual(0.5); // Kataburn ≥ 0.5
  });

  it('hybrid head vectors (R0 26, R_w 1681 m/h, θ 20°, ψ_up 90°)', () => {
    const o = createHybridOut();
    hybridHeadDeg(26, 1681, 20, 90, 90, o);
    vec(o.e, '90.0', 0, 'e aligned');
    vec(o.rHyb, '6724.0', 0, 'R_hyb aligned');
    hybridHeadDeg(26, 1681, 20, 90, 45, o);
    vec(o.e, '46.8', 0, 'e 45');
    vec(o.thetaE, '14.87', 0, 'θe 45');
    vec(o.rMult, '4712.1', 0, 'R_mult 45');
    vec(o.rAdd, '1737.0', 0, 'R_add 45');
    vec(o.blend, '0.5', 0, 'b 45');
    vec(o.rHyb, '3224.6', 0, 'R_hyb 45');
    hybridHeadDeg(26, 1681, 20, 90, 0, o);
    vec(o.e, '2.7', 0, 'e 0');
    vec(o.rHyb, '1682.8', 0, 'R_hyb 0');
    hybridHeadDeg(26, 1681, 20, 90, 270, o);
    vec(o.e, 270, 0, 'e 270');
    vec(o.thetaE, -20, 0, 'θe 270');
    vec(o.rAdd, '1603.0', 0, 'R_add 270');
    vec(o.rHyb, '960.6', 0, 'R_hyb 270 (Kataburn bound)');
    hybridHeadDeg(26, 26, 20, 90, null, o);
    vec(o.e, 90, 0, 'e calm');
    vec(o.rHyb, '104.0', 0, 'R_hyb calm');
  });

  it('flat + calm falls back to a neutral head (circle)', () => {
    const o = hybridHeadDeg(20, 20, 0, NaN, null);
    expect(o.rHyb).toBeCloseTo(20, 9);
    expect(o.thetaE).toBe(0);
  });

  it('cross-slope wind (V3): head between wind-to and upslope, ≤ 1.2 × flat wind ROS', () => {
    const o = hybridHeadDeg(26, 1681, 20, 90, 0);
    expect(o.e).toBeGreaterThan(0);
    expect(o.e).toBeLessThan(90);
    expect(o.rHyb).toBeLessThanOrEqual(1.2 * 1681);
  });
});

describe('§7.4 convex three-speed ellipse', () => {
  it('calm 30° plane: R_H 8.0 R0, R_B 0.533 R0, R_F 1.0 R0; R(45°) 5.739, R(135°) 0.459', () => {
    const h = hybridHeadDeg(26, 26, 30, 0, null);
    const th = 30;
    const e = ellipseSpeeds(h.rHyb, 1, 1, 26, 26, h.thetaE, 0, 1, Infinity, createEllipseSpeedsOut());
    vec(e.rH / 26, '8.0', 0, 'R_H');
    vec(e.rB / 26, '0.533', 0, 'R_B');
    vec(e.rF / 26, '1.0', 0, 'R_F');
    vec(offsetEllipseSpeed(e.rH, e.rB, e.rF, Math.cos(Math.PI / 4)) / 26, '5.739', 0, 'R(45)');
    vec(offsetEllipseSpeed(e.rH, e.rB, e.rF, Math.cos((3 * Math.PI) / 4)) / 26, '0.459', 0, 'R(135)');
    expect(th).toBe(30);
  });

  it('upslope wind case: R_B 16.84, R_F 222.5, R(0…180°) = 6724.0, 4759.8, 222.5, 17.1, 16.8', () => {
    const e = ellipseSpeeds(6724, 1, 1, 1681, 26, 20, 0, 3.843, Infinity, createEllipseSpeedsOut());
    vec(e.rB, '16.84', 0, 'R_B');
    vec(e.rF, '222.5', 0, 'R_F');
    const exp = ['6724.0', '4759.8', '222.5', '17.1', '16.8'];
    for (let q = 0; q < 5; q++) vec(offsetEllipseSpeed(e.rH, e.rB, e.rF, Math.cos((q * Math.PI) / 4)), exp[q]!, 0, `R(${45 * q})`);
  });

  it('weak wind blowing downslope on 30° (R0 26, R_w 100): e upslope, R_H 134, R_B 53.3', () => {
    const h = hybridHeadDeg(26, 100, 30, 0, 180);
    vec(h.e, 0, 0.01, 'e upslope');
    const e = ellipseSpeeds(h.rHyb, 1, 1, 100, 26, h.thetaE, 0, 1, Infinity, createEllipseSpeedsOut());
    vec(e.rH, 134, 0, 'R_H');
    vec(e.rB, '53.3', 0, 'R_B');
    expect(e.rB).toBeGreaterThanOrEqual(26 * slopeFactor(-30));
  });

  it('flat ground equals R_w·ŝ(ψ) of §6.8 (LB 2: 1.0, 0.7518, 0.2679, 0.0955, 0.0718)', () => {
    const e = ellipseSpeeds(1, 1, 1, 1, 0.01, 0, 0, 2, Infinity, createEllipseSpeedsOut());
    const exp = ['1.0', '0.7518', '0.2679', '0.0955', '0.0718'];
    for (let q = 0; q < 5; q++) vec(offsetEllipseSpeed(e.rH, e.rB, e.rF, Math.cos((q * Math.PI) / 4)), exp[q]!, 0, `ŝ(${45 * q})`);
  });

  it('forest cap 15 km/h and the build-up shrink', () => {
    const e = ellipseSpeeds(40000, 1, 1, 10000, 30, 0, 0, 3, 15000, createEllipseSpeedsOut());
    expect(e.rH).toBe(15000);
    expect(e.capped).toBe(true);
    const b = ellipseSpeeds(1000, 1, 0.5, 1000, 20, 0, 0, 3, Infinity, createEllipseSpeedsOut());
    expect(b.lbB).toBeCloseTo(2, 12);
    expect(b.rH).toBeCloseTo(500, 9);
  });

  it('support function is convex (Wulff shape reproduces R_H, R_B, R_F)', () => {
    // Convexity of the Wulff shape: R(ψ) + R''(ψ) ≥ 0 numerically.
    const e = ellipseSpeeds(8, 1, 1, 1, 1, 30, 0, 1, Infinity, createEllipseSpeedsOut());
    const f = (p: number): number => offsetEllipseSpeed(e.rH, e.rB, e.rF, Math.cos(p));
    const d = 1e-3;
    for (let p = 0; p < 2 * Math.PI; p += 0.05) expect(f(p) + (f(p + d) - 2 * f(p) + f(p - d)) / (d * d)).toBeGreaterThan(-1e-6);
  });
});

describe('§7.4 Wilson breach probability', () => {
  it('vectors', () => {
    vec(breachProbability(2000, 3, false), '0.291');
    vec(breachProbability(2000, 5, false), '0.054');
    vec(breachProbability(5000, 10, true), '0.345');
    vec(breachProbability(5000, 3, true), '0.883');
    vec(breachProbability(10000, 3, true), '0.979');
  });
});

describe('§7.6 attachment amplifier', () => {
  it('A and steady G = 1 + 1.5A² (W_align 1, s_res 0)', () => {
    const cases: [number, number, string, string][] = [
      [15, 0, '0.004', '1.000'], [20, 0.5, '0.104', '1.016'], [22, 1, '0.500', '1.375'], [25, 1, '0.881', '2.164'], [28, 1, '0.982', '2.447'],
      [30, 0.2, '0.398', '1.238'], [35, 1, '1.000', '2.499'],
    ];
    for (const [th, T, a, g] of cases) {
      const A = attachmentScore(th, T, 1);
      vec(A, a, 0, `A(${th}, ${T})`);
      vec(amplifierGain(A, A, 0), g, 0, `G(${th}, ${T})`);
    }
  });
  it('W_align, s_res and the engagement relaxation', () => {
    expect(alignmentWeight(90, 5)).toBe(1);
    expect(alignmentWeight(45, 30)).toBe(1);
    expect(alignmentWeight(150, 30)).toBe(0.5);
    expect(alignmentWeight(90, 30)).toBeCloseTo(0.75, 12);
    expect(amplifierGain(1, 1, 1)).toBe(1);
    expect(relaxEngagement(0, 1, 180)).toBeCloseTo(1 - Math.exp(-1), 12);
    expect(relaxEngagement(0.3, 1, 0)).toBe(0.3);
  });
});

describe('§7.7 gully steering', () => {
  it('rotates the head toward the gully axis by clamp((α − 15)/15)', () => {
    const o = hybridHeadDeg(26, 26, 30, 90, null); // head east (up a side wall)
    const w = gullySteer(o, 0.8, 30, 22.5); // axis 30°, α 22.5° → w 0.5
    expect(w).toBeCloseTo(0.5, 12);
    expect(o.e).toBeCloseTo(60, 9);
    finishHybrid(26, Math.tan((30 * Math.PI) / 180), 0, o);
    expect(o.thetaE).toBeCloseTo(Math.atan(Math.tan((30 * Math.PI) / 180) * Math.cos((30 * Math.PI) / 180)) * (180 / Math.PI), 6);
    expect(gullySteer(o, 0.4, 30, 25)).toBe(0); // T < 0.5
    expect(gullySteer(o, 0.8, 250, 25)).toBe(0); // > 90° away
  });
});

describe('§7.8 build-up', () => {
  it('build(1, 6, 10, 20, 26 min) = 0.109, 0.498, 0.683, 0.900, 0.950; floor 0.1', () => {
    const exp = ['0.109', '0.498', '0.683', '0.900', '0.950'];
    [1, 6, 10, 20, 26].forEach((m, q) => vec(buildFraction(m * 60), exp[q]!, 0, `build(${m})`));
    expect(buildFraction(0)).toBe(0.1);
    expect(buildFraction(600, true)).toBeCloseTo(1 - Math.exp(-2.3), 9);
  });
  it('line ignitions start at b₀ = min(0.9, L/500)', () => {
    expect(buildFraction(0 - lineIgnitionOrigin(0, 250))).toBeCloseTo(0.5, 9);
    expect(buildFraction(0 - lineIgnitionOrigin(0, 2000))).toBeCloseTo(0.9, 9);
    expect(lineIgnitionOrigin(100, 0)).toBe(100);
  });
});

describe('§7.9 VLS score and lee separation', () => {
  const windTo = 90; // wind from 270°
  it('VLS vectors (S_ridge 1)', () => {
    vec(vlsScore(25, leeAlignment(90, windTo), 30 / 3.6, 1, 6), '0.784');
    vec(vlsScore(22, leeAlignment(120, windTo), 30 / 3.6, 1, 6), '0.315');
    vec(vlsScore(30, leeAlignment(90, windTo), 5, 1, 6), '0.500');
    vec(vlsScore(30, leeAlignment(90, windTo), 40 / 3.6, 1, 10), '0.500');
    expect(vlsScore(30, 1, 10, 0, 6)).toBe(0);
    expect(vlsScore(30, 1, 2.5, 1, 6)).toBe(0);
    expect(vlsScore(30, leeAlignment(NaN, windTo), 10, 1, 6)).toBe(0);
    expect(vlsScore(30, 1, NaN, 1, 6)).toBe(0);
  });
  it('lee separation vectors', () => {
    vec(leeSeparation(20, Math.cos(0), 6, true), '0.370');
    vec(leeSeparation(25, Math.cos(0), 6, true), '0.741');
    vec(leeSeparation(25, Math.cos(0), 5.56, true), '0.506'); // the vector's printed 5.56 m/s (20 km/h = 5.556 gives 0.503)
    vec(leeSeparation(18, Math.cos((20 * Math.PI) / 180), 4, true), '0.000');
    vec(leeSeparation(30, Math.cos((45 * Math.PI) / 180), 8, true), '0.598');
    expect(leeSeparation(30, 1, 8, false)).toBe(0);
  });
  it('lateral rate: mean 2.0 km/h at v 0.67 (0.4–3.6), 2.8 km/h at v 1 (0.56–5.0)', () => {
    const mean = (vls: number): number => {
      let s = 0;
      for (let q = 0; q < 720; q++) s += vlsLateralRate(vls, (q / 720) * 750, 750);
      return (s / 720) * 3.6;
    };
    vec(mean(0.5 + 0.5 * (2 / 3)), '2.0');
    vec(mean(1), '2.8');
    vec(vlsLateralRate(1, 750 / 4, 750) * 3.6, '5.04');
    vec(vlsLateralRate(1, (3 * 750) / 4, 750) * 3.6, '0.56');
  });
});

describe('§7.10 junction geometry', () => {
  it('1/sin(θ₀/2) at 10, 20, 30, 40, 60° = 11.47 (cap 6), 5.76, 3.86, 2.92, 2.00', () => {
    const exp = ['11.47', '5.76', '3.86', '2.92', '2.00'];
    [10, 20, 30, 40, 60].forEach((th, q) => vec(junctionGeometric(th), exp[q]!, 0, `geo(${th})`));
    vec(junctionBoost(10), '3.5');
    vec(junctionBoost(60), '1.5');
    expect(junctionBoost(0)).toBeCloseTo(3.5, 12);
  });
});

describe('§8.10 Byram N_c (computed by fire/spread)', () => {
  it('vectors', () => {
    vec(byramConvectiveNumber(20000, 5, 0.5, 1.1, 300 - 273.15), '13.0');
    vec(byramConvectiveNumber(10000, 5, 0, 1.15, 305 - 273.15), '4.45');
    vec(byramConvectiveNumber(10000, 3, 0, 1.15, 305 - 273.15), '20.6');
    vec(byramConvectiveNumber(1000, 3, 0, 1.1, 303 - 273.15), '2.17');
    const calm = byramConvectiveNumber(10000, 0, 1, 1.1, 30);
    expect(Number.isFinite(calm) && calm > 0 && calm <= 100).toBe(true);
    expect(byramConvectiveNumber(0, 5, 0, 1.1, 30)).toBe(0);
  });
});

describe('§7.12 driver attribution', () => {
  const a = (o: Partial<ReturnType<typeof createAttributionInput>>) => attributeDriver({ ...createAttributionInput(), ...o });
  it('first match wins in the spec order', () => {
    expect(a({ seeded: true, gain: 2 })).toBe(SpreadDriver.Spotting);
    expect(a({ vlsTerm: 0.4, ros: 1, junction: 2 })).toBe(SpreadDriver.LateralVorticity);
    expect(a({ junction: 1.4, gain: 2 })).toBe(SpreadDriver.Junction);
    expect(a({ gain: 1.3, direction: 0.1 })).toBe(SpreadDriver.Eruptive);
    expect(a({ direction: 0.3, fireWindShare: 0.5 })).toBe(SpreadDriver.Backing);
    expect(a({ fireWindShare: 0.3, wind: 30 })).toBe(SpreadDriver.FireInducedWind);
  });
  it('factor rule', () => {
    expect(a({ wind: 1.1, slope: 1.1 })).toBe(SpreadDriver.None);
    expect(a({ wind: 28, slope: 4 })).toBe(SpreadDriver.WindAndSlope); // ln 4 = 1.39 ≥ 0.4·ln 28 = 1.33
    expect(a({ wind: 28, slope: 2 })).toBe(SpreadDriver.Wind);
    expect(a({ wind: 1, slope: 8 })).toBe(SpreadDriver.Slope);
    expect(a({ wind: 1.3, moisture: 2.1 })).toBe(SpreadDriver.DryFuel);
    expect(a({ wind: 1.3, moisture: 1.45 })).toBe(SpreadDriver.Wind); // DryFuel only when moisture ≥ 1.5
    expect(a({ wind: 1.3, fuel: 0.3 })).toBe(SpreadDriver.Fuel);
  });
});
