/**
 * What a glyph rebuild costs (plan 9.8 and 11, spike S3): the High tier's cap in slices of 3.4 ms (the phone's 8 ms divided by the
 * spike's factor of 2.35), a whole rebuild in one to three slices, the cold start of a fresh builder, the raster fill, the walk of a
 * big box in an orbit view, and a stream of 3,000 rebuilds that leaves the heap flat. Timings go to stderr like the `[slice perf]`
 * lines. The assertions allow for a machine that other jobs share (the figures are a few times under them on a quiet one): they
 * catch a slowdown by an order of magnitude and the rule the slicing keeps, not the milliseconds.
 */
import * as v8 from 'node:v8';
import * as vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { makeGridSpec } from '../../core/grid';
import { AtmosphereSampler } from '../atmosphereSampler';
import { makeAirView } from '../slice/testing';
import { createGlyphBuilder } from './flowGlyphs';
import { HeightRaster } from './glyphField';
import { buildAll, groundOf, makeCamera, makeScenario, ORIGIN, topDownCamera, type Scenario } from './glyphOracle.testing';
import type { GlyphBuilder } from './glyphTypes';

const log = (s: string): void => {
  process.stderr.write(`[glyph perf] ${s}\n`);
};
const BUDGET_MS = 3.4;
const BIG = { cssW: 2560, cssH: 1440 };
const rotate = (x: number, y: number): [number, number] => [3 - 0.004 * y, 1 + 0.004 * x];
const quantile = (xs: number[], q: number): number => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(q * xs.length) - 1)]!;
const median = (xs: number[]): number => quantile(xs, 0.5);
const now = (): number => performance.now();

/** The High cap: 2000 glyphs of 4-step shafts and heads, 12,000 segments (a tablet screen at L3). */
const heavy = (): Scenario => makeScenario({ cellPx: 60, field: rotate, camera: topDownCamera(133, 60, 0, 0, BIG), cap: { glyphs: 2000, segments: 12000 } });

/** One rebuild cut into slices of `BUDGET_MS`; each slice's duration (ms). */
function slices(b: GlyphBuilder, sc: Scenario): number[] {
  const out: number[] = [];
  b.begin({ ...sc.input, now });
  for (;;) {
    const t0 = now();
    const done = b.step(BUDGET_MS);
    out.push(now() - t0);
    if (done) return out;
  }
}

