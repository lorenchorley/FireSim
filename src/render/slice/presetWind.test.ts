import { describe, expect, it } from 'vitest';
import { windToUV } from '../../core/units';
import { AtmosphereSampler } from '../atmosphereSampler';
import { PRESET_WIND_AGL_M, presetWindFromDeg } from './presetWind';
import { resolveSlice } from './sectionLine';
import { makeAirView, makeResolveContext } from './testing';
import type { SlicePresetId } from './types';

/** A 3-D air whose wind is `speed` m/s from `fromDeg` everywhere, or a function of the height above the datum. */
function airFrom(fromDeg: number | ((z: number) => number), speed = 8, kind: 'prognostic' | 'diagnosed' = 'prognostic'): AtmosphereSampler {
  const dir = (z: number): number => (typeof fromDeg === 'number' ? fromDeg : fromDeg(z));
  const view = makeAirView({ kind, u: (_x, _y, z) => windToUV(speed, dir(z))[0], v: (_x, _y, z) => windToUV(speed, dir(z))[1], w: () => 0 });
  return new AtmosphereSampler(view, 500, null);
}

/** The model's wind at the middle of the preset's line, split along and across that line (what the chips of the picture would show there). */
function alongAndAcross(air: AtmosphereSampler, windFromDeg: number, preset: SlicePresetId): { along: number; across: number } {
  const r = resolveSlice({ azimuth: 0, centre: [0, 0], preset }, makeResolveContext({ windFromDeg, mapCentre: [0, 0], heightAt: () => 500 }));
  const [dx, dy] = r.line!.dir;
  const w = new Float32Array(3);
  air.wind(0, 0, 530, 30, w);
  return { along: w[0]! * dx + w[1]! * dy, across: w[0]! * dy - w[1]! * dx };
}

describe('presetWindFromDeg: the direction the Along and Across presets follow', () => {
  it("is the model's wind at the line's centre, not the forecast's (a wind edit turned the air at the fire from 310 to about 95 degrees)", () => {
    const air = airFrom(94.6, 12.7);
    // the forecast says 310 (north-west), the model says 94.6 (east): the preset follows the model
    expect(presetWindFromDeg(air, [0, 0], 500, 310)).toBeCloseTo(94.6, 1);
  });

  it('reads the wind 30 m above the ground: a wind that turns with height is read at that height', () => {
    // from 250 degrees up to 520 m ASL (about the first 20 m above a 500 m ground) and from 300 above: the 30 m reading is the lower one's neighbour
    const air = airFrom((z) => (z < 520 ? 250 : 300));
    const low = presetWindFromDeg(air, [0, 0], 500, null);
    const high = presetWindFromDeg(air, [0, 0], 1500, null); // 30 m above a ground at 1500 m: the upper wind
    expect(PRESET_WIND_AGL_M).toBe(30);
    expect(low).not.toBeNull();
    expect(high).toBeCloseTo(300, 0);
    expect(low!).toBeLessThan(high! - 5);
  });

  it('follows the wind where the line is centred, not at the middle of the model: a wind that changes across the area', () => {
    const view = makeAirView({
      u: (x) => windToUV(8, x < 0 ? 270 : 360)[0],
      v: (x) => windToUV(8, x < 0 ? 270 : 360)[1],
      w: () => 0,
    });
    const air = new AtmosphereSampler(view, 500, null);
    expect(presetWindFromDeg(air, [-2000, 0], 500, 90)).toBeCloseTo(270, 0);
    expect(presetWindFromDeg(air, [2000, 0], 500, 90)).toBeCloseTo(0, 0); // (360 is 0)
  });

  it('falls back to the forecast when the air holds no 3-D wind (a view without wind, or none at all)', () => {
    const none = new AtmosphereSampler(null, 500, null);
    expect(none.hasWind).toBe(false);
    expect(presetWindFromDeg(none, [0, 0], 500, 123)).toBe(123);
    expect(presetWindFromDeg(none, [0, 0], 500, null)).toBeNull(); // no wind anywhere: the presets say it is calm
    const noWindField = new AtmosphereSampler(makeAirView({ u: null as never }), 500, null);
    if (!noWindField.hasWind) expect(presetWindFromDeg(noWindField, [0, 0], 500, 77)).toBe(77);
  });

  it("falls back to the forecast where the model's wind is calm (a sheltered pocket does not switch the presets off)", () => {
    const calm = airFrom(270, 0.05);
    expect(presetWindFromDeg(calm, [0, 0], 500, 200)).toBe(200);
    expect(presetWindFromDeg(calm, [0, 0], 500, null)).toBeNull();
  });

  it('does not read the air at a point that is not a number', () => {
    const air = airFrom(270);
    expect(presetWindFromDeg(air, [NaN, 0], 500, 11)).toBe(11);
    expect(presetWindFromDeg(air, [0, 0], NaN, 12)).toBe(12);
  });

  it('is what makes the Along preset line up with the model wind: the along part of the wind at the centre is all of it, the across part none', () => {
    // A 14 m/s wind from the east, edited in at the fire, with a forecast from 310: the line follows the model, so nothing blows across it there.
    const air = airFrom(94.6, 12.7);
    const from = presetWindFromDeg(air, [0, 0], 500, 310);
    const { along, across } = alongAndAcross(air, from!, 'along');
    expect(Math.abs(across)).toBeLessThan(0.05);
    expect(along).toBeCloseTo(12.7, 1);
    // the forecast's direction, which the presets followed before, put 7 m/s of that 12.7 m/s across the line, and the along part is against it
    const old = alongAndAcross(air, 310, 'along');
    expect(Math.abs(old.across)).toBeGreaterThan(7);
    // and Across is the quarter turn: all across, none along
    const q = alongAndAcross(air, from!, 'across');
    expect(Math.abs(q.along)).toBeLessThan(0.05);
    expect(q.across).toBeCloseTo(12.7, 1);
  });
});
