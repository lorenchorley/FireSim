/** Pure helpers of the design-system primitives (the builders themselves need a DOM and are exercised by the style guide). */
import { describe, expect, it } from 'vitest';
import { ORIGIN_INFO, pct, rangePercent, sparkHeights } from './primitives';

describe('pct', () => {
  it('formats a fraction as a clamped CSS percentage', () => {
    expect(pct(0.42)).toBe('42%');
    expect(pct(0.1234)).toBe('12.3%');
    expect(pct(1)).toBe('100%');
    expect(pct(1.7)).toBe('100%');
    expect(pct(0)).toBe('0%');
    expect(pct(-1)).toBe('0%');
    expect(pct(Number.NaN)).toBe('0%');
    expect(pct(Infinity)).toBe('0%');
  });
});

describe('rangePercent', () => {
  it('positions a value inside [min, max] as 0..100', () => {
    expect(rangePercent(50, 0, 100)).toBe(50);
    expect(rangePercent(0, 0, 100)).toBe(0);
    expect(rangePercent(100, 0, 100)).toBe(100);
    expect(rangePercent(5, 0, 10)).toBe(50);
    expect(rangePercent(-5, -10, 10)).toBe(25);
  });

  it('clamps and survives degenerate ranges', () => {
    expect(rangePercent(150, 0, 100)).toBe(100);
    expect(rangePercent(-5, 0, 100)).toBe(0);
    expect(rangePercent(3, 5, 5)).toBe(0);
    expect(rangePercent(Number.NaN, 0, 1)).toBe(0);
  });
});

describe('sparkHeights', () => {
  it('scales so the largest value is 1', () => {
    expect(sparkHeights([1, 2, 4])).toEqual([0.25, 0.5, 1]);
  });

  it('gives zeros for empty, zero, negative or non-finite input', () => {
    expect(sparkHeights([])).toEqual([]);
    expect(sparkHeights([0, 0])).toEqual([0, 0]);
    expect(sparkHeights([-3, Number.NaN, 2])).toEqual([0, 0, 1]);
  });
});

describe('origin chips', () => {
  it('describe the five kinds of provenance with a word, an icon and a sentence', () => {
    expect(Object.keys(ORIGIN_INFO).sort()).toEqual(['bundled', 'live', 'saved', 'synthetic', 'user']);
    for (const info of Object.values(ORIGIN_INFO)) {
      expect(info.label.length).toBeGreaterThan(2);
      expect(info.description.length).toBeGreaterThan(10);
    }
  });
});
