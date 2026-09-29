import { describe, expect, it } from 'vitest';
import { FuelFlag, FuelType } from '../core/types';
import { BARK_CODE, CANOPY_CODES, SWAY_MAX_SPEED, barkKindOf, canopyCodeColour, canopyCodeLegend, canopyCodeOverlay, canopyCodeScale, swayParams } from './canopyStyle';
import { legendFor } from './legends';

describe('barkKindOf', () => {
  it('follows the fuel flags first', () => {
    expect(barkKindOf(FuelFlag.Stringybark, 0.2, FuelType.DryForestShrubby, 0.5)).toBe('stringy');
    expect(barkKindOf(FuelFlag.RibbonBark, 3.9, FuelType.DryForestShrubby, 0.5)).toBe('ribbon');
    expect(barkKindOf(FuelFlag.Stringybark | FuelFlag.HeavyFuel, 1, FuelType.WetForest, 0.1)).toBe('stringy');
  });

  it('otherwise follows the bark hazard: high stringy, moderate ribbon, low smooth', () => {
    expect(barkKindOf(0, 3.8, FuelType.DryForestShrubby, 0.5)).toBe('stringy');
    expect(barkKindOf(undefined, 2.4, FuelType.GrassyWoodland, 0.5)).toBe('ribbon');
    expect(barkKindOf(0, 0.6, FuelType.WetForest, 0.5)).toBe('smooth');
    expect(barkKindOf(0, 0, FuelType.DryForestGrassy, 0.5)).toBe('smooth');
  });

  it('blends the class boundaries with the per-tree random so a stand is a natural mix', () => {
    const at = (r: number): string => barkKindOf(0, 3.0, FuelType.DryForestShrubby, r);
    expect(at(0.05)).toBe('ribbon');
    expect(at(0.95)).toBe('stringy');
    const kinds = new Set(Array.from({ length: 21 }, (_, i) => barkKindOf(0, 1.8, FuelType.DryForestShrubby, i / 20)));
    expect(kinds.size).toBe(2);
  });

  it('gives rainforest and snow gum smooth bark, and the bark codes are distinct bytes', () => {
    expect(barkKindOf(0, 3.9, FuelType.Rainforest, 0.9)).toBe('smooth');
    expect(barkKindOf(0, 3.9, FuelType.SnowGumWoodland, 0.9)).toBe('smooth');
    expect(new Set(Object.values(BARK_CODE)).size).toBe(3);
  });
});

describe('colour coding', () => {
  it('matches each attribute to its heat map and provides a 256-entry LUT and a legend', () => {
    expect(canopyCodeOverlay('height')).toBe('canopyHeight');
    expect(canopyCodeOverlay('cover')).toBe('canopyCover');
    expect(canopyCodeOverlay('bark')).toBe('barkHazard');
    expect(canopyCodeOverlay('understorey')).toBe('elevatedHazard');
    for (const code of CANOPY_CODES) {
      const s = canopyCodeScale(code);
      expect(s.lut.length).toBe(256 * 4);
      expect(s.hi).toBeGreaterThan(s.lo);
      for (let i = 0; i < 256; i++) expect(s.lut[i * 4 + 3]).toBe(255);
      const lg = canopyCodeLegend(code);
      expect(lg.title.length).toBeGreaterThan(3);
      expect(lg.entries.length).toBeGreaterThanOrEqual(3);
      for (const e of lg.entries) expect(e.colour).toMatch(/^#[0-9a-f]{6}$/);
      expect(lg.note?.length ?? 0).toBeGreaterThan(10);
    }
  });

  it('uses the heat map\'s own ramp and legend when the heat map exists (same colours, no second palette)', () => {
    for (const code of CANOPY_CODES) {
      const shared = legendFor(canopyCodeOverlay(code));
      const s = canopyCodeScale(code);
      const lg = canopyCodeLegend(code);
      if (shared) {
        expect(s.source).toBe('shared');
        expect(lg).toEqual(shared);
      } else {
        expect(s.source).toBe('local');
      }
    }
  });

  it('colours low and high values differently and monotonically for the hazard scales', () => {
    const lo = canopyCodeColour(canopyCodeScale('bark'), 0.2);
    const hi = canopyCodeColour(canopyCodeScale('bark'), 3.8);
    expect(Math.hypot(lo[0] - hi[0], lo[1] - hi[1], lo[2] - hi[2])).toBeGreaterThan(0.3);
    const h1 = canopyCodeColour(canopyCodeScale('height'), 5);
    const h2 = canopyCodeColour(canopyCodeScale('height'), 40);
    expect(Math.hypot(h1[0] - h2[0], h1[1] - h2[1], h1[2] - h2[2])).toBeGreaterThan(0.3);
    // Values outside the range clamp to the end colours.
    expect(canopyCodeColour(canopyCodeScale('cover'), -10)).toEqual(canopyCodeColour(canopyCodeScale('cover'), 0));
    expect(canopyCodeColour(canopyCodeScale('cover'), 1000)).toEqual(canopyCodeColour(canopyCodeScale('cover'), 100));
  });
});

describe('swayParams', () => {
  it('is zero in calm air, grows with the wind and is capped', () => {
    const calm = swayParams(0);
    expect(calm).toEqual({ lean: 0, amp: 0, flutter: 0 });
    let prev = swayParams(0);
    for (const v of [2, 5, 10, 15, 20, SWAY_MAX_SPEED]) {
      const p = swayParams(v);
      expect(p.lean).toBeGreaterThan(prev.lean);
      expect(p.amp).toBeGreaterThan(prev.amp);
      expect(p.flutter).toBeGreaterThan(prev.flutter);
      prev = p;
    }
    expect(swayParams(80)).toEqual(swayParams(SWAY_MAX_SPEED));
    expect(swayParams(NaN)).toEqual(calm);
    expect(swayParams(-5)).toEqual(calm);
  });

  it('leans a bushfire-strength wind (15–20 m/s) visibly but not absurdly (≈ 9–14 % of the height)', () => {
    expect(swayParams(18).lean).toBeGreaterThan(0.09);
    expect(swayParams(SWAY_MAX_SPEED).lean).toBeLessThan(0.15);
    // A light breeze barely moves them.
    expect(swayParams(2).lean).toBeLessThan(0.02);
  });
});
