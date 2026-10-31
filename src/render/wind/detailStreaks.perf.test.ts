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
import { detailBytes, linesOf, makeDetailScenario, type DetailScenario } from './detailStreaks.testing';
import { buildAll, makeCamera, topDownCamera } from './glyphOracle.testing';
import { DETAIL_RELIEF as TUNED, type CrownSet, type DetailBuilder, type DetailInput, type DetailRelief } from './glyphTypes';

/** The tuned relief with no tree faded out: these pictures are seen from straight above, where the canopy's shader fades every tree out (and the crowns would not count). */
const DETAIL_RELIEF: DetailRelief = { ...TUNED, crowns: { ...TUNED.crowns, fadeSin: 1 } };
import { hash01 } from '../fields';
import type { FuelMap } from '../../core/types';

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
  it('the cold start reads the clock after every line in the first two rebuilds, every 4 in the next two (16 later): a slice cannot run past its budget by more than that, counted on a fake clock', () => {
    const sc = heavy();
    const b = createDetailBuilder('high');
    let reads = 0;
    const clock = (): number => ++reads; // one fake millisecond a read
    let worstCold = 0;
    let worstFirst = 0;
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
        // Every clock read lets at most `interval` lines through: 1 while the builder is cold (its first two rebuilds), 4 while it warms up, 16 after its fourth rebuild.
        const interval = r <= 2 ? 1 : r <= 4 ? 4 : 16;
        expect(linesInSlice, `rebuild ${r}, slice ${slicesOfThis}: ${linesInSlice} lines for ${readsInSlice} clock reads`).toBeLessThanOrEqual(interval * readsInSlice);
        if (r <= 2) worstFirst = Math.max(worstFirst, linesInSlice);
        if (r <= 4) worstCold = Math.max(worstCold, linesInSlice);
        else worstWarm = Math.max(worstWarm, linesInSlice);
        if (done) break;
        if (slicesOfThis > 5000) throw new Error('no progress');
      }
      perRebuild.push(`#${r}: ${slicesOfThis} slices`);
      expect(slicesOfThis, `rebuild ${r} is cut into slices of the clock, not run through`).toBeGreaterThan(1);
    }
    log(`cold start on a fake clock (1 ms a read, budget ${BUDGET_MS} ms): ${perRebuild.join('; ')}; most lines in one slice: ${worstFirst} in the first two rebuilds, ${worstCold} in the first four, ${worstWarm} warm`);
    expect(b.out.lines).toBeGreaterThan(600);
    expect(b.out.segments).toBeLessThanOrEqual(12000);
    expect(worstCold, 'a cold slice is a few clock intervals of 4 lines, not a whole rebuild').toBeLessThanOrEqual(4 * (BUDGET_MS + 2));
    // 0.7.0: the first two rebuilds read the clock after every line, so a slice there runs one line (one fake millisecond) past its budget at most.
    expect(worstFirst, 'a slice of the first two rebuilds stops within a line of its budget').toBeLessThanOrEqual(BUDGET_MS + 2);
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

// ───────────────────────── the relief (0.7.0) ─────────────────────────

