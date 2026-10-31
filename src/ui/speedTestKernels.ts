/**
 * The two FROZEN kernels of the speed test and the clock that times them (0.7.0, item C; speedTest.ts has the words around them). Pure: no DOM, no
 * worker, no `Math.random` and no clock but the `now` the caller hands in, so the node tests pin the numbers and the worker, the main-thread fallback and the
 * reference measurement all run the same code.
 *
 *   K1 "air stencil": a 45 x 45 x 20 Float32 grid (the standard tier's air, 40,500 cells), each sweep a 7-point stencil and a trilinear gather at a
 *      displaced point for every interior cell (the two things the air step spends its time on), values and displacements from a fixed LCG seed.
 *   K2 "memory copy": a 16 MiB Float32 array copied into another by a plain loop, eight chunks a sweep.
 *
 * Frozen: `speedTest.kernels.test.ts` pins the checksum of K1 after 3 sweeps and of K2 after 2 sweeps from the fixed inputs. Any edit to a kernel (its
 * arithmetic, its sizes, its seed, the order it visits cells) changes those and must come with a new `SPEED_TEST_VERSION` and a new reference.
 */

/** The fixed seed of every input; the generator is a 32-bit LCG (Numerical Recipes constants), exact in integer arithmetic on every engine. */
export const SPEED_TEST_SEED = 20261030;

export const STENCIL_NX = 45;
export const STENCIL_NY = 45;
export const STENCIL_NZ = 20;
/** The copy's array: 16 MiB of Float32, in this many chunks a sweep (a slice of the main-thread fallback can stop between chunks). */
export const COPY_FLOATS = 4 * 1024 * 1024;
export const COPY_PARTS = 8;

/** One timed kernel. A sweep is `parts` calls of `part(0 .. parts - 1)` in order; `work` is what one sweep does in the kernel's own unit. */
export interface Kernel {
  /** K1: cell updates a sweep (the interior cells). K2: bytes copied a sweep. */
  readonly work: number;
  readonly parts: number;
  part(p: number): void;
  /** Called once after the last part of a sweep (the buffers swap). */
  end(): void;
  /** The state the next sweep would read (the tests compare it with a naive oracle). */
  values(): Float32Array;
  /** FNV-1a over the 32-bit words of `values()`: what the frozen-kernel test pins. */
  checksum(): number;
}

