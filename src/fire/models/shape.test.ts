/** Spec §6.8 (LB, ellipse), §6.9 (intensity gating) and §6.10 (spotting envelope) vectors. */
import { describe, expect, it } from 'vitest';
import { FuelType, type CellFuelParams } from '../../core/types';
import { cellParamsFromRow, fuelRow } from './fuelRef';
import { createIntensityOut, intensityKernel } from './kernel';
import { createEllipseCoeffs, ellipseCoefficients, ellipseSupport, ellipseSupportCos, lbForest, lbGrass, lengthToBreadth } from './shape';
import { spottingEnvelope, spottingRaw } from './spotting';
import { expectVector } from './testUtil';

describe('length-to-breadth (spec §6.8)', () => {
  it('forest LB(2, 3, 4, 5, 10, 20, 25, 30, 40, 60)', () => {
    const u = [2, 3, 4, 5, 10, 20, 25, 30, 40, 60];
    const v = ['1', '1.027', '1.091', '1.195', '1.539', '2.550', '3.272', '3.843', '4.986', '7.272'];
    u.forEach((x, i) => expectVector(lbForest(x), v[i]!, 0, `LB(${x})`));
    expect(lbForest(0)).toBe(1);
    expect(lbForest(1.5)).toBe(1);
  });
  it('grass LB(5, 10, 20, 30) and the ramp (3, 4)', () => {
    ['2.321', '3.202', '4.416', '5.331'].forEach((v, i) => expectVector(lbGrass([5, 10, 20, 30][i]!), v));
    expectVector(lbGrass(3), '1.277');
    expectVector(lbGrass(4), '1.729');
    expect(lbGrass(1.9)).toBe(1);
  });
  it('LB is continuous and non-decreasing in U (ramps remove the jumps, D21)', () => {
    for (const f of [lbForest, lbGrass]) {
      let prev = f(0);
      for (let u = 0.01; u <= 80; u += 0.01) {
        const v = f(u);
        // The published forest form steps 3.280 → 3.272 at 25 km/h (doc 03 §3.10); everything else is monotone.
        expect(v).toBeGreaterThanOrEqual(prev - 0.009);
        expect(v - prev).toBeLessThan(0.01);
        prev = v;
      }
    }
    expect(lengthToBreadth('heath', 10)).toBe(lbGrass(10));
    expect(lengthToBreadth('pine', 10)).toBe(lbForest(10));
    expect(lengthToBreadth('none', 10)).toBe(1);
  });
  it('ellipse: LB 3.843 flank 0.1324, back 0.0175; LB 3: 0.1716, 0.0294', () => {
    const e = ellipseCoefficients(3.843, createEllipseCoeffs());
    expectVector(e.h, '0.1324');
    expectVector(e.cb, '0.0175');
    const e3 = ellipseCoefficients(3, createEllipseCoeffs());
    expectVector(e3.h, '0.1716');
    expectVector(e3.cb, '0.0294');
  });
  it('LB 2: ŝ(0, 45, 90, 135, 180°) = 1.0, 0.7518, 0.2679, 0.0955, 0.0718', () => {
    ['1.0', '0.7518', '0.2679', '0.0955', '0.0718'].forEach((v, i) => expectVector(ellipseSupport(2, [0, 45, 90, 135, 180][i]!), v));
  });
  it('ŝ reproduces head, flank and back; circle at LB 1', () => {
    for (const lb of [1, 1.3, 2.5, 5, 8]) {
      const e = ellipseCoefficients(lb, createEllipseCoeffs());
      expect(ellipseSupportCos(e, 1)).toBeCloseTo(1, 12);
      expect(ellipseSupportCos(e, 0)).toBeCloseTo(e.h, 12);
      expect(ellipseSupportCos(e, -1)).toBeCloseTo(e.cb, 12);
    }
    for (let a = 0; a <= 180; a += 15) expect(ellipseSupport(1, a)).toBeCloseTo(1, 12);
  });
});