/** `n` trees of 28 to 42 m over an area `w` x `h` m about the origin, as one set. */
function forestOf(n: number, w: number, h: number): CrownSet {
  const position = new Float32Array(3 * n);
  const size = new Float32Array(2 * n);
  for (let i = 0; i < n; i++) {
    position.set([(hash01(i, 9, 1) - 0.5) * w, (hash01(i, 9, 2) - 0.5) * h, 0], 3 * i);
    size.set([28 + hash01(i, 9, 3) * 14, 8 + hash01(i, 9, 4) * 6], 2 * i);
  }
  return { group: 0, count: n, position, size };
}
const canopyOf = (sc: DetailScenario): FuelMap => {
  const g = sc.grid;
  const n = g.nx * g.ny;
  return { grid: g, canopyHeight: new Float32Array(n).fill(24), canopyCover: new Float32Array(n).fill(1) } as unknown as FuelMap;
};
const bumpy = (x: number, y: number): number => 400 + 6 * Math.sin(x / 7) * Math.cos(y / 9) + 0.15 * x + 40 * Math.sin(x / 90);
/** The High cap on a tablet screen at 300 px a model cell (0.44 m a pixel: crowns count), a canopy, 700 crowns on the screen and a plume, over rolling ground (a ridge slide and lee sites). */
const relieved = (): DetailScenario => {
  const sc = makeDetailScenario({ field: swirl, camera: topDownCamera(133, 300, 0, 0, BIG, 800), cap: { glyphs: 2000, segments: 12000 }, ground: bumpy, groundCell: 10 });
  const input: DetailInput = { ...sc.input, relief: DETAIL_RELIEF, canopy: canopyOf(sc), crowns: [forestOf(700, 1100, 620)], plumes: [{ x: -200, y: 0, radiusM: 60, strength: 1 }] };
  return { ...sc, input };
};

/** Whole rebuilds of two inputs, interleaved (so that whatever else the machine is doing is shared), after a warm-up: the medians (ms). */
function compare(plain: DetailInput, withRelief: DetailInput, rounds: number): { plain: number; relief: number; b: DetailBuilder } {
  const a = createDetailBuilder('high');
  const b = createDetailBuilder('high');
  for (let r = 0; r < 60; r++) {
    buildAll(a, { ...plain, now });
    buildAll(b, { ...withRelief, now });
  }
  const ta: number[] = [];
  const tb: number[] = [];
  for (let r = 0; r < rounds; r++) {
    let t0 = now();
    buildAll(a, { ...plain, now });
    ta.push(now() - t0);
    t0 = now();
    buildAll(b, { ...withRelief, now });
    tb.push(now() - t0);
  }
  return { plain: median(ta), relief: median(tb), b };
}

