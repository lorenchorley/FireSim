/** The plume site (plumeSite.ts): none without a fire, strength and radius from the hottest cell, one site at the fire's centre. */
import { describe, expect, it } from 'vitest';
import { NO_PLUMES, PLUME_FULL_KW_M, plumeSites } from './plumeSite';

describe('plumeSites', () => {
  it('is none without a fire or without any intensity, and always the same frozen list', () => {
    expect(plumeSites(null)).toBe(NO_PLUMES);
    expect(plumeSites({ x: 1, y: 2, maxIntensity: 0 })).toBe(NO_PLUMES);
    expect(plumeSites({ x: 1, y: 2, maxIntensity: -5 })).toBe(NO_PLUMES);
    expect(plumeSites({ x: 1, y: 2, maxIntensity: NaN })).toBe(NO_PLUMES);
    expect(NO_PLUMES).toHaveLength(0);
    expect(Object.isFrozen(NO_PLUMES)).toBe(true);
  });

  it('one site at the fire centre, strength from the hottest cell up to 20,000 kW/m, a base of 30 to 120 m', () => {
    expect(PLUME_FULL_KW_M).toBe(20_000);
    expect(plumeSites({ x: 120, y: -340, maxIntensity: 10_000 })).toEqual([{ x: 120, y: -340, radiusM: 75, strength: 0.5 }]);
    const [weak] = plumeSites({ x: 0, y: 0, maxIntensity: 200 })!;
    expect(weak!.strength).toBeCloseTo(0.01, 6);
    expect(weak!.radiusM).toBeCloseTo(30.9, 6);
  });

  it('is capped at full strength, however hot', () => {
    expect(plumeSites({ x: 5, y: 6, maxIntensity: 20_000 })[0]).toEqual({ x: 5, y: 6, radiusM: 120, strength: 1 });
    expect(plumeSites({ x: 5, y: 6, maxIntensity: 150_000 })[0]).toEqual({ x: 5, y: 6, radiusM: 120, strength: 1 });
  });

  it('a hotter fire never has a smaller or weaker plume', () => {
    let last = { strength: 0, radiusM: 0 };
    for (const kw of [10, 100, 1000, 5000, 12_000, 20_000, 40_000]) {
      const p = plumeSites({ x: 0, y: 0, maxIntensity: kw })[0]!;
      expect(p.strength).toBeGreaterThanOrEqual(last.strength);
      expect(p.radiusM).toBeGreaterThanOrEqual(last.radiusM);
      last = p;
    }
  });
});
