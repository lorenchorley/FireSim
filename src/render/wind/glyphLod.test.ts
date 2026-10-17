/**
 * The level planner (thresholds, hysteresis, lattice exponent), the pixel-scale helpers and the visible box.
 */
import { describe, expect, it } from 'vitest';
import { boxContains, cellPxAt, LEVEL_EDGES, LOD_HYSTERESIS, metresPerPixelAt, planLod, visibleBox } from './glyphLod';
import { makeCamera, topDownCamera } from './glyphOracle.testing';
import type { Box, GlyphLevel, LodPlan } from './glyphTypes';

const BIG: Box = { x0: -1e5, y0: -1e5, x1: 1e5, y1: 1e5 };

describe('pixel scale', () => {
  it('metres per pixel is 2 d tan(fov / 2) / height, and a cell is its metres over that', () => {
    expect(metresPerPixelAt(1000, 50, 868)).toBeCloseTo((2 * 1000 * Math.tan((25 * Math.PI) / 180)) / 868, 12);
    expect(metresPerPixelAt(1000, 90, 1000)).toBeCloseTo(2, 12);
    expect(cellPxAt(133, 1000, 50, 868)).toBeCloseTo(133 / metresPerPixelAt(1000, 50, 868), 9);
    // The builder's own scale (clip depth over pixels per metre) is the same number for a point on the view axis.
    const cam = makeCamera({ eye: [0, 1234, 0], target: [0, 0, 0] });
    expect(metresPerPixelAt(cam.distance, cam.fovDeg, cam.cssH)).toBeCloseTo(cam.distance / cam.pxPerMetre1, 12);
  });
});

describe('planLod: the ladder', () => {
  it('has the four edges of the design', () => {
    expect([...LEVEL_EDGES]).toEqual([4, 12, 32, 90]);
    expect(LOD_HYSTERESIS).toBe(1.15);
  });

  it('with no history the level is the raw one: under 4 px nothing, 4 to 12 L1, 12 to 32 L2, 32 to 90 L3, over 90 L4', () => {
    const level = (px: number): GlyphLevel => planLod(px, 2, null).level;
    expect([0.1, 3.99].map(level)).toEqual([0, 0]);
    expect([4, 11.99].map(level)).toEqual([1, 1]);
    expect([12, 31.99].map(level)).toEqual([2, 2]);
    expect([32, 89.99].map(level)).toEqual([3, 3]);
    expect([90, 500, 1e5].map(level)).toEqual([4, 4, 4]);
  });

  it('draws nothing for a size that is not a size', () => {
    for (const px of [0, -3, NaN]) expect(planLod(px, 2, null).level).toBe(0);
    for (const px of [0, NaN]) expect(planLod(px, 2, { level: 3, spacingExp: 5 }).level).toBe(0); // history does not rescue it
  });

  it('each level is what the design says', () => {
    const p = (px: number): LodPlan => planLod(px, 1, null);
    expect(p(2)).toMatchObject({ level: 0, spacingPx: 0, spacingM: 0 });
    expect(p(8)).toMatchObject({ level: 1, spacingPx: 56, curved: false, jitter: 0, lengthPx: { min: 8, max: 45, pxPerMs: 4 } });
    expect(p(20)).toMatchObject({ level: 2, spacingPx: 40, curved: false, jitter: 0, lengthPx: { min: 8, max: 32, pxPerMs: 4 } });
    expect(p(60)).toMatchObject({ level: 3, spacingPx: 36, curved: true, jitter: 0.3, lengthPx: { min: 28, max: 56, pxPerMs: 4 } });
    expect(p(200)).toMatchObject({ level: 4, spacingPx: 56, curved: true, jitter: 0.3, lengthPx: { min: 90, max: 140, pxPerMs: 6 } });
    expect(p(60).cellPx).toBe(60);
    expect(p(60).mppCentre).toBe(1);
    // An L1 arrow never reaches the next lattice point at the nominal spacing: 45 of 56 px is the design's 0.8 rounded.
    expect(p(8).lengthPx.max / p(8).spacingPx).toBeLessThanOrEqual(0.81);
  });
});

