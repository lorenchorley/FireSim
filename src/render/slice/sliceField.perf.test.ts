/**
 * What one slice update costs and allocates (plan 8.4 and 11): the whole update the scene runs (resolve the line, the four
 * preset statuses, sample the lattice, the model's cells) at a 90 x 50 lattice on the standard tier's 45 x 45 x 20 model, which
 * the plan budgets at 8 ms p95; and that a steady stream of updates allocates only its small result objects, so the heap stays
 * flat. Timings go to stderr like the `[atmos perf]` lines; the assertions are the plan's own budget, which a shared machine
 * will not threaten (the figure measured on the build machine is about a tenth of it).
 */
import * as v8 from 'node:v8';
import * as vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { makeGridSpec } from '../../core/grid';
import { AtmosphereSampler, type SectionLine } from '../atmosphereSampler';
import { sampleSlice } from './sliceField';
import { createSliceUpdater } from './sliceUpdater';
import { makeAirView, makeResolveContext } from './testing';
import type { SliceInputs } from './types';

const log = (s: string): void => {
  process.stderr.write(`[slice perf] ${s}\n`);
};

const ORIGIN = { lat: -33.7, lon: 150.3 };
const ridge = (x: number, y: number): number => 600 + 500 * Math.exp(-((x / 900) ** 2)) + 150 * Math.sin(y / 700);
const terrain = { heightAt: ridge };

/** A model of `n` x `n` columns `cell` metres apart with `nz` levels, fields that vary in all three directions. */
function model(n: number, cell: number, nz: number, kind: 'prognostic' | 'diagnosed' = 'prognostic') {
  const grid = makeGridSpec(ORIGIN, n * cell, cell);
  const view = makeAirView({
    grid,
    nz,
    kind,
    baseM: 500,
    topM: 3000,
    groundAt: (x, y) => ridge(x, y) - 20,
    u: (x, _y, z) => 6 + 0.004 * (z - 500) + 2 * Math.sin(x / 900),
    v: (_x, y, z) => 1 + 0.001 * (z - 500) + Math.cos(y / 800),
    w: (x, _y, z) => 0.5 * Math.sin(x / 600 + z / 400),
    theta: kind === 'prognostic' ? (x, _y, z) => 0.002 * x + 0.001 * (z - 500) : null,
    smoke: kind === 'prognostic' ? (_x, y) => Math.max(0, 2 - y / 1000) : null,
  });
  return { grid, view };
}

function inputs(sampler: AtmosphereSampler, grid: ReturnType<typeof model>['grid'], a: [number, number], b: [number, number]): SliceInputs {
  return {
    line: { azimuth: 0, centre: [0, 0], a, b },
    ctx: makeResolveContext({ grid, heightAt: ridge, fire: [200, 100], windFromDeg: 280, user: [-1500, 200] }),
    sampler,
    terrain,
    shownTime: 0,
  };
}

const quantile = (xs: number[], q: number): number => {
  const s = [...xs].sort((p, r) => p - r);
  return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]!;
};

describe('slice update cost', () => {
  for (const [name, n, cell, nz, kind] of [
    ['standard tier, 6 km (45 x 45 x 20, 133 m)', 45, 133, 20, 'prognostic'],
    ['high tier, 6 km (60 x 60 x 24, 100 m)', 60, 100, 24, 'prognostic'],
    ['fast tier, 6 km (45 x 45 x 20, diagnosed)', 45, 133, 20, 'diagnosed'],
  ] as const) {
    it(`${name}: one update at a 90 x 50 lattice, p95 within the plan’s 8 ms`, () => {
      const { grid, view } = model(n, cell, nz, kind);
      const sampler = new AtmosphereSampler(view, 0, null);
      const half = ((n - 1) * cell) / 2;
      const inp = inputs(sampler, grid, [-half + 1, -half * 0.4], [half - 1, half * 0.5]); // nearly the whole 6 km
      const updater = createSliceUpdater();
      // The lattice the plan budgets: 90 columns, 50 rows. The updater picks the size itself (about that), so the timed spec is the updater's.
      const probe = updater.request(inp, 0, true)!;
      expect(probe.data).not.toBeNull();
      log(`${name}: updater lattice ${probe.data!.columns} x ${probe.data!.rows}, ${probe.data!.cells!.count} model columns crossed`);
      // Warm up so V8 has optimised the loops, then time.
      for (let i = 0; i < 60; i++) updater.request(inp, 1000 + i, true);
      const ms: number[] = [];
      let t = 5000;
      for (let i = 0; i < 400; i++) {
        const t0 = performance.now();
        updater.request(inp, (t += 300), true);
        ms.push(performance.now() - t0);
      }
      const p50 = quantile(ms, 0.5);
      const p95 = quantile(ms, 0.95);
      log(`${name}: whole update (resolve, 4 preset statuses, sample, cells): median ${p50.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms, max ${Math.max(...ms).toFixed(2)} ms over ${ms.length} updates`);
      expect(p95).toBeLessThan(8);

      // The sampling alone at exactly 90 x 50.
      const line: SectionLine = probe.resolved.line!;
      const spec = { line, shownTime: 0, columns: 90, rows: 50 };
      let out = sampleSlice(sampler, terrain, spec)!;
      for (let i = 0; i < 60; i++) out = sampleSlice(sampler, terrain, spec, out)!;
      const s: number[] = [];
      for (let i = 0; i < 400; i++) {
        const t0 = performance.now();
        sampleSlice(sampler, terrain, spec, out);
        s.push(performance.now() - t0);
      }
      log(`${name}: sampleSlice alone at 90 x 50: median ${quantile(s, 0.5).toFixed(2)} ms, p95 ${quantile(s, 0.95).toFixed(2)} ms`);
      expect(quantile(s, 0.95)).toBeLessThan(8);
    });
  }
});

