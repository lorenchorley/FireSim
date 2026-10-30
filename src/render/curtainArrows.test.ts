/**
 * Which columns of the curtain's arrows are drawn (curtainArrows.ts): none thinned where the columns are 14 px apart or more, more thinned the more the
 * line is foreshortened, at most 7 apart, the same columns at each stride, and a small camera move cannot flip the stride.
 */
import { describe, expect, it } from 'vitest';
import { ARROW_COLUMNS, ARROW_MIN_SPACING_PX, MAX_STRIDE, STRIDE_HYSTERESIS, arrowStride, columnDrawn, foreshortening, pixelsPerMetre } from './curtainArrows';

/** The unit vector of a camera that looks `azimuthDeg` clockwise from north and `dipDeg` down, in the scene's axes (x east, y up, z south). */
const looking = (azimuthDeg: number, dipDeg: number): [number, number, number] => {
  const a = (azimuthDeg * Math.PI) / 180;
  const d = (dipDeg * Math.PI) / 180;
  return [Math.sin(a) * Math.cos(d), -Math.sin(d), -Math.cos(a) * Math.cos(d)];
};
const EAST: [number, number] = [1, 0];
/** `foreshortening` of a camera direction (the vector of `looking`) and a line direction. */
const fore = (v: [number, number, number], dir: ArrayLike<number>): number => foreshortening(v[0], v[2], dir);

describe('foreshortening', () => {
  it('is 1 face-on and from straight above, 0 looking along the line, either way', () => {
    expect(fore(looking(0, 35), EAST)).toBeCloseTo(1, 12); // looking north at a line that runs east: face-on
    expect(fore(looking(180, 60), EAST)).toBeCloseTo(1, 12);
    expect(fore(looking(0, 90), EAST)).toBeCloseTo(1, 12); // from straight above
    expect(fore(looking(90, 0), EAST)).toBeCloseTo(0, 12); // looking east along it
    expect(fore(looking(270, 0), EAST)).toBeCloseTo(0, 12); // looking west along it
  });

  it('is the sine of the angle between the line and the view direction', () => {
    expect(fore(looking(45, 0), EAST)).toBeCloseTo(Math.SQRT1_2, 12);
    expect(fore(looking(90, 35), EAST)).toBeCloseTo(Math.sin((35 * Math.PI) / 180), 12); // along the line but looking down at 35 degrees: the ground runs away at the sine of the dip
    expect(fore(looking(30, 20), EAST)).toBeCloseTo(Math.sqrt(1 - (Math.sin((30 * Math.PI) / 180) * Math.cos((20 * Math.PI) / 180)) ** 2), 12);
  });

  it('follows the line, not the camera: the same view of a line that runs north is the turned answer', () => {
    const north: [number, number] = [0, 1];
    expect(fore(looking(0, 0), north)).toBeCloseTo(0, 12);
    expect(fore(looking(90, 0), north)).toBeCloseTo(1, 12);
    const sw: [number, number] = [-Math.SQRT1_2, -Math.SQRT1_2];
    expect(fore(looking(225, 10), sw)).toBeCloseTo(Math.sin((10 * Math.PI) / 180), 12); // along it, 10 degrees down
  });

  it('never goes below 0 or over 1 (rounding at the ends)', () => {
    expect(fore([1, 0, 0], [1, 0])).toBe(0);
    expect(fore([1 + 1e-12, 0, 0], [1, 0])).toBe(0);
    expect(fore([0, -1, 0], [1, 0])).toBe(1);
  });
});

describe('pixelsPerMetre', () => {
  it('is the viewport height over the height of the view at that depth', () => {
    expect(pixelsPerMetre(640, 50, 1000)).toBeCloseTo(640 / (2 * Math.tan((25 * Math.PI) / 180) * 1000), 9);
    expect(pixelsPerMetre(640, 50, 1000)).toBeCloseTo(0.6861, 3);
    expect(pixelsPerMetre(640, 50, 500)).toBeCloseTo(2 * pixelsPerMetre(640, 50, 1000), 9);
  });

  it('does not divide by zero for a curtain at the camera', () => {
    expect(Number.isFinite(pixelsPerMetre(640, 50, 0))).toBe(true);
    expect(Number.isFinite(pixelsPerMetre(640, 50, -5))).toBe(true);
  });
});