describe('planLod: hysteresis of +/- 15 %', () => {
  // The edge between level L and L + 1 is LEVEL_EDGES[L]; the band is [edge / 1.15, edge x 1.15).
  for (let L = 0; L < 4; L++) {
    const edge = LEVEL_EDGES[L]!;
    it(`edge ${edge} px: up only from ${(edge * 1.15).toFixed(2)}, down only under ${(edge / 1.15).toFixed(2)}`, () => {
      const lo = L as GlyphLevel;
      const hi = (L + 1) as GlyphLevel;
      // Rising: the lower level holds until edge x 1.15 (the last value just under it keeps it).
      expect(planLod(edge * 1.1499, 1, { level: lo, spacingExp: 5 }).level).toBe(lo);
      expect(planLod(edge, 1, { level: lo, spacingExp: 5 }).level).toBe(lo);
      expect(planLod(edge * 1.15, 1, { level: lo, spacingExp: 5 }).level).toBe(hi);
      // Falling: the upper level holds down to edge / 1.15.
      expect(planLod(edge / 1.1499, 1, { level: hi, spacingExp: 5 }).level).toBe(hi);
      expect(planLod(edge, 1, { level: hi, spacingExp: 5 }).level).toBe(hi);
      expect(planLod(edge / 1.15 - 1e-9, 1, { level: hi, spacingExp: 5 }).level).toBe(lo);
    });

    it(`edge ${edge} px: a hover around it (+/- 10 %) never flips the level, from either side`, () => {
      for (const start of [L, L + 1] as GlyphLevel[]) {
        let prev: LodPlan | { level: GlyphLevel; spacingExp: number } = { level: start, spacingExp: 5 };
        for (let k = 0; k < 400; k++) {
          const px = edge * (1 + 0.1 * Math.sin(k * 0.9) * Math.cos(k * 0.13));
          prev = planLod(px, 1, prev);
          expect(prev.level).toBe(start);
        }
      }
    });
  }
  it('a sweep up and down crosses every edge once in each direction, at different values', () => {
    const upAt: number[] = [];
    const downAt: number[] = [];
    let prev: LodPlan | null = null;
    for (let px = 1; px <= 400; px *= 1.002) {
      const next: LodPlan = planLod(px, 1, prev);
      if (prev && next.level > prev.level) upAt.push(px);
      prev = next;
    }
    for (let px = 400; px >= 1; px /= 1.002) {
      const next: LodPlan = planLod(px, 1, prev);
      if (prev && next.level < prev.level) downAt.push(px);
      prev = next;
    }
    expect(upAt).toHaveLength(4);
    expect(downAt).toHaveLength(4);
    for (let L = 0; L < 4; L++) {
      expect(upAt[L]! / LEVEL_EDGES[L]!).toBeGreaterThanOrEqual(1.15 - 1e-9);
      expect(upAt[L]! / LEVEL_EDGES[L]!).toBeLessThan(1.15 * 1.003);
      expect(downAt[3 - L]! / LEVEL_EDGES[L]!).toBeLessThan(1 / 1.15 + 1e-9);
      expect(downAt[3 - L]! / LEVEL_EDGES[L]!).toBeGreaterThan(1 / 1.15 / 1.003);
    }
  });

  it('a fast pinch crosses several edges at once, one edge at a time by the same rule', () => {
    expect(planLod(1000, 1, { level: 0, spacingExp: 0 }).level).toBe(4);
    expect(planLod(100, 1, { level: 0, spacingExp: 0 }).level).toBe(3); // 100 < 90 x 1.15 = 103.5
    expect(planLod(2, 1, { level: 4, spacingExp: 5 }).level).toBe(0);
    expect(planLod(20, 1, { level: 4, spacingExp: 5 }).level).toBe(2);
  });
});

