/**
 * The pure helpers of the Wind speed map that follows the Wind height (0.7.0, E1b, made real in C0): which height the map follows, and the top of
 * its range. The map itself (the field, the legend text, the chip) is lane R's.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYERS, windMapHeight } from './layers';
import { windSpeedRangeKmh } from './legends';
import { WIND_HEIGHTS, type WindHeight } from './wind/glyphTypes';

const ALL: readonly WindHeight[] = ['felt', ...WIND_HEIGHTS];

describe('windMapHeight', () => {
  it('is the Wind height while the arrows and flow lines are on', () => {
    for (const h of ALL) expect(windMapHeight({ windGlyphs: true, windHeight: h }), String(h)).toBe(h);
  });

  it("is the 10 m map ('fire') while they are off, whatever height is chosen: the Wind speed map is then today's", () => {
    for (const h of ALL) expect(windMapHeight({ windGlyphs: false, windHeight: h }), String(h)).toBe('fire');
  });

  it('reads only the two fields it names (the layer state as it is)', () => {
    expect(windMapHeight(DEFAULT_LAYERS)).toBe(DEFAULT_LAYERS.windGlyphs ? DEFAULT_LAYERS.windHeight : 'fire');
    expect(windMapHeight({ ...DEFAULT_LAYERS, windGlyphs: true, windHeight: 300 })).toBe(300);
  });
});

describe('windSpeedRangeKmh', () => {
  it('is 60 km/h for the 10 m wind, What the fire feels, 50 m and 100 m', () => {
    for (const h of ['fire', 'felt', 50, 100] as const) expect(windSpeedRangeKmh(h), String(h)).toBe(60);
  });

  it('is 90 km/h from 300 m (where the arrows\' card also ends, 25 m/s)', () => {
    for (const h of [300, 1000, 2000] as const) expect(windSpeedRangeKmh(h), String(h)).toBe(90);
    expect(90 / 3.6).toBe(25);
  });

  it('answers 60 or 90 for every height there is, and never goes down as the height rises', () => {
    let last = 0;
    for (const h of [...ALL].sort((a, b) => (typeof a === 'number' ? a : 10) - (typeof b === 'number' ? b : 10))) {
      const r = windSpeedRangeKmh(h);
      expect([60, 90]).toContain(r);
      expect(r, String(h)).toBeGreaterThanOrEqual(last);
      last = r;
    }
  });
});
