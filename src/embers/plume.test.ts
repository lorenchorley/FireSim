/**
 * Sub-grid plume field (spec §9.3: w_sg = C_w·F_L^{1/3}·exp(−(z − z0)/z_d)·φ, φ = max(0, 1 − d⊥/Δx_a), tilted axis).
 */
import { describe, expect, it } from 'vitest';
import { PlumeField, PlumeSources } from './plume';
import { uniformWind } from './testing';

describe('PlumeField', () => {
  const dxa = 200;

  it('reproduces the source updraft, the z_d decay and the tilt (U/w0)·Δz of the axis', () => {
    const src = new PlumeSources();
    src.push(0, 0, 500, 10, 0.25);
    const f = new PlumeField();
    f.build(src, dxa, uniformWind(10, 0));
    // at 100 m above the source the axis is (10/10)·100 = 100 m downwind
    expect(f.sample(100, 0, 600)).toBeCloseTo(10 * Math.exp(-100 / 200), 1);
    expect(f.sample(0, 0, 500)).toBeCloseTo(10, 1);
    // φ = 1 − d/Δx_a: half-way to the footprint edge (±15 % for the node interpolation)
    const half = f.sample(200, 0, 600);
    expect(half / (0.5 * 10 * Math.exp(-0.5))).toBeGreaterThan(0.85);
    expect(half / (0.5 * 10 * Math.exp(-0.5))).toBeLessThan(1.15);
    expect(f.sample(100, 250, 600)).toBe(0);
    expect(f.sample(100, 0, 300)).toBe(0); // below the source
    expect(f.lastAlpha).toBe(0);
    f.sample(100, 0, 600);
    expect(f.lastAlpha).toBe(0.25);
  });

  it('takes the max over overlapping columns (not the sum) and keeps α_p of the dominant source', () => {
    const src = new PlumeSources();
    src.push(0, 0, 500, 8, 0.25);
    src.push(100, 0, 500, 12, 0.4);
    const f = new PlumeField();
    f.build(src, dxa, uniformWind(0, 0));
    const v = f.sample(100, 0, 500);
    expect(v).toBeCloseTo(12, 0);
    expect(v).toBeLessThan(12 + 8 * 0.5);
    expect(f.lastAlpha).toBeCloseTo(0.4, 6);
  });

  it('is inactive without sources', () => {
    const f = new PlumeField();
    f.build(new PlumeSources(), dxa, uniformWind(5, 0));
    expect(f.active).toBe(false);
    expect(f.sample(0, 0, 0)).toBe(0);
  });
});