describe('planLod: the lattice spacing', () => {
  it('is a power of two of metres: round(log2(spacing px x metres per pixel))', () => {
    const p = planLod(60, 2.2167, null); // 36 px x 2.2167 m = 79.8 m -> log2 = 6.32
    expect(p.spacingExp).toBe(6);
    expect(p.spacingM).toBe(64);
    expect(planLod(60, 3, null).spacingExp).toBe(7); // 108 m -> 6.75
    expect(planLod(60, 0.1, null).spacingExp).toBe(2); // 3.6 m -> 1.85
    expect(planLod(60, 0.01, null).spacingM).toBe(2 ** -1); // 0.36 m -> -1.47
  });

  it('keeps the exponent until the exact value is more than 0.5 + 0.15 octave from it', () => {
    const exact = (e: number): number => 2 ** e / 36; // the mpp that makes log2(36 mpp) = e
    let prev: LodPlan = planLod(60, exact(6.0), null);
    expect(prev.spacingExp).toBe(6);
    for (const e of [6.2, 6.5, 6.6, 6.64, 6.3, 6.0, 5.6, 5.4, 5.36]) {
      prev = planLod(60, exact(e), prev);
      expect(prev.spacingExp).toBe(6);
    }
    expect(planLod(60, exact(6.66), prev).spacingExp).toBe(7); // past 0.65 up: the plain rounding
    expect(planLod(60, exact(5.34), prev).spacingExp).toBe(5);
    // And back the other way: from 7, 6.4 is 0.6 away and stays, 6.3 is 0.7 away and goes.
    const seven = planLod(60, exact(7.0), null);
    expect(planLod(60, exact(6.4), seven).spacingExp).toBe(7);
    expect(planLod(60, exact(6.3), seven).spacingExp).toBe(6);
  });

  it('a hover around a rounding point (.5) of the exponent does not flip it', () => {
    let prev: LodPlan | null = null;
    let flips = 0;
    let last = NaN;
    for (let k = 0; k < 300; k++) {
      const e = 6.5 + 0.12 * Math.sin(k * 0.7);
      prev = planLod(60, 2 ** e / 36, prev);
      if (prev.spacingExp !== last && !Number.isNaN(last)) flips++;
      last = prev.spacingExp;
    }
    expect(flips).toBe(0);
  });

  it('takes a new exponent when the level changes the spacing in pixels, and has none for a level of nothing', () => {
    const l3 = planLod(60, 2, null); // 72 m
    const l4 = planLod(200, 2, l3); // 112 m
    expect(l3.spacingExp).toBe(6);
    expect(l4.spacingExp).toBe(7);
    expect(planLod(2, 2, l4)).toMatchObject({ level: 0, spacingExp: 0, spacingM: 0 });
    expect(planLod(60, 2, planLod(2, 2, l4)).spacingExp).toBe(6); // a level of nothing kept no exponent
    for (const mpp of [0, -1, NaN, Infinity]) expect(planLod(60, mpp, null)).toMatchObject({ level: 3, spacingExp: 0 });
  });

  it('fills `out` in place when asked (a plan may be passed as its own history)', () => {
    const out: LodPlan = planLod(8, 2, null);
    const nested = out.lengthPx;
    const again = planLod(60, 2, out, out);
    expect(again).toBe(out);
    expect(out.lengthPx).toBe(nested);
    expect(out).toMatchObject(planLod(60, 2, planLod(8, 2, null)));
    expect(out.level).toBe(3);
  });
});

