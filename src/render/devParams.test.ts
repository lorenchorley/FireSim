/**
 * The wind glyph height of the render dev page: a checked `wh=`. (dev.ts needs a DOM and the demo data, so only this pure part is run in
 * node; a source pin keeps dev.ts using it.)
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { devWindHeight } from './devParams';
import { WIND_HEIGHTS } from './wind/glyphTypes';

const q = (s: string): URLSearchParams => new URLSearchParams(s);

describe('wh= on the dev page', () => {
  it('is `fire` when it is not given', () => {
    expect(devWindHeight(q(''))).toBe('fire');
    expect(devWindHeight(q('arrows=1'))).toBe('fire');
  });

  it('takes every one of the engine heights, as the text of the height, and gives back the height itself (a number for the numbers)', () => {
    for (const h of WIND_HEIGHTS) expect(devWindHeight(q(`wh=${h}`))).toBe(h);
    expect(devWindHeight(q('wh=fire'))).toBe('fire');
    expect(devWindHeight(q('wh=300'))).toBe(300);
    expect(typeof devWindHeight(q('wh=1000'))).toBe('number');
  });

  it('refuses anything else, with a message that lists the heights: no NaN height, no 7 m', () => {
    for (const bad of ['abc', '7', '10', '0', '-100', '100.5', '1e3', ' 100', '100 ', 'Fire', 'FIRE', 'NaN', 'Infinity', '']) {
      expect(() => devWindHeight(q(`wh=${encodeURIComponent(bad)}`)), JSON.stringify(bad)).toThrow(RangeError);
    }
    expect(() => devWindHeight(q('wh=abc'))).toThrow('wh=abc is not a wind height: use felt, fire, 50, 100, 300, 1000, 2000');
  });
});

describe('dev.ts', () => {
  it('asks for the height before it loads anything, and passes the checked height to the layers', () => {
    const dev = readFileSync(new URL('./dev.ts', import.meta.url), 'utf8');
    expect(dev).toMatch(/const windHeight = devWindHeight\(q\);/);
    expect(dev.indexOf('devWindHeight(q)')).toBeLessThan(dev.indexOf('setAssetBase('));
    expect(dev).toMatch(/\n    windHeight,\n/);
    expect(dev).not.toMatch(/num\('wh'/); // no Number('abc') any more
  });
});
