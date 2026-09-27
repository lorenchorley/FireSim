import { describe, expect, it } from 'vitest';
import { afdrsMoisture, forestMoisture, forestPeriod, grassMoisture, heathMc1, pineMoisture, rainMemoryMc2 } from './afdrs';

// Spec §5.3 vectors: (T, RH) → forest P1/P2/P3, grass, heath MC1, pine.
const VECTORS: [number, number, number, number, number, number, number, number][] = [
  [15, 80, 12.4, 16.45, 18.2, 17.55, 18.25, 13.53],
  [25, 40, 7.25, 9.24, 9.79, 9.98, 9.73, 8.57],
  [30, 20, 4.68, 5.63, 5.59, 6.19, 6.55, 6.09],
  [40, 10, 3.25, 3.49, 3.13, 5.0, 4.21, 4.69],
];

describe('AFDRS-equivalent moisture M_A (spec §5.3)', () => {
  it.each(VECTORS)('T %d °C, RH %d %%', (t, rh, p1, p2, p3, grass, heath, pine) => {
    expect(forestMoisture(1, t, rh)).toBeCloseTo(p1, 2);
    expect(forestMoisture(2, t, rh)).toBeCloseTo(p2, 1);
    expect(Math.abs(forestMoisture(2, t, rh) - p2)).toBeLessThanOrEqual(0.006);
    expect(forestMoisture(3, t, rh)).toBeCloseTo(p3, 1);
    expect(Math.abs(forestMoisture(3, t, rh) - p3)).toBeLessThanOrEqual(0.006);
    expect(Math.abs(grassMoisture(t, rh) - grass)).toBeLessThanOrEqual(0.006);
    expect(heathMc1(t, rh)).toBeCloseTo(heath, 2);
    expect(pineMoisture(t, rh)).toBeCloseTo(pine, 2);
  });

  it('heath MC1 drops the Δ term above 60 % RH (15 °C / 80 % → 18.25)', () => {
    expect(heathMc1(15, 80)).toBeCloseTo(18.25, 2);
    expect(heathMc1(25, 60)).toBeCloseTo(4.37 + 0.161 * 60 - 0.027 * 60, 6);
  });

  it('heath MC2 rain memory vectors', () => {
    expect(rainMemoryMc2(1, 12)).toBeCloseTo(22.93, 2);
    expect(rainMemoryMc2(1, 24)).toBeCloseTo(8.19, 2);
    expect(rainMemoryMc2(0, 1)).toBe(0);
  });

  it('forest period boundary: 16:59 LMST in October → 1, 17:00 → 2; night → 3; winter never 1', () => {
    expect(forestPeriod(16 + 59 / 60, 10, 0)).toBe(1);
    expect(forestPeriod(17, 10, 0)).toBe(2);
    expect(forestPeriod(12, 10, 0)).toBe(1);
    expect(forestPeriod(11.99, 10, 0)).toBe(2);
    expect(forestPeriod(6.9, 1, 0)).toBe(3);
    expect(forestPeriod(19, 1, 0)).toBe(3);
    expect(forestPeriod(18.9, 1, 0)).toBe(2);
    expect(forestPeriod(14, 7, 0)).toBe(2); // July: no period 1
    expect(forestPeriod(14, 3, 0.59)).toBe(1);
    expect(forestPeriod(14, 3, 0.6)).toBe(2); // cloud ≥ 60 %
  });

  it('afdrsMoisture dispatches by family (wet forest never period 1; none = 0)', () => {
    expect(afdrsMoisture('forest', 25, 40, 14, 12, 0, 0, 0)).toBeCloseTo(7.25, 2);
    expect(afdrsMoisture('wetForest', 25, 40, 14, 12, 0, 0, 0)).toBeCloseTo(forestMoisture(2, 25, 40), 9);
    expect(afdrsMoisture('wetForest', 25, 40, 22, 12, 0, 0, 0)).toBeCloseTo(forestMoisture(3, 25, 40), 9);
    expect(afdrsMoisture('heath', 30, 20, 14, 12, 0, 1, 12)).toBeCloseTo(6.55 + 22.93, 1);
    expect(afdrsMoisture('grass', 40, 10, 14, 12, 0, 0, 0)).toBe(5);
    expect(afdrsMoisture('pine', 30, 20, 14, 12, 0, 0, 0)).toBeCloseTo(6.09, 2);
    expect(afdrsMoisture('none', 30, 20, 14, 12, 0, 0, 0)).toBe(0);
  });
});