describe('visibleBox', () => {
  it('a top view sees the rectangle of the screen: half the width x metres per pixel either side, exact', () => {
    const cam = topDownCamera(133, 60, 250, -400);
    const mpp = cam.distance / cam.pxPerMetre1;
    const b = visibleBox(cam.unproject, cam.eye, 0, BIG, 20000, 0)!;
    expect(b.x0).toBeCloseTo(250 - 206 * mpp, 6);
    expect(b.x1).toBeCloseTo(250 + 206 * mpp, 6);
    expect(b.y0).toBeCloseTo(-400 - 434 * mpp, 6);
    expect(b.y1).toBeCloseTo(-400 + 434 * mpp, 6);
    // The margin grows each side by that share of the size.
    const g = visibleBox(cam.unproject, cam.eye, 0, BIG, 20000, 0.25)!;
    expect(g.x0).toBeCloseTo(b.x0 - 0.25 * (b.x1 - b.x0), 6);
    expect(g.y1).toBeCloseTo(b.y1 + 0.25 * (b.y1 - b.y0), 6);
    expect(boxContains(g, b)).toBe(true);
    expect(boxContains(b, g)).toBe(false);
  });

  it('is clipped to the bounds, and null when none of the ground is in view', () => {
    const cam = topDownCamera(133, 60, 0, 0);
    const clipped = visibleBox(cam.unproject, cam.eye, 0, { x0: -100, y0: -200, x1: 150, y1: 1e5 }, 20000)!;
    expect(clipped).toEqual({ x0: -100, y0: -200, x1: 150, y1: expect.any(Number) });
    expect(visibleBox(cam.unproject, cam.eye, 0, { x0: 1e6, y0: 1e6, x1: 1e6 + 5, y1: 1e6 + 5 }, 20000)).toBeNull();
    // Looking at the sky; or from below the plane.
    const sky = makeCamera({ eye: [0, 500, 0], target: [0, 3000, -2000] });
    expect(visibleBox(sky.unproject, sky.eye, 0, BIG, 20000)).toBeNull();
    expect(visibleBox(cam.unproject, cam.eye, cam.eye[1] + 1, BIG, 20000)).toBeNull();
    expect(visibleBox(cam.unproject, cam.eye, 0, BIG, 0)).toBeNull();
  });

  it('an orbit view: rays at or above the horizon stop at the maximum range, and a shorter range gives a smaller box', () => {
    // Facing north, pitched 20 degrees below the horizon with a 50 degree view: the top of the screen is 5 degrees above it, the bottom
    // 45 degrees below it (it meets the ground 800 m ahead).
    const eye: [number, number, number] = [0, 800, 0];
    const cam = makeCamera({ eye, target: [0, 800 - 1000 * Math.tan((20 * Math.PI) / 180), -1000] });
    const far = visibleBox(cam.unproject, cam.eye, 0, BIG, 20000, 0)!;
    const mid = visibleBox(cam.unproject, cam.eye, 0, BIG, 6000, 0)!;
    expect(far.y0).toBeCloseTo(800, 3);
    expect(mid.y0).toBeCloseTo(800, 3);
    expect(far.y1).toBeCloseTo(20000, 3); // the top edge's middle ray is above the horizon: it stops at the maximum range
    expect(mid.y1).toBeCloseTo(6000, 3);
    expect(boxContains(far, mid)).toBe(true);
    expect(far.x1).toBeGreaterThan(mid.x1);
    // The box is wider at the far end than at the near edge, as the view is.
    expect(mid.x1).toBeGreaterThan(0.2 * 6000 * 0.9);
  });

  it('contains the ground the camera can see, over relief up to the lowest plane (hits on higher ground are nearer, so inside)', () => {
    const cam = makeCamera({ eye: [100, 1500, 3000], target: [0, 0, 0] });
    const lowest = 0;
    const b = visibleBox(cam.unproject, cam.eye, lowest, BIG, 20000, 0.25)!;
    let inside = 0;
    let n = 0;
    for (let k = 0; k < 400; k++) {
      const nx = -1 + 2 * ((k * 0.6180339887) % 1);
      const ny = -1 + 2 * ((k * 0.7548776662) % 1);
      // The ray's direction through the pixel, hit with planes 0, 150 and 300 m above the lowest ground.
      const m = cam.unproject;
      const pw = m[3]! * nx + m[7]! * ny + m[11]! + m[15]!;
      const d = [(m[0]! * nx + m[4]! * ny + m[8]! + m[12]!) / pw - cam.eye[0], (m[1]! * nx + m[5]! * ny + m[9]! + m[13]!) / pw - cam.eye[1], (m[2]! * nx + m[6]! * ny + m[10]! + m[14]!) / pw - cam.eye[2]];
      if (d[1]! >= -1e-9) continue;
      for (const h of [0, 150, 300]) {
        const t = (lowest + h - cam.eye[1]) / d[1]!;
        const x = cam.eye[0] + t * d[0]!;
        const y = -(cam.eye[2] + t * d[2]!);
        if (Math.hypot(x - cam.eye[0], y + cam.eye[2]) > 20000) continue;
        n++;
        if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) inside++;
      }
    }
    expect(n).toBeGreaterThan(900);
    expect(inside).toBe(n);
  });

  it('fills `out` in place when asked', () => {
    const cam = topDownCamera(133, 60);
    const out: Box = { x0: 0, y0: 0, x1: 0, y1: 0 };
    expect(visibleBox(cam.unproject, cam.eye, 0, BIG, 20000, 0.25, out)).toBe(out);
    expect(out).toEqual(visibleBox(cam.unproject, cam.eye, 0, BIG, 20000, 0.25));
  });

  it('boxContains includes the edges', () => {
    const a: Box = { x0: 0, y0: 0, x1: 10, y1: 10 };
    expect(boxContains(a, a)).toBe(true);
    expect(boxContains(a, { x0: 1, y0: 1, x1: 9, y1: 10 })).toBe(true);
    expect(boxContains(a, { x0: -0.1, y0: 1, x1: 9, y1: 9 })).toBe(false);
    expect(boxContains(a, { x0: 1, y0: 1, x1: 9, y1: 10.1 })).toBe(false);
  });
});