/** A 32-bit linear congruential generator: the next unit-interval float [0, 1) each call. */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function fnv(a: Float32Array): number {
  const w = new Uint32Array(a.buffer, a.byteOffset, a.length);
  let h = 0x811c9dc5;
  for (let i = 0; i < w.length; i++) {
    h ^= w[i]!;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/** K1. The displacements are under one cell, so the gather's eight corners are always inside the grid. */
export function makeStencilKernel(): Kernel {
  const nx = STENCIL_NX;
  const nxy = nx * STENCIL_NY;
  const n = nxy * STENCIL_NZ;
  const rnd = lcg(SPEED_TEST_SEED);
  let a = new Float32Array(n);
  let b = new Float32Array(n);
  const u = new Float32Array(n);
  const v = new Float32Array(n);
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    a[i] = rnd();
    u[i] = 0.9 * (2 * rnd() - 1);
    v[i] = 0.9 * (2 * rnd() - 1);
    w[i] = 0.9 * (2 * rnd() - 1);
  }
  b.set(a); // (the border is never written: both buffers hold the same border for ever)
  return {
    work: (nx - 2) * (STENCIL_NY - 2) * (STENCIL_NZ - 2),
    parts: STENCIL_NZ - 2,
    part(p) {
      const z = p + 1;
      for (let j = 1; j < STENCIL_NY - 1; j++) {
        for (let i = 1; i < nx - 1; i++) {
          const c = z * nxy + j * nx + i;
          const around = a[c - 1]! + a[c + 1]! + a[c - nx]! + a[c + nx]! + a[c - nxy]! + a[c + nxy]!;
          const x = i - u[c]!;
          const y = j - v[c]!;
          const s = z - w[c]!;
          const i0 = x | 0;
          const j0 = y | 0;
          const k0 = s | 0;
          const fx = x - i0;
          const fy = y - j0;
          const fz = s - k0;
          const o = k0 * nxy + j0 * nx + i0;
          const c0 = (a[o]! * (1 - fx) + a[o + 1]! * fx) * (1 - fy) + (a[o + nx]! * (1 - fx) + a[o + nx + 1]! * fx) * fy;
          const c1 = (a[o + nxy]! * (1 - fx) + a[o + nxy + 1]! * fx) * (1 - fy) + (a[o + nxy + nx]! * (1 - fx) + a[o + nxy + nx + 1]! * fx) * fy;
          b[c] = 0.88 * (c0 * (1 - fz) + c1 * fz) + 0.02 * around; // (weights sum to 1: the values stay in [0, 1], and never reach the slow denormal range)
        }
      }
    },
    end() {
      const t = a;
      a = b;
      b = t;
    },
    values: () => a,
    checksum: () => fnv(a),
  };
}

/** K2. Each sweep copies the whole array, swaps the two and adds 1 to the first float, so the state depends on the number of sweeps. */
export function makeCopyKernel(): Kernel {
  const rnd = lcg(SPEED_TEST_SEED ^ 0x5bd1e995);
  let src = new Float32Array(COPY_FLOATS);
  let dst = new Float32Array(COPY_FLOATS);
  for (let i = 0; i < COPY_FLOATS; i++) src[i] = rnd();
  const chunk = COPY_FLOATS / COPY_PARTS;
  return {
    work: COPY_FLOATS * 4,
    parts: COPY_PARTS,
    part(p) {
      const to = (p + 1) * chunk;
      for (let i = p * chunk; i < to; i++) dst[i] = src[i]!;
    },
    end() {
      const t = src;
      src = dst;
      dst = t;
      src[0] = src[0]! + 1;
    },
    values: () => src,
    checksum: () => fnv(src),
  };
}

/** Run `sweeps` whole sweeps (no clock): what the checksum test and a warm-up call use. */
export function sweeps(k: Kernel, count: number): void {
  for (let s = 0; s < count; s++) {
    for (let p = 0; p < k.parts; p++) k.part(p);
    k.end();
  }
}

/** How long a kernel is warmed and then timed (ms of its own running time: the gaps of a sliced run do not count). */
export const WARM_MS = 200;
export const TIME_MS = 800;

/**
 * Times one kernel: warm-up sweeps for `warmMs`, then timed sweeps for `timeMs`, each phase ended at a sweep boundary (so only whole sweeps are counted).
 * `step` can be called again after it returns false: the main-thread fallback runs it in slices and `now` is read only to measure the running time inside
 * each slice, so the time spent waiting between slices is not in the score.
 */
export class KernelTimer {
  private phase: 'warm' | 'timed' | 'done' = 'warm';
  private part = 0;
  private base = 0; // ms of the current phase run before this call
  private count = 0; // whole timed sweeps
  private timedMs = 0;

  constructor(
    private readonly kernel: Kernel,
    private readonly warmMs = WARM_MS,
    private readonly timeMs = TIME_MS,
  ) {}

  /** Runs until the kernel is timed (true) or, when `sliceMs` is given, until that long has passed in this call, checked between parts (false). */
  step(now: () => number, sliceMs = Infinity): boolean {
    const sliceStart = now();
    let t0 = sliceStart; // when the current phase last started running, in this call
    let before = this.base; // the phase's ms from earlier calls
    while (this.phase !== 'done') {
      this.kernel.part(this.part);
      const t = now();
      const phaseMs = before + (t - t0);
      if (++this.part === this.kernel.parts) {
        this.part = 0;
        this.kernel.end();
        if (this.phase === 'timed') this.count++;
        if (phaseMs >= (this.phase === 'warm' ? this.warmMs : this.timeMs)) {
          if (this.phase === 'timed') {
            this.timedMs = phaseMs;
            this.phase = 'done';
            return true;
          }
          this.phase = 'timed';
          t0 = t;
          before = 0;
        }
      }
      if (t - sliceStart >= sliceMs) {
        this.base = before + (t - t0);
        return false;
      }
    }
    return true;
  }

  /** The kernel's work a second (work units: cell updates, or bytes), or 0 until it is timed. */
  rate(): number {
    return this.phase === 'done' && this.timedMs > 0 ? (this.count * this.kernel.work) / (this.timedMs / 1000) : 0;
  }
}

/** What the test measures, before it is set against the reference. */
export interface SpeedRaw {
  stencilMcellsPerS: number;
  copyGBps: number;
}

/** K1 then K2 to the end in one go (the worker's job, and the reference measurement's). `now` is `performance.now`. */
export function measureAll(now: () => number): SpeedRaw {
  const k1 = new KernelTimer(makeStencilKernel());
  k1.step(now);
  const k2 = new KernelTimer(makeCopyKernel());
  k2.step(now);
  return { stencilMcellsPerS: k1.rate() / 1e6, copyGBps: k2.rate() / 1e9 };
}
