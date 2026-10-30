/**
 * What a rebuild of the detailed streaks costs (contract 5, perf rows): the High tier's cap in slices of 3.4 ms (the phone's 8 ms divided
 * by the glyph spike's factor of 2.35), the cold start of a fresh builder counted on a fake clock (as `flowGlyphs.perf.test.ts` does), the
 * warm rebuild on the wall clock, the walk of a big box in an orbit view, and a stream of 3,000 rebuilds that leaves the heap flat.
 * Timings go to stderr like the `[glyph perf]` lines. The assertions allow for a machine that other jobs share (the figures are a few
 * times under them on a quiet one): they catch a slowdown by an order of magnitude and the rule the slicing keeps, not the milliseconds.
 * The contract's own figures were estimates ("a High-cap build, median under 4 ms and slice p95 under 8 ms", "about 1,900 lines x 12
 * segments", which the 12,000-segment cap does not allow: a full High build is about 840 lines of 14 segments). The limits here are set
 * from the first runs (a quiet machine measured 2 ms for a whole High-cap rebuild and a slice p95 of 3 ms), with the figures in the log lines.
 */
import * as v8 from 'node:v8';
import * as vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createDetailBuilder } from './detailStreaks';
import { linesOf, makeDetailScenario, type DetailScenario } from './detailStreaks.testing';
import { buildAll, makeCamera, topDownCamera } from './glyphOracle.testing';
import type { DetailBuilder } from './glyphTypes';

const log = (s: string): void => {
  process.stderr.write(`[detail perf] ${s}\n`);
};
const BUDGET_MS = 3.4;
const BIG = { cssW: 2560, cssH: 1440 };
/** Wind of 5 to 10 m/s turning round the middle: lines of 90 to 160 px, 10 to 18 segments. */
const swirl = (x: number, y: number): [number, number] => [5 - 0.004 * y, 2 + 0.004 * x];
const quantile = (xs: number[], q: number): number => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(q * xs.length) - 1)]!;
const median = (xs: number[]): number => quantile(xs, 0.5);
const now = (): number => performance.now();

/** The High cap, full: a tablet screen at the first level-4 zoom (a model cell of 104 px: the lattice is at its densest), 12,000 segments and 2,000 lines to give. */
const heavy = (): DetailScenario => makeDetailScenario({ field: swirl, camera: topDownCamera(133, 104, 0, 0, BIG), cap: { glyphs: 2000, segments: 12000 } });
/** What a phone shows: 412 x 868 at a model cell of 150 px. */
const phone = (): DetailScenario => makeDetailScenario({ field: swirl, cellPx: 150 });

/** One rebuild cut into slices of `BUDGET_MS`; each slice's duration (ms). */
function slices(b: DetailBuilder, sc: DetailScenario): number[] {
  const out: number[] = [];
  b.begin({ ...sc.input, now });
  for (;;) {
    const t0 = now();
    const done = b.step(BUDGET_MS);
    out.push(now() - t0);
    if (done) return out;
  }
}

