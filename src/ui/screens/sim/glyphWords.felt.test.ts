/**
 * C0 (0.7.0, item B): `WindHeight` gains `'felt'` ("What the fire feels") but it is not yet one of `WIND_HEIGHTS`, so no chip, remembered choice
 * or switch can select it. This pins the label the widened type needs to compile, and that the six chips are unchanged (the E2 picture lane
 * flips both: it puts `'felt'` first and replaces the second check with seven chips).
 */
import { describe, expect, it } from 'vitest';
import { WIND_HEIGHTS } from '../../../render/wind/glyphTypes';
import { WIND_HEIGHT_CHIPS, heightLabel } from './glyphWords';

describe("the label of the 'felt' height", () => {
  it("is 'What the fire feels', and the other labels are as they were", () => {
    expect(heightLabel('felt')).toBe('What the fire feels');
    expect(heightLabel('fire')).toBe('10 m');
    expect(heightLabel(50)).toBe('50 m');
    expect(heightLabel(1000)).toBe('1 km');
  });

  it("is not a chip yet: the six chips of 0.6.0 stand and nothing can select 'felt'", () => {
    expect(WIND_HEIGHTS).toEqual(['fire', 50, 100, 300, 1000, 2000]);
    expect(WIND_HEIGHT_CHIPS.map((c) => c.label)).toEqual(['10 m', '50 m', '100 m', '300 m', '1 km', '2 km']);
  });
});
