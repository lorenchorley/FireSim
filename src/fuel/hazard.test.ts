import { describe, expect, it } from 'vitest';
import {
  barkHazardFromLoad,
  fhsFromLoad,
  fhsFromRating,
  loadFromFhs,
  loadFromLitterDepthMm,
  OFHAG_RATINGS,
  ratingFromFhs,
  type HazardLayer,
} from './hazard';

describe('hazard ↔ load (spec §4.6)', () => {
  it('loadFromFhs("surface", 3.25) = 13.0 (§4.9 vector)', () => {
    expect(loadFromFhs('surface', 3.25)).toBeCloseTo(13.0, 6);
  });

  it('passes through (0, 0) and every table point', () => {
    const table: Record<HazardLayer, [number, number][]> = {
      surface: [[1, 4], [2, 8], [3, 12], [3.5, 14], [4, 20]],
      nearSurface: [[1, 1], [2, 2], [3, 3], [3.5, 3.5], [4, 4]],
      elevated: [[1, 1], [2, 2], [3, 3], [3.5, 4], [4, 6]],
      bark: [[0, 0], [1, 1], [2, 2], [3, 5], [4, 7]],
    };
    for (const [layer, pts] of Object.entries(table) as [HazardLayer, [number, number][]][]) {
      expect(loadFromFhs(layer, 0)).toBe(0);
      for (const [f, l] of pts) expect(loadFromFhs(layer, f)).toBeCloseTo(l, 9);
    }
  });

  it('clamps FHS to 0–4 and is monotone', () => {
    expect(loadFromFhs('surface', -1)).toBe(0);
    expect(loadFromFhs('surface', 9)).toBe(20);
    let prev = -1;
    for (let f = 0; f <= 4; f += 0.05) {
      const v = loadFromFhs('elevated', f);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('fhsFromLoad inverts the polyline for s/ns/el (D15: user-entered loads)', () => {
    for (const layer of ['surface', 'nearSurface', 'elevated'] as const) {
      for (let f = 0; f <= 4; f += 0.25) expect(fhsFromLoad(layer, loadFromFhs(layer, f))).toBeCloseTo(f, 9);
    }
    expect(fhsFromLoad('surface', 100)).toBe(4);
    expect(fhsFromLoad('surface', -3)).toBe(0);
  });

  it('bark: step table ≤0 → 0, ≤1 → 1, ≤2 → 2, ≤5 → 3, >5 → 4 [V PyroXL fl_to_fhs]', () => {
    const cases: [number, number][] = [[0, 0], [0.01, 1], [1, 1], [1.5, 2], [2, 2], [2.67, 3], [5, 3], [5.01, 4], [9, 4]];
    for (const [l, h] of cases) expect(barkHazardFromLoad(l)).toBe(h);
    expect(fhsFromLoad('bark', 2.67)).toBe(3);
    // loadFromFhs('bark', ·) at integer hazards lands back in the same step.
    for (let h = 0; h <= 4; h++) expect(barkHazardFromLoad(loadFromFhs('bark', h))).toBe(h);
  });

  it('OFHAG rating → FHS [V AFDRS-RP Table 4.3]', () => {
    expect(OFHAG_RATINGS.map((r) => fhsFromRating('surface', r))).toEqual([1, 2, 3, 3.5, 4]);
    expect(OFHAG_RATINGS.map((r) => fhsFromRating('bark', r))).toEqual([0, 1, 2, 3, 4]);
    expect(ratingFromFhs('surface', 3.4)).toBe('Very High');
    expect(ratingFromFhs('surface', 0.2)).toBe('None');
    expect(ratingFromFhs('bark', 3)).toBe('Very High');
  });

  it('litter depth: 4 t/ha ≈ 1 cm', () => {
    expect(loadFromLitterDepthMm(10)).toBeCloseTo(4, 9);
    expect(loadFromLitterDepthMm(-5)).toBe(0);
  });
});
