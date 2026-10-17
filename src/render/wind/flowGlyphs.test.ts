/**
 * The glyph builder against analytic fields and the rules of the design (plan 9.3, D-CONTRACT-050 section 2): straight and
 * curved traces, equal steps, length rules per level, arrowheads, draping, calm dots, the raster edge, the near plane, the orbit
 * density, the caps, pan invariance bit for bit, determinism, staging on the clock and the colour table.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HeightField } from '../heightfield';
import { luminance, rgbToLinear, sampleRamp, srgbToLinear, WIND_RAMP, type Rgb } from '../palette';
import { buildSpeedTable, createGlyphBuilder, GLYPH_DOT_PX, GLYPH_HEAD_DEG, GLYPH_LIFT_MIN_M, GLYPH_LIFT_PX, GLYPH_NEAR_FACTOR, HALO_INK, SPEED_TABLE_BINS, type GlyphOutputDetail } from './flowGlyphs';
import { buildAll, clipW, counterClock, glyphsOf, latticeSeed, makeCamera, makeScenario, outputBytes, segmentLength, segmentXY, topDownCamera, type Glyph, type Scenario, type ScenarioOptions } from './glyphOracle.testing';
import { GLYPH_SHAFT_SEGMENTS_MAX } from './glyphTypes';

const outOf = (b: ReturnType<typeof createGlyphBuilder>): GlyphOutputDetail => b.out as GlyphOutputDetail;
/** Metres per pixel of a flat top view. */
const mppTop = (sc: Scenario): number => sc.camera.distance / sc.camera.pxPerMetre1;
const deg = (r: number): number => (r * 180) / Math.PI;

function build(sc: Scenario, tier: 'low' | 'medium' | 'high' = 'high'): { out: GlyphOutputDetail; glyphs: Glyph[] } {
  const b = createGlyphBuilder(tier);
  buildAll(b, sc.input);
  const out = outOf(b);
  return { out, glyphs: glyphsOf(out) };
}

/** Total length of the shaft of a glyph. */
function shaftLength(out: GlyphOutputDetail, g: Glyph): number {
  let s = 0;
  for (let k = 0; k < g.shaft; k++) s += segmentLength(out, g.seg + k);
  return s;
}

/** Largest distance (m) of a shaft vertex from the chord seed -> tip. */
function sagitta(out: GlyphOutputDetail, g: Glyph): number {
  const [x0, y0] = g.seed;
  const cx = g.tip[0] - x0;
  const cy = g.tip[1] - y0;
  const c = Math.hypot(cx, cy);
  let m = 0;
  for (let k = 0; k < g.shaft; k++) {
    const [, , x1, y1] = segmentXY(out, g.seg + k);
    m = Math.max(m, Math.abs(cx * (y1 - y0) - cy * (x1 - x0)) / c);
  }
  return m;
}

describe('a uniform wind', () => {
  // A tiny scene (a 8 m square) so that the Float32 output has a resolution under 1e-6 m.
  const sc = makeScenario({ n: 5, cell: 2, groundCell: 1, cellPx: 60, field: () => [6, 8] });
  const { out, glyphs } = build(sc);

  it('gives straight glyphs with equal steps (deviation under 1e-6 m, steps within 1e-3), 10 m/s to the north-north-east', () => {
    const full = glyphs.filter((g) => g.shaft === 6);
    expect(full.length).toBeGreaterThan(10);
    let dev = 0;
    let stepErr = 0;
    for (const g of full) {
      const [x0, y0] = segmentXY(out, g.seg);
      const len0 = segmentLength(out, g.seg);
      for (let k = 0; k < g.shaft; k++) {
        const [, , x1, y1] = segmentXY(out, g.seg + k);
        // Distance of every vertex from the line through the first vertex along (0.6, 0.8).
        dev = Math.max(dev, Math.abs((x1 - x0) * 0.8 - (y1 - y0) * 0.6));
        stepErr = Math.max(stepErr, Math.abs(segmentLength(out, g.seg + k) / len0 - 1));
      }
    }
    expect(dev).toBeLessThan(1e-6);
    expect(stepErr).toBeLessThan(1e-3);
  });

  it('draws 4 px per m/s: 40 px for 10 m/s at L3', () => {
    const g = glyphs.find((q) => q.shaft === 6)!;
    expect(shaftLength(out, g) / mppTop(sc)).toBeCloseTo(40, 2);
  });
});

