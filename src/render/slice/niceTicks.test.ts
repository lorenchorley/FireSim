import { describe, expect, it } from 'vitest';
import { Rng } from '../../core/rng';
import { niceTicks } from './niceTicks';

/** step = m x 10^p with m in {1, 2, 5}. */
function isNiceStep(step: number): boolean {
  const e = Math.floor(Math.log10(step) + 1e-9);
  const m = step / 10 ** e;
  return [1, 2, 5].some((x) => Math.abs(m - x) < 1e-9);
}

/** The first version of `niceTicks` (every candidate step builds its list), kept as the oracle for the faster one. */
function niceTicksReference(lo: number, hi: number, target = 5): { values: number[]; step: number } {
  const multiples = (a: number, b: number, step: number): number[] => {
    const slack = step * 1e-9;
    const out: number[] = [];
    for (let k = Math.ceil((a - slack) / step); k <= Math.floor((b + slack) / step); k++) out.push(Number((k * step).toPrecision(12)) + 0);
    return out;
  };
  if (!(hi > lo) || !Number.isFinite(lo) || !Number.isFinite(hi)) return { values: [lo], step: 1 };
  const want = Math.max(1, Number.isFinite(target) ? target : 5);
  const raw = (hi - lo) / want;
  const e = Math.floor(Math.log10(raw));
  let best: { values: number[]; step: number } | null = null;
  let bestErr = Infinity;
  for (let p = e - 1; p <= e + 1; p++) {
    for (const m of [1, 2, 5]) {
      const step = m * 10 ** p;
      const values = multiples(lo, hi, step);
      if (values.length === 0) continue;
      const err = Math.abs(values.length - want);
      if (err <= bestErr) {
        best = { values, step };
        bestErr = err;
      }
    }
  }
  return best ?? { values: [lo], step: raw };
}

describe('niceTicks', () => {
  it('gives exactly the ticks the first version gave (it only counts the candidates now), for heights, distances and odd ranges', () => {
    const rng = new Rng(11);
    for (let q = 0; q < 3000; q++) {
      const span = 10 ** rng.range(-3, 5);
      const lo = q % 3 === 0 ? 0 : rng.range(-50, 50) * span;
      const hi = lo + span * rng.range(0.05, 3);
      const target = [2, 3, 4, 5, 6, 5.5, 0.2, 12][q % 8];
      const got = niceTicks(lo, hi, target);
      const want = niceTicksReference(lo, hi, target);
      expect(got.step, `${lo} to ${hi} (${target})`).toBe(want.step);
      expect(got.values.map((v) => Object.is(v, -0))).toEqual(want.values.map((v) => Object.is(v, -0)));
      expect(got.values).toEqual(want.values);
    }
    for (const [lo, hi] of [[0, 3000], [350, 2500], [602.5, 2914.2], [-120, 1480], [0, 6000]] as const) expect(niceTicks(lo, hi, 4)).toEqual(niceTicksReference(lo, hi, 4));
  });

  it('answers the same range with the same object (a redraw asks for the same two axes), and a different target or range gets its own', () => {
    const a = niceTicks(350, 2500, 4);
    expect(niceTicks(350, 2500, 4)).toBe(a);
    const other = niceTicks(350, 2500, 6);
    expect(other).not.toBe(a);
    expect(other).toEqual(niceTicksReference(350, 2500, 6));
    expect(niceTicks(350, 2501, 4)).not.toBe(a);
    expect(niceTicks(350, 2500, 4)).toEqual(niceTicksReference(350, 2500, 4)); // still right after the others came and went
    // more ranges than the cache holds: the oldest goes, and every answer stays right
    for (let i = 0; i < 40; i++) expect(niceTicks(i, i + 1500, 5)).toEqual(niceTicksReference(i, i + 1500, 5));
    expect(niceTicks(350, 2500, 4)).toEqual(a);
  });

  it('gives 500 m steps for a 1500 m axis and for the usual height range', () => {
    expect(niceTicks(0, 1500)).toEqual({ values: [0, 500, 1000, 1500], step: 500 });
    expect(niceTicks(600, 3000)).toEqual({ values: [1000, 1500, 2000, 2500, 3000], step: 500 });
    expect(niceTicks(250, 2900).step).toBe(500);
  });

  it('puts the ticks on multiples of the step, inside the range, ascending, whatever the scale', () => {
    const rng = new Rng(5);
    for (let q = 0; q < 400; q++) {
      const span = 10 ** rng.range(-3, 5);
      const lo = rng.range(-50, 50) * span; // an axis does not start a million spans from zero
      const hi = lo + span;
      const t = niceTicks(lo, hi);
      expect(t.values.length, `${lo} to ${hi}`).toBeGreaterThan(0);
      expect(isNiceStep(t.step), `step ${t.step}`).toBe(true);
      for (let i = 0; i < t.values.length; i++) {
        const v = t.values[i]!;
        expect(v).toBeGreaterThanOrEqual(lo - t.step * 1e-6);
        expect(v).toBeLessThanOrEqual(hi + t.step * 1e-6);
        expect(Math.abs(v / t.step - Math.round(v / t.step))).toBeLessThan(1e-6);
        if (i > 0) expect(v).toBeGreaterThan(t.values[i - 1]!);
      }
      // About five of them: never a crowd, and never a single tick for an axis with room for several.
      expect(t.values.length).toBeLessThanOrEqual(11);
    }
  });

  it('gives clean decimals for a small range (0.2, not 0.2000000001) and no negative zero', () => {
    const t = niceTicks(0, 1);
    expect(t.values).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    const u = niceTicks(-500, 500);
    expect(u.values).toEqual([-400, -200, 0, 200, 400]);
    expect(Object.is(u.values[2], 0)).toBe(true);
  });

  it('follows the target tick count and breaks a tie towards the larger step', () => {
    expect(niceTicks(0, 1000, 10).step).toBe(100);
    expect(niceTicks(0, 1000, 3).step).toBe(500);
    expect(niceTicks(0, 100).step).toBe(20); // 20 gives 6 ticks, 50 gives 3
    // An exact tie: 0 to 3 with 5.5 wanted, step 0.5 gives 7 ticks and step 1 gives 4, both 1.5 away: the larger step wins.
    expect(niceTicks(0, 3, 5.5).step).toBe(1);
  });

  it('never returns an empty list for hi > lo, even when no round number is near', () => {
    for (const [lo, hi] of [
      [1.2, 1.9],
      [1001, 1002],
      [0.0001, 0.00012],
      [12345, 12350],
      [-0.4, -0.1],
    ] as const) {
      const t = niceTicks(lo, hi);
      expect(t.values.length, `${lo} to ${hi}`).toBeGreaterThan(0);
      for (const v of t.values) {
        expect(v).toBeGreaterThanOrEqual(lo - 1e-12);
        expect(v).toBeLessThanOrEqual(hi + 1e-12);
      }
    }
  });

  it('an empty, reversed or not finite range gives the one value lo and step 1', () => {
    expect(niceTicks(5, 5)).toEqual({ values: [5], step: 1 });
    expect(niceTicks(10, 0)).toEqual({ values: [10], step: 1 });
    expect(niceTicks(0, Infinity)).toEqual({ values: [0], step: 1 });
    expect(niceTicks(NaN, 3).step).toBe(1);
  });

  it('survives a target that is zero, negative or not a number', () => {
    for (const target of [0, -3, NaN, 0.2]) expect(niceTicks(0, 1500, target).values.length).toBeGreaterThan(0);
  });
});
