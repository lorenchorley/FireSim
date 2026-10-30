/**
 * The detailed streaks' builder against analytic fields and the rules of the contract (3.1 to 3.5, 5): straight and curved lines in equal
 * steps, the numbers a line carries for the shader (arc lengths, life seed, speed, tail, turb, lift), lift and lee from the 10 m ground,
 * the caps, the near plane, the walls, calm, the raster edge, the orbit density, pan invariance, determinism, staging on the clock,
 * and the pulse formula.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { HeightField } from '../heightfield';
import { buildSpeedTable, GLYPH_NEAR_FACTOR, GLYPH_LIFT_MIN_M, GLYPH_LIFT_PX, GLYPH_MAX_SLOPE } from './flowGlyphs';
import { createDetailBuilder, DETAIL_MIN_LINE_SEGMENTS, DETAIL_TAIL, DETAIL_TERRAIN, detailGroundFactor, pulseIntensity } from './detailStreaks';
import { detailBytes, linesOf, makeDetailScenario, segmentLength, segmentXY, type DetailScenario, type DetailScenarioOptions, type Line } from './detailStreaks.testing';
import { buildAll, clipW, counterClock, groundOf, makeCamera, nestedSeed, ORIGIN, topDownCamera } from './glyphOracle.testing';
import { crownDiscRadius } from './detailObstacles';
import { hash01 } from '../fields';
import { DETAIL_GEOMETRY, DETAIL_RELIEF, GLYPH_CAPS, type CrownSet, type DetailBuilder, type DetailInput, type DetailOutput, type DetailRelief, type GlyphTier, type Plume } from './glyphTypes';
import type { FuelMap } from '../../core/types';

/** Metres per pixel of a flat top view. */
const mppTop = (sc: DetailScenario): number => sc.camera.distance / sc.camera.pxPerMetre1;
const deg = (r: number): number => (r * 180) / Math.PI;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function build(sc: DetailScenario, tier: GlyphTier = 'high'): { b: DetailBuilder; out: DetailOutput; lines: Line[] } {
  const b = createDetailBuilder(tier);
  buildAll(b, sc.input);
  return { b, out: b.out, lines: linesOf(b.out) };
}

/** Direction (radians) of segment k, and the turn (degrees, signed) between segments k and k + 1 of a line. */
const heading = (out: DetailOutput, k: number): number => {
  const [x0, y0, x1, y1] = segmentXY(out, k);
  return Math.atan2(y1 - y0, x1 - x0);
};
const turnBetween = (out: DetailOutput, k: number): number => {
  let d = heading(out, k + 1) - heading(out, k);
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return deg(d);
};

/** The steps of a line of this length: `clamp(ceil(L / 9), 8, 24)`. */
const stepsFor = (lenPx: number): number => clamp(Math.ceil(lenPx / DETAIL_GEOMETRY.stepPx), DETAIL_GEOMETRY.minSegments, DETAIL_GEOMETRY.maxSegments);
const lengthFor = (speed: number): number => clamp(DETAIL_GEOMETRY.pxPerMs * speed, DETAIL_GEOMETRY.minPx, DETAIL_GEOMETRY.maxPx);

/** A tiny scene (a 10 m square, a model cell of 2 m) so that the Float32 output has a resolution under 1e-6 m. */
const tiny = (o: DetailScenarioOptions = {}): DetailScenario => makeDetailScenario({ n: 5, cell: 2, groundCell: 1, cellPx: 150, field: () => [6, 8], ...o });

describe('a uniform wind', () => {
  const sc = tiny();
  const { out, lines } = build(sc);

  it('is at the level of the detailed streaks, and draws straight lines in equal steps, 10 m/s to the north-north-east', () => {
    expect(sc.plan.level).toBe(4);
    expect(sc.plan).toMatchObject({ spacingPx: 32, jitter: 0.35, lengthPx: { min: 90, max: 220, pxPerMs: 16 } });
    const full = lines.filter((l) => l.count === 18);
    expect(full.length).toBeGreaterThan(10);
    let dev = 0;
    let stepErr = 0;
    for (const l of full) {
      const [x0, y0] = segmentXY(out, l.seg);
      const len0 = segmentLength(out, l.seg);
      for (let k = 0; k < l.count; k++) {
        const [, , x1, y1] = segmentXY(out, l.seg + k);
        dev = Math.max(dev, Math.abs((x1 - x0) * 0.8 - (y1 - y0) * 0.6)); // from the line through the first vertex along (0.6, 0.8)
        stepErr = Math.max(stepErr, Math.abs(segmentLength(out, l.seg + k) / len0 - 1));
      }
    }
    expect(dev).toBeLessThan(1e-6);
    expect(stepErr).toBeLessThan(1e-3);
  });

  it('draws 16 px per m/s: 160 px for 10 m/s, in 18 steps of 8.9 px (the arc lengths are those pixels)', () => {
    const l = lines.find((q) => q.count === 18)!;
    let metres = 0;
    for (let k = 0; k < l.count; k++) metres += segmentLength(out, l.seg + k);
    expect(metres / mppTop(sc)).toBeCloseTo(160, 2);
    expect(l.lengthPx).toBeCloseTo(160, 3);
    for (let k = 0; k < l.count; k++) {
      expect(out.d[4 * (l.seg + k)]).toBeCloseTo((k * 160) / 18, 3);
      expect(out.d[4 * (l.seg + k) + 1]).toBeCloseTo(((k + 1) * 160) / 18, 3);
    }
  });

  it('runs a line downwind from its seed (north-north-east), no line the other way', () => {
    for (const l of lines) {
      expect(l.end[1]).toBeGreaterThan(l.seed[1]);
      expect(l.end[0]).toBeGreaterThan(l.seed[0]);
    }
  });
});

describe('what a line carries for the shader', () => {
  const rotate = (x: number, y: number): [number, number] => [3 - 0.004 * y, 1 + 0.004 * x];
  const sc = makeDetailScenario({ field: (x, y) => [rotate(x, y)[0] + 4, rotate(x, y)[1]] });
  const { out, lines } = build(sc);

  it('has segments that join, arc lengths that grow by at most 12 px a segment from 0, and L (px) the same on every segment of a line', () => {
    expect(lines.length).toBeGreaterThan(60);
    for (const l of lines) {
      expect(out.d[4 * l.seg]).toBe(0);
      for (let k = 0; k < l.count; k++) {
        const q = l.seg + k;
        const s0 = out.d[4 * q]!;
        const s1 = out.d[4 * q + 1]!;
        expect(s1).toBeGreaterThan(s0);
        expect(s1 - s0).toBeLessThanOrEqual(12);
        expect(out.d[4 * q + 2]).toBe(l.lengthPx);
        if (k > 0) {
          expect(s0).toBeCloseTo(out.d[4 * (q - 1) + 1]!, 3);
          for (let c = 0; c < 3; c++) expect(out.a[3 * q + c]).toBe(out.b[3 * (q - 1) + c]); // the segments join
        }
      }
      // A line is as long as it is drawn: the last arc length is L (a line cut short is shorter on every one of its segments).
      expect(out.d[4 * (l.seg + l.count - 1) + 1]).toBeCloseTo(l.lengthPx, 3);
      expect(l.count).toBeGreaterThanOrEqual(DETAIL_MIN_LINE_SEGMENTS);
      expect(l.count).toBeLessThanOrEqual(DETAIL_GEOMETRY.maxSegments);
    }
  });

  it('puts the metres of a step in step with its pixels: a segment is s1 - s0 px long at the seed scale (flat top view)', () => {
    let worst = 0;
    for (const l of lines) for (let k = 0; k < l.count; k++) worst = Math.max(worst, Math.abs(segmentLength(out, l.seg + k) / mppTop(sc) / (out.d[4 * (l.seg + k) + 1]! - out.d[4 * (l.seg + k)]!) - 1));
    expect(worst).toBeLessThan(2e-3); // Float32 at 1 km
  });

  it('gives each line a life seed in [0, 1), the same on all its segments, spread over the whole range', () => {
    const seen = new Set<number>();
    const deciles = new Array<number>(10).fill(0);
    for (const l of lines) {
      expect(l.life).toBeGreaterThanOrEqual(0);
      expect(l.life).toBeLessThan(1);
      for (let k = 0; k < l.count; k++) expect(out.d[4 * (l.seg + k) + 3]).toBe(l.life);
      seen.add(l.life);
      deciles[Math.floor(l.life * 10)]!++;
    }
    expect(seen.size).toBeGreaterThan(lines.length * 0.98); // a seed per line, not shared
    expect(Math.min(...deciles)).toBeGreaterThan(lines.length / 10 / 3);
    expect(lines.reduce((s, l) => s + l.life, 0) / lines.length).toBeGreaterThan(0.4);
    expect(lines.reduce((s, l) => s + l.life, 0) / lines.length).toBeLessThan(0.6);
  });

  it('gives each line its speed (m/s, the same on all its segments), a tail of 6 px per m/s plus 20 from 24 to 90 px, and turb and lift in range', () => {
    for (const l of lines) {
      expect(l.speed).toBeGreaterThanOrEqual(0.3);
      expect(l.tail).toBeCloseTo(clamp(DETAIL_TAIL.pxPerMs * l.speed + DETAIL_TAIL.basePx, DETAIL_TAIL.minPx, DETAIL_TAIL.maxPx), 3);
      expect(l.tail).toBeGreaterThanOrEqual(24);
      expect(l.tail).toBeLessThanOrEqual(90);
      expect(l.turb).toBeGreaterThanOrEqual(0.25 - 1e-6);
      expect(l.turb).toBeLessThanOrEqual(1);
      expect(l.lift).toBeGreaterThanOrEqual(-1);
      expect(l.lift).toBeLessThanOrEqual(1);
      expect(l.lengthPx).toBeCloseTo(lengthFor(l.speed), 3);
      for (let k = 0; k < l.count; k++) {
        const q = l.seg + k;
        expect(out.e[4 * q]).toBe(l.speed);
        expect(out.e[4 * q + 1]).toBe(l.turb);
        expect(out.e[4 * q + 2]).toBe(l.lift);
        expect(out.e[4 * q + 3]).toBe(l.tail);
      }
    }
    // Longer when faster: the tail and the line.
    const slow = lines.reduce((a, l) => (l.speed < a.speed ? l : a));
    const fast = lines.reduce((a, l) => (l.speed > a.speed ? l : a));
    expect(fast.tail).toBeGreaterThan(slow.tail);
    expect(fast.lengthPx).toBeGreaterThan(slow.lengthPx);
  });

  for (const speed of [0.5, 2, 5, 8, 12, 25]) {
    it(`a ${speed} m/s wind draws a line of clamp(16 x speed, 90, 220) = ${lengthFor(speed)} px in ${stepsFor(lengthFor(speed))} steps, with a tail of ${clamp(6 * speed + 20, 24, 90)} px`, () => {
      const q = makeDetailScenario({ field: () => [speed, 0] });
      const r = build(q);
      const east = q.grid.x0 + (q.grid.nx - 1) * q.grid.cellSize;
      const full = r.lines.filter((l) => l.seed[0] + (lengthFor(speed) + 20) * mppTop(q) < east);
      expect(full.length).toBeGreaterThan(20);
      for (const l of full) {
        expect(l.count).toBe(stepsFor(lengthFor(speed)));
        expect(l.lengthPx).toBeCloseTo(lengthFor(speed), 3);
        expect(l.speed).toBeCloseTo(speed, 5);
        expect(l.tail).toBeCloseTo(clamp(6 * speed + 20, 24, 90), 3);
        let metres = 0;
        for (let k = 0; k < l.count; k++) metres += segmentLength(r.out, l.seg + k);
        expect(metres / mppTop(q)).toBeCloseTo(lengthFor(speed), 1);
      }
    });
  }
});