describe('glyph rebuild cost', () => {
  // First of all: this is the first code that runs in this worker, so the builder is as cold as it will ever be.
  it('the cold start: the first rebuilds of a fresh builder overshoot a slice by a bounded amount', () => {
    const sc = heavy();
    const b = createGlyphBuilder('high');
    const firsts: string[] = [];
    let worst = 0;
    for (let r = 0; r < 6; r++) {
      const t0 = now();
      const s = slices(b, sc);
      const total = now() - t0;
      worst = Math.max(worst, ...s);
      firsts.push(`#${r + 1}: ${total.toFixed(1)} ms in ${s.length} slices (longest ${Math.max(...s).toFixed(1)} ms)`);
    }
    log(`cold start, ${b.out.glyphs} glyphs, ${b.out.segments} segments: ${firsts.join('; ')}`);
    expect(b.out.glyphs).toBeGreaterThan(1800); // thinned to 95 % of the cap, so the hard stop is rarely reached
    expect(b.out.glyphs).toBeLessThanOrEqual(2000);
    // The spike measured 4 to 7 times a steady rebuild for the first one; reading the clock every 8 glyphs keeps a slice near its budget.
    expect(worst).toBeLessThan(BUDGET_MS + 40);
  });

  it('a warm rebuild of the High cap: one to three slices of 3.4 ms, the slice p95 within its budget plus one check interval', () => {
    const sc = heavy();
    const b = createGlyphBuilder('high');
    for (let r = 0; r < 60; r++) buildAll(b, { ...sc.input, now });
    const all: number[] = [];
    const counts: number[] = [];
    const totals: number[] = [];
    for (let r = 0; r < 120; r++) {
      const t0 = now();
      const s = slices(b, sc);
      totals.push(now() - t0);
      counts.push(s.length);
      all.push(...s);
    }
    // Unsliced, for the comparison with the spike.
    const whole: number[] = [];
    for (let r = 0; r < 120; r++) {
      const t0 = now();
      buildAll(b, { ...sc.input, now });
      whole.push(now() - t0);
    }
    const perSegment = (median(whole) * 1000) / b.out.segments;
    log(
      `${b.out.glyphs} glyphs, ${b.out.segments} segments: whole rebuild median ${median(whole).toFixed(2)} ms (p95 ${quantile(whole, 0.95).toFixed(2)}); in slices of ${BUDGET_MS} ms: median ${median(counts)} slices (max ${Math.max(...counts)}), slice p95 ${quantile(all, 0.95).toFixed(2)} ms, max ${Math.max(...all).toFixed(2)} ms; ` +
        `${perSegment.toFixed(3)} us per segment, so 2000 glyphs of 10 steps (the spike's case, 24,000 segments with heads) would take about ${((perSegment * 24000) / 1000).toFixed(1)} ms here`,
    );
    expect(b.out.glyphs).toBeGreaterThan(1800); // thinned to 95 % of the cap, so the hard stop is rarely reached
    expect(b.out.glyphs).toBeLessThanOrEqual(2000);
    expect(median(counts)).toBeLessThanOrEqual(3);
    expect(quantile(all, 0.95)).toBeLessThan(BUDGET_MS * 2 + 1);
    expect(median(whole)).toBeLessThan(25);
  });

  it('the raster fill: about half a millisecond at the model grid, a few at half of it (spike S3: 0.3 to 0.5 and 1 to 2 ms)', () => {
    const grid = makeGridSpec(ORIGIN, 45 * 133, 133);
    const view = makeAirView({
      grid,
      baseM: 500,
      groundAt: (x, y) => 720 + 150 * Math.sin(x / 900) * Math.cos(y / 700),
      u: (x, _y, z) => 6 + 3 * Math.sin(x / 700 + z / 900),
      v: (_x, y, z) => 1 + 2 * Math.cos(y / 600 - z / 700),
    });
    const sampler = new AtmosphereSampler(view, 500, null);
    const ground = groundOf({ nx: 150, ny: 150, cellSize: 40, x0: grid.x0, y0: grid.y0, origin: ORIGIN }, (x, y) => 735 + 150 * Math.sin(x / 900) * Math.cos(y / 700));
    const hr = new HeightRaster();
    const time = (refine: 1 | 2): number => {
      for (let k = 0; k < 40; k++) hr.fill(sampler, ground, 100, refine);
      const t: number[] = [];
      for (let k = 0; k < 150; k++) {
        const t0 = now();
        hr.fill(sampler, ground, 100 + (k % 7), refine);
        t.push(now() - t0);
      }
      return median(t);
    };
    const m1 = time(1);
    const m2 = time(2);
    log(`HeightRaster.fill, 45 x 45 columns: 1x ${m1.toFixed(2)} ms (2025 texels), 2x ${m2.toFixed(2)} ms (7921 texels)`);
    expect(m1).toBeLessThan(5);
    expect(m2).toBeLessThan(15);
  });

  it('the lattice walk of an orbit view that sees the whole 12 km (about 136,000 cells) stays in a few slices', () => {
    // Facing north from 150 m up and 800 m back, the top of the screen near the horizon: the box is the whole domain at a 32 m lattice.
    const cam = makeCamera({ eye: [0, 150, 800], target: [0, 0, 0], ...BIG });
    const sc = makeScenario({ n: 90, cell: 133, cellPx: 70, field: rotate, camera: cam, maxRangeM: 20000 });
    const b = createGlyphBuilder('high');
    const cells = ((sc.input.box.x1 - sc.input.box.x0) / sc.plan.spacingM) * ((sc.input.box.y1 - sc.input.box.y0) / sc.plan.spacingM);
    for (let r = 0; r < 20; r++) buildAll(b, { ...sc.input, now });
    const t: number[] = [];
    const n: number[] = [];
    for (let r = 0; r < 20; r++) {
      const t0 = now();
      n.push(slices(b, sc).length);
      t.push(now() - t0);
    }
    log(`orbit, lattice ${sc.plan.spacingM} m, about ${Math.round(cells)} cells in the box: whole rebuild median ${median(t).toFixed(1)} ms in ${median(n)} slices; ${b.out.glyphs} glyphs`);
    expect(b.out.glyphs).toBeGreaterThan(50);
    expect(median(t)).toBeLessThan(120);
  });

  it('3,000 rebuilds of changing views leave the heap flat (under 100 kB after two collections)', () => {
    v8.setFlagsFromString('--expose-gc');
    const gc = vm.runInNewContext('gc') as () => void;
    const views: Scenario[] = [];
    for (const [cellPx, cx, cy] of [[60, 0, 0], [60, 900, -600], [150, -500, 700], [20, 0, 0], [8, 300, 300], [90, -1200, 400]] as const) {
      views.push(makeScenario({ cellPx, field: (x, y) => [rotate(x, y)[0] + Math.sin(x / 300), rotate(x, y)[1]], camera: topDownCamera(133, cellPx, cx, cy) }));
    }
    const b = createGlyphBuilder('high');
    for (let k = 0; k < 600; k++) buildAll(b, { ...views[k % views.length]!.input, now });
    gc();
    gc();
    const before = process.memoryUsage().heapUsed;
    for (let k = 0; k < 3000; k++) buildAll(b, { ...views[k % views.length]!.input, now });
    gc();
    gc();
    const grew = process.memoryUsage().heapUsed - before;
    log(`3000 rebuilds: heap after collection changed by ${(grew / 1024).toFixed(1)} kB`);
    expect(grew).toBeLessThan(100 * 1024);
  });
});