describe('detailed streaks rebuild cost', () => {
  it('the cold start reads the clock every 4 lines in the first four rebuilds (16 later): a slice cannot run past its budget by more than that, counted on a fake clock', () => {
    const sc = heavy();
    const b = createDetailBuilder('high');
    let reads = 0;
    const clock = (): number => ++reads; // one fake millisecond a read
    let worstCold = 0;
    let worstWarm = 0;
    const perRebuild: string[] = [];
    for (let r = 1; r <= 8; r++) {
      b.begin({ ...sc.input, now: clock });
      let slicesOfThis = 0;
      let linesBefore = 0;
      for (;;) {
        const reads0 = reads;
        const done = b.step(BUDGET_MS);
        slicesOfThis++;
        const readsInSlice = reads - reads0;
        const linesInSlice = b.out.lines - linesBefore;
        linesBefore = b.out.lines;
        // Every clock read lets at most `interval` lines through: 4 while the builder is cold, 16 after its fourth rebuild.
        const interval = r <= 4 ? 4 : 16;
        expect(linesInSlice, `rebuild ${r}, slice ${slicesOfThis}: ${linesInSlice} lines for ${readsInSlice} clock reads`).toBeLessThanOrEqual(interval * readsInSlice);
        if (r <= 4) worstCold = Math.max(worstCold, linesInSlice);
        else worstWarm = Math.max(worstWarm, linesInSlice);
        if (done) break;
        if (slicesOfThis > 5000) throw new Error('no progress');
      }
      perRebuild.push(`#${r}: ${slicesOfThis} slices`);
      expect(slicesOfThis, `rebuild ${r} is cut into slices of the clock, not run through`).toBeGreaterThan(1);
    }
    log(`cold start on a fake clock (1 ms a read, budget ${BUDGET_MS} ms): ${perRebuild.join('; ')}; most lines in one slice: ${worstCold} cold, ${worstWarm} warm`);
    expect(b.out.lines).toBeGreaterThan(600);
    expect(b.out.segments).toBeLessThanOrEqual(12000);
    expect(worstCold, 'a cold slice is a few clock intervals of 4 lines, not a whole rebuild').toBeLessThanOrEqual(4 * (BUDGET_MS + 2));
  });

  it('the cold start on the wall clock: the typical slice of the first six rebuilds is near its budget (the worst is only reported)', () => {
    const sc = heavy();
    const b = createDetailBuilder('high');
    const firsts: string[] = [];
    const all: number[] = [];
    for (let r = 0; r < 6; r++) {
      const t0 = now();
      const s = slices(b, sc);
      const total = now() - t0;
      all.push(...s);
      firsts.push(`#${r + 1}: ${total.toFixed(1)} ms in ${s.length} slices (longest ${Math.max(...s).toFixed(1)} ms)`);
    }
    log(`cold start, ${b.out.lines} lines, ${b.out.segments} segments: ${firsts.join('; ')}; all ${all.length} slices: median ${median(all).toFixed(2)} ms, worst ${Math.max(...all).toFixed(1)} ms`);
    expect(b.out.lines).toBeGreaterThan(600);
    // The median does not move when a busy machine takes one slice away for a while; slices that do not stop on the clock would move it.
    expect(median(all)).toBeLessThan(BUDGET_MS + 10);
  });

  it('a warm rebuild of the High cap: a few slices of 3.4 ms, the slice p95 within its budget plus one check interval', () => {
    const sc = heavy();
    const b = createDetailBuilder('high');
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
    // Unsliced, for the comparison with the contract's estimate.
    const whole: number[] = [];
    for (let r = 0; r < 120; r++) {
      const t0 = now();
      buildAll(b, { ...sc.input, now });
      whole.push(now() - t0);
    }
    const perSegment = (median(whole) * 1000) / b.out.segments;
    log(
      `${b.out.lines} lines, ${b.out.segments} segments: whole rebuild median ${median(whole).toFixed(2)} ms (p95 ${quantile(whole, 0.95).toFixed(2)}); in slices of ${BUDGET_MS} ms: median ${median(counts)} slices (max ${Math.max(...counts)}), ` +
        `slice p95 ${quantile(all, 0.95).toFixed(2)} ms, max ${Math.max(...all).toFixed(2)} ms; ${perSegment.toFixed(3)} us per segment`,
    );
    expect(b.out.lines).toBeGreaterThan(600);
    expect(b.out.segments).toBeGreaterThan(8000);
    expect(median(counts)).toBeLessThanOrEqual(4);
    expect(quantile(all, 0.95)).toBeLessThan(BUDGET_MS * 3 + 1); // on a shared machine a slice can be preempted: this catches slices that do not stop on the clock
    expect(median(whole)).toBeLessThan(10); // measured about 2 ms here (the contract's estimate was 4); five times that is a slowdown, not a busy machine
  });

  it('a phone-size rebuild (a model cell of 150 px: about 100 lines) is a fraction of the High cap', () => {
    const sc = phone();
    const b = createDetailBuilder('high');
    for (let r = 0; r < 60; r++) buildAll(b, { ...sc.input, now });
    const whole: number[] = [];
    for (let r = 0; r < 120; r++) {
      const t0 = now();
      buildAll(b, { ...sc.input, now });
      whole.push(now() - t0);
    }
    log(`phone: ${b.out.lines} lines, ${b.out.segments} segments: whole rebuild median ${median(whole).toFixed(2)} ms (p95 ${quantile(whole, 0.95).toFixed(2)})`);
    expect(b.out.lines).toBeGreaterThan(50);
    expect(median(whole)).toBeLessThan(3); // measured about 0.2 ms
  });

  it('the lattice walk of an orbit view that sees the whole 12 km stays in a few slices', () => {
    // Facing north from 150 m up and 800 m back, the top of the screen near the horizon: the box is the whole domain at a 32 m lattice.
    const cam = makeCamera({ eye: [0, 150, 800], target: [0, 0, 0], ...BIG });
    const sc = makeDetailScenario({ n: 90, cell: 133, field: swirl, camera: cam, maxRangeM: 20000 });
    const b = createDetailBuilder('high');
    const cells = ((sc.input.box.x1 - sc.input.box.x0) / sc.plan.spacingM) * ((sc.input.box.y1 - sc.input.box.y0) / sc.plan.spacingM);
    for (let r = 0; r < 20; r++) buildAll(b, { ...sc.input, now });
    const t: number[] = [];
    const n: number[] = [];
    for (let r = 0; r < 20; r++) {
      const t0 = now();
      n.push(slices(b, sc).length);
      t.push(now() - t0);
    }
    log(`orbit, lattice ${sc.plan.spacingM} m, about ${Math.round(cells)} cells in the box: whole rebuild median ${median(t).toFixed(1)} ms in ${median(n)} slices; ${b.out.lines} lines`);
    expect(sc.plan.level).toBe(4);
    expect(b.out.lines).toBeGreaterThan(50);
    expect(median(t)).toBeLessThan(60); // measured about 7 ms
  });

  it('3,000 rebuilds of changing views leave the heap flat (under 40 kB after two collections)', () => {
    v8.setFlagsFromString('--expose-gc');
    const gc = vm.runInNewContext('gc') as () => void;
    const views: DetailScenario[] = [];
    for (const [cellPx, cx, cy] of [[150, 0, 0], [150, 900, -600], [400, -500, 700], [1500, 0, 0], [104, 300, 300], [2500, -1200, 400]] as const) {
      views.push(makeDetailScenario({ cellPx, field: (x, y) => [swirl(x, y)[0] + Math.sin(x / 300), swirl(x, y)[1]], camera: topDownCamera(133, cellPx, cx, cy) }));
    }
    const b = createDetailBuilder('high');
    for (let k = 0; k < 600; k++) buildAll(b, { ...views[k % views.length]!.input, now });
    gc();
    gc();
    const before = process.memoryUsage().heapUsed;
    for (let k = 0; k < 3000; k++) buildAll(b, { ...views[k % views.length]!.input, now });
    gc();
    gc();
    const grew = process.memoryUsage().heapUsed - before;
    log(`3000 rebuilds: heap after collection changed by ${(grew / 1024).toFixed(1)} kB; last build ${linesOf(b.out).length} lines`);
    expect(grew).toBeLessThan(40 * 1024); // 17 to 25 kB measured (the contract said 30): a leak of one small object a rebuild would be over it
  });
});