describe('intensity and flame height gating (spec §6.9, D28)', () => {
  const dfs = (over: Partial<CellFuelParams> = {}): CellFuelParams => ({ ...cellParamsFromRow(FuelType.DryForestShrubby, fuelRow(FuelType.DryForestShrubby)), ...over });
  const run = (p: CellFuelParams, ros: number, fa: number) => {
    const o = createIntensityOut();
    intensityKernel(p, ros, fa, o);
    return o;
  };
  const base = { surfaceLoad: 14.5, nearSurfaceLoad: 1.9, elevatedLoad: 4.9, canopyLoad: 3.5, hEl: 2.0, hOEff: 20 };
  it('ROS 2114, FA 0.95 → FH 18.83, w 17.62, I 19 248', () => {
    const o = run(dfs(base), 2114, 0.95);
    expectVector(o.flameHeight, '18.83');
    expectVector(o.w, '17.62');
    expectVector(o.intensity, 19248, 1);
    expect(o.crownShare).toBeCloseTo((0.5 * 0.95 * 3.5) / o.w, 12);
  });
  it('ROS 415, s 9.94, FA 0.72 → FH 5.80, w 12.05, I 2584', () => {
    const o = run(dfs({ ...base, surfaceLoad: 9.94 }), 415, 0.72);
    expectVector(o.flameHeight, '5.80');
    expectVector(o.w, '12.05');
    expectVector(o.intensity, 2584, 1);
    expect(o.crownShare).toBe(0);
  });
  it('ROS 4000, FA 1 → FH 29.86, w 18.55, I 38 337', () => {
    const o = run(dfs(base), 4000, 1);
    expectVector(o.flameHeight, '29.86');
    expectVector(o.w, '18.55');
    expectVector(o.intensity, 38337, 1);
  });
  it('ROS 100 (s 5, ns 1, el 1, FA 0.5, H_el 1) → FH 1.09, w 3.5, I 181', () => {
    const o = run(dfs({ surfaceLoad: 5, nearSurfaceLoad: 1, elevatedLoad: 1, hEl: 1 }), 100, 0.5);
    expectVector(o.flameHeight, '1.09');
    expectVector(o.w, '3.5');
    expectVector(o.intensity, 181, 1);
  });
  it('grass w = clamp(L, 1, 6), no FA; heath w = s + ns + el, FH from intensity', () => {
    const g = cellParamsFromRow(FuelType.Grassland, fuelRow(FuelType.Grassland));
    const o = run({ ...g, surfaceLoad: 4, nearSurfaceLoad: 4, grassState: 'natural' }, 8205, 0.1);
    expect(o.w).toBe(6);
    expectVector(o.flameHeight, '3.39');
    const o2 = run({ ...g, surfaceLoad: 0.2, nearSurfaceLoad: 0.3 }, 1000, 1);
    expect(o2.w).toBe(1);
    const h = cellParamsFromRow(FuelType.Heath, fuelRow(FuelType.Heath));
    const oh = run(h, 3860.6, 0.2);
    expect(oh.w).toBe(20);
    expectVector(oh.intensity, 39892, 1);
    expectVector(oh.flameHeight, '12.99');
  });
});

describe('spotting envelope (spec §6.10, D29)', () => {
  it('(U10 40, FHS_s 3.5): R 100 → 50; 150 → 50; 500 → 689; 1000 → 1603; 2000 → 3455; 4000 → 6114 m', () => {
    const r = [100, 150, 500, 1000, 2000, 4000];
    const s = [50, 50, 689, 1603, 3455, 6114];
    r.forEach((x, i) => expectVector(spottingEnvelope(x, 40, 3.5), s[i]!, 1, `S(${x})`));
  });
  it('(U 20, FHS 2): 1000 → 1322; 2000 → 3037', () => {
    expectVector(spottingEnvelope(1000, 20, 2), 1322, 1);
    expectVector(spottingEnvelope(2000, 20, 2), 3037, 1);
  });
  it('raw fit: 500 m/h → 370 m (doc 03), envelope monotone in R', () => {
    expectVector(spottingRaw(500, 40, 3.5), 370, 2);
    for (const [u, f] of [[40, 3.5], [20, 2], [10, 1], [60, 4]] as const) {
      let prev = 0;
      for (let r = 0; r <= 12000; r += 10) {
        const s = spottingEnvelope(r, u, f);
        expect(s).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = s;
      }
    }
    expect(Number.isFinite(spottingEnvelope(2000, 0, 0))).toBe(true);
  });
});
