/**
 * The speed test's kernels, clock and scoring (0.7.0, item C). The two kernels are FROZEN: the checksums below are what they compute from the fixed
 * inputs after 3 sweeps (K1) and 2 sweeps (K2), so any edit to a kernel fails here and has to come with a new SPEED_TEST_VERSION and a new reference.
 * Nothing in this file depends on how fast the machine is, except the one real run at the end, which only checks that the numbers are positive.
 */
import { describe, expect, it } from 'vitest';
import { runSpeedTest, scoreSpeedTest, SPEED_TEST_BUDGET_MS, SPEED_TEST_REFERENCE, SPEED_TEST_VERSION } from './speedTest';
import {
  COPY_FLOATS,
  COPY_PARTS,
  KernelTimer,
  lcg,
  makeCopyKernel,
  makeStencilKernel,
  SPEED_TEST_SEED,
  STENCIL_NX,
  STENCIL_NY,
  STENCIL_NZ,
  sweeps,
  TIME_MS,
  WARM_MS,
  type Kernel,
} from './speedTestKernels';

/** What the kernels computed when version 1 was frozen (2026-10-30). Change one only together with SPEED_TEST_VERSION. */
const FROZEN = { version: 1, stencilAfter3: 0x7d268009, copyAfter2: 0x1e84aad9 };

