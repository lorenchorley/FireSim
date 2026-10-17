/**
 * A steady-state rebuild allocates under 1 kB, whether or not V8 inlines (spike S3, rule 1: a helper that takes or returns a double
 * is boxed, a heap number per call, unless TurboFan inlines it, which it declines to do on a busy machine or in a cold loop). This
 * file runs with inlining switched off, which makes the difference deterministic, and in a file of its own so that no earlier test has
 * already optimised the builder (the pattern of atmosphereSampler.alloc.test.ts). The clock the builder is given costs what a
 * browser's `performance.now()` costs, a heap number per read (node's own `performance.now` allocates about 100 bytes a read, which
 * would measure node), and counts against the kilobyte.
 *
 * "Steady state" is after V8 has optimised the code, which a small rebuild reaches only after 100 to 200 of them (the set-up code in
 * `walk` runs in the interpreter before that, and costs about 1.2 kB a rebuild): each case runs until three windows in a row are
 * quiet, and the number of rebuilds that took is logged.
 */
import * as v8 from 'node:v8';
import * as vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createGlyphBuilder } from './flowGlyphs';
import { counterClock, makeScenario, topDownCamera, type ScenarioOptions } from './glyphOracle.testing';
import type { GlyphBuilder, GlyphInput } from './glyphTypes';

let gcFn: (() => void) | null = null;
function gc(): void {
  if (!gcFn) {
    v8.setFlagsFromString('--expose-gc');
    gcFn = vm.runInNewContext('gc') as () => void;
  }
  gcFn();
}

const log = (s: string): void => {
  process.stderr.write(`[glyph alloc, inlining off] ${s}\n`);
};

/** A clock that advances 0.37 ms a read and returns a new number each time, as `performance.now()` does in a browser. */
function browserClock(): () => number {
  let t = 0.5;
  return () => {
    t += 0.37;
    return t;
  };
}

const BIG_SCREEN = { cssW: 2560, cssH: 1440 };
const rotate = (x: number, y: number): [number, number] => [3 - 0.004 * y, 1 + 0.004 * x]; // has a calm point, so dots and short traces happen too
const CASES: [string, ScenarioOptions, number][] = [
  // About 1650 glyphs and 11,500 segments: the High cap of 12,000 segments is nearly full.
  ['L3, nearly the High cap (12,000 segments)', { cellPx: 50, field: rotate, camera: topDownCamera(133, 50, 0, 0, BIG_SCREEN) }, 1500],
  ['L4, long flow lines', { cellPx: 150, field: rotate, camera: topDownCamera(133, 150, 0, 0, BIG_SCREEN) }, 900],
  ['L4 on a phone', { cellPx: 150, field: () => [6, 8], camera: topDownCamera(133, 150) }, 100],
  ['L2, straight arrows', { cellPx: 20, field: rotate, camera: topDownCamera(133, 20, 0, 0, BIG_SCREEN) }, 400],
  ['L1, straight arrows', { cellPx: 8, field: rotate, camera: topDownCamera(133, 8, 0, 0, BIG_SCREEN) }, 25],
  ['calm dots', { cellPx: 50, field: () => [0.1, 0], camera: topDownCamera(133, 50, 0, 0, BIG_SCREEN) }, 1500],
];

/** Bytes per rebuild over a window of rebuilds, and the rebuild of the given builder and input. */
function windows(rebuild: () => void, count: number, size: number): number[] {
  const per: number[] = [];
  for (let w = 0; w < count; w++) {
    const a0 = process.memoryUsage().heapUsed;
    for (let k = 0; k < size; k++) rebuild();
    per.push((process.memoryUsage().heapUsed - a0) / size);
  }
  return per;
}

/** Rebuilds until the code has settled: three quiet windows of 20 in a row (at most 1200 rebuilds). */
function settle(rebuild: () => void): number {
  let quiet = 0;
  let done = 0;
  while (quiet < 3 && done < 1200) {
    const w = windows(rebuild, 1, 20)[0]!;
    done += 20;
    quiet = w < 800 ? quiet + 1 : 0;
  }
  return done;
}

function makeRebuild(b: GlyphBuilder, input: GlyphInput): () => void {
  return () => {
    b.begin(input);
    while (!b.step(3.4)) {
      /* the slices of one rebuild */
    }
  };
}

describe('a steady rebuild allocates under 1 kB', () => {
  it('with TurboFan inlining off, begin and every step of a sliced rebuild, for every level and a calm field', () => {
    v8.setFlagsFromString('--no-turbo-inlining');
    try {
      const lines: string[] = [];
      for (const [name, opts, minGlyphs] of CASES) {
        const sc = makeScenario({ ...opts, cap: { glyphs: 2000, segments: 12000 } });
        const b = createGlyphBuilder('high');
        const rebuild = makeRebuild(b, { ...sc.input, now: browserClock() });
        const settled = settle(rebuild);
        expect(b.out.glyphs, name).toBeGreaterThanOrEqual(minGlyphs);
        gc();
        gc();
        const per = windows(rebuild, 21, 20).sort((x, y) => x - y);
        const median = per[per.length >> 1]!;
        lines.push(`${name}: ${b.out.glyphs} glyphs, ${b.out.segments} segments; settled after ${settled} rebuilds; ${median.toFixed(0)} B per rebuild (best ${per[0]!.toFixed(0)}, worst ${per[per.length - 1]!.toFixed(0)})`);
        expect(median, name).toBeLessThan(1024);
      }
      for (const line of lines) log(line);
    } finally {
      v8.setFlagsFromString('--turbo-inlining');
    }
  });

  it('the builder itself is tiny: with a clock that returns a whole number a rebuild allocates under 256 bytes', () => {
    v8.setFlagsFromString('--no-turbo-inlining');
    try {
      const sc = makeScenario({ cellPx: 50, field: rotate, camera: topDownCamera(133, 50, 0, 0, BIG_SCREEN) });
      const clock = counterClock(0);
      const b = createGlyphBuilder('high');
      const rebuild = makeRebuild(b, { ...sc.input, now: clock.now });
      settle(rebuild);
      gc();
      gc();
      const per = windows(rebuild, 21, 20).sort((x, y) => x - y);
      log(`whole-number clock: ${per[per.length >> 1]!.toFixed(0)} B per rebuild`);
      expect(per[per.length >> 1]!).toBeLessThan(256);
    } finally {
      v8.setFlagsFromString('--turbo-inlining');
    }
  });
});