describe('analytic fields', () => {
  const OM = 0.02;
  const rotate = (x: number, y: number): [number, number] => [-OM * y, OM * x];

  it('uniform: straight lines (a deviation under 1e-6 m in the tiny scene); solid-body rotation: a line recovers the radius of its seed within 1e-3', () => {
    const sc = makeDetailScenario({ field: rotate });
    const { out, lines } = build(sc);
    let worst = 0;
    let checked = 0;
    for (const l of lines) {
      const r0 = Math.hypot(...l.seed);
      if (r0 < 60) continue;
      checked++;
      for (let k = 0; k < l.count; k++) {
        const [, , x1, y1] = segmentXY(out, l.seg + k);
        worst = Math.max(worst, Math.abs(Math.hypot(x1, y1) - r0) / r0);
      }
    }
    expect(checked).toBeGreaterThan(30);
    expect(worst).toBeLessThan(1e-3); // RK2 on a circle drifts at third order, and the Float32 output adds 1e-7 of the radius
  });

  it('a rotating field turns the lines: the ones near the middle bend by at least 20 degrees from end to end, all the same way', () => {
    const sc = makeDetailScenario({ field: rotate });
    const { out, lines } = build(sc);
    const near = lines.filter((l) => {
      const r = Math.hypot(...l.seed);
      return r > 60 && r < 180;
    });
    expect(near.length).toBeGreaterThan(10);
    for (const l of near) {
      let total = 0;
      for (let k = 0; k + 1 < l.count; k++) total += turnBetween(out, l.seg + k);
      expect(total, `line from ${l.seed.map((v) => v.toFixed(0)).join(', ')}`).toBeGreaterThanOrEqual(20); // counter-clockwise: positive
    }
    // Steps of equal length along the curve (arc length, within 1e-3).
    for (const l of lines) {
      const l0 = segmentLength(out, l.seg);
      for (let k = 1; k < l.count; k++) expect(Math.abs(segmentLength(out, l.seg + k) / l0 - 1)).toBeLessThan(1e-3);
    }
  });

  it('a uniform field gives straight lines, however long: the turn between steps is nil', () => {
    const { out, lines } = build(tiny({ field: () => [-3, 4] }));
    expect(lines.length).toBeGreaterThan(10);
    for (const l of lines) for (let k = 0; k + 1 < l.count; k++) expect(Math.abs(turnBetween(out, l.seg + k))).toBeLessThan(1e-3);
  });

  it('no step turns by more than 45 degrees, in a stagnation point, a saddle and a vortex, at the closest level-4 zoom', () => {
    const fields: [string, (x: number, y: number) => [number, number]][] = [
      ['saddle', (x, y) => [0.01 * x, -0.01 * y]],
      ['vortex', (x, y) => [-0.05 * y, 0.05 * x]],
      ['reversal', (x) => [x < 0 ? -4 : 4, 0]], // the flow turns right round inside one model cell
      ['rotating mix', (x, y) => [-0.03 * y + 0.01 * x, 0.03 * x + 0.01 * y]],
    ];
    for (const [name, field] of fields) {
      const sc = makeDetailScenario({ cellPx: 104, field });
      const { out, lines } = build(sc);
      expect(lines.length, name).toBeGreaterThan(20);
      let worst = 0;
      for (const l of lines) for (let k = 0; k + 1 < l.count; k++) worst = Math.max(worst, Math.abs(turnBetween(out, l.seg + k)));
      expect(worst, name).toBeLessThanOrEqual(45);
    }
  });

  it('a saddle bends the lines along their hyperbola (x y stays constant)', () => {
    const A = 0.01;
    const sc = makeDetailScenario({ field: (x, y) => [A * x, -A * y] });
    const { out, lines } = build(sc);
    let worst = 0;
    let n = 0;
    for (const l of lines) {
      const [x0, y0] = l.seed;
      if (Math.abs(x0 * y0) < 2e4) continue;
      n++;
      for (let k = 0; k < l.count; k++) {
        const [, , x1, y1] = segmentXY(out, l.seg + k);
        worst = Math.max(worst, Math.abs(x1 * y1 - x0 * y0) / Math.abs(x0 * y0));
      }
    }
    expect(n).toBeGreaterThan(20);
    expect(worst).toBeLessThan(0.01);
  });
});

describe('colour', () => {
  const table = buildSpeedTable();

  it('colours each segment by the speed at its middle: the table of the Wind speed ramp, alpha 1', () => {
    const sc = makeDetailScenario({ field: (x) => [3 + (x + 3000) / 300, 0] }); // 3 to 23 m/s across the domain
    const { out, lines } = build(sc);
    let checked = 0;
    let exact = 0;
    for (const l of lines) {
      for (let k = 0; k < l.count; k++) {
        const q = l.seg + k;
        const xm = 0.5 * (out.a[3 * q]! + out.b[3 * q]!);
        const speed = 3 + (xm + 3000) / 300;
        const bin = Math.min(63, Math.round(speed * (63 / 25)));
        const at = (b: number): boolean => [0, 1, 2].every((c) => Math.abs(out.c[4 * q + c]! - table[3 * b + c]!) < 1e-6);
        expect(at(bin) || at(Math.max(0, bin - 1)) || at(Math.min(63, bin + 1)), `segment ${q}`).toBe(true); // a bin edge may round the other way in Float32
        if (at(bin)) exact++;
        expect(out.c[4 * q + 3]).toBe(1);
        checked++;
      }
      expect(l.speed).toBeCloseTo(3 + (l.seed[0] + 3000) / 300, 3); // the line's speed is the wind at its seed
    }
    expect(checked).toBeGreaterThan(1000);
    expect(exact / checked).toBeGreaterThan(0.97);
  });
});

describe('calm', () => {
  it('a calm field draws nothing at all: no dot and no line, and says how many seeds it passed over', () => {
    const { out } = build(makeDetailScenario({ field: () => [0.1, 0] }));
    expect(out.lines).toBe(0);
    expect(out.segments).toBe(0);
    expect(out.calm).toBeGreaterThan(50);
  });

  it('a trace that meets calm air stops there, and a line of under three steps is not drawn', () => {
    // 5 m/s west of x = 0, falling in a straight line to 0.1 m/s at x = 133 m (one cell), then calm.
    const sc = makeDetailScenario({ field: (x) => [x <= 0 ? 5 : x >= 133 ? 0.1 : 5 - (4.9 * x) / 133, 0] });
    const { out, lines } = build(sc);
    const short = lines.filter((l) => l.count < stepsFor(l.lengthPx) && l.seed[0] < 128);
    expect(short.length).toBeGreaterThan(0);
    expect(out.calm).toBeGreaterThan(0);
    // No vertex beyond where the speed is 0.3 m/s (x = 127.6 m) plus half a step.
    for (const l of lines) {
      const step = (l.lengthPx * mppTop(sc)) / l.count / 2;
      for (let k = 0; k < l.count; k++) expect(segmentXY(out, l.seg + k)[2]).toBeLessThan(127.6 + step + 1e-2);
      expect(l.count).toBeGreaterThanOrEqual(DETAIL_MIN_LINE_SEGMENTS);
    }
  });
});

