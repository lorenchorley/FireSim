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

/** The High cap: 2000 glyphs of 4-step shafts and heads, 12,000 segments (a tablet screen at L3, a model cell of 38 px: the lattice is at its densest, 128 m on 36.6 px). */
const heavy = (): Scenario => makeScenario({ cellPx: 38, field: rotate, camera: topDownCamera(133, 38, 0, 0, BIG), cap: { glyphs: 2000, segments: 12000 } });

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
  // The cold start is two tests. What it protects is that a slice of the first rebuilds of a builder (code still in the interpreter, 4 to 7
  // times slower) stops near its budget, because the clock is read every 8 glyphs there (every 32 later). That rule is counted on a fake
  // clock, so it cannot fail because the machine is busy; the wall clock is only asked about the typical slice (the median), and the worst
  // is logged: one descheduled slice is no news (it took 66.7 ms against a limit of 43.4 on a loaded run), and the cold rebuilds are only
  // about nine slices in all, so no percentile above the median is steadier than the worst.

  it('the cold start reads the clock every 8 glyphs in the first four rebuilds: a slice cannot run past its budget by more than that, counted on a fake clock', () => {
    const sc = heavy();
    const b = createGlyphBuilder('high');
    let reads = 0;
    const clock = (): number => ++reads; // one fake millisecond a read
    let worstCold = 0;
    let worstWarm = 0;
    const perRebuild: string[] = [];
    for (let r = 1; r <= 8; r++) {
      b.begin({ ...sc.input, now: clock });
      let slicesOfThis = 0;
      let glyphsBefore = 0;
      for (;;) {
        const reads0 = reads;
        const done = b.step(BUDGET_MS);
        slicesOfThis++;
        const readsInSlice = reads - reads0;
        const glyphsInSlice = b.out.glyphs - glyphsBefore;
        glyphsBefore = b.out.glyphs;
        // Every clock read lets at most `interval` glyphs through: 8 while the builder is cold, 32 after its fourth rebuild.
        const interval = r <= 4 ? 8 : 32;
        expect(glyphsInSlice, `rebuild ${r}, slice ${slicesOfThis}: ${glyphsInSlice} glyphs for ${readsInSlice} clock reads`).toBeLessThanOrEqual(interval * readsInSlice);
        if (r <= 4) worstCold = Math.max(worstCold, glyphsInSlice);
        else worstWarm = Math.max(worstWarm, glyphsInSlice);
        if (done) break;
        if (slicesOfThis > 5000) throw new Error('no progress');
      }
      perRebuild.push(`#${r}: ${slicesOfThis} slices`);
      expect(slicesOfThis, `rebuild ${r} is cut into slices of the clock, not run through`).toBeGreaterThan(1);
    }
    log(`cold start on a fake clock (1 ms a read, budget ${BUDGET_MS} ms): ${perRebuild.join('; ')}; most glyphs in one slice: ${worstCold} cold, ${worstWarm} warm`);
    expect(b.out.glyphs).toBeGreaterThan(1800); // thinned to 95 % of the cap, so the hard stop is rarely reached
    expect(b.out.glyphs).toBeLessThanOrEqual(2000);
    expect(worstCold, 'a cold slice is a few clock intervals of 8 glyphs, not a whole rebuild').toBeLessThanOrEqual(8 * (BUDGET_MS + 2));
  });

  it('the cold start on the wall clock: the typical slice of the first six rebuilds is near its budget (the worst is only reported)', () => {
    const sc = heavy();
    const b = createGlyphBuilder('high');
    const firsts: string[] = [];
    const all: number[] = [];
    for (let r = 0; r < 6; r++) {
      const t0 = now();
      const s = slices(b, sc);
      const total = now() - t0;
      all.push(...s);
      firsts.push(`#${r + 1}: ${total.toFixed(1)} ms in ${s.length} slices (longest ${Math.max(...s).toFixed(1)} ms)`);
    }
    log(`cold start, ${b.out.glyphs} glyphs, ${b.out.segments} segments: ${firsts.join('; ')}; all ${all.length} slices: median ${median(all).toFixed(2)} ms, worst ${Math.max(...all).toFixed(1)} ms`);
    expect(b.out.glyphs).toBeGreaterThan(1800);
    expect(b.out.glyphs).toBeLessThanOrEqual(2000);
    // The median does not move when a busy machine takes one slice away for a while; slices that do not stop on the clock would move it.
    expect(median(all)).toBeLessThan(BUDGET_MS + 10);
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
    expect(quantile(all, 0.95)).toBeLessThan(BUDGET_MS * 3 + 1); // on a shared machine a slice can be preempted: this catches slices that do not stop on the clock
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