let gcFn: (() => void) | null = null;
function gc(): void {
  if (!gcFn) {
    v8.setFlagsFromString('--expose-gc');
    gcFn = vm.runInNewContext('gc') as () => void;
  }
  gcFn();
}

describe('slice update allocation', () => {
  const { grid, view } = model(45, 133, 20);
  const sampler = new AtmosphereSampler(view, 0, null);
  const inp = inputs(sampler, grid, [-2800, -900], [2900, 1400]);
  const spec = { line: createSliceUpdater().request(inp, 0, true)!.resolved.line!, shownTime: 0 };

  /**
   * Bytes allocated per call of `f`: the median of the windows that grew the heap. A window that shrinks it is a collection (or the
   * sweeper finishing the one before) freeing old garbage, which says nothing about `f`; if `f` allocates, every window grows.
   */
  function bytesPerCall(f: () => void, windows: number, calls: number): number {
    for (let i = 0; i < 300; i++) f(); // warm up: unoptimised code boxes every double it computes
    gc();
    gc();
    const grew: number[] = [];
    for (let r = 0; r < windows; r++) {
      const a0 = process.memoryUsage().heapUsed;
      for (let i = 0; i < calls; i++) f();
      const d = process.memoryUsage().heapUsed - a0;
      if (d > 0) grew.push(d);
    }
    grew.sort((p, q) => p - q);
    return grew.length ? grew[grew.length >> 1]! / calls : 0;
  }

  it('sampleSlice into a reused SliceData allocates nothing: bytes per call, with a lattice of 5000 points', () => {
    const out = sampleSlice(sampler, terrain, spec)!;
    const bytes = bytesPerCall(() => sampleSlice(sampler, terrain, spec, out), 41, 100);
    log(`sampleSlice into a reused SliceData: ${bytes.toFixed(1)} bytes per call (a lattice of ${out.columns * out.rows} points and ${out.cells!.count} model columns)`);
    // A boxed double per lattice point alone would be 16 bytes x 5000 = 80 kB per call. The windows' own heap reads add a few bytes.
    expect(bytes).toBeLessThan(50);
  });

  it('one whole update (resolve, four preset statuses, sample) allocates only its small result objects', () => {
    const updater = createSliceUpdater();
    let t = 0;
    const bytes = bytesPerCall(() => updater.request(inp, (t += 300), true), 41, 100);
    log(`updater.request: ${bytes.toFixed(0)} bytes per update (the result objects: SliceComputed, ResolvedSlice, the line, the preset statuses and their trial lines)`);
    // A few kB, none of it in proportion to the lattice (the arrays are reused: see the figure above); a per-point box would be 80 kB.
    expect(bytes).toBeLessThan(16 * 1024);
  });

  it('a stream of updates keeps the heap flat: 3000 updates leave no retained growth after a collection', () => {
    const updater = createSliceUpdater();
    for (let i = 0; i < 300; i++) updater.request(inp, i * 300, true);
    gc();
    gc();
    const before = process.memoryUsage().heapUsed;
    let t = 1e6;
    for (let i = 0; i < 3000; i++) {
      // A mix of the three things that happen: a new snapshot (pending then polled), an edit, and a line that moves a little.
      const moved: SliceInputs = i % 7 === 0 ? { ...inp, line: { azimuth: 0, centre: [0, 0], a: [-2800, -900 + (i % 5)], b: [2900, 1400] } } : inp;
      updater.request(moved, (t += 100), i % 3 === 0);
      updater.poll((t += 200));
    }
    gc();
    gc();
    const grew = process.memoryUsage().heapUsed - before;
    log(`updater, 3000 updates: heap after collection changed by ${(grew / 1024).toFixed(1)} kB`);
    // The arrays are reused, so nothing is retained; a few kB of noise (the heap reading itself) is allowed, a leak would be megabytes.
    expect(grew).toBeLessThan(300 * 1024);
  });
});
