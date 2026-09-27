import { describe, expect, it } from 'vitest';
import { afdrsAvailability, cellAvailability, faBlendWeight, fuelAvailabilityMk2, fuelAvailabilityWet, wetForestC1, wetForestValidated } from './availability';

describe('fuel availability (spec §5.9)', () => {
  it('FA_dry (Mk2 logistic) DF 3…10', () => {
    const v = [0.136, 0.285, 0.504, 0.723, 0.872, 0.95, 0.984, 0.998];
    v.forEach((fa, i) => expect(fuelAvailabilityMk2(3 + i)).toBeCloseTo(fa, 3));
  });
  it('C1 vectors', () => {
    expect(wetForestC1(100, 5)).toBeCloseTo(0.43, 3);
    expect(wetForestC1(100, 4)).toBeCloseTo(0.762, 3);
    expect(wetForestC1(0, 7)).toBe(wetForestC1(0, 6)); // W clamped to [3, 6]
  });
  it.each([
    [3.5, [0.939, 0.966, 0.983, 0.993, 0.998]],
    [4.5, [0.061, 0.298, 0.736, 0.954, 0.998]],
    [5, [0.01, 0.034, 0.345, 0.893, 0.998]],
  ])('FA_wet(DF 10; KBDI 0/50/100/150/200), W %f', (w, fas) => {
    [0, 50, 100, 150, 200].forEach((k, i) => expect(Math.abs(fuelAvailabilityWet(10, k, w) - fas[i]!)).toBeLessThanOrEqual(0.0006));
  });
  it('wet-forest availability rises with drought (−0.0175 constant, D9)', () => {
    let prev = 0;
    for (let k = 0; k <= 200; k += 25) {
      const fa = fuelAvailabilityWet(9, k, 4.5);
      expect(fa).toBeGreaterThanOrEqual(prev);
      prev = fa;
    }
  });
  it('topographic blend: flat wet-forest cell with tpiSmall 30 m → w = 0.5; NW ridge → 1; SE or gully → 0', () => {
    expect(faBlendWeight(30, NaN)).toBeCloseTo(0.5, 9);
    expect(faBlendWeight(40, 315)).toBeCloseTo(1, 9);
    expect(faBlendWeight(40, 135)).toBeCloseTo(0, 9);
    expect(faBlendWeight(-20, 315)).toBe(0);
    const dry = fuelAvailabilityMk2(8);
    const wet = fuelAvailabilityWet(8, 50, 4.5);
    expect(cellAvailability('wetForest', 8, 50, 4.5, 0.5)).toBeCloseTo(0.5 * dry + 0.5 * wet, 9);
  });
  it('families: grass/heath 1, none 0, pine uses FA_wet with W = wrf; validity flag above wrf 5', () => {
    expect(cellAvailability('grass', 5, 50, 1)).toBe(1);
    expect(cellAvailability('heath', 5, 50, 1)).toBe(1);
    expect(cellAvailability('none', 5, 50, 1)).toBe(0);
    expect(cellAvailability('forest', 5, 50, 3.5)).toBeCloseTo(0.504, 3);
    expect(cellAvailability('pine', 10, 100, 4)).toBeCloseTo(fuelAvailabilityWet(10, 100, 4, false), 9);
    expect(wetForestValidated(5)).toBe(true);
    expect(wetForestValidated(5.5)).toBe(false);
  });
  it('AFDRS-parity path: dry 0.1·DF, wet min(FA_dry(C1·DF), 0.1·DF)', () => {
    expect(afdrsAvailability('forest', 5, 50, 3.5)).toBeCloseTo(0.5, 9);
    expect(afdrsAvailability('forest', 12, 50, 3.5)).toBe(1);
    expect(afdrsAvailability('wetForest', 10, 100, 5)).toBeCloseTo(0.345, 3);
    expect(afdrsAvailability('wetForest', 5, 200, 3.5)).toBeCloseTo(0.5, 9);
  });
});