describe('the frozen kernels', () => {
  it('are version 1, with the numbers of the contract: a 45 x 45 x 20 grid, a 16 MiB copy, about two seconds', () => {
    expect(SPEED_TEST_VERSION).toBe(FROZEN.version);
    expect([STENCIL_NX, STENCIL_NY, STENCIL_NZ]).toEqual([45, 45, 20]);
    expect(STENCIL_NX * STENCIL_NY * STENCIL_NZ).toBe(40_500);
    expect(COPY_FLOATS * 4).toBe(16 * 1024 * 1024);
    expect(WARM_MS + TIME_MS).toBe(1000);
    expect(2 * (WARM_MS + TIME_MS)).toBe(SPEED_TEST_BUDGET_MS);
  });

  it('K1, the air stencil, gives the pinned checksum after 3 sweeps', () => {
    const k = makeStencilKernel();
    sweeps(k, 3);
    expect(k.checksum()).toBe(FROZEN.stencilAfter3);
  });

  it('K2, the memory copy, gives the pinned checksum after 2 sweeps', () => {
    const k = makeCopyKernel();
    sweeps(k, 2);
    expect(k.checksum()).toBe(FROZEN.copyAfter2);
  });

  it('start from the same state every time, and every sweep changes the state (a checksum that did not move would pin nothing)', () => {
    const a = makeStencilKernel();
    const b = makeStencilKernel();
    expect(a.checksum()).toBe(b.checksum());
    const at0 = a.checksum();
    sweeps(a, 1);
    expect(a.checksum()).not.toBe(at0);
    sweeps(b, 1);
    expect(b.checksum()).toBe(a.checksum());
    const c = makeCopyKernel();
    const c0 = c.checksum();
    sweeps(c, 1);
    expect(c.checksum()).not.toBe(c0);
  });

  it('K1 does what it says: a naive stencil and trilinear gather agree with it after 3 sweeps, every value stays in [0, 1] and nothing is NaN', () => {
    const nx = STENCIL_NX;
    const ny = STENCIL_NY;
    const nz = STENCIL_NZ;
    const n = nx * ny * nz;
    const rnd = lcg(SPEED_TEST_SEED);
    let a = new Float32Array(n);
    const u = new Float32Array(n);
    const v = new Float32Array(n);
    const w = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      a[i] = rnd();
      u[i] = 0.9 * (2 * rnd() - 1);
      v[i] = 0.9 * (2 * rnd() - 1);
      w[i] = 0.9 * (2 * rnd() - 1);
    }
    const at = (src: Float32Array, i: number, j: number, k: number): number => src[(k * ny + j) * nx + i]!;
    for (let sweep = 0; sweep < 3; sweep++) {
      const b = Float32Array.from(a);
      for (let k = 1; k < nz - 1; k++)
        for (let j = 1; j < ny - 1; j++)
          for (let i = 1; i < nx - 1; i++) {
            const c = (k * ny + j) * nx + i;
            const [x, y, z] = [i - u[c]!, j - v[c]!, k - w[c]!];
            const [i0, j0, k0] = [Math.floor(x), Math.floor(y), Math.floor(z)];
            const [fx, fy, fz] = [x - i0, y - j0, z - k0];
            let gathered = 0;
            for (const [di, dj, dk] of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]] as const) {
              gathered += (di ? fx : 1 - fx) * (dj ? fy : 1 - fy) * (dk ? fz : 1 - fz) * at(a, i0 + di, j0 + dj, k0 + dk);
            }
            const around = at(a, i - 1, j, k) + at(a, i + 1, j, k) + at(a, i, j - 1, k) + at(a, i, j + 1, k) + at(a, i, j, k - 1) + at(a, i, j, k + 1);
            b[c] = 0.88 * gathered + 0.02 * around;
          }
      a = b;
    }
    const k = makeStencilKernel();
    sweeps(k, 3);
    // (the oracle adds the eight corners in another order, so it differs from the kernel in the last float bits at most)
    const got = k.values();
    let worst = 0;
    for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(got[i]! - a[i]!));
    expect(worst).toBeLessThan(1e-5);
    expect(got.every((x) => Number.isFinite(x) && x >= 0 && x <= 1)).toBe(true);
    expect(new Set(got).size, 'the field is not flat: three sweeps do not mix it away').toBeGreaterThan(1000);
    expect(k.work).toBe((nx - 2) * (ny - 2) * (nz - 2));
    expect(k.parts).toBe(nz - 2);
  });

  it('K2 holds the input with the first float raised once a sweep: the pinned checksum is the checksum of that array', () => {
    const rnd = lcg(SPEED_TEST_SEED ^ 0x5bd1e995);
    const s = new Float32Array(COPY_FLOATS);
    for (let i = 0; i < COPY_FLOATS; i++) s[i] = rnd();
    s[0] = Math.fround(Math.fround(s[0]! + 1) + 1);
    const w = new Uint32Array(s.buffer);
    let h = 0x811c9dc5;
    for (let i = 0; i < w.length; i++) {
      h ^= w[i]!;
      h = Math.imul(h, 16777619) >>> 0;
    }
    expect(h).toBe(FROZEN.copyAfter2);
    const k = makeCopyKernel();
    expect(k.work).toBe(16 * 1024 * 1024);
    expect(k.parts).toBe(COPY_PARTS);
  });

  it('the generator is the fixed 32-bit LCG: the same seed gives the same numbers, in [0, 1)', () => {
    const a = lcg(1);
    const b = lcg(1);
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect(first[0]).toBeCloseTo((1664525 + 1013904223) / 4294967296, 12);
    for (const x of first) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

/** A kernel that takes `ms` of a fake clock per part and counts what it did. */
function fake(parts: number, work: number, clock: { t: number }, ms = 1): Kernel & { done: number; swept: number } {
  return {
    work,
    parts,
    done: 0,
    swept: 0,
    part() {
      clock.t += ms;
      this.done++;
    },
    end() {
      this.swept++;
    },
    values: () => new Float32Array(0),
    checksum: () => 0,
  };
}

describe('the clock that times a kernel', () => {
  it('warms for warmMs, then times whole sweeps for timeMs, and reports the work a second', () => {
    const clock = { t: 0 };
    const k = fake(4, 100, clock); // 4 ms a sweep
    const timer = new KernelTimer(k, 20, 40);
    expect(timer.rate()).toBe(0);
    expect(timer.step(() => clock.t)).toBe(true);
    expect(k.swept).toBe(5 + 10); // 5 warm sweeps (20 ms), 10 timed (40 ms)
    expect(timer.rate()).toBe((10 * 100) / 0.04); // 10 sweeps of 100 in 40 ms
  });

  it('ends each phase at a sweep boundary: a phase of 18 ms runs 20 ms, and the rate counts only whole sweeps', () => {
    const clock = { t: 0 };
    const k = fake(4, 100, clock);
    const timer = new KernelTimer(k, 18, 18);
    timer.step(() => clock.t);
    expect(k.swept).toBe(5 + 5);
    expect(timer.rate()).toBe((5 * 100) / 0.02);
  });

  it('in slices: the gaps between slices do not count, the answer is the same, and a slice stops between parts', () => {
    const clock = { t: 0 };
    const k = fake(4, 100, clock);
    const timer = new KernelTimer(k, 20, 40);
    let slices = 0;
    while (!timer.step(() => clock.t, 3)) {
      slices++;
      clock.t += 1000; // the page had its turn for a second
      expect(slices).toBeLessThan(100);
    }
    expect(slices).toBeGreaterThan(10);
    expect(timer.rate()).toBe((10 * 100) / 0.04);
    expect(k.done).toBe(15 * 4);
  });

  it('is done for good once timed: another step does nothing', () => {
    const clock = { t: 0 };
    const k = fake(2, 10, clock);
    const timer = new KernelTimer(k, 4, 4);
    timer.step(() => clock.t);
    const done = k.done;
    expect(timer.step(() => clock.t, 1)).toBe(true);
    expect(k.done).toBe(done);
  });
});

describe('scoring', () => {
  it('is reference over measured: over 1 is slower than the build machine, under 1 faster', () => {
    const ref = { stencilMcellsPerS: 100, copyGBps: 10 };
    const slow = scoreSpeedTest({ stencilMcellsPerS: 25, copyGBps: 2 }, 1_700_000_000_000, ref);
    expect(slow).toEqual({ version: SPEED_TEST_VERSION, stencilMcellsPerS: 25, copyGBps: 2, ratioStencil: 4, ratioCopy: 5, at: 1_700_000_000_000 });
    const fast = scoreSpeedTest({ stencilMcellsPerS: 200, copyGBps: 20 }, 0, ref);
    expect(fast.ratioStencil).toBe(0.5);
    expect(fast.ratioCopy).toBe(0.5);
  });

  it('never gives a ratio of a number that is not there (NaN, not Infinity)', () => {
    const r = scoreSpeedTest({ stencilMcellsPerS: 0, copyGBps: NaN }, 0);
    expect(r.ratioStencil).toBeNaN();
    expect(r.ratioCopy).toBeNaN();
  });

  it('has a reference measured on a machine: positive numbers and a date (the placeholder of C0 was 1 and 1)', () => {
    expect(SPEED_TEST_REFERENCE.stencilMcellsPerS).toBeGreaterThan(1);
    expect(SPEED_TEST_REFERENCE.copyGBps).toBeGreaterThan(0.1);
  });
});

describe('one real run (node has no Worker, so it runs on this thread, in slices)', () => {
  it('takes about two seconds, gives positive numbers and a ratio to the reference', async () => {
    const t0 = performance.now();
    const r = await runSpeedTest();
    const took = performance.now() - t0;
    expect(took).toBeGreaterThan(1800);
    expect(took).toBeLessThan(20_000); // (a loaded machine: the slices wait their turn, the timed part does not)
    expect(r.version).toBe(SPEED_TEST_VERSION);
    expect(r.stencilMcellsPerS).toBeGreaterThan(0);
    expect(r.copyGBps).toBeGreaterThan(0);
    expect(r.ratioStencil).toBeCloseTo(SPEED_TEST_REFERENCE.stencilMcellsPerS / r.stencilMcellsPerS, 9);
    expect(Math.abs(r.at - Date.now())).toBeLessThan(25_000);
  }, 60_000);

  it('stops when aborted, before it starts or half way, with an AbortError and no result', async () => {
    const before = new AbortController();
    before.abort();
    await expect(runSpeedTest({ signal: before.signal })).rejects.toMatchObject({ name: 'AbortError' });
    const mid = new AbortController();
    const t0 = performance.now();
    const run = runSpeedTest({ signal: mid.signal });
    setTimeout(() => mid.abort(), 150);
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