describe('arrowStride', () => {
  const SPACING = 100; // m between columns
  /** The stride for a screen scale such that the columns are `px` apart face-on. */
  const at = (px: number, f = 1, last = 0): number => arrowStride(SPACING, f, px / SPACING, last);

  it('is 1 whenever the columns are 14 px apart or more, at any zoom and any foreshortening that leaves them so', () => {
    expect(ARROW_MIN_SPACING_PX).toBe(14);
    for (const px of [14, 15, 40, 400, 1e5, Infinity]) expect(at(px), `${px} px apart`).toBe(1);
    expect(arrowStride(100, 1, 0.14)).toBe(1);
    expect(arrowStride(100, 0.5, 0.28)).toBe(1); // half foreshortened but twice as close: the same 14 px
  });

  it('grows as the columns close up: the least stride that keeps them 14 px apart', () => {
    expect(at(13.9)).toBe(2);
    expect(at(7)).toBe(2);
    expect(at(6.9)).toBe(3);
    expect(at(14 / 3)).toBe(3);
    expect(at(14 / 4)).toBe(4);
    expect(at(14 / 6)).toBe(6);
    expect(at(14 / 7)).toBe(7);
  });

  it('is at most 7, even for columns that land on each other (a line seen end on, or a view that has no area)', () => {
    expect(MAX_STRIDE).toBe(7);
    expect(at(1)).toBe(7);
    expect(at(0.001)).toBe(7);
    expect(at(0)).toBe(7);
    expect(arrowStride(SPACING, 0, 1)).toBe(7);
    expect(arrowStride(SPACING, -0.2, 1)).toBe(7);
  });

  it('never goes down as the foreshortening grows, over the whole range, at a phone scale (360 x 640, columns 15.4 px apart face-on)', () => {
    const phone = (f: number): number => arrowStride(15.4, f, 1);
    let last = 0;
    for (let f = 1; f >= 0; f -= 0.01) {
      const s = phone(f);
      expect(s).toBeGreaterThanOrEqual(last);
      expect(s).toBeGreaterThanOrEqual(1);
      expect(s).toBeLessThanOrEqual(7);
      last = s;
    }
    // The numbers of the design: all of them above f = 0.91, every other from 0.46, every third from 0.31 and so on, 7 at the edge.
    expect(phone(1)).toBe(1);
    expect(phone(0.92)).toBe(1);
    expect(phone(0.9)).toBe(2);
    expect(phone(0.47)).toBe(2);
    expect(phone(0.45)).toBe(3);
    expect(phone(0.32)).toBe(3);
    expect(phone(0.3)).toBe(4);
    expect(phone(0.0)).toBe(7);
  });

  it('a view that cannot be measured leaves every column drawn', () => {
    expect(arrowStride(SPACING, NaN, 1)).toBe(1);
    expect(arrowStride(SPACING, 1, NaN)).toBe(1);
    expect(arrowStride(NaN, 1, 1)).toBe(1);
  });

  describe('hysteresis (15 %)', () => {
    it('keeps the stride in use while the gap is within 15 % of the edge, and changes it beyond', () => {
      expect(STRIDE_HYSTERESIS).toBe(0.15);
      // The edge between strides 1 and 2 is at 14 px. Coming from 1, the gap may fall to 14 / 1.15 = 12.17 px before it flips.
      expect(at(13.5, 1, 1)).toBe(1);
      expect(at(12.3, 1, 1)).toBe(1);
      expect(at(12.1, 1, 1)).toBe(2);
      // Coming from 2, the gap must climb to 14 x 1.15 = 16.1 px to go back to 1.
      expect(at(14.5, 1, 2)).toBe(2);
      expect(at(16, 1, 2)).toBe(2);
      expect(at(16.2, 1, 2)).toBe(1);
      // Without a stride in use the plain rule applies.
      expect(at(13.5)).toBe(2);
      expect(at(13.5, 1, 0)).toBe(2);
    });

    it('a camera that shakes by 5 % about any edge never flips the stride back and forth', () => {
      for (const edge of [14, 7, 14 / 3, 14 / 4, 14 / 5, 14 / 6]) {
        let stride = at(edge * 0.97); // the stride just below the edge
        let flips = 0;
        for (let i = 0; i < 200; i++) {
          const px = edge * (i % 2 === 0 ? 1.05 : 0.95);
          const next = at(px, 1, stride);
          if (next !== stride) flips++;
          stride = next;
        }
        expect(flips, `edge ${edge}`).toBe(0);
      }
    });

    it('a slow sweep through an edge flips once on the way down and once on the way back, at different places', () => {
      let stride = 1;
      const changes: number[] = [];
      for (let px = 20; px >= 5; px -= 0.05) {
        const s = at(px, 1, stride);
        if (s !== stride) changes.push(px);
        stride = s;
      }
      const down = changes.length;
      for (let px = 5; px <= 20; px += 0.05) {
        const s = at(px, 1, stride);
        if (s !== stride) changes.push(px);
        stride = s;
      }
      expect(stride).toBe(1);
      expect(changes.length, 'each edge crossed once each way').toBe(down * 2);
      expect(down).toBe(2); // 1 -> 2 at about 12.2 px, 2 -> 3 at about 6.1 px (5 px is the end of the sweep)
      // Down: 14 / 1.15 = 12.17 px and 7 / 1.15 = 6.09 px. Back up: 7 x 1.15 = 8.05 px and 14 x 1.15 = 16.1 px: each flip back comes later than the flip down (the hysteresis).
      expect(changes[0]!).toBeCloseTo(12.17, 0);
      expect(changes[1]!).toBeCloseTo(6.09, 0);
      expect(changes[2]!).toBeCloseTo(8.05, 0);
      expect(changes[3]!).toBeCloseTo(16.1, 0);
    });

    it('a stride in use that is no longer anywhere near is dropped', () => {
      expect(at(100, 1, 7)).toBe(1);
      expect(at(1, 1, 1)).toBe(7);
    });
  });
});

describe('columnDrawn', () => {
  it('draws column 0 first and every stride-th column after it, the same ones at each stride', () => {
    const kept = (stride: number): number[] => Array.from({ length: ARROW_COLUMNS }, (_, m) => m).filter((m) => columnDrawn(m, stride));
    expect(ARROW_COLUMNS).toBe(21);
    expect(kept(1)).toHaveLength(21);
    expect(kept(2)).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
    expect(kept(3)).toEqual([0, 3, 6, 9, 12, 15, 18]);
    expect(kept(7)).toEqual([0, 7, 14]);
    // Stride 6 keeps a subset of stride 3's, and 2 of 1's: a column drawn at a coarse stride is drawn at the finer ones that divide it.
    for (const m of kept(6)) expect(kept(3)).toContain(m);
    for (const m of kept(4)) expect(kept(2)).toContain(m);
  });
});