describe('the relief costs', () => {
  it('a warm rebuild of the High cap with a canopy, 700 crowns, a plume and rolling ground costs under three times the rebuild without the relief (the contract: 2.4 to 7 ms), and its slices keep their budget', () => {
    const sc = relieved();
    const { relief: _r, canopy: _c, crowns: _k, plumes: _p, ...plain } = sc.input;
    const c = compare(plain, sc.input, 120);
    log(`relief, High cap: ${c.b.out.lines} lines, ${c.b.out.segments} segments, ${c.b.out.blocked} seeds not drawn: whole rebuild median ${c.relief.toFixed(2)} ms against ${c.plain.toFixed(2)} ms without the relief (x${(c.relief / c.plain).toFixed(2)})`);
    expect(c.b.out.lines).toBeGreaterThan(300);
    // The crowns bend the picture (the same input without them is another one).
    const without = createDetailBuilder('high');
    buildAll(without, { ...sc.input, crowns: undefined, now });
    expect(c.b.out.lines, 'the crowns move seeds onto their rims and keep the lines').toBeGreaterThan(0.9 * without.out.lines);
    expect(detailBytes(c.b.out).equals(detailBytes(without.out)), 'the crowns bend the lines').toBe(false);
    expect(c.relief / c.plain, 'a shared machine slows both: the ratio is what is pinned').toBeLessThan(3);
    expect(c.relief, 'and an order of magnitude over the contract is a slowdown, not a busy machine').toBeLessThan(30);
    const all: number[] = [];
    const b = createDetailBuilder('high');
    for (let r = 0; r < 60; r++) buildAll(b, { ...sc.input, now });
    for (let r = 0; r < 100; r++) all.push(...slices(b, sc));
    log(`relief, High cap slices of ${BUDGET_MS} ms: p95 ${quantile(all, 0.95).toFixed(2)} ms, max ${Math.max(...all).toFixed(2)} ms`);
    expect(quantile(all, 0.95)).toBeLessThan(BUDGET_MS * 3 + 1);
  });

  it('a phone picture with the relief (a canopy, 300 crowns, rolling ground) costs under four times the picture without it', () => {
    const sc = makeDetailScenario({ field: swirl, camera: topDownCamera(133, 1000, 0, 0, {}, 800), ground: bumpy, groundCell: 10 });
    const input: DetailInput = { ...sc.input, relief: DETAIL_RELIEF, canopy: canopyOf(sc), crowns: [forestOf(300, 55, 115)] };
    const c = compare(sc.input, input, 150);
    log(`relief, phone at the closest zoom: ${c.b.out.lines} lines, ${c.b.out.segments} segments: whole rebuild median ${c.relief.toFixed(2)} ms against ${c.plain.toFixed(2)} ms (x${(c.relief / c.plain).toFixed(2)})`);
    expect(c.b.out.lines).toBeGreaterThan(100);
    expect(c.relief / c.plain).toBeLessThan(4);
    expect(c.relief).toBeLessThan(20);
  });

  it('choosing the crowns reads the clock every 256 trees in the first two rebuilds, every 1,024 in the next two, and every 4,096 after: counted on a fake clock', () => {
    const sc = makeDetailScenario({ field: swirl, camera: topDownCamera(133, 300, 0, 0, {}, 0) });
    const trees = 60000;
    const input: DetailInput = { ...sc.input, relief: DETAIL_RELIEF, canopy: canopyOf(sc), crowns: [forestOf(trees, 3000, 3000)] };
    const b = createDetailBuilder('high');
    const reads: number[] = [];
    for (let r = 1; r <= 6; r++) {
      let n = 0;
      const clock = (): number => ++n * 1e-6; // a read costs a nanosecond: never past the budget, so a build is one slice
      b.begin({ ...input, now: clock });
      while (!b.step(1e9)) {
        /* one slice */
      }
      reads.push(n);
    }
    log(`crowns scan, ${trees} trees: clock reads per rebuild ${reads.join(', ')}`);
    expect(reads[0]! - reads[4]!, 'cold: 60,000 / 256 reads against 60,000 / 4,096').toBeGreaterThan(trees / 256 - trees / 4096 - 8);
    expect(reads[2]! - reads[4]!, 'warming: 60,000 / 1,024').toBeGreaterThan(trees / 1024 - trees / 4096 - 8);
    expect(reads[0]).toBe(reads[1]);
    expect(reads[2]).toBe(reads[3]);
    expect(reads[4]).toBe(reads[5]);
    expect(reads[4]!).toBeLessThan(reads[2]!);
  });

  it('passing over 60,000 placed trees (the whole forest of the app, almost all of it off the screen) costs under 2.5 ms warm over the same picture made from the few trees near it', () => {
    const sc = makeDetailScenario({ field: swirl, camera: topDownCamera(133, 300, 0, 0, {}, 0) });
    const all = forestOf(60000, 6000, 6000);
    // The same trees that are within 500 m of the middle, as a set of their own: the same crowns, none of the passing over.
    const keep: number[] = [];
    for (let i = 0; i < all.count; i++) if (Math.abs(all.position[3 * i]!) < 500 && Math.abs(all.position[3 * i + 1]!) < 500) keep.push(i);
    const near: CrownSet = { group: 0, count: keep.length, position: new Float32Array(3 * keep.length), size: new Float32Array(2 * keep.length) };
    keep.forEach((i, k) => {
      near.position.set(all.position.subarray(3 * i, 3 * i + 3), 3 * k);
      near.size.set(all.size.subarray(2 * i, 2 * i + 2), 2 * k);
    });
    expect(keep.length).toBeGreaterThan(300);
    const c = compare({ ...sc.input, relief: DETAIL_RELIEF, canopy: canopyOf(sc), crowns: [near] }, { ...sc.input, relief: DETAIL_RELIEF, canopy: canopyOf(sc), crowns: [all] }, 100);
    log(`60,000 trees: whole rebuild ${c.relief.toFixed(2)} ms against ${c.plain.toFixed(2)} ms with only the ${keep.length} near ones`);
    expect(c.relief - c.plain).toBeLessThan(2.5);
  });
});