describe('analytic fields', () => {
  const OM = 0.02;
  const rotate = (x: number, y: number): [number, number] => [-OM * y, OM * x];

  it('solid-body rotation: a flow line recovers the radius of its seed within 1 %', () => {
    const sc = makeScenario({ cellPx: 60, field: rotate });
    const { out, glyphs } = build(sc);
    let worst = 0;
    let checked = 0;
    for (const g of glyphs) {
      const r0 = Math.hypot(...g.seed);
      if (g.dot || r0 < 150) continue;
      checked++;
      for (let k = 0; k < g.shaft; k++) {
        const [, , x1, y1] = segmentXY(out, g.seg + k);
        worst = Math.max(worst, Math.abs(Math.hypot(x1, y1) - r0) / r0);
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(worst).toBeLessThan(0.01);
    expect(worst).toBeLessThan(1e-3); // RK2 on a circle drifts at third order, and the Float32 output adds 1e-7 of the radius
  });

  it('steps keep one length along a curve (arc length, within 1e-3)', () => {
    const sc = makeScenario({ cellPx: 60, field: rotate });
    const { out, glyphs } = build(sc);
    let worst = 0;
    let n = 0;
    for (const g of glyphs) {
      if (g.shaft < 6) continue;
      n++;
      const l0 = segmentLength(out, g.seg);
      for (let k = 1; k < g.shaft; k++) worst = Math.max(worst, Math.abs(segmentLength(out, g.seg + k) / l0 - 1));
    }
    expect(n).toBeGreaterThan(100);
    expect(worst).toBeLessThan(1e-3);
  });

  it('a saddle bends the flow line along its hyperbola (x y stays constant), turning the way the field turns', () => {
    const A = 0.01;
    const sc = makeScenario({ cellPx: 60, field: (x, y) => [A * x, -A * y] });
    const { out, glyphs } = build(sc);
    let worst = 0;
    let right = 0;
    let n = 0;
    for (const g of glyphs) {
      if (g.shaft < 6) continue;
      const [x0, y0] = g.seed;
      if (Math.abs(x0 * y0) < 2e5) continue;
      n++;
      for (let k = 0; k < g.shaft; k++) {
        const [, , x1, y1] = segmentXY(out, g.seg + k);
        worst = Math.max(worst, Math.abs(x1 * y1 - x0 * y0) / Math.abs(x0 * y0));
      }
      // The flow (A x, -A y) turns counter-clockwise where x y > 0 (first and third quadrants) and clockwise where x y < 0.
      const [ax, ay, bx, by] = segmentXY(out, g.seg);
      const [cx, cy, dx, dy] = segmentXY(out, g.seg + g.shaft - 1);
      const turn = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
      if (Math.sign(turn) === Math.sign(x0 * y0) && Math.abs(turn) > 1e-6 * segmentLength(out, g.seg) * segmentLength(out, g.seg + 1)) right++;
    }
    expect(n).toBeGreaterThan(30);
    expect(worst).toBeLessThan(0.01);
    expect(right).toBe(n);
  });

  it('L1 and L2 are straight (one step) while L3 and L4 curve, in the same rotating field', () => {
    const f = (x: number, y: number): [number, number] => [-0.05 * y, 0.05 * x]; // 5 m/s at 100 m: strong turning
    for (const [cellPx, level] of [[8, 1], [20, 2], [60, 3], [150, 4]] as const) {
      const sc = makeScenario({ cellPx, field: f });
      expect(sc.plan.level).toBe(level);
      const { out, glyphs } = build(sc);
      const lines = glyphs.filter((g) => !g.dot);
      expect(lines.length).toBeGreaterThan(5);
      if (level <= 2) {
        expect(lines.every((g) => g.shaft === 1)).toBe(true);
        expect(Math.max(...lines.map((g) => sagitta(out, g)))).toBeLessThan(1e-3); // one segment is its own chord
      } else {
        const longest = Math.max(...lines.map((g) => g.shaft));
        expect(longest).toBeGreaterThanOrEqual(6);
        expect(longest).toBeLessThanOrEqual(GLYPH_SHAFT_SEGMENTS_MAX);
        const curved = lines.filter((g) => g.shaft >= 6 && sagitta(out, g) > 0.3 * mppTop(sc));
        expect(curved.length).toBeGreaterThan(lines.length / 4);
      }
    }
  });

  it('runs a glyph downwind from its seed', () => {
    const sc = makeScenario({ cellPx: 60, field: () => [0, -9] }); // wind to the south
    const { glyphs } = build(sc);
    const full = glyphs.filter((g) => g.shaft >= 6);
    expect(full.length).toBeGreaterThan(50);
    expect(full.every((g) => g.tip[1] < g.seed[1] - 1)).toBe(true);
    expect(full.every((g) => Math.abs(g.tip[0] - g.seed[0]) < 1e-2)).toBe(true);
  });
});

describe('length rules per level', () => {
  const rules = [
    { cellPx: 8, level: 1, pxPerMs: 4, min: 8, max: 45 },
    { cellPx: 20, level: 2, pxPerMs: 4, min: 8, max: 32 },
    { cellPx: 60, level: 3, pxPerMs: 4, min: 28, max: 56 },
    { cellPx: 150, level: 4, pxPerMs: 6, min: 90, max: 140 },
  ];
  for (const r of rules) {
    it(`L${r.level}: length is clamp(${r.pxPerMs} px per m/s x speed, ${r.min}, ${r.max}) px`, () => {
      for (const speed of [0.5, 2, 5, 12, 25]) {
        const sc = makeScenario({ cellPx: r.cellPx, field: () => [speed, 0] });
        expect(sc.plan.level).toBe(r.level);
        const { out, glyphs } = build(sc);
        const want = Math.min(r.max, Math.max(r.min, r.pxPerMs * speed));
        const east = sc.grid.x0 + (sc.grid.nx - 1) * sc.grid.cellSize;
        // Glyphs that were not cut by the east edge.
        const lines = glyphs.filter((g) => !g.dot && g.seed[0] + (want + 20) * mppTop(sc) < east);
        expect(lines.length).toBeGreaterThan(0);
        for (const g of lines) expect(shaftLength(out, g) / mppTop(sc)).toBeCloseTo(want, 3);
      }
    });
  }
});

describe('arrowheads and draping', () => {
  it('two chevron barbs from the tip, 28 degrees either side of the way back, 0.35 of the length (5 to 9 px) long', () => {
    const sc = makeScenario({ cellPx: 60, field: () => [6, 8] });
    const { out, glyphs } = build(sc);
    const full = glyphs.filter((g) => g.shaft === 6);
    expect(full.length).toBeGreaterThan(50);
    const headPx = Math.min(9, Math.max(5, 0.35 * 40)); // 10 m/s: 40 px long
    let angleErr = 0;
    let lenErr = 0;
    for (const g of full) {
      const [sx, sy] = segmentXY(out, g.seg + 5);
      const back = [sx - g.tip[0], sy - g.tip[1]];
      const signs: number[] = [];
      for (let b = 0; b < 2; b++) {
        const [ax, ay, bx, by] = segmentXY(out, g.seg + g.shaft + b);
        expect(Math.hypot(ax - g.tip[0], ay - g.tip[1])).toBeLessThan(1e-2); // starts at the tip
        const vx = bx - ax;
        const vy = by - ay;
        const turn = deg(Math.atan2(back[0]! * vy - back[1]! * vx, back[0]! * vx + back[1]! * vy));
        signs.push(Math.sign(turn));
        angleErr = Math.max(angleErr, Math.abs(Math.abs(turn) - GLYPH_HEAD_DEG));
        lenErr = Math.max(lenErr, Math.abs(Math.hypot(vx, vy) / (headPx * mppTop(sc)) - 1));
      }
      expect(signs[0]! * signs[1]!).toBe(-1); // one barb each side
    }
    expect(angleErr).toBeLessThan(0.05);
    expect(lenErr).toBeLessThan(1e-3);
  });

  it('the barbs scale with the glyph: 5 px for a slow short glyph, 9 px for a long one', () => {
    const slow = makeScenario({ cellPx: 8, field: () => [2, 0] }); // L1: 8 px long -> head 0.35 x 8 = 2.8, raised to 5
    const fast = makeScenario({ cellPx: 8, field: () => [11, 0] }); // 44 px -> 15.4, cut to 9
    for (const [sc, px] of [[slow, 5], [fast, 9]] as const) {
      const { out, glyphs } = build(sc);
      const g = glyphs.find((q) => !q.dot)!;
      expect(segmentLength(out, g.seg + g.shaft) / mppTop(sc)).toBeCloseTo(px, 3);
    }
  });

  it('drapes every vertex on the ground plus the lift: max(1.5 m, 3 px) x exaggeration in world y', () => {
    const ground = (x: number, y: number): number => 300 + 60 * Math.sin(x / 700) + 40 * Math.cos(y / 500);
    for (const vex of [1, 2]) {
      const cam = topDownCamera(133, 60, 0, 0, { near: 30 }, 300 * vex);
      const sc = makeScenario({ cellPx: 60, field: (_x, y) => [5 + 0.001 * y, 3], ground, camera: cam, vex });
      const { out, glyphs } = build(sc);
      const hf = new HeightField(sc.ground.grid, sc.ground.elevation);
      expect(glyphs.length).toBeGreaterThan(100);
      let worst = 0;
      for (const g of glyphs) {
        const zSeed = hf.heightAt(g.seed[0], g.seed[1]);
        const mpp = clipW(sc.camera.viewProj, g.seed[0], zSeed * vex, -g.seed[1]) / sc.camera.pxPerMetre1;
        const lift = Math.max(GLYPH_LIFT_MIN_M, GLYPH_LIFT_PX * mpp);
        for (let k = g.seg; k < g.seg + g.count; k++) {
          for (const [x, yw, zw] of [[out.a[3 * k]!, out.a[3 * k + 1]!, out.a[3 * k + 2]!], [out.b[3 * k]!, out.b[3 * k + 1]!, out.b[3 * k + 2]!]] as const) {
            worst = Math.max(worst, Math.abs(yw - (hf.heightAt(x, -zw) + lift) * vex));
          }
        }
      }
      expect(worst).toBeLessThan(5e-3 * vex); // Float32 world heights near 300 m to 600 m
    }
  });
});

describe('calm dots, and what happens when the wind drops', () => {
  it('a calm field is all dots: one segment of 3 px, counted in out.calm', () => {
    const sc = makeScenario({ cellPx: 60, field: () => [0.1, 0] });
    const { out, glyphs } = build(sc);
    expect(out.glyphs).toBeGreaterThan(100);
    expect(out.calm).toBe(out.glyphs);
    expect(out.segments).toBe(out.glyphs);
    for (const g of glyphs) {
      expect(g.dot).toBe(true);
      const [x0, y0, x1, y1] = segmentXY(out, g.seg);
      expect(Math.hypot(x1 - x0, y1 - y0) / mppTop(sc)).toBeCloseTo(GLYPH_DOT_PX, 3);
      expect(y1).toBeCloseTo(y0, 3);
    }
    expect(out.c[3]).toBe(1);
  });

  it('a trace stops when the wind falls under 0.3 m/s and the glyph is shorter; a calm seed is a dot', () => {
    // 5 m/s west of x = 0, falling in a straight line to 0.1 m/s at x = 133 m (one cell), then calm.
    const sc = makeScenario({ cellPx: 60, field: (x) => [x <= 0 ? 5 : x >= 133 ? 0.1 : 5 - (4.9 * x) / 133, 0] });
    const { out, glyphs } = build(sc);
    const lines = glyphs.filter((g) => !g.dot);
    const short = lines.filter((g) => g.shaft < 6 && g.seed[0] < 128);
    expect(short.length).toBeGreaterThan(0); // cut short
    expect(lines.every((g) => g.shaft >= 1)).toBe(true);
    expect(glyphs.some((g) => g.dot && g.seed[0] > 128)).toBe(true);
    expect(out.calm).toBe(glyphs.filter((g) => g.dot).length);
    // No shaft vertex beyond where the speed is 0.3 m/s (x = 127.6 m) plus half a step.
    const half = (28 * mppTop(sc)) / 6 / 2;
    for (const g of lines) for (let k = 0; k < g.shaft; k++) expect(segmentXY(out, g.seg + k)[2]).toBeLessThan(127.6 + half + 1e-2);
  });
});

describe('the raster edge', () => {
  it('a glyph stops at the edge of the wind raster: nothing is drawn beyond it, and the glyphs near it are shorter', () => {
    const sc = makeScenario({ cellPx: 60, field: () => [10, 0], centre: [2600, 0] }); // the screen spans the east edge, x = 2926
    const g = sc.grid;
    const east = g.x0 + (g.nx - 1) * g.cellSize;
    const { out, glyphs } = build(sc);
    let maxX = -Infinity;
    for (let k = 0; k < out.segments; k++) maxX = Math.max(maxX, out.a[3 * k]!, out.b[3 * k]!);
    expect(maxX).toBeLessThanOrEqual(east + 1e-2);
    expect(glyphs.some((q) => q.shaft >= 1 && q.shaft < 6)).toBe(true);
    expect(glyphs.every((q) => q.seed[0] <= east)).toBe(true);
    // The west and north edges stop too (a wind toward them).
    const nw = makeScenario({ cellPx: 60, field: () => [-7, 7], centre: [-2600, 2600] });
    const b = build(nw);
    let minX = Infinity;
    let maxY = -Infinity;
    for (let k = 0; k < b.out.segments; k++) {
      minX = Math.min(minX, b.out.a[3 * k]!, b.out.b[3 * k]!);
      maxY = Math.max(maxY, -b.out.a[3 * k + 2]!, -b.out.b[3 * k + 2]!);
    }
    expect(minX).toBeGreaterThanOrEqual(g.x0 - 1e-2);
    expect(maxY).toBeLessThanOrEqual(g.y0 + (g.ny - 1) * g.cellSize + 1e-2);
  });
});

describe('the near plane', () => {
  it('a glyph with a vertex at a clip depth under 1.5 near planes is dropped whole, and none is drawn that has one', () => {
    // A top view from 2063 m with the near plane at 1366.7 m (1.5 x = 2050 m) over ground that rises to the east: a glyph that starts
    // just beyond the limit climbs into it.
    const cam = topDownCamera(133, 60, 0, 0, { near: 1366.67 }, 0);
    const sc = makeScenario({ cellPx: 60, field: () => [10, 0], ground: (x) => 0.04 * x, camera: cam });
    const { out, glyphs } = build(sc);
    const wmin = GLYPH_NEAR_FACTOR * cam.near;
    expect(out.dropped).toBeGreaterThan(10);
    expect(glyphs.length).toBeGreaterThan(50);
    let lowest = Infinity;
    for (let k = 0; k < out.segments; k++) {
      lowest = Math.min(lowest, clipW(cam.viewProj, out.a[3 * k]!, out.a[3 * k + 1]!, out.a[3 * k + 2]!), clipW(cam.viewProj, out.b[3 * k]!, out.b[3 * k + 1]!, out.b[3 * k + 2]!));
    }
    expect(lowest).toBeGreaterThan(wmin - 1e-2);
    // A dropped glyph leaves no stray segments: the segments of the glyphs add up to the total.
    expect(glyphs.reduce((s, g) => s + g.count, 0)).toBe(out.segments);
  });
});

describe('orbit view density', () => {
  /** Glyphs per band of the screen (equal heights in NDC), by the seed's projection: near the bottom, the middle, and well up toward the horizon. */
  function bands(sc: Scenario, glyphs: Glyph[]): { near: number; mid: number; far: number } {
    const vp = sc.camera.viewProj;
    const c = { near: 0, mid: 0, far: 0 };
    for (const g of glyphs) {
      const w = clipW(vp, g.seed[0], 0, -g.seed[1]);
      const y = (vp[1]! * g.seed[0] + vp[9]! * -g.seed[1] + vp[13]!) / w;
      const x = (vp[0]! * g.seed[0] + vp[8]! * -g.seed[1] + vp[12]!) / w;
      if (Math.abs(x) > 1) continue;
      if (y > -0.9 && y < -0.6) c.near++;
      else if (y > -0.15 && y < 0.15) c.mid++;
      else if (y > 0.35 && y < 0.65) c.far++;
    }
    return c;
  }
  const orbit = (thin: boolean, margin = 0.25) => {
    const cam = makeCamera({ eye: [0, 1500, 3000], target: [0, 0, 0] }); // 27 degrees above the horizon, the top of the screen near it
    const sc = makeScenario({ n: 90, cell: 133, cellPx: 40, field: () => [4, 3], camera: cam, boxMargin: margin, plan: thin ? undefined : { mppCentre: 1e9 } });
    const { glyphs } = build(sc);
    return { sc, glyphs, b: bands(sc, glyphs) };
  };

  it('thins the seeds toward the horizon so the picture is about as full far up as it is in the middle', () => {
    const thin = orbit(true);
    const flat = orbit(false);
    expect(thin.sc.plan.level).toBe(3);
    // Without thinning the world lattice crowds the upper screen (many metres per pixel); with it the bands match.
    expect(flat.b.far / flat.b.mid).toBeGreaterThan(3);
    expect(thin.b.far / thin.b.mid).toBeGreaterThan(0.6);
    expect(thin.b.far / thin.b.mid).toBeLessThan(1.6);
    expect(thin.glyphs.length).toBeLessThan(flat.glyphs.length / 2);
    expect(thin.b.far).toBeGreaterThan(30);
  });

  it('keeps a seed or drops it by the camera alone: a wider box adds seeds and changes none of the others', () => {
    const a = orbit(true);
    const wide = orbit(true, 0.9);
    const key = (g: Glyph): string => `${g.seed[0]},${g.seed[1]}`;
    const wideKeys = new Set(wide.glyphs.map(key));
    expect(a.glyphs.every((g) => wideKeys.has(key(g)))).toBe(true);
    expect(wide.glyphs.length).toBeGreaterThanOrEqual(a.glyphs.length);
  });
});

describe('caps', () => {
  const tablet: ScenarioOptions = { cellPx: 40, camera: topDownCamera(133, 40, 0, 0, { cssW: 1280, cssH: 800 }), field: () => [6, 2] };

  it('keeps about the glyph cap and never more, by a hash and not by the order of the lattice', () => {
    const all = build(makeScenario(tablet));
    expect(all.glyphs.length).toBeGreaterThan(700);
    const cap = 120;
    const sc = makeScenario({ ...tablet, cap: { glyphs: cap, segments: 12000 } });
    const { glyphs } = build(sc);
    expect(glyphs.length).toBeLessThanOrEqual(cap);
    expect(glyphs.length).toBeGreaterThan(cap * 0.8);
    // Spread over the whole screen, not the first rows: the kept seeds cover the north and the south of the box.
    const ys = glyphs.map((g) => g.seed[1]).sort((p, q) => p - q);
    const span = sc.input.box.y1 - sc.input.box.y0;
    expect(ys[ys.length - 1]! - ys[0]!).toBeGreaterThan(0.7 * span);
  });

  it('keeps the segment cap: the shafts shrink to fit and the build stops at the cap', () => {
    const sc = makeScenario({ ...tablet, cap: { glyphs: 2000, segments: 3000 } });
    const { out, glyphs } = build(sc);
    expect(out.segments).toBeLessThanOrEqual(3000);
    expect(out.segments).toBeGreaterThan(2900);
    expect(Math.max(...glyphs.map((g) => g.shaft))).toBeLessThanOrEqual(3);
    // A roomy cap gives the full shafts.
    const roomy = build(makeScenario({ ...tablet, cap: { glyphs: 2000, segments: 20000 } }));
    expect(Math.max(...roomy.glyphs.map((g) => g.shaft))).toBeGreaterThanOrEqual(6);
  });

  it('the tier caps are the size of `out`: nothing is written past them', () => {
    const b = createGlyphBuilder('low');
    const sc = makeScenario({ ...tablet, cap: { glyphs: 99999, segments: 999999 } });
    buildAll(b, sc.input);
    const out = outOf(b);
    expect(out.glyphs).toBeLessThanOrEqual(600);
    expect(out.segments).toBeLessThanOrEqual(4000);
    expect(out.a.length).toBe(3 * 4000);
    expect(out.c.length).toBe(4 * 4000);
  });
});

describe('deterministic seeds', () => {
  it('the same input gives the same bytes, on a fresh builder and on a used one; the sources never call Math.random', () => {
    const sc = makeScenario({ cellPx: 60, field: (x, y) => [-0.02 * y + 3, 0.02 * x] });
    const a = createGlyphBuilder('high');
    buildAll(a, sc.input);
    const first = Buffer.from(outputBytes(outOf(a)));
    const b = createGlyphBuilder('high');
    buildAll(b, sc.input);
    expect(outputBytes(outOf(b)).equals(first)).toBe(true);
    buildAll(a, sc.input); // reused
    expect(outputBytes(outOf(a)).equals(first)).toBe(true);
    for (const f of ['flowGlyphs.ts', 'glyphLod.ts', 'glyphPose.ts', 'glyphField.ts']) {
      expect(readFileSync(new URL(`./${f}`, import.meta.url), 'utf8')).not.toMatch(/Math\s*\.\s*random\s*\(/);
    }
  });

  it('a seed is the lattice formula: cell centre moved by the hash, anchored to the world', () => {
    const sc = makeScenario({ cellPx: 60, field: () => [6, 8] });
    const { glyphs } = build(sc);
    const S = sc.plan.spacingM;
    expect(S).toBe(2 ** sc.plan.spacingExp);
    let worst = 0;
    for (const g of glyphs) {
      const i = Math.floor(g.seed[0] / S);
      const j = Math.floor(g.seed[1] / S);
      const [x, y] = latticeSeed(i, j, sc.plan.spacingExp, sc.plan.jitter);
      worst = Math.max(worst, Math.abs(x - g.seed[0]), Math.abs(y - g.seed[1]));
    }
    expect(worst).toBeLessThan(5e-4); // Float32 at 3 km
    // L1 and L2 have no jitter: a plain lattice.
    const l1 = makeScenario({ cellPx: 8, field: () => [6, 8] });
    for (const g of build(l1).glyphs) {
      const q = l1.plan.spacingM;
      expect(((g.seed[0] / q - 0.5) % 1) + 1).toBeCloseTo(1, 4);
    }
  });
});

describe('pan invariance', () => {
  it('a top view panned by whole lattice cells builds the same glyphs for the seeds both views hold, bit for bit', () => {
    const field = (x: number, y: number): [number, number] => [4 + 0.002 * y + Math.sin(x / 900), 2 + Math.cos(y / 700)];
    const A = makeScenario({ cellPx: 60, field });
    const S = A.plan.spacingM;
    const dx = 3 * S;
    const dy = -2 * S;
    // The view of a camera that has moved by (3 S, -2 S): same height, same everything else.
    const B = makeScenario({ cellPx: 60, field, camera: topDownCamera(133, 60, dx, dy) });
    expect(B.plan.spacingExp).toBe(A.plan.spacingExp);
    const ga = build(A);
    const gb = build(B);
    const key = (g: Glyph): string => `${g.seed[0]},${g.seed[1]}`;
    const inA = new Map(ga.glyphs.map((g) => [key(g), g]));
    let shared = 0;
    let differing = 0;
    for (const g of gb.glyphs) {
      const m = inA.get(key(g));
      if (!m) continue;
      shared++;
      if (m.count !== g.count) {
        differing++;
        continue;
      }
      for (let k = 0; k < g.count; k++) {
        const ia = m.seg + k;
        const ib = g.seg + k;
        for (let c = 0; c < 3; c++) if (ga.out.a[3 * ia + c] !== gb.out.a[3 * ib + c] || ga.out.b[3 * ia + c] !== gb.out.b[3 * ib + c]) differing++;
        for (let c = 0; c < 4; c++) if (ga.out.c[4 * ia + c] !== gb.out.c[4 * ib + c]) differing++;
      }
    }
    expect(shared).toBeGreaterThan(gb.glyphs.length * 0.4);
    expect(differing).toBe(0);
    // And every glyph whose seed is well inside both screens is in both builds.
    const vpB = B.camera.viewProj;
    const ndc = (vp: Float64Array, g: Glyph): [number, number] => {
      const w = clipW(vp, g.seed[0], 0, -g.seed[1]);
      return [(vp[0]! * g.seed[0] + vp[8]! * -g.seed[1] + vp[12]!) / w, (vp[1]! * g.seed[0] + vp[9]! * -g.seed[1] + vp[13]!) / w];
    };
    const inB = new Set(gb.glyphs.map(key));
    for (const g of ga.glyphs) {
      const [bx, by] = ndc(vpB, g);
      if (Math.abs(bx) < 0.9 && Math.abs(by) < 0.9) expect(inB.has(key(g))).toBe(true);
    }
  });
});

describe('degenerate inputs build nothing, and say they are done', () => {
  const cases: [string, (sc: Scenario) => void][] = [
    ['level 0', (sc) => Object.assign(sc.input.lod, { level: 0 })],
    ['an empty box', (sc) => Object.assign(sc.input, { box: { x0: 1, y0: 1, x1: 0, y1: 0 } })],
    ['a box outside the raster', (sc) => Object.assign(sc.input, { box: { x0: 1e6, y0: 1e6, x1: 1e6 + 10, y1: 1e6 + 10 } })],
    ['a zero cap', (sc) => Object.assign(sc.input, { cap: { glyphs: 0, segments: 100 } })],
    ['no pixel scale', (sc) => Object.assign(sc.input, { pxPerMetre1: 0 })],
  ];
  for (const [name, mutate] of cases) {
    it(name, () => {
      const sc = makeScenario({ cellPx: 60 });
      mutate(sc);
      const b = createGlyphBuilder('medium');
      b.begin(sc.input);
      expect(b.step(3)).toBe(true); // at once, with nothing built
      expect(b.busy).toBe(false);
      expect(outOf(b).glyphs).toBe(0);
      expect(outOf(b).segments).toBe(0);
    });
  }

  it('step before any begin is done', () => {
    const b = createGlyphBuilder('low');
    expect(b.busy).toBe(false);
    expect(b.step(3)).toBe(true);
  });
});

describe('staging', () => {
  const sc = makeScenario({ cellPx: 60, field: (x, y) => [5 + Math.sin(x / 500), 3 + Math.cos(y / 400)] });
  const whole = (() => {
    const b = createGlyphBuilder('high');
    buildAll(b, sc.input);
    return Buffer.from(outputBytes(outOf(b)));
  })();

  it('slices that stop on the clock give exactly the bytes of one slice', () => {
    for (const tick of [0.7, 1, 2.5]) {
      const clock = counterClock(tick);
      const b = createGlyphBuilder('high');
      b.begin({ ...sc.input, now: clock.now });
      let steps = 0;
      while (!b.step(3)) {
        steps++;
        expect(b.busy).toBe(true);
        expect(steps).toBeLessThan(10000);
      }
      expect(b.busy).toBe(false);
      expect(steps).toBeGreaterThan(1);
      expect(outputBytes(outOf(b)).equals(whole)).toBe(true);
    }
  });

  it('always makes progress, even with a budget of nothing and a clock that stands still', () => {
    const clock = counterClock(0);
    const b = createGlyphBuilder('high');
    b.begin({ ...sc.input, now: clock.now });
    let steps = 0;
    let last = 0;
    while (!b.step(0)) {
      steps++;
      // Walking the lattice finds no glyph yet (a few hundred cells a call while the code is cold); once tracing, every call adds some.
      if (last > 0) expect(outOf(b).glyphs).toBeGreaterThan(last);
      expect(outOf(b).glyphs).toBeGreaterThanOrEqual(last);
      last = outOf(b).glyphs;
      expect(steps).toBeLessThan(200);
    }
    expect(outputBytes(outOf(b)).equals(whole)).toBe(true);
    expect(last).toBeGreaterThan(0);
  });

  it('reads the clock more often for the first rebuilds of a builder (cold code), and rarely for a warm one', () => {
    const reads: number[] = [];
    const b = createGlyphBuilder('high');
    for (let r = 0; r < 7; r++) {
      const clock = counterClock(0);
      b.begin({ ...sc.input, now: clock.now });
      while (!b.step(3)) {
        /* sliced */
      }
      reads.push(clock.reads());
    }
    expect(reads[0]!).toBeGreaterThan(reads[6]!);
    expect(reads[6]!).toBeLessThan(sc.input.cap.glyphs / 16); // at most one read per 16 glyphs once warm (about one per 128)
  });

  it('cancel stops a build at once and the builder can start another', () => {
    const clock = counterClock(1);
    const b = createGlyphBuilder('high');
    b.begin({ ...sc.input, now: clock.now });
    expect(b.step(2)).toBe(false);
    expect(b.busy).toBe(true);
    b.cancel();
    expect(b.busy).toBe(false);
    expect(b.step(2)).toBe(true);
    buildAll(b, sc.input);
    expect(outputBytes(outOf(b)).equals(whole)).toBe(true);
  });

  it('begin during a build restarts it', () => {
    const clock = counterClock(1);
    const b = createGlyphBuilder('high');
    b.begin({ ...sc.input, now: clock.now });
    b.step(2);
    buildAll(b, sc.input);
    expect(outputBytes(outOf(b)).equals(whole)).toBe(true);
  });

  it('does not read the clock for a cap-bound build more often than the glyph count allows', () => {
    const clock = counterClock(0);
    const b = createGlyphBuilder('high');
    b.begin({ ...sc.input, now: clock.now });
    while (!b.step(1e9)) {
      /* done in one */
    }
    expect(clock.reads()).toBeLessThan(40);
  });
});

describe('the colour table', () => {
  const table = buildSpeedTable();

  it('is 64 entries of linear rgb from the Wind speed ramp, 0 to 25 m/s', () => {
    expect(table.length).toBe(SPEED_TABLE_BINS * 3);
    for (let b = 0; b < SPEED_TABLE_BINS; b++) {
      const c = sampleRamp(WIND_RAMP, (b / 63) * 25, [0, 0, 0] as Rgb);
      expect(table[3 * b]).toBeCloseTo(srgbToLinear(c[0]), 6);
      expect(table[3 * b + 1]).toBeCloseTo(srgbToLinear(c[1]), 6);
      expect(table[3 * b + 2]).toBeCloseTo(srgbToLinear(c[2]), 6);
    }
  });

  it('every colour holds at least 3:1 against the halo ink (the pale stops are the tight ones)', () => {
    const lum = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const ink = lum(HALO_INK[0], HALO_INK[1], HALO_INK[2]);
    expect(ink).toBeLessThan(0.02); // near-black
    let lowest = Infinity;
    for (let b = 0; b < SPEED_TABLE_BINS; b++) {
      const y = lum(table[3 * b]!, table[3 * b + 1]!, table[3 * b + 2]!);
      lowest = Math.min(lowest, (Math.max(y, ink) + 0.05) / (Math.min(y, ink) + 0.05));
    }
    expect(lowest).toBeGreaterThanOrEqual(3);
    // Agrees with the palette's own luminance of the sRGB colour.
    const c = sampleRamp(WIND_RAMP, 25, [0, 0, 0] as Rgb);
    expect(lum(...(rgbToLinear(c) as [number, number, number]))).toBeCloseTo(luminance(c), 8);
  });

  it('colours each segment by the speed at its start, alpha 1, and a dot by the calm colour', () => {
    const sc = makeScenario({ cellPx: 60, field: (x) => [3 + (x + 3000) / 300, 0] }); // 3 to 23 m/s across the domain
    const { out, glyphs } = build(sc);
    let checked = 0;
    for (const g of glyphs) {
      if (g.dot) continue;
      const [x0] = segmentXY(out, g.seg);
      const speed = 3 + (x0 + 3000) / 300; // at the first segment's start (the raster is linear in x)
      const bin = Math.min(63, Math.round(speed * (63 / 25)));
      for (let c = 0; c < 3; c++) expect(out.c[4 * g.seg + c]).toBeCloseTo(table[3 * bin + c]!, 6);
      expect(out.c[4 * g.seg + 3]).toBe(1);
      expect(out.c[4 * (g.seg + g.count - 1) + 3]).toBe(1);
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
    const calm = build(makeScenario({ cellPx: 60, field: () => [0.1, 0] }));
    for (let c = 0; c < 3; c++) expect(calm.out.c[c]).toBeCloseTo(table[c]!, 6);
  });
});
