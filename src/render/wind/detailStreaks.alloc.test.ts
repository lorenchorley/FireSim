/**
 * A steady-state rebuild of the detailed streaks allocates under 1 kB, whether or not V8 inlines (the glyph spike's rule 1: a helper that takes
 * or returns a double is boxed, a heap number per call, unless TurboFan inlines it, which it declines to do on a busy machine or in a cold
 * loop). This file runs with inlining switched off, which makes the difference deterministic, and in a file of its own so that no earlier
 * test has already optimised the builder (the pattern of `flowGlyphs.alloc.test.ts`). The clock the builder is given costs what a browser's
 * `performance.now()` costs, a heap number per read, and counts against the kilobyte.
 *
 * "Steady state" is after V8 has optimised the code, which a small rebuild reaches only after 100 to 200 of them: each case runs until
 * three windows in a row are quiet, and the number of rebuilds that took is logged.
 */
import * as v8 from 'node:v8';
import * as vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createDetailBuilder } from './detailStreaks';
import { makeDetailScenario, type DetailScenario, type DetailScenarioOptions } from './detailStreaks.testing';
import { hash01 } from '../fields';
import { counterClock, topDownCamera } from './glyphOracle.testing';
import { DETAIL_RELIEF, type CrownSet, type DetailBuilder, type DetailInput } from './glyphTypes';
import type { FuelMap } from '../../core/types';

let gcFn: (() => void) | null = null;
function gc(): void {
  if (!gcFn) {
    v8.setFlagsFromString('--expose-gc');
    gcFn = vm.runInNewContext('gc') as () => void;
  }
  gcFn();
}

const log = (s: string): void => {
  process.stderr.write(`[detail alloc, inlining off] ${s}\n`);
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
const rotate = (x: number, y: number): [number, number] => [3 - 0.004 * y, 1 + 0.004 * x]; // has a calm point, so calm stops and short lines happen too
const swirl = (x: number, y: number): [number, number] => [5 - 0.004 * y, 2 + 0.004 * x];
const bumpy = (x: number, y: number): number => 400 + 6 * Math.sin(x / 7) * Math.cos(y / 9) + 0.15 * x; // rough and sloping: every ground term is exercised
const wall = (x: number): number => (x < -20 ? 300 : x > 20 ? 460 : 300 + 4 * (x + 20));
/** What the relief is given (0.7.0): `forest` a canopy, 120 crowns of which many are proud, and a plume; `ridge` nothing but the 10 m ground (the ridge slide and the lee sites). */
type ReliefKind = 'forest' | 'ridge';
function reliefInput(sc: DetailScenario, kind: ReliefKind): DetailInput {
  const g = sc.grid;
  const n = g.nx * g.ny;
  const input: DetailInput = { ...sc.input, relief: DETAIL_RELIEF };
  if (kind === 'forest') {
    input.canopy = { grid: g, canopyHeight: new Float32Array(n).fill(24), canopyCover: new Float32Array(n).fill(1) } as unknown as FuelMap;
    const count = 120;
    const position = new Float32Array(3 * count);
    const size = new Float32Array(2 * count);
    for (let i = 0; i < count; i++) {
      position.set([(hash01(i, 1, 1) - 0.5) * 90, (hash01(i, 1, 2) - 0.5) * 180, 0], 3 * i);
      size.set([28 + hash01(i, 1, 3) * 14, 8 + hash01(i, 1, 4) * 6], 2 * i);
    }
    input.crowns = [{ group: 0, count, position, size } as CrownSet];
    input.plumes = [{ x: -30, y: 0, radiusM: 15, strength: 1 }];
  }
  return input;
}
const CASES: [string, DetailScenarioOptions, number, ReliefKind?][] = [
  // About 840 lines and 11,400 segments: the High cap of 12,000 segments is nearly full.
  ['a tablet at the first level-4 zoom, nearly the High cap (12,000 segments)', { field: swirl, camera: topDownCamera(133, 104, 0, 0, BIG_SCREEN) }, 600],
  ['a tablet with a calm point', { field: rotate, camera: topDownCamera(133, 104, 0, 0, BIG_SCREEN) }, 600],
  ['a phone', { field: swirl, cellPx: 150 }, 80],
  ['a phone at the closest zoom', { field: swirl, cellPx: 3000 }, 20],
  ['rough ground and a slope (the 10 m ground terms)', { field: swirl, cellPx: 150, ground: bumpy, groundCell: 5, camera: topDownCamera(133, 150, 0, 0, {}, 800) }, 40],
  ['a wall (lines cut at its foot)', { field: () => [8, 0], cellPx: 150, ground: wall, groundCell: 10, camera: topDownCamera(133, 150, 0, 0, { near: 30 }, 460) }, 40],
  ['calm', { field: () => [0.1, 0], cellPx: 150 }, 0],
  // 0.7.0: the relief (obstacle scan, grid, field, eddy sites, ridge slide, canopy reads) allocates nothing either.
  ['the relief in a forest at 1000 px a cell: a canopy, 120 crowns, their wakes and a plume', { field: swirl, cellPx: 1000, camera: topDownCamera(133, 1000, 0, 0, {}, 0) }, 100, 'forest'],
  ['the relief on rough ground and a slope (the ridge slide, the lee sites)', { field: swirl, cellPx: 300, ground: bumpy, groundCell: 5, camera: topDownCamera(133, 300, 0, 0, {}, 800) }, 100, 'ridge'],
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

function makeRebuild(b: DetailBuilder, input: DetailInput): () => void {
  return () => {
    b.begin(input);
    while (!b.step(3.4)) {
      /* the slices of one rebuild */
    }
  };
}

describe('a steady rebuild of the detailed streaks allocates under 1 kB', () => {
  it('with TurboFan inlining off, begin and every step of a sliced rebuild, for a tablet, a phone, rough ground, a wall and a calm field', () => {
    v8.setFlagsFromString('--no-turbo-inlining');
    try {
      const lines: string[] = [];
      for (const [name, opts, minLines, relief] of CASES) {
        const sc = makeDetailScenario({ ...opts, cap: { glyphs: 2000, segments: 12000 } });
        const b = createDetailBuilder('high');
        const rebuild = makeRebuild(b, { ...(relief ? reliefInput(sc, relief) : sc.input), now: browserClock() });
        const settled = settle(rebuild);
        expect(b.out.lines, name).toBeGreaterThanOrEqual(minLines);
        gc();
        gc();
        const per = windows(rebuild, 21, 20).sort((x, y) => x - y);
        const median = per[per.length >> 1]!;
        lines.push(`${name}: ${b.out.lines} lines, ${b.out.segments} segments; settled after ${settled} rebuilds; ${median.toFixed(0)} B per rebuild (best ${per[0]!.toFixed(0)}, worst ${per[per.length - 1]!.toFixed(0)})`);
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
      const sc = makeDetailScenario({ field: swirl, camera: topDownCamera(133, 104, 0, 0, BIG_SCREEN) });
      const clock = counterClock(0);
      const b = createDetailBuilder('high');
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