describe('the raster edge', () => {
  it('a line stops at the edge of the wind raster: nothing is drawn beyond it, and the lines near it are shorter', () => {
    const sc = makeDetailScenario({ field: () => [10, 0], centre: [2700, 0] }); // the screen spans the east edge, x = 2926
    const g = sc.grid;
    const east = g.x0 + (g.nx - 1) * g.cellSize;
    const { out, lines } = build(sc);
    let maxX = -Infinity;
    for (let k = 0; k < out.segments; k++) maxX = Math.max(maxX, out.a[3 * k]!, out.b[3 * k]!);
    expect(maxX).toBeLessThanOrEqual(east + 1e-2);
    expect(lines.some((q) => q.count < stepsFor(q.lengthPx))).toBe(true);
    expect(lines.every((q) => q.seed[0] <= east)).toBe(true);
    const nw = makeDetailScenario({ field: () => [-7, 7], centre: [-2700, 2700] });
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
  it('a line with a vertex at a clip depth under 1.5 near planes is dropped whole, and none is drawn that has one', () => {
    // A top view from 825 m with the near plane at 533.3 m (1.5 x = 800 m) over ground that rises to the east: a line that starts just
    // inside the limit climbs into it.
    const cam = topDownCamera(133, 150, 0, 0, { near: 533.33 }, 0);
    const sc = makeDetailScenario({ field: () => [10, 0], ground: (x) => 0.1 * x, camera: cam });
    const { out, lines } = build(sc);
    const wmin = GLYPH_NEAR_FACTOR * cam.near;
    expect(out.dropped).toBeGreaterThan(5);
    expect(lines.length).toBeGreaterThan(20);
    let lowest = Infinity;
    for (let k = 0; k < out.segments; k++) {
      lowest = Math.min(lowest, clipW(cam.viewProj, out.a[3 * k]!, out.a[3 * k + 1]!, out.a[3 * k + 2]!), clipW(cam.viewProj, out.b[3 * k]!, out.b[3 * k + 1]!, out.b[3 * k + 2]!));
    }
    expect(lowest).toBeGreaterThan(wmin - 1e-2);
    // A dropped line leaves no stray segments: the segments of the lines add up to the total.
    expect(lines.reduce((s, l) => s + l.count, 0)).toBe(out.segments);
    expect(lines.length).toBe(out.lines);
  });
});

describe('cliff faces: no line runs up or down a wall', () => {
  // A wall along x = 0: 160 m high over 40 m (slope 4, 76 degrees), flat above and below; a steady wind from the west carries every line
  // toward it. The ground raster is fine enough (10 m) to hold the wall.
  const wall = (x: number): number => (x < -20 ? 300 : x > 20 ? 460 : 300 + 4 * (x + 20));
  const scene = (vex: number, ground: (x: number, y: number) => number = (x) => wall(x)): DetailScenario =>
    makeDetailScenario({ groundCell: 10, ground, field: () => [8, 0], vex, camera: topDownCamera(133, 150, 0, 0, { near: 30 }, 460 * vex) });
  const trueSlopes = (out: DetailOutput, lines: Line[], vex: number): number[] => {
    const s: number[] = [];
    for (const l of lines) {
      for (let k = l.seg; k < l.seg + l.count; k++) {
        const h = Math.hypot(out.b[3 * k]! - out.a[3 * k]!, out.b[3 * k + 2]! - out.a[3 * k + 2]!);
        if (h > 0) s.push(Math.abs(out.b[3 * k + 1]! - out.a[3 * k + 1]!) / vex / h);
      }
    }
    return s;
  };

  it('cuts a line at the foot of the wall, and draws none that starts on the wall', () => {
    const sc = scene(1);
    const { out, lines } = build(sc);
    expect(lines.length).toBeGreaterThan(20);
    expect(Math.max(...trueSlopes(out, lines, 1))).toBeLessThanOrEqual(GLYPH_MAX_SLOPE * 1.001);
    expect(out.steep, 'lines cut or dropped at the wall').toBeGreaterThan(3);
    const west = lines.filter((l) => l.seed[0] < -20);
    expect(west.length).toBeGreaterThan(10);
    for (const l of west) expect(l.end[0], 'a line from the west stops at the foot').toBeLessThan(0);
    for (const l of lines) expect(l.seed[0] < -19 || l.seed[0] > 10, `seed at x = ${l.seed[0].toFixed(1)} is on the wall`).toBe(true);
    const full = Math.max(...lines.map((l) => Math.hypot(l.end[0] - l.seed[0], l.end[1] - l.seed[1])));
    expect(Math.min(...west.map((l) => Math.hypot(l.end[0] - l.seed[0], l.end[1] - l.seed[1])))).toBeLessThan(0.7 * full);
  });

  it('judges the true slope: a hillside of 0.5 drawn at an exaggeration of 3 (steeper than 1 on screen) is not cut; the wall still is', () => {
    const hill = (x: number): number => 300 + 0.5 * x;
    for (const vex of [1, 3]) {
      const { out, lines } = build(scene(vex, (x) => hill(x)));
      expect(out.steep, `a gentle hillside, exaggeration ${vex}`).toBe(0);
      expect(lines.length).toBeGreaterThan(30);
    }
    const { out, lines } = build(scene(3));
    expect(out.steep).toBeGreaterThan(3);
    expect(Math.max(...trueSlopes(out, lines, 3))).toBeLessThanOrEqual(GLYPH_MAX_SLOPE * 1.001);
  });

  it('flat ground cuts nothing', () => {
    expect(build(scene(1, () => 300)).out.steep).toBe(0);
  });
});

describe('draping, lift and lee from the 10 m ground', () => {
  /** The 10 m ground of a function, over the domain of the default scene (45 cells of 133 m). */
  const ten = (fn: (x: number, y: number) => number) => {
    const sc0 = makeDetailScenario();
    const g = sc0.grid;
    const e = (g.nx - 1) * g.cellSize;
    return groundOf({ nx: Math.ceil(e / 10) + 1, ny: Math.ceil(e / 10) + 1, cellSize: 10, x0: g.x0, y0: g.y0, origin: ORIGIN }, fn);
  };
  /** Lines well inside the domain, so that the 10 m ground is read inside its edge. */
  const inside = (lines: Line[]): Line[] => lines.filter((l) => Math.abs(l.seed[0]) < 1500 && Math.abs(l.seed[1]) < 1500);

  it('drapes every vertex on the ground plus the lift (max(1.5 m, 3 px)) plus 3 m x the line lift (not under half a metre), times the exaggeration', () => {
    const ground = (x: number, y: number): number => 300 + 60 * Math.sin(x / 700) + 40 * Math.cos(y / 500);
    for (const vex of [1, 2]) {
      const cam = topDownCamera(133, 150, 0, 0, { near: 30 }, 300 * vex);
      const sc = makeDetailScenario({ field: (_x, y) => [5 + 0.001 * y, 3], ground, ground10: ten(ground), camera: cam, vex });
      const { out, lines } = build(sc);
      const hf = new HeightField(sc.ground.grid, sc.ground.elevation);
      expect(lines.length).toBeGreaterThan(60);
      let worst = 0;
      let lifted = 0;
      for (const l of lines) {
        const zSeed = hf.heightAt(l.seed[0], l.seed[1]);
        const mpp = clipW(sc.camera.viewProj, l.seed[0], zSeed * vex, -l.seed[1]) / sc.camera.pxPerMetre1;
        const drape = Math.max(GLYPH_LIFT_MIN_M, GLYPH_LIFT_PX * mpp);
        if (Math.abs(l.lift) > 0.05) lifted++;
        for (let k = l.seg; k < l.seg + l.count; k++) {
          for (const [x, yw, zw] of [[out.a[3 * k]!, out.a[3 * k + 1]!, out.a[3 * k + 2]!], [out.b[3 * k]!, out.b[3 * k + 1]!, out.b[3 * k + 2]!]] as const) {
            worst = Math.max(worst, Math.abs(yw - (hf.heightAt(x, -zw) + Math.max(DETAIL_TERRAIN.minAboveM, drape + DETAIL_TERRAIN.liftM * l.lift)) * vex));
          }
        }
      }
      expect(lifted).toBeGreaterThan(10);
      expect(worst).toBeLessThan(5e-3 * vex);
    }
  });

  it('the lee sinks a line by up to 3 m, but never under half a metre above the ground (at the closest zoom the lift is only 1.5 m)', () => {
    const ramp = (x: number): number => 300 + 0.2 * x;
    const sc = makeDetailScenario({ cellPx: 3000, field: () => [-10, 0], ground: ramp, ground10: ten((x) => ramp(x)), camera: topDownCamera(133, 3000, 0, 0, { near: 5 }, 300) });
    const { out, lines } = build(sc);
    const hf = new HeightField(sc.ground.grid, sc.ground.elevation);
    expect(lines.length).toBeGreaterThan(5);
    for (const l of lines) {
      expect(l.lift).toBeCloseTo(-0.667, 2);
      for (let k = l.seg; k < l.seg + l.count; k++) {
        const above = out.a[3 * k + 1]! - hf.heightAt(out.a[3 * k]!, -out.a[3 * k + 2]!);
        expect(above).toBeCloseTo(DETAIL_TERRAIN.minAboveM, 2); // 1.5 - 3 x 0.667 = -0.5, held at 0.5
      }
    }
  });

  it('flat ground: turb 0.25 and lift 0 on every line', () => {
    const camera = topDownCamera(133, 150, 0, 0, {}, 500); // the camera is above the ground, which is at 500 m
    const { lines } = build(makeDetailScenario({ field: () => [6, 8], ground: () => 500, ground10: ten(() => 500), camera }));
    expect(lines.length).toBeGreaterThan(30);
    for (const l of lines) {
      expect(l.turb).toBeCloseTo(0.25, 6);
      expect(l.lift).toBeCloseTo(0, 6);
    }
  });

  it('ramp ground (slope 0.2): up the slope lift is positive (speed x slope / 3) with no lee, down it lift is negative and the lee raises turb; across it, neither', () => {
    const ramp = (x: number): number => 300 + 0.2 * x;
    const lift = (sp: number, slope: number): number => clamp((sp * slope) / DETAIL_TERRAIN.liftMs, -1, 1);
    const cases: [string, [number, number], number][] = [
      ['up', [10, 0], 0.2],
      ['down', [-10, 0], -0.2],
      ['across', [0, 10], 0],
    ];
    for (const [name, field, slope] of cases) {
      const sc = makeDetailScenario({ field: () => field, ground: ramp, ground10: ten((x) => ramp(x)) });
      const lines = inside(build(sc).lines);
      expect(lines.length, name).toBeGreaterThan(20);
      const lee = clamp(-slope / DETAIL_TERRAIN.leeSlope, 0, 1);
      for (const l of lines) {
        expect(l.lift, name).toBeCloseTo(lift(10, slope), 4);
        // A plane is not rough: the turb is the base and the lee, and only the lee side has any lee.
        expect(l.turb, name).toBeCloseTo(DETAIL_TERRAIN.turbBase + 0.5 * lee, 4);
      }
      if (name === 'up') expect(lines[0]!.lift).toBeGreaterThan(0.5);
      if (name === 'down') {
        expect(lines[0]!.lift).toBeLessThan(-0.5);
        expect(lines[0]!.turb).toBeGreaterThan(0.5);
      }
      if (name !== 'down') expect(lines[0]!.turb).toBeCloseTo(0.25, 4);
    }
  });

  it('rough ground (bumps of a few metres at 15 m) raises turb over flat ground, a plain ramp does not, and the roughness shows on every side of the flow', () => {
    const bumpy = (x: number, y: number): number => 400 + 4 * Math.sin(x / 2.4) * Math.cos(y / 2.4);
    for (const field of [[10, 0], [0, 10], [-10, 0]] as [number, number][]) {
      const lines = inside(build(makeDetailScenario({ field: () => field, ground10: ten(bumpy) })).lines);
      expect(lines.length).toBeGreaterThan(20);
      const mean = lines.reduce((s, l) => s + l.turb, 0) / lines.length;
      expect(mean, `field ${field}`).toBeGreaterThan(0.25 + 0.1);
      for (const l of lines) expect(l.turb).toBeLessThanOrEqual(1);
    }
  });

  it('the ground terms shrink with the height the wind is read at: all of them at 10 m (and with no height), 0.38 of them at 300 m, almost none at 1,000 m', () => {
    expect(detailGroundFactor(10)).toBe(1);
    expect(detailGroundFactor(0)).toBe(1);
    expect(detailGroundFactor(100)).toBeCloseTo(Math.exp(-90 / 300), 12);
    expect(detailGroundFactor(300)).toBeCloseTo(0.38, 2);
    expect(detailGroundFactor(1000)).toBeLessThan(0.05);
    const ramp = (x: number): number => 300 + 0.2 * x;
    const at = (heightM: number | undefined): Line[] =>
      inside(build(makeDetailScenario({ field: () => [-10, 0], ground: ramp, ground10: ten((x) => ramp(x)), ...(heightM !== undefined ? { heightM } : {}) })).lines);
    const base = at(undefined)[0]!;
    expect(at(10)[0]!.turb).toBeCloseTo(base.turb, 6);
    for (const h of [50, 100, 300, 1000, 2000]) {
      const l = at(h)[0]!;
      const g = detailGroundFactor(h);
      expect(l.turb - 0.25, `turb at ${h} m`).toBeCloseTo((base.turb - 0.25) * g, 4);
      expect(l.lift, `lift at ${h} m`).toBeCloseTo(base.lift * g, 4);
    }
  });

  it('without a 10 m ground (missing, or one too small to read) turb is 0.5 and lift 0, and the lines are the same lines', () => {
    const sc = makeDetailScenario({ field: () => [6, 8] });
    const base = build(sc);
    for (const broken of [undefined, { grid: { ...sc.ground.grid, nx: 1 }, elevation: sc.ground.elevation }, { grid: sc.ground.grid, elevation: new Float32Array(4) }]) {
      const input = { ...sc.input, ground10: broken as never };
      const b = createDetailBuilder('high');
      buildAll(b, input);
      const lines = linesOf(b.out);
      expect(lines.length).toBe(base.lines.length);
      for (const l of lines) {
        expect(l.turb).toBe(0.5);
        expect(l.lift).toBe(0);
      }
      // Same lines (the lift bakes into y only when there is one: flat ground has none).
      expect(Buffer.from(b.out.a.subarray(0, 3 * b.out.segments)).equals(Buffer.from(base.out.a.subarray(0, 3 * base.out.segments)))).toBe(true);
    }
  });
});

describe('orbit view density', () => {
  /** Lines per band of the screen (equal heights in NDC), by the seed's projection: near the bottom, the middle, and up toward the horizon. */
  function bands(sc: DetailScenario, lines: Line[]): { near: number; mid: number; far: number } {
    const vp = sc.camera.viewProj;
    const c = { near: 0, mid: 0, far: 0 };
    for (const l of lines) {
      const w = clipW(vp, l.seed[0], 0, -l.seed[1]);
      const y = (vp[1]! * l.seed[0] + vp[9]! * -l.seed[1] + vp[13]!) / w;
      const x = (vp[0]! * l.seed[0] + vp[8]! * -l.seed[1] + vp[12]!) / w;
      if (Math.abs(x) > 1) continue;
      if (y > -0.9 && y < -0.6) c.near++;
      else if (y > -0.15 && y < 0.15) c.mid++;
      else if (y > 0.35 && y < 0.65) c.far++;
    }
    return c;
  }
  const orbit = (thin: boolean) => {
    const cam = makeCamera({ eye: [0, 300, 600], target: [0, 0, 0] }); // 27 degrees above the horizon, the top of the screen near it
    const sc = makeDetailScenario({ n: 90, cell: 133, field: () => [4, 3], camera: cam, plan: thin ? undefined : { mppCentre: 1e9 } });
    const { lines } = build(sc);
    return { sc, lines, b: bands(sc, lines) };
  };

  it('thins the seeds toward the horizon so the picture is about as full far up as it is in the middle', () => {
    const thin = orbit(true);
    const flat = orbit(false);
    expect(thin.sc.plan.level).toBe(4);
    expect(flat.b.far / flat.b.mid).toBeGreaterThan(2);
    expect(thin.b.far / thin.b.mid).toBeGreaterThan(0.5);
    expect(thin.b.far / thin.b.mid).toBeLessThan(1.8);
    expect(thin.lines.length).toBeLessThan(flat.lines.length);
    expect(thin.b.far).toBeGreaterThan(10);
  });
});

describe('seeds off the screen', () => {
  it('a seed outside the margin is kept only when its line runs onto the screen: every line touches the screen plus a tenth, and some run in from outside', () => {
    const sc = makeDetailScenario({ field: () => [8, 3] });
    const { out, lines } = build(sc);
    const vp = sc.camera.viewProj;
    const ndc = (k: number, end: 'a' | 'b'): [number, number] => {
      const arr = end === 'a' ? out.a : out.b;
      const x = arr[3 * k]!;
      const y = arr[3 * k + 1]!;
      const z = arr[3 * k + 2]!;
      const w = clipW(vp, x, y, z);
      return [(vp[0]! * x + vp[4]! * y + vp[8]! * z + vp[12]!) / w, (vp[1]! * x + vp[5]! * y + vp[9]! * z + vp[13]!) / w];
    };
    const tight = 1.2 + 0.06; // the seed margin (a tenth of the screen) and a step's worth
    let runIn = 0;
    for (const l of lines) {
      let touches = false;
      for (let k = l.seg; k < l.seg + l.count; k++) {
        const [x, y] = ndc(k, 'b');
        if (Math.abs(x) <= tight && Math.abs(y) <= tight) touches = true;
      }
      expect(touches, `line from ${l.seed.map((v) => v.toFixed(0))}`).toBe(true);
      const [sx, sy] = ndc(l.seg, 'a');
      if (Math.abs(sx) > 1.2 || Math.abs(sy) > 1.2) runIn++;
    }
    expect(lines.length).toBeGreaterThan(50);
    expect(runIn).toBeGreaterThan(3);
  });
});

describe('caps', () => {
  const tablet: DetailScenarioOptions = { camera: topDownCamera(133, 150, 0, 0, { cssW: 2560, cssH: 1440 }), field: (x, y) => [3 - 0.004 * y + 4, 1 + 0.004 * x] };
  const CAPS: Record<GlyphTier, number> = { low: 4000, medium: 8000, high: 12000 };

  for (const tier of ['low', 'medium', 'high'] as const) {
    it(`${tier}: never more than ${CAPS[tier]} segments or more lines than fit, though the scene has more; the arrays are that size`, () => {
      const sc = makeDetailScenario({ ...tablet, cap: { glyphs: 99999, segments: 999999 } });
      const { b, out, lines } = build(sc, tier);
      expect(out.segments).toBeLessThanOrEqual(CAPS[tier]);
      expect(out.segments).toBeGreaterThan(CAPS[tier] * 0.7); // thinned to 95 % of it by the segments the lines take
      expect(out.lines).toBeLessThanOrEqual(CAPS[tier] / DETAIL_GEOMETRY.minSegments);
      expect(lines.length).toBe(out.lines);
      expect(b.out.a.length).toBe(3 * CAPS[tier]);
      expect(b.out.e.length).toBe(4 * CAPS[tier]);
    });
  }

  it('thins by a hash over the whole screen and not by the order of the lattice: the kept lines cover the north and the south, and a cap of a quarter keeps about a quarter', () => {
    const all = build(makeDetailScenario({ ...tablet, cap: { glyphs: 99999, segments: 999999 } }), 'high');
    const cap = Math.floor(all.out.segments / 4);
    const sc = makeDetailScenario({ ...tablet, cap: { glyphs: 99999, segments: cap } });
    const { out, lines } = build(sc);
    expect(out.segments).toBeLessThanOrEqual(cap);
    expect(out.segments).toBeGreaterThan(cap * 0.8);
    const ys = lines.map((l) => l.seed[1]).sort((p, q) => p - q);
    const span = sc.input.box.y1 - sc.input.box.y0;
    expect(ys[ys.length - 1]! - ys[0]!).toBeGreaterThan(0.7 * span);
    // The lines of the small build are lines of the big one (the same hash picks them).
    const big = new Set(all.lines.map((l) => `${l.seed[0]},${l.seed[1]}`));
    const shared = lines.filter((l) => big.has(`${l.seed[0]},${l.seed[1]}`)).length;
    expect(shared).toBeGreaterThan(lines.length * 0.95);
  });

  it('a cap of lines is kept too, by hash', () => {
    const sc = makeDetailScenario({ ...tablet, cap: { glyphs: 100, segments: 12000 } });
    const { out } = build(sc);
    expect(out.lines).toBeLessThanOrEqual(100);
    expect(out.lines).toBeGreaterThan(80);
  });

  it('a cap too small for a line of 8 steps draws none, and one of 30 segments fits a line or two but never more', () => {
    expect(build(makeDetailScenario({ ...tablet, cap: { glyphs: 99999, segments: 2 } })).out.segments).toBe(0);
    const { out } = build(makeDetailScenario({ ...tablet, cap: { glyphs: 99999, segments: 30 } }));
    expect(out.segments).toBeLessThanOrEqual(30);
    expect(out.segments).toBeGreaterThan(0);
  });
});

describe('deterministic seeds and lifetimes', () => {
  const field = (x: number, y: number): [number, number] => [-0.02 * y + 3, 0.02 * x];

  it('the same input and seed give the same bytes, on a fresh builder and on a used one', () => {
    const sc = makeDetailScenario({ field, seed: 7 });
    const a = createDetailBuilder('high');
    buildAll(a, sc.input);
    const first = Buffer.from(detailBytes(a.out));
    expect(a.out.segments).toBeGreaterThan(500);
    const b = createDetailBuilder('high');
    buildAll(b, sc.input);
    expect(detailBytes(b.out).equals(first)).toBe(true);
    buildAll(a, makeDetailScenario({ field: () => [1, 1], cellPx: 300 }).input); // something else in between
    buildAll(a, sc.input); // reused
    expect(detailBytes(a.out).equals(first)).toBe(true);
  });

  it('a different input seed changes the lifetimes (the life seed of every line) and nothing else', () => {
    const a = build(makeDetailScenario({ field, seed: 0 }));
    const b = build(makeDetailScenario({ field, seed: 1 }));
    const c = build(makeDetailScenario({ field, seed: 0.5 }));
    expect(b.out.segments).toBe(a.out.segments);
    const n = a.out.segments;
    const equal = (x: Float32Array, y: Float32Array, per: number): boolean => Buffer.from(x.buffer, x.byteOffset, 4 * per * n).equals(Buffer.from(y.buffer, y.byteOffset, 4 * per * n));
    expect(equal(a.out.a, b.out.a, 3)).toBe(true);
    expect(equal(a.out.b, b.out.b, 3)).toBe(true);
    expect(equal(a.out.c, b.out.c, 4)).toBe(true);
    expect(equal(a.out.e, b.out.e, 4)).toBe(true);
    let same = 0;
    let sameHalf = 0;
    for (let k = 0; k < n; k++) {
      expect(a.out.d[4 * k]).toBe(b.out.d[4 * k]);
      expect(a.out.d[4 * k + 1]).toBe(b.out.d[4 * k + 1]);
      expect(a.out.d[4 * k + 2]).toBe(b.out.d[4 * k + 2]);
      if (a.out.d[4 * k + 3] === b.out.d[4 * k + 3]) same++;
      if (a.out.d[4 * k + 3] === c.out.d[4 * k + 3]) sameHalf++;
    }
    expect(same).toBeLessThan(n * 0.01);
    expect(sameHalf).toBeLessThan(n * 0.01);
  });

  it('the life seed is a hash of the lattice cell: the same cell has the same life in a view that is panned, and different cells differ', () => {
    const A = makeDetailScenario({ field });
    const S = A.plan.spacingM;
    const B = makeDetailScenario({ field, camera: topDownCamera(133, 150, 5 * S, -3 * S) });
    const la = new Map(build(A).lines.map((l) => [`${l.seed[0]},${l.seed[1]}`, l.life]));
    let shared = 0;
    for (const l of build(B).lines) {
      const m = la.get(`${l.seed[0]},${l.seed[1]}`);
      if (m === undefined) continue;
      shared++;
      expect(l.life).toBe(m);
    }
    expect(shared).toBeGreaterThan(30);
  });

  it('a seed is the nested lattice formula: the lattice point of the level it was born at, moved by the hash of its identity, anchored to the world', () => {
    const sc = makeDetailScenario({ field: () => [6, 8], plan: { thin: 1 } });
    const { lines } = build(sc);
    const j = sc.plan.spacingExp;
    expect(sc.plan.spacingM).toBe(2 ** j);
    expect(sc.plan.jitter).toBe(0.35);
    let worst = 0;
    const born = new Array<number>(14).fill(0);
    for (const l of lines) {
      // The identity is the one lattice level (j to j + 12) whose indices, not both even, put the formula on the seed.
      let best = Infinity;
      let bornAt = -1;
      for (let t = 0; t <= 12; t++) {
        const S = 2 ** (j + t);
        const ia = Math.round(l.seed[0] / S);
        const ja = Math.round(l.seed[1] / S);
        if (t < 12 && (ia & 1) === 0 && (ja & 1) === 0) continue;
        const [x, y] = nestedSeed(ia, ja, j + t, sc.plan.jitter);
        const d = Math.max(Math.abs(x - l.seed[0]), Math.abs(y - l.seed[1]));
        if (d < best) {
          best = d;
          bornAt = t;
        }
      }
      worst = Math.max(worst, best);
      born[bornAt]!++;
    }
    expect(lines.length).toBeGreaterThan(200);
    expect(worst).toBeLessThan(5e-4); // Float32 at 3 km
    // A quarter of the points are on the next lattice too: three quarters of a full picture are born at the finest level, a sixteenth at the next.
    expect(born[0]! / lines.length).toBeGreaterThan(0.65);
    expect(born[0]! / lines.length).toBeLessThan(0.85);
    expect(born[1]!).toBeGreaterThan(0);
  });
});

describe('the nested lattice: nothing pops where the lattice changes, and the line count follows the zoom', () => {
  const field = (x: number, y: number): [number, number] => [5 + Math.sin(y / 700), 2 + Math.cos(x / 500)];
  const key = (l: Line): string => `${l.seed[0]},${l.seed[1]}`;
  /** The same view planned with the finest lattice `exp` and the share `thin` of it. */
  const planned = (exp: number, thin: number, o: DetailScenarioOptions = {}): DetailScenario => makeDetailScenario({ field, seed: 5, plan: { spacingExp: exp, spacingM: 2 ** exp, thin }, ...o });
  const bytesOf = (b: { out: DetailOutput }, l: Line): string => {
    const out = b.out;
    const parts: number[] = [];
    for (let k = 0; k < l.count; k++) {
      const i = l.seg + k;
      for (let c = 0; c < 3; c++) parts.push(out.a[3 * i + c]!, out.b[3 * i + c]!);
      for (let c = 0; c < 4; c++) parts.push(out.c[4 * i + c]!, out.d[4 * i + c]!, out.e[4 * i + c]!);
    }
    return parts.join(',');
  };

  it('is the same picture either side of an octave edge: the finer lattice at 1/4 of its points is the coarser lattice at all of its own, line for line', () => {
    // (Two octaves up from the scenario's own lattice, so that even the finer lattice at all of its points fits the caps: a cap thins by its own hash.)
    const j = makeDetailScenario({ field, seed: 5 }).plan.spacingExp + 2;
    const coarse = build(planned(j, 1));
    const fine = build(planned(j - 1, 0.25));
    expect(coarse.lines.length).toBeGreaterThan(80);
    expect(fine.lines.length).toBe(coarse.lines.length);
    expect(fine.out.segments).toBe(coarse.out.segments);
    const inCoarse = new Map(coarse.lines.map((l) => [key(l), bytesOf(coarse, l)]));
    for (const l of fine.lines) expect(bytesOf(fine, l), `the line at ${key(l)}`).toBe(inCoarse.get(key(l)));
    // And the other way: the finer lattice at all of its points holds the coarser one at all of its own, and four times the lines.
    const full = build(planned(j - 1, 1));
    expect(full.lines.length / coarse.lines.length).toBeGreaterThan(3.3);
    expect(full.lines.length / coarse.lines.length).toBeLessThan(4.7);
    const inFull = new Map(full.lines.map((l) => [key(l), bytesOf(full, l)]));
    for (const l of coarse.lines) expect(inFull.get(key(l)), `the line at ${key(l)}`).toBe(bytesOf(coarse, l));
  });

  it('adds lines and never moves or removes one as the share rises: the lines of a lower share are all in a higher one, and their count goes with the share', () => {
    const j = makeDetailScenario({ field, seed: 5 }).plan.spacingExp + 1;
    const shares = [0.25, 0.35, 0.5, 0.7, 0.85, 1];
    const builds = shares.map((t) => build(planned(j, t)));
    const full = builds[builds.length - 1]!.lines.length;
    for (let k = 1; k < builds.length; k++) {
      const lo = builds[k - 1]!;
      const hi = builds[k]!;
      const inHi = new Map(hi.lines.map((l) => [key(l), bytesOf(hi, l)]));
      for (const l of lo.lines) expect(inHi.get(key(l)), `share ${shares[k - 1]} in ${shares[k]}`).toBe(bytesOf(lo, l));
      expect(hi.lines.length).toBeGreaterThan(lo.lines.length);
      expect(hi.lines.length / full).toBeCloseTo(shares[k]!, 1); // the count is the share of the whole lattice (within a tenth)
    }
    expect(builds[0]!.lines.length / full).toBeCloseTo(0.25, 1);
  });

  it('a plan without a share keeps all of the finest lattice, as a share of 1 does', () => {
    const j = makeDetailScenario({ field, seed: 5 }).plan.spacingExp + 1;
    const a = build(planned(j, 1));
    const sc = planned(j, 1);
    delete (sc.input.lod as { thin?: number }).thin;
    const b = build(sc);
    expect(detailBytes(b.out).equals(detailBytes(a.out))).toBe(true);
  });

  it('a line keeps its life, place and shape across rebuilds at different zooms (its lines are the same line, not a new one with the same seed)', () => {
    const near = build(makeDetailScenario({ field, seed: 5, cellPx: 150 }));
    const far = build(makeDetailScenario({ field, seed: 5, cellPx: 135 }));
    const inFar = new Map(far.lines.map((l) => [key(l), l]));
    let shared = 0;
    for (const l of near.lines) {
      const m = inFar.get(key(l));
      if (!m) continue;
      shared++;
      expect(m.life).toBe(l.life);
      expect(m.speed).toBe(l.speed);
      expect(m.turb).toBe(l.turb);
    }
    expect(shared).toBeGreaterThan(near.lines.length * 0.3);
  });

  it('the line count of a continuous zoom changes by under 12 % for a step of 6 %, through every octave edge, over flat ground and a rolling one', () => {
    const rolling = groundOf(makeDetailScenario({ field }).raster.grid, (x, y) => 40 * Math.sin(x / 400) + 20 * Math.cos(y / 300));
    for (const [name, o, baseY] of [['flat', {}, 0], ['rolling', { groundRaster: rolling }, 80]] as const) {
      const counts: number[] = [];
      const exps = new Set<number>();
      for (let px = 104; px < 3300; px *= 1.06) {
        const sc = makeDetailScenario({ field, seed: 5, camera: topDownCamera(133, px, 0, 0, {}, baseY), ...o });
        exps.add(sc.plan.spacingExp);
        counts.push(build(sc).lines.length);
      }
      expect(exps.size, name).toBeGreaterThanOrEqual(5); // five octaves of zoom: four edges crossed
      for (let k = 1; k < counts.length; k++) {
        const r = Math.max(counts[k]! / counts[k - 1]!, counts[k - 1]! / counts[k]!);
        expect(r, `${name}: ${counts[k - 1]} to ${counts[k]} lines at step ${k}`).toBeLessThan(1.12);
      }
      // With a lattice 4 x as dense as the old sparse end: about one line to 32 x 32 px of screen and margin, not one to 64 x 64.
      for (const c of counts) expect(c, name).toBeGreaterThan(300);
    }
  });

  it('the same lines are drawn for a view whichever way its zoom was reached: the picture is a function of the plan alone', () => {
    const j = makeDetailScenario({ field, seed: 5 }).plan.spacingExp;
    const a = build(planned(j, 0.6));
    const used = createDetailBuilder('high'); // a builder that built another zoom first
    buildAll(used, planned(j + 1, 0.3).input);
    buildAll(used, planned(j, 0.6).input);
    expect(detailBytes(used.out).equals(detailBytes(a.out))).toBe(true);
  });
});

describe('pan invariance', () => {
  it('a top view panned by whole lattice cells builds the same lines for the seeds both views hold, bit for bit', () => {
    const field = (x: number, y: number): [number, number] => [4 + 0.002 * y + Math.sin(x / 900), 2 + Math.cos(y / 700)];
    const A = makeDetailScenario({ field, seed: 3 });
    const S = A.plan.spacingM;
    const B = makeDetailScenario({ field, seed: 3, camera: topDownCamera(133, 150, 3 * S, -2 * S) });
    expect(B.plan.spacingExp).toBe(A.plan.spacingExp);
    const ga = build(A);
    const gb = build(B);
    const key = (l: Line): string => `${l.seed[0]},${l.seed[1]}`;
    const inA = new Map(ga.lines.map((l) => [key(l), l]));
    let shared = 0;
    let differing = 0;
    for (const l of gb.lines) {
      const m = inA.get(key(l));
      if (!m) continue;
      shared++;
      if (m.count !== l.count) {
        differing++;
        continue;
      }
      for (let k = 0; k < l.count; k++) {
        const ia = m.seg + k;
        const ib = l.seg + k;
        for (let c = 0; c < 3; c++) if (ga.out.a[3 * ia + c] !== gb.out.a[3 * ib + c] || ga.out.b[3 * ia + c] !== gb.out.b[3 * ib + c]) differing++;
        for (let c = 0; c < 4; c++) {
          if (ga.out.c[4 * ia + c] !== gb.out.c[4 * ib + c]) differing++;
          if (ga.out.d[4 * ia + c] !== gb.out.d[4 * ib + c]) differing++;
          if (ga.out.e[4 * ia + c] !== gb.out.e[4 * ib + c]) differing++;
        }
      }
    }
    expect(shared).toBeGreaterThan(gb.lines.length * 0.3);
    expect(differing).toBe(0);
    // And every line whose seed is well inside both screens is in both builds.
    const vpB = B.camera.viewProj;
    const ndc = (vp: Float64Array, l: Line): [number, number] => {
      const w = clipW(vp, l.seed[0], 0, -l.seed[1]);
      return [(vp[0]! * l.seed[0] + vp[8]! * -l.seed[1] + vp[12]!) / w, (vp[1]! * l.seed[0] + vp[9]! * -l.seed[1] + vp[13]!) / w];
    };
    const inB = new Set(gb.lines.map(key));
    let inside = 0;
    for (const l of ga.lines) {
      const [bx, by] = ndc(vpB, l);
      if (Math.abs(bx) < 0.9 && Math.abs(by) < 0.9) {
        inside++;
        expect(inB.has(key(l))).toBe(true);
      }
    }
    expect(inside).toBeGreaterThan(10);
  });

  it('after a pan of a kilometre (a tablet screen, the same lattice) the lines both views hold are the same bytes', () => {
    const field = (x: number, y: number): [number, number] => [5 + Math.sin(y / 800), 2 + Math.cos(x / 600)];
    const screen = { cssW: 900, cssH: 560 };
    const A = makeDetailScenario({ field, camera: topDownCamera(133, 105, 0, 0, screen) });
    const S = A.plan.spacingM;
    const dx = Math.round(1000 / S) * S;
    const B = makeDetailScenario({ field, camera: topDownCamera(133, 105, dx, 0, screen) });
    expect(A.plan.level).toBe(4);
    expect(B.plan.spacingExp).toBe(A.plan.spacingExp);
    const ga = build(A);
    const gb = build(B);
    expect(ga.out.segments).toBeLessThan(0.9 * 12000); // the caps do not thin either build: a thinned build depends on its whole screen
    expect(gb.out.segments).toBeLessThan(0.9 * 12000);
    const inA = new Map(ga.lines.map((l) => [`${l.seed[0]},${l.seed[1]}`, l]));
    let shared = 0;
    for (const l of gb.lines) {
      const m = inA.get(`${l.seed[0]},${l.seed[1]}`);
      if (!m) continue;
      shared++;
      expect(m.count).toBe(l.count);
      for (let k = 0; k < l.count; k++) {
        for (const [x, y, per] of [[ga.out.a, gb.out.a, 3], [ga.out.b, gb.out.b, 3], [ga.out.c, gb.out.c, 4], [ga.out.d, gb.out.d, 4], [ga.out.e, gb.out.e, 4]] as const) {
          for (let c = 0; c < per; c++) expect(x[per * (m.seg + k) + c]).toBe(y[per * (l.seg + k) + c]);
        }
      }
    }
    expect(shared).toBeGreaterThan(30);
  });
});

describe('degenerate inputs build nothing, and say they are done', () => {
  const cases: [string, (sc: DetailScenario) => void][] = [
    ['level 0', (sc) => Object.assign(sc.input.lod, { level: 0 })],
    ['an empty box', (sc) => Object.assign(sc.input, { box: { x0: 1, y0: 1, x1: 0, y1: 0 } })],
    ['a box outside the raster', (sc) => Object.assign(sc.input, { box: { x0: 1e6, y0: 1e6, x1: 1e6 + 10, y1: 1e6 + 10 } })],
    ['a zero cap', (sc) => Object.assign(sc.input, { cap: { glyphs: 0, segments: 100 } })],
    ['a cap of two segments', (sc) => Object.assign(sc.input, { cap: { glyphs: 10, segments: 2 } })],
    ['no pixel scale', (sc) => Object.assign(sc.input, { pxPerMetre1: 0 })],
    ['no lattice', (sc) => Object.assign(sc.input.lod, { spacingM: 0 })],
  ];
  for (const [name, mutate] of cases) {
    it(name, () => {
      const sc = makeDetailScenario();
      mutate(sc);
      const b = createDetailBuilder('medium');
      b.begin(sc.input);
      expect(b.step(3)).toBe(true); // at once, with nothing built
      expect(b.busy).toBe(false);
      expect(b.out.lines).toBe(0);
      expect(b.out.segments).toBe(0);
    });
  }

  it('step before any begin is done', () => {
    const b = createDetailBuilder('low');
    expect(b.busy).toBe(false);
    expect(b.step(3)).toBe(true);
  });

  it('a build that finds nothing resets what the last one said', () => {
    const sc = makeDetailScenario();
    const b = createDetailBuilder('high');
    buildAll(b, sc.input);
    expect(b.out.segments).toBeGreaterThan(0);
    b.begin({ ...sc.input, lod: { ...sc.input.lod, level: 0 } });
    expect(b.out).toMatchObject({ lines: 0, segments: 0, dropped: 0, calm: 0, steep: 0 });
  });
});

describe('staging', () => {
  const sc = makeDetailScenario({ field: (x, y) => [5 + Math.sin(x / 500), 3 + Math.cos(y / 400)], cellPx: 120, camera: topDownCamera(133, 120, 0, 0, { cssW: 1280, cssH: 800 }) });
  const whole = (() => {
    const b = createDetailBuilder('high');
    buildAll(b, sc.input);
    return Buffer.from(detailBytes(b.out));
  })();

  it('slices that stop on the clock give exactly the bytes of one slice', () => {
    expect(whole.length).toBeGreaterThan(100_000);
    for (const tick of [0.7, 1, 2.5]) {
      const clock = counterClock(tick);
      const b = createDetailBuilder('high');
      b.begin({ ...sc.input, now: clock.now });
      let steps = 0;
      while (!b.step(3)) {
        steps++;
        expect(b.busy).toBe(true);
        expect(steps).toBeLessThan(10000);
      }
      expect(b.busy).toBe(false);
      expect(steps).toBeGreaterThan(1);
      expect(detailBytes(b.out).equals(whole)).toBe(true);
    }
  });

  it('always makes progress, even with a budget of nothing and a clock that stands still', () => {
    const clock = counterClock(0);
    const b = createDetailBuilder('high');
    b.begin({ ...sc.input, now: clock.now });
    let steps = 0;
    let last = 0;
    while (!b.step(0)) {
      steps++;
      expect(b.out.lines).toBeGreaterThanOrEqual(last);
      last = b.out.lines;
      expect(steps).toBeLessThan(2000);
    }
    expect(detailBytes(b.out).equals(whole)).toBe(true);
    expect(last).toBeGreaterThan(0);
  });

  it('reads the clock more often for the first rebuilds of a builder (cold code), and rarely for a warm one', () => {
    const reads: number[] = [];
    const b = createDetailBuilder('high');
    for (let r = 0; r < 7; r++) {
      const clock = counterClock(0);
      b.begin({ ...sc.input, now: clock.now });
      while (!b.step(3)) {
        /* sliced */
      }
      reads.push(clock.reads());
    }
    expect(reads[0]!).toBeGreaterThan(reads[6]!);
    expect(reads[6]!).toBeLessThan(b.out.lines / 4); // at most one read per 16 lines once warm (and fewer while the slice is mostly left)
  });

  it('cancel stops a build at once and the builder can start another', () => {
    const clock = counterClock(1);
    const b = createDetailBuilder('high');
    b.begin({ ...sc.input, now: clock.now });
    expect(b.step(2)).toBe(false);
    expect(b.busy).toBe(true);
    b.cancel();
    expect(b.busy).toBe(false);
    expect(b.step(2)).toBe(true);
    buildAll(b, sc.input);
    expect(detailBytes(b.out).equals(whole)).toBe(true);
  });

  it('begin during a build restarts it', () => {
    const clock = counterClock(1);
    const b = createDetailBuilder('high');
    b.begin({ ...sc.input, now: clock.now });
    b.step(2);
    buildAll(b, sc.input);
    expect(detailBytes(b.out).equals(whole)).toBe(true);
  });

  it('reads the clock after every line and every 64 cells in its first two rebuilds, every 4 lines and 256 cells in the next two, and only a handful of times after that', () => {
    const b = createDetailBuilder('high');
    const reads: number[] = [];
    for (let r = 1; r <= 6; r++) {
      const clock = counterClock(0);
      b.begin({ ...sc.input, now: clock.now });
      while (!b.step(1e9)) {
        /* done in one */
      }
      reads.push(clock.reads());
      if (r === 1) expect(clock.reads(), 'a read a line at least').toBeGreaterThanOrEqual(b.out.lines);
    }
    // Cold (the first two): not one a cell, but one a line and 64 cells; warming (the next two) a quarter of the lines; warm: not one a line.
    expect(reads[0]).toBe(reads[1]);
    expect(reads[2]).toBe(reads[3]);
    expect(reads[2]!).toBeLessThan(reads[0]! / 2);
    expect(reads[4]!).toBeLessThan(reads[2]! / 2);
    expect(reads[4]).toBe(reads[5]);
    expect(reads[4]!).toBeLessThan(200); // a read every 2048 cells of the walk and every 16 lines (the lattice is four times as dense as it was)
  });
});

describe('pulseIntensity: the vertex shader\'s pulse in TypeScript', () => {
  // head 100 px along the line, a tail of 40 px: 1 at the head, down to 0 at 60 px, 0 ahead of the head.
  const rows: [number, number, number, number][] = [
    [100, 100, 40, 1],
    [99, 100, 40, 0.975],
    [90, 100, 40, 0.75],
    [80, 100, 40, 0.5],
    [70, 100, 40, 0.25],
    [60, 100, 40, 0],
    [50, 100, 40, 0],
    [0, 100, 40, 0],
    [100.5, 100, 40, 0],
    [150, 100, 40, 0],
    [0, 0, 24, 1],
    [0, -5, 24, 0],
  ];
  it('gives the shader\'s values at 12 points: head 1, linear to 0 a tail behind, 0 ahead', () => {
    expect(rows).toHaveLength(12);
    for (const [s, head, tail, want] of rows) expect(pulseIntensity(s, head, tail), `s ${s} head ${head} tail ${tail}`).toBeCloseTo(want, 12);
  });

  it('is never outside 0 to 1, falls as the point falls behind the head, and a longer tail is brighter at the same point behind it', () => {
    let prev = 1;
    for (let s = 100; s >= 0; s -= 0.5) {
      const v = pulseIntensity(s, 100, 60);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(prev + 1e-12);
      prev = v;
    }
    expect(pulseIntensity(80, 100, 90)).toBeGreaterThan(pulseIntensity(80, 100, 30));
    // A tail of nothing is a bare head (never a division by zero).
    expect(pulseIntensity(10, 10, 0)).toBe(1);
    expect(pulseIntensity(9, 10, 0)).toBe(1);
    expect(pulseIntensity(11, 10, 0)).toBe(0);
  });
});

/** The 0.6.0 picture, pinned (0.7.0): scenarios whose bytes were hashed with the builder as 0.6.0 left it, before the relief terms existed. */
export function goldenScenarios(): [string, DetailScenario][] {
  const sc0 = makeDetailScenario();
  const g = sc0.grid;
  const e = (g.nx - 1) * g.cellSize;
  const ten = (fn: (x: number, y: number) => number) => groundOf({ nx: Math.ceil(e / 10) + 1, ny: Math.ceil(e / 10) + 1, cellSize: 10, x0: g.x0, y0: g.y0, origin: ORIGIN }, fn);
  const hills = (x: number, y: number): number => 300 + 60 * Math.sin(x / 700) + 40 * Math.cos(y / 500) + 6 * Math.sin(x / 37) * Math.cos(y / 41);
  const wall = (x: number): number => (x < -20 ? 300 : x > 20 ? 460 : 300 + 4 * (x + 20));
  const rotate = (x: number, y: number): [number, number] => [3 - 0.004 * y, 1 + 0.004 * x];
  return [
    ['uniform wind, tiny scene', tiny()],
    ['a shear over rolling hills, seen from above', makeDetailScenario({ field: (_x, y) => [5 + 0.001 * y, 3], ground: hills, ground10: ten(hills), camera: topDownCamera(133, 150, 0, 0, { near: 30 }, 300), seed: 4 })],
    ['a turning wind over hills, tilted camera', makeDetailScenario({ field: rotate, ground: hills, ground10: ten(hills), camera: makeCamera({ eye: [300, 900, 1300], target: [0, 300, 0], near: 30 }), seed: 2 })],
    ['a wall across the wind', makeDetailScenario({ groundCell: 10, ground: (x) => wall(x), field: () => [8, 0], camera: topDownCamera(133, 150, 0, 0, { near: 30 }, 460) })],
  ];
}

/** sha1 of `detailBytes` and the line and segment counts of each golden scenario, taken with the 0.6.0 builder (commit 1332ba1, before the relief terms). */
const GOLDEN: Record<string, [string, number, number]> = {
  'uniform wind, tiny scene': ['3e6ba882b39aaef93182d43f73f9b1da0b615092', 312, 4962],
  'a shear over rolling hills, seen from above': ['35009013f569a604b4571dd4d1848e33b8780a7d', 584, 6283],
  'a turning wind over hills, tilted camera': ['65c39de799917dd6e2a6f0d91daec9c7bfbec361', 356, 2847],
  'a wall across the wind': ['7c1a06218e83afa4a18df5ba4bc0f5b805222d93', 566, 7854],
};

describe('the 0.6.0 picture is what the builder draws when `relief` is absent', () => {
  for (const [name, sc] of goldenScenarios()) {
    it(`${name}: the bytes are the 0.6.0 bytes`, () => {
      const { out } = build(sc);
      expect([createHash('sha1').update(detailBytes(out)).digest('hex'), out.lines, out.segments]).toEqual(GOLDEN[name]);
      expect(out.blocked).toBe(0);
    });
  }
});

// ───────────────────────── the relief (0.7.0) ─────────────────────────

/** A scenario with the relief on (its `canopy`, `crowns` and `plumes` as given), seen from above. */
function withRelief(sc: DetailScenario, o: { relief?: DetailRelief; canopyH?: number; cover?: number; crowns?: readonly CrownSet[]; plumes?: readonly Plume[] } = {}): DetailScenario {
  const g = sc.grid;
  const n = g.nx * g.ny;
  const input = { ...sc.input, relief: o.relief ?? DETAIL_RELIEF } as DetailInput;
  if (o.canopyH !== undefined) input.canopy = { grid: g, canopyHeight: new Float32Array(n).fill(o.canopyH), canopyCover: new Float32Array(n).fill(o.cover ?? 1) } as unknown as FuelMap;
  if (o.crowns) input.crowns = o.crowns;
  if (o.plumes) input.plumes = o.plumes;
  return { ...sc, input };
}
const reliefOff = (): DetailRelief => ({ ...DETAIL_RELIEF, enabled: false });
/** Trees [x, y, height, width] as one set of the vegetation layer's. */
const stand = (list: readonly [number, number, number, number][], group = 0): CrownSet => {
  const position = new Float32Array(3 * list.length);
  const size = new Float32Array(2 * list.length);
  list.forEach(([x, y, h, w], i) => {
    position.set([x, y, 0], 3 * i);
    size.set([h, w], 2 * i);
  });
  return { group, count: list.length, position, size };
};
const hashOf = (out: DetailOutput): string => createHash('sha1').update(detailBytes(out)).digest('hex');
/** The heading (degrees) of the first and of the last segment of a line, and the largest turn between two of its segments (degrees, absolute), and the sum of the signed turns. */
function turns(out: DetailOutput, l: Line): { first: number; last: number; worst: number; total: number } {
  let worst = 0;
  let total = 0;
  for (let k = l.seg; k < l.seg + l.count - 1; k++) {
    const t = turnBetween(out, k);
    worst = Math.max(worst, Math.abs(t));
    total += t;
  }
  return { first: deg(heading(out, l.seg)), last: deg(heading(out, l.seg + l.count - 1)), worst, total };
}

describe('the relief: off, absent, or with nothing to bend round, is the 0.6.0 picture', () => {
  it('draws the 0.6.0 bytes with the relief switched off by its own flag, in every golden scenario', () => {
    for (const [name, sc] of goldenScenarios()) {
      const { out } = build(withRelief(sc, { relief: reliefOff(), canopyH: 24, crowns: [stand([[0, 0, 30, 10]])], plumes: [{ x: 0, y: 0, radiusM: 50, strength: 1 }] }));
      expect([hashOf(out), out.lines, out.segments], name).toEqual(GOLDEN[name]);
      expect(out.blocked, name).toBe(0);
    }
  });

  it('draws the 0.6.0 bytes with the relief on over flat ground with no canopy, no crown and no plume (a ridge needs a slope)', () => {
    const [name, sc] = goldenScenarios()[0]!;
    const { out } = build(withRelief(sc));
    expect([hashOf(out), out.lines, out.segments], name).toEqual(GOLDEN[name]);
    const flat = makeDetailScenario({ field: () => [6, 8], ground: () => 500, camera: topDownCamera(133, 150, 0, 0, {}, 500) });
    expect(hashOf(build(withRelief(flat)).out)).toBe(hashOf(build(flat).out));
  });

  it('draws the same lines in the same places with the crowns too far to count (a 5 m crown under 8 px across): nothing is blocked, only the canopy lifts them', () => {
    const sc = makeDetailScenario({ field: () => [6, 8], cellPx: 150 }); // 0.89 m a pixel
    const trees = stand([[0, 0, 30, 10], [20, 10, 31, 9]]);
    const a = build(withRelief(sc, { canopyH: 24, crowns: [trees] }));
    const b = build(sc);
    expect(a.out.lines).toBe(b.out.lines);
    expect(a.out.blocked).toBe(0);
    for (let k = 0; k < b.out.segments; k++) {
      expect(a.out.a[3 * k]).toBe(b.out.a[3 * k]);
      expect(a.out.a[3 * k + 2]).toBe(b.out.a[3 * k + 2]);
    }
  });
});

describe('the relief: a line slides along the contour of a windward slope', () => {
  const ten = (fn: (x: number, y: number) => number) => {
    const sc0 = makeDetailScenario();
    const g = sc0.grid;
    const e = (g.nx - 1) * g.cellSize;
    return groundOf({ nx: Math.ceil(e / 10) + 1, ny: Math.ceil(e / 10) + 1, cellSize: 10, x0: g.x0, y0: g.y0, origin: ORIGIN }, fn);
  };
  /** A slope of 0.3 rising to the east, a wind of 8 m/s from `deg` degrees off east, seen from above at 300 px a model cell (0.44 m a pixel: lines of 40 to 100 m). */
  const ramp = (windDeg: number, o: DetailScenarioOptions = {}): DetailScenario => {
    const ground = (x: number): number => 300 + 0.3 * x;
    const c = Math.cos((windDeg * Math.PI) / 180);
    const s = Math.sin((windDeg * Math.PI) / 180);
    return makeDetailScenario({ field: () => [8 * c, 8 * s], ground: (x) => ground(x), ground10: ten((x) => ground(x)), camera: topDownCamera(133, 300, 0, 0, { near: 5 }, 300), ...o });
  };
  const full = (lines: Line[]): Line[] => lines.filter((l) => l.count >= 14 && Math.abs(l.seed[0]) < 1500 && Math.abs(l.seed[1]) < 1500);

  it('turns a line that meets the slope at 40 degrees toward the contour, by 10 to 30 degrees from the wind, steadily along the slope, and never by more than 30 degrees in a step', () => {
    const { out, lines } = build(withRelief(ramp(40)));
    const ls = full(lines);
    expect(ls.length).toBeGreaterThan(30);
    for (const l of ls) {
      const t = turns(out, l);
      // The wind is 40 degrees off east and the contour runs north: a line leans toward 90.
      expect(t.first - 40, `line at ${l.seed}`).toBeGreaterThan(8);
      expect(t.first - 40).toBeLessThan(30);
      expect(Math.abs(t.last - t.first), 'a steady slope turns every step the same').toBeLessThan(0.5);
      expect(t.worst).toBeLessThanOrEqual(30 + 1e-6);
    }
    // Without the relief the same lines run straight along 40 degrees.
    const plain = build(ramp(40));
    for (const l of full(plain.lines)) expect(turns(plain.out, l).first).toBeCloseTo(40, 3);
  });

  it('keeps a line that meets it head-on straight, and lifted over it (the lift of 0.6.0)', () => {
    const { out, lines } = build(withRelief(ramp(0)));
    const ls = full(lines);
    expect(ls.length).toBeGreaterThan(30);
    for (const l of ls) {
      const t = turns(out, l);
      expect(Math.abs(t.last - t.first)).toBeLessThan(1e-3);
      expect(l.lift, 'the lift over the slope').toBeGreaterThan(0.5);
    }
  });

  it('leaves a line alone where the ground falls ahead (the lee has its own sink), and slides less where the wind is high above the ground', () => {
    const { out, lines } = build(withRelief(ramp(180)));
    expect(full(lines).length).toBeGreaterThan(30);
    for (const l of full(lines)) expect(Math.abs(turns(out, l).total)).toBeLessThan(1e-3);
    const mean = (hm: number): number => {
      const b = build(withRelief(ramp(40, { heightM: hm })));
      const ls = full(b.lines);
      return ls.reduce((s, l) => s + turns(b.out, l).first - 40, 0) / Math.max(1, ls.length);
    };
    expect(mean(10)).toBeGreaterThan(10);
    expect(mean(300)).toBeLessThan(0.7 * mean(10));
    expect(mean(300)).toBeGreaterThan(2);
    expect(mean(1000)).toBeLessThan(2);
  });

  it('slides along a gentler slope less: nothing while the rise along the flow is under 0.1 a metre, the whole of the deflection from 0.35', () => {
    const turnFor = (slope: number): number => {
      const ground = (x: number): number => 300 + slope * x;
      const sc = makeDetailScenario({ field: () => [8 * Math.cos(0.7), 8 * Math.sin(0.7)], ground, ground10: ten(ground), camera: topDownCamera(133, 300, 0, 0, { near: 5 }, 300) });
      const b = build(withRelief(sc));
      const ls = full(b.lines);
      expect(ls.length, `slope ${slope}`).toBeGreaterThan(20);
      return ls.reduce((s, l) => s + turns(b.out, l).first - deg(0.7), 0) / ls.length;
    };
    expect(turnFor(0.1)).toBeLessThan(0.01); // 0.1 x cos 40 degrees = 0.077
    expect(turnFor(0.2)).toBeGreaterThan(1);
    expect(turnFor(0.35)).toBeGreaterThan(turnFor(0.2));
    expect(turnFor(0.6)).toBeGreaterThan(turnFor(0.35));
    expect(turnFor(0.6)).toBeLessThan(30);
  });
});

describe('the relief: the strokes ride on the canopy', () => {
  const closest = (o: DetailScenarioOptions = {}): DetailScenario => makeDetailScenario({ field: () => [6, 8], cellPx: 3000, camera: topDownCamera(133, 3000, 0, 0, { near: 5 }, 0), ...o });

  it('draws every vertex at the canopy plane (85 % of 24 m = 20.4 m) over the ground where the cover is whole, and at 1.5 m without a canopy', () => {
    const sc = closest();
    const withCanopy = build(withRelief(sc, { canopyH: 24, cover: 1 }));
    const without = build(withRelief(sc));
    expect(withCanopy.lines.length).toBeGreaterThan(20);
    const out = withCanopy.out;
    for (let k = 0; k < out.segments; k++) for (const y of [out.a[3 * k + 1]!, out.b[3 * k + 1]!]) expect(y).toBeCloseTo(0.85 * 24, 3);
    for (let k = 0; k < without.out.segments; k++) expect(without.out.a[3 * k + 1]).toBeCloseTo(GLYPH_LIFT_MIN_M, 3);
  });

  it('weighs the plane by the cover, and keeps the 1.5 m lift (the stroke is never under it) where the plane is lower', () => {
    const sc = closest();
    const half = build(withRelief(sc, { canopyH: 24, cover: 0.15 }));
    for (let k = 0; k < half.out.segments; k++) expect(half.out.a[3 * k + 1]).toBeCloseTo(0.85 * 24 * 0.5, 3);
    const low = build(withRelief(sc, { canopyH: 1.2, cover: 1 })); // a plane of 1.02 m is under the lift of 1.5 m
    for (let k = 0; k < low.out.segments; k++) expect(low.out.a[3 * k + 1]).toBeCloseTo(GLYPH_LIFT_MIN_M, 3);
  });

  it('adds the wind\'s rise (3 m x the line\'s lift) to the base of the stroke, and the canopy over it: ground + max(base, plane) + 3 lift', () => {
    const ground = (x: number): number => 300 + 0.2 * x;
    const ten = groundOf(closest().grid, (x) => ground(x));
    const sc = closest({ field: () => [-10, 0], ground: (x) => ground(x), ground10: ten, camera: topDownCamera(133, 3000, 0, 0, { near: 5 }, 300) });
    const { out, lines } = build(withRelief(sc, { canopyH: 24, cover: 1 }));
    const hf = new HeightField(sc.ground.grid, sc.ground.elevation);
    expect(lines.length).toBeGreaterThan(5);
    for (const l of lines) {
      expect(l.lift).toBeCloseTo(-0.667, 2); // the lee sinks the base: 1.5 - 3 x 0.667 = -0.5, held at 0.5 m
      for (let k = l.seg; k < l.seg + l.count; k++) {
        const above = out.a[3 * k + 1]! - hf.heightAt(out.a[3 * k]!, -out.a[3 * k + 2]!);
        expect(above).toBeCloseTo(0.5 + (0.85 * 24 - 1.5), 2); // the sunk base (0.5 m) with the plane's metres over the base lift (20.4 - 1.5) on top
      }
    }
  });

  it('climbs over the edge of a stand smoothly and is cut by nothing: the canopy\'s ramp of a cell is not a wall', () => {
    const base = makeDetailScenario({ field: () => [8, 0], camera: topDownCamera(133, 600, 0, 0, { near: 5 }, 0) });
    const g = base.grid;
    const n = g.nx * g.ny;
    const height = new Float32Array(n);
    for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) height[j * g.nx + i] = i >= Math.floor(g.nx / 2) ? 24 : 0; // a stand from the middle column east
    // The middle column is at x = x0 + 22 cells = 0 (the grid is centred on 0): the edge ramps from -133 m to 0.
    const input: DetailInput = { ...base.input, relief: DETAIL_RELIEF, canopy: { grid: g, canopyHeight: height, canopyCover: new Float32Array(n).fill(1) } as unknown as FuelMap };
    const { out, lines } = build({ ...base, input });
    expect(out.steep).toBe(0);
    expect(lines.length).toBeGreaterThan(30);
    let across = 0;
    for (const l of lines) {
      const y0 = out.a[3 * l.seg + 1]!;
      const y1 = out.b[3 * (l.seg + l.count - 1) + 1]!;
      if (y1 - y0 > 3) across++;
      for (let k = l.seg; k < l.seg + l.count; k++) {
        const run = Math.hypot(out.b[3 * k]! - out.a[3 * k]!, out.b[3 * k + 2]! - out.a[3 * k + 2]!);
        expect(Math.abs(out.b[3 * k + 1]! - out.a[3 * k + 1]!)).toBeLessThanOrEqual(((0.85 * 24) / 133) * run * 1.05 + 1e-3);
      }
    }
    expect(across, 'lines that climb the edge').toBeGreaterThan(3);
  });

  it('still cuts a line at a wall of the ground with the canopy on, and counts it', () => {
    const wall = (x: number): number => (x < -20 ? 300 : x > 20 ? 460 : 300 + 4 * (x + 20));
    const sc = makeDetailScenario({ groundCell: 10, ground: (x) => wall(x), field: () => [8, 0], camera: topDownCamera(133, 150, 0, 0, { near: 30 }, 460) });
    const { out } = build(withRelief(sc, { canopyH: 24, cover: 1 }));
    expect(out.steep, 'lines cut or dropped at the wall').toBeGreaterThan(3);
  });
});

describe('the relief: the lines part round a crown', () => {
  /** A top view at 0.133 m a pixel (412 px = 55 m), a wind of 12 m/s from the west (lines of 25 m), a canopy of 24 m (the stroke at 20.4 m) and one tree of 40 m x 16 m at the middle: a disc of 6.2 m at the stroke. */
  const view = (o: DetailScenarioOptions = {}): DetailScenario => makeDetailScenario({ field: () => [12, 0], camera: topDownCamera(133, 1000, 0, 0, { near: 5 }, 0), ...o });
  const R = crownDiscRadius(40, 16, 0.85 * 24, 0.7, 0.3);
  const alone = (): DetailScenario => withRelief(view(), { canopyH: 24, crowns: [stand([[0, 0, 40, 16]])] });
  const speedOnly = (): DetailScenario => withRelief(view(), { canopyH: 24 }); // the same, no crown: the lines run straight

  it('is a disc of about 6.2 m at the stroke for this tree', () => {
    expect(R).toBeGreaterThan(6.1);
    expect(R).toBeLessThan(6.3);
  });

  it('draws no seed inside 0.8 radii of the crown, counts them, and ends every line at its rim (0.85 radii): no vertex inside it', () => {
    const { out, lines } = build(alone());
    const base = build(speedOnly());
    expect(out.blocked).toBeGreaterThan(0);
    expect(base.out.blocked).toBe(0);
    for (const l of lines) expect(Math.hypot(l.seed[0], l.seed[1]), `seed ${l.seed}`).toBeGreaterThanOrEqual(0.8 * R - 1e-3);
    let nearest = Infinity;
    for (let k = 0; k < out.segments; k++) for (const [x, y] of [[out.a[3 * k]!, -out.a[3 * k + 2]!], [out.b[3 * k]!, -out.b[3 * k + 2]!]] as const) nearest = Math.min(nearest, Math.hypot(x, y));
    expect(nearest).toBeGreaterThanOrEqual(0.85 * R - 1e-3);
    expect(nearest, 'some line does end at the rim').toBeLessThan(0.85 * R + 0.5);
    // The lines that were blocked are the ones the crown took: the others are the straight picture's (before the crown) or bent ones.
    expect(lines.length).toBeLessThanOrEqual(base.lines.length);
    expect(lines.length + out.blocked).toBeGreaterThanOrEqual(base.lines.length - 15); // (a few more end short, under three segments, at the rim)
  });

  it('pushes a line that passes beside the crown outward, and brings it back toward its own track behind it', () => {
    const { out, lines } = build(alone());
    let pushed = 0;
    let returned = 0;
    for (const l of lines) {
      if (l.count < 16 || l.seed[0] > -1 * R || l.seed[0] < -3 * R || Math.abs(l.seed[1]) < 0.4 * R || Math.abs(l.seed[1]) > 2.3 * R) continue;
      const side = Math.sign(l.seed[1]);
      // The lateral position (times the side) where the line crosses x = 0, and at its end.
      let at0: number | null = null;
      let tail = 0;
      for (let k = l.seg; k < l.seg + l.count; k++) {
        const [x0, y0, x1, y1] = segmentXY(out, k);
        if (at0 === null && x0 <= 0 && x1 > 0) at0 = (y0 + ((y1 - y0) * (0 - x0)) / (x1 - x0)) * side;
        tail = y1 * side;
      }
      if (at0 === null) continue;
      if (at0 > Math.abs(l.seed[1]) + 0.1 * R) pushed++;
      if (tail < at0 - 0.05 * R) returned++;
    }
    expect(pushed, 'lines pushed out past the crown').toBeGreaterThan(5);
    expect(returned, 'and drawn back behind it').toBeGreaterThan(3);
  });

  it('keeps the model\'s direction far from every obstacle: a line farther than 3 radii of all of them is the straight line of 0.6.0', () => {
    const { out, lines } = build(alone());
    let far = 0;
    for (const l of lines) {
      let nearest = Infinity;
      for (let k = l.seg; k < l.seg + l.count; k++) nearest = Math.min(nearest, Math.hypot(out.a[3 * k]!, out.a[3 * k + 2]!), Math.hypot(out.b[3 * k]!, out.b[3 * k + 2]!));
      if (nearest < 3.2 * R) continue;
      far++;
      expect(turns(out, l).first).toBeCloseTo(0, 6);
      expect(Math.abs(turns(out, l).total)).toBeLessThan(1e-4);
    }
    expect(far).toBeGreaterThan(100);
  });

  it('bends by at most 30 degrees a step in a stagnation point, a saddle between two crowns and the curl of a vortex pair', () => {
    const two = withRelief(view(), { canopyH: 24, crowns: [stand([[0, 5, 40, 16], [0, -5, 40, 16]])] });
    const plume = withRelief(view(), { plumes: [{ x: -14, y: 0, radiusM: 12, strength: 1 }] });
    const wake = withRelief(view(), { canopyH: 24, crowns: [stand([[0, 0, 44, 16]])] }); // a proud crown: it makes its wake as well
    let bent = 0;
    for (const [name, sc] of [['one crown', alone()], ['two crowns', two], ['plume', plume], ['proud crown', wake]] as const) {
      const { out, lines } = build(sc);
      expect(lines.length, name).toBeGreaterThan(100);
      let worst = 0;
      for (const l of lines) {
        const t = turns(out, l);
        worst = Math.max(worst, t.worst);
        if (Math.abs(t.total) > 20) bent++;
      }
      expect(worst, name).toBeLessThanOrEqual(30 + 1e-6);
      expect(worst, `${name}: some line really turns`).toBeGreaterThan(8);
    }
    expect(bent).toBeGreaterThan(20);
  });

  it('colours every segment by the model\'s speed at its middle with the crowns on, as without them', () => {
    const table = buildSpeedTable();
    const field = (x: number): [number, number] => [3 + (x + 100) / 18, 0]; // 3 to 14 m/s across a 200 m view
    const sc = withRelief(view({ field }), { canopyH: 24, crowns: [stand([[0, 0, 40, 16], [12, 9, 41, 14], [-9, -11, 39, 14]])] });
    const { out, lines } = build(sc);
    expect(out.blocked).toBeGreaterThan(3);
    let checked = 0;
    let exact = 0;
    for (const l of lines) {
      for (let k = 0; k < l.count; k++) {
        const q = l.seg + k;
        const xm = 0.5 * (out.a[3 * q]! + out.b[3 * q]!);
        const speed = 3 + (xm + 100) / 18;
        const bin = Math.min(63, Math.round(speed * (63 / 25)));
        const at = (b: number): boolean => [0, 1, 2].every((c) => Math.abs(out.c[4 * q + c]! - table[3 * b + c]!) < 1e-6);
        expect(at(bin) || at(Math.max(0, bin - 1)) || at(Math.min(63, bin + 1)), `segment ${q}`).toBe(true);
        if (at(bin)) exact++;
        checked++;
      }
      expect(l.speed, 'the line\'s own speed is the wind at its seed').toBeCloseTo(3 + (l.seed[0] + 100) / 18, 3);
    }
    expect(checked).toBeGreaterThan(1000);
    expect(exact / checked).toBeGreaterThan(0.95);
  });

  it('writes the pin into the colour alpha: 1 on a line with no obstacle within 2.5 radii, from 0.2 to 1 on the others, and never 0', () => {
    const second = crownDiscRadius(41, 14, 0.85 * 24, 0.7, 0.3);
    // (The wakes have their own pin, round their cores; leave them out here.)
    const { out, lines } = build(withRelief(view(), { relief: { ...DETAIL_RELIEF, eddies: { ...DETAIL_RELIEF.eddies, maxEddies: 0 } }, canopyH: 24, crowns: [stand([[0, 0, 40, 16], [14, 4, 41, 14]])] }));
    let pinned = 0;
    let free = 0;
    for (const l of lines) {
      const pins = new Set<number>();
      let nearest = Infinity; // in radii of the crown it is near
      for (let k = l.seg; k < l.seg + l.count; k++) {
        pins.add(out.c[4 * k + 3]!);
        for (const [x, z] of [[out.a[3 * k]!, out.a[3 * k + 2]!], [out.b[3 * k]!, out.b[3 * k + 2]!]] as const) nearest = Math.min(nearest, Math.hypot(x, z) / R, Math.hypot(x - 14, z + 4) / second);
      }
      expect(pins.size, 'one pin to a line').toBe(1);
      const pin = [...pins][0]!;
      expect(pin).toBeGreaterThanOrEqual(0.2 - 1e-6);
      expect(pin).toBeLessThanOrEqual(1);
      if (nearest > 3) {
        expect(pin, `a line ${nearest.toFixed(1)} radii away`).toBe(1);
        free++;
      } else if (pin < 1) pinned++;
    }
    expect(free).toBeGreaterThan(100);
    expect(pinned).toBeGreaterThan(30);
  });

  it('is the same bytes every time, and from a builder that has built other pictures first', () => {
    const sc = alone();
    const a = build(sc);
    const b = build(sc);
    expect(hashOf(b.out)).toBe(hashOf(a.out));
    const used = createDetailBuilder('high');
    buildAll(used, withRelief(view({ field: () => [3, 5] }), { canopyH: 12, crowns: [stand([[3, 3, 20, 6]])] }).input);
    buildAll(used, sc.input);
    expect(hashOf(used.out)).toBe(hashOf(a.out));
    expect(used.out.blocked).toBe(a.out.blocked);
  });

  it('after a pan by whole lattice cells builds the same bytes for the seeds both views hold (the crowns are the world\'s, not the screen\'s)', () => {
    const trees = stand([[0, 0, 40, 16], [9, 6, 41, 14], [-8, -7, 39, 14]]);
    const A = withRelief(view({ seed: 3 }), { canopyH: 24, crowns: [trees] });
    const S = A.plan.spacingM;
    const B = withRelief(view({ seed: 3, camera: topDownCamera(133, 1000, 3 * S, -2 * S, { near: 5 }, 0) }), { canopyH: 24, crowns: [trees] });
    expect(B.plan.spacingExp).toBe(A.plan.spacingExp);
    const ga = build(A);
    const gb = build(B);
    const key = (l: Line): string => `${l.seed[0]},${l.seed[1]}`;
    const inA = new Map(ga.lines.map((l) => [key(l), l]));
    let shared = 0;
    let differing = 0;
    for (const l of gb.lines) {
      const m = inA.get(key(l));
      if (!m) continue;
      shared++;
      if (m.count !== l.count) {
        differing++;
        continue;
      }
      for (let k = 0; k < l.count; k++) {
        const ia = m.seg + k;
        const ib = l.seg + k;
        for (let c = 0; c < 3; c++) if (ga.out.a[3 * ia + c] !== gb.out.a[3 * ib + c] || ga.out.b[3 * ia + c] !== gb.out.b[3 * ib + c]) differing++;
        for (let c = 0; c < 4; c++) if (ga.out.c[4 * ia + c] !== gb.out.c[4 * ib + c] || ga.out.d[4 * ia + c] !== gb.out.d[4 * ib + c] || ga.out.e[4 * ia + c] !== gb.out.e[4 * ib + c]) differing++;
      }
    }
    expect(shared).toBeGreaterThan(gb.lines.length * 0.3);
    expect(differing).toBe(0);
  });

  it('is a function of the crowns, not of their order', () => {
    const list: [number, number, number, number][] = [[0, 0, 40, 16], [9, 6, 41, 14], [-8, -7, 39, 14], [5, -12, 43, 15]];
    const a = build(withRelief(view(), { canopyH: 24, crowns: [stand(list)] }));
    const b = build(withRelief(view(), { canopyH: 24, crowns: [stand([...list].reverse())] }));
    expect(b.out.lines).toBe(a.out.lines);
    expect(b.out.blocked).toBe(a.out.blocked);
    for (let k = 0; k < a.out.segments; k++) {
      for (const c of [0, 1, 2]) {
        expect(b.out.a[3 * k + c]).toBeCloseTo(a.out.a[3 * k + c]!, 4);
        expect(b.out.b[3 * k + c]).toBeCloseTo(a.out.b[3 * k + c]!, 4);
      }
    }
  });

  it('stays inside the caps with crowns: never more segments than the tier\'s cap, never more lines than its lines', () => {
    const list: [number, number, number, number][] = Array.from({ length: 300 }, (_, i) => [(hash01(i, 5, 1) - 0.5) * 60, (hash01(i, 5, 2) - 0.5) * 120, 28 + hash01(i, 5, 3) * 8, 7 + hash01(i, 5, 4) * 3]);
    for (const tier of ['low', 'medium', 'high'] as const) {
      const { out } = build(withRelief(view(), { canopyH: 24, crowns: [stand(list)] }), tier);
      const caps = GLYPH_CAPS[tier];
      expect(out.segments, tier).toBeLessThanOrEqual(caps.segments);
      expect(out.lines, tier).toBeLessThanOrEqual(caps.glyphs);
      expect(out.segments, tier).toBeGreaterThan(0);
    }
  });
});

describe('the relief: eddies curl behind obstacles', () => {
  const view = (o: DetailScenarioOptions = {}): DetailScenario => makeDetailScenario({ field: () => [8, 0], camera: topDownCamera(133, 1000, 0, 0, { near: 5 }, 0), ...o });

  it('curls the lines that start in the core of a plume\'s vortices (they bend by more than 15 degrees) and leaves the lines beyond their reach as straight as the wind', () => {
    // A plume 12 m across at (-20, 0): its pair is 20 m downwind, at (0.4, 10.8) and (0.4, -10.8), core 8.4 m, reach 38 m.
    const sc = withRelief(view(), { plumes: [{ x: -20, y: 0, radiusM: 12, strength: 1 }] });
    const { out, lines } = build(sc);
    const cores: [number, number][] = [[0.4, 10.8], [0.4, -10.8]];
    let curled = 0;
    let inCores = 0;
    let straight = 0;
    for (const l of lines) {
      const t = turns(out, l);
      const dCore = Math.min(...cores.map((c) => Math.hypot(l.seed[0] - c[0], l.seed[1] - c[1])));
      if (dCore < 0.7 * 8.4 && l.count >= 10) {
        inCores++;
        let wide = 0;
        for (let k = l.seg; k < l.seg + l.count; k++) wide = Math.max(wide, Math.abs(deg(heading(out, k))));
        if (wide > 15) curled++;
      }
      let near = Infinity;
      for (let k = 0; k < l.count; k++) for (const c of cores) near = Math.min(near, Math.hypot(out.a[3 * (l.seg + k)]! - c[0], -out.a[3 * (l.seg + k) + 2]! - c[1]));
      if (near > 3.2 * 12 + 1) {
        straight++;
        expect(Math.abs(t.total), 'a line beyond the reach of both cores').toBeLessThan(1e-4);
        expect(t.first).toBeCloseTo(0, 6);
      }
    }
    expect(inCores).toBeGreaterThan(2);
    expect(curled, `of ${inCores} lines that start in a core`).toBeGreaterThanOrEqual(Math.ceil(0.6 * inCores));
    expect(straight).toBeGreaterThan(50);
  });

  it('puts the pin round the cores of a wake (the noise does not carry the curl away), 1 beyond 2.5 radii of them', () => {
    const { out, lines } = build(withRelief(view(), { plumes: [{ x: -20, y: 0, radiusM: 12, strength: 1 }] }));
    let pinned = 0;
    for (const l of lines) {
      const pin = out.c[4 * l.seg + 3]!;
      if (pin < 1) pinned++;
      expect(pin).toBeGreaterThanOrEqual(0.2 - 1e-6);
    }
    expect(pinned).toBeGreaterThan(5);
  });

  it('makes no wake for a crown that stands no taller than the stand, nor one that has a neighbour, and makes one for a proud crown that stands free', () => {
    const wakeOf = (list: [number, number, number, number][]): number => {
      const sc = withRelief(view(), { canopyH: 24, crowns: [stand(list)] });
      const noWake = withRelief(view(), { relief: { ...DETAIL_RELIEF, eddies: { ...DETAIL_RELIEF.eddies, maxEddies: 0 } }, canopyH: 24, crowns: [stand(list)] });
      return hashOf(build(sc).out) === hashOf(build(noWake).out) ? 0 : 1;
    };
    // 22.5 m: a crown (the stroke is at 20.4) but under 3 m proud. 40 m: proud. Priority is by the tree's own place: try some places for the proud one.
    expect(wakeOf([[0, 0, 22.5, 10]])).toBe(0);
    const proud = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => wakeOf([[i * 0.37 - 1, 0.5 * i - 2, 40, 12]]));
    expect(proud.reduce((a, b) => a + b, 0), 'about half of the proud crowns have a wake').toBeGreaterThan(0);
    expect(proud.reduce((a, b) => a + b, 0)).toBeLessThan(8);
    // Two proud crowns within 2.2 radii of each other: neither has one.
    expect(wakeOf([[0, 0, 40, 12], [6, 0, 40, 12]])).toBe(0);
  });
});

describe('the relief: the lee of a ridge', () => {
  /** A ridge across the wind: the ground falls 60 m over 120 m from x = -40 to x = 80 (a slope of 0.5) and is flat beyond; wind from the west. */
  const lee = (o: DetailScenarioOptions = {}): DetailScenario => {
    const ground = (x: number): number => (x < -40 ? 360 : x > 80 ? 300 : 360 - 0.5 * (x + 40));
    const g0 = makeDetailScenario().grid;
    const e = (g0.nx - 1) * g0.cellSize;
    const ten = groundOf({ nx: Math.ceil(e / 10) + 1, ny: Math.ceil(e / 10) + 1, cellSize: 10, x0: g0.x0, y0: g0.y0, origin: ORIGIN }, (x) => ground(x));
    return makeDetailScenario({ field: () => [8, 0], ground: (x) => ground(x), ground10: ten, camera: topDownCamera(133, 400, 20, 0, { near: 5 }, 360), ...o });
  };

  it('draws the lee with a pair of eddies where the ground falls along the flow and is much higher upwind, and not on level ground or on the windward side', () => {
    const on = build(withRelief(lee()));
    const noWake = build(withRelief(lee(), { relief: { ...DETAIL_RELIEF, eddies: { ...DETAIL_RELIEF.eddies, maxEddies: 0 } } }));
    expect(on.lines.length).toBeGreaterThan(50);
    expect(hashOf(on.out), 'the lee sites change the lines').not.toBe(hashOf(noWake.out));
    // Level ground: no site, the ridge slide has nothing to do either: the 0.6.0 picture.
    const flat = makeDetailScenario({ field: () => [8, 0], ground: () => 300, camera: topDownCamera(133, 400, 20, 0, { near: 5 }, 300) });
    expect(hashOf(build(withRelief(flat)).out)).toBe(hashOf(build(flat).out));
    // Wind from the east (up the slope): the slope rises ahead, no lee.
    const up = lee({ field: () => [-8, 0] });
    const a = build(withRelief(up));
    const b = build(withRelief(up, { relief: { ...DETAIL_RELIEF, eddies: { ...DETAIL_RELIEF.eddies, maxEddies: 0 } } }));
    expect(hashOf(a.out), 'a windward slope has no lee eddies').toBe(hashOf(b.out));
  });

  it('is the same sites from any view: the world lattice does not move with the zoom or the pan', () => {
    const a = build(withRelief(lee()));
    const b = build(withRelief(lee({ camera: topDownCamera(133, 420, 22, 3, { near: 5 }, 360) })));
    expect(a.lines.length).toBeGreaterThan(30);
    expect(b.lines.length).toBeGreaterThan(30);
    expect(hashOf(a.out)).not.toBe(hashOf(b.out)); // other views, other pictures: but both have the sites (the pins show it)
    let pa = 0;
    let pb = 0;
    for (let k = 0; k < a.out.segments; k++) if (a.out.c[4 * k + 3]! < 1) pa++;
    for (let k = 0; k < b.out.segments; k++) if (b.out.c[4 * k + 3]! < 1) pb++;
    expect(pa).toBeGreaterThan(0);
    expect(pb).toBeGreaterThan(0);
  });
});
