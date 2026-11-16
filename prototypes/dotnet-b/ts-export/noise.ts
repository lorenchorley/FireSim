/**
 * The noise wrapper of the exporter (stage 3, T3.1a; used only by `export.ts --noise SEED`, never by the app).
 *
 * It stands in for "a different libm": a C# solver calls the .NET runtime's maths (glibc on Linux, bionic on a phone, another V8 in another
 * browser), which agrees with V8 12.4's (Node 22) to the last bit on most but not all inputs. This replaces the transcendental functions of
 * `Math` for the duration of a run with wrappers that return V8's value, or, on a fraction of the calls, the neighbouring double(s).
 *
 * What is implemented (the numbers are measured, see reports/3-scenarios.md; V8 12.4.254.21 against glibc 2.39, 200,000 inputs per function):
 * - Functions: exp log pow sin cos tan atan atan2 acos asin sinh cbrt log2 log10 hypot. Never sqrt, abs, floor, ceil, round, min, max, fround,
 *   imul, sign or the arithmetic operators (exact in every engine). `x ** y` with a non-constant exponent is the same pow; the noise build
 *   of run.mjs lowers it to `Math.pow` so that it is covered too (pow-lowering-plugin.mjs).
 * - On every call, one uniform draw u from a private mulberry32 (the `Rng` of src/core/rng.ts, a separate instance seeded from the noise seed
 *   and a fixed mix constant, so it shares no state with, and is not the sequence of, any stream of the solver). If u >= the function's
 *   mismatch rate the exact V8 result is returned. Otherwise the result moves by k ulp of its own magnitude, up or down with equal
 *   probability (a second draw), where k is 1 for every function whose largest measured difference is 1 ulp, and for cbrt (1, 2 or 3 ulp),
 *   sinh and log10 (1 or 2) and hypot (1 or 2) k is drawn with the measured proportions.
 * - Exact cases are left alone, because every libm returns them exactly: a result that is 0, NaN or infinite; a zero argument of a one-argument
 *   function; log2, log10, cbrt and hypot results that are whole numbers; asin/acos of +-1; pow with exponent 0, 1, 2, -1 or 0.5, base 0 or 1,
 *   or two whole numbers with a non-negative exponent; atan2 with a zero argument or equal magnitudes; hypot with a zero argument. The draws
 *   are made before this test, so it changes which calls are nudged and not the stream.
 * - The call order of the solver is deterministic, so a noisy run is deterministic too: the same (scenario, solver seed, noise seed) gives the
 *   same bits in every process. Different noise seeds give different draws.
 * Not modelled: a real libm is a function of its input (the same argument always gives the same neighbour); this noise is per call, so two
 * calls with the same argument can differ. It is therefore noisier in that respect, and exact on the arguments that the guards recognise.
 */
import { Rng } from '../../../src/core/rng';

/** Measured mismatch of V8 12.4 against glibc 2.39: the fraction of random inputs that differ, and the ulp sizes seen (count by size). */
export interface NoiseSpec {
  rate: number;
  /** Cumulative probability of a difference of 1, 2, 3 ... ulp, given that there is one. */
  sizes: readonly number[];
}

const cum = (counts: readonly number[]): number[] => {
  const t = counts.reduce((a, b) => a + b, 0);
  let c = 0;
  return counts.map((n) => (c += n / t));
};

/** Measured by prototypes/dotnet-b (scratchpad T3.1a libm-gen.mjs + libm-cmp.py); the counts are of 200,000 inputs per function. */
export const NOISE_SPECS: Readonly<Record<string, NoiseSpec>> = {
  exp: { rate: 0.0962, sizes: [1] },
  log: { rate: 0.0087, sizes: [1] },
  pow: { rate: 0.0985, sizes: [1] },
  sin: { rate: 0.033, sizes: [1] },
  cos: { rate: 0.0333, sizes: [1] },
  tan: { rate: 0.0386, sizes: [1] },
  atan: { rate: 0.0145, sizes: [1] },
  atan2: { rate: 0.1768, sizes: [1] },
  acos: { rate: 0.0765, sizes: [1] },
  asin: { rate: 0.0602, sizes: [1] },
  sinh: { rate: 0.001, sizes: cum([199, 11]) },
  cbrt: { rate: 0.4771, sizes: cum([85851, 9521, 56]) },
  log2: { rate: 0.0028, sizes: [1] },
  log10: { rate: 0.0124, sizes: cum([2286, 193]) },
  hypot: { rate: 0.3552, sizes: cum([70638, 399]) },
};

export const NOISE_FUNCTIONS = Object.keys(NOISE_SPECS);

export interface NoiseHandle {
  /** Puts the original `Math` functions back. */
  restore(): void;
  /** Calls seen, calls whose result was moved, and calls where a nudge was drawn but the argument was an exact case, per function. */
  report(): { seed: number; scale: number; calls: Record<string, number>; nudged: Record<string, number>; exactSkipped: Record<string, number> };
}

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer); // little endian: [0] low word, [1] high word

/** x moved by k ulp (k may be negative) in magnitude; x must be finite and non-zero. Returns x itself if the move would leave the finite range. */
function stepUlp(x: number, k: number): number {
  f64[0] = x;
  let lo = u32[0]! + k;
  let hi = u32[1]!;
  if (lo > 0xffffffff) {
    lo -= 0x100000000;
    hi += 1;
  } else if (lo < 0) {
    lo += 0x100000000;
    hi -= 1;
  }
  u32[0] = lo;
  u32[1] = hi;
  const y = f64[0]!;
  return Number.isFinite(y) ? y : x;
}

export function installNoise(seed: number, scale = 1): NoiseHandle {
  // A private stream: the seed is mixed so that noise seed 12 is not the sequence of a solver stream seeded 12.
  const rng = new Rng((Math.imul(seed >>> 0, 0x9e3779b1) ^ 0x6a09e667) >>> 0);
  const orig: Record<string, (...a: number[]) => number> = {};
  const stats: Record<string, { calls: number; nudged: number; skipped: number }> = {};
  const M = Math as unknown as Record<string, (...a: number[]) => number>;

  /** Which of the exact cases of this function applies to these arguments (true: leave the result alone). */
  const exact: Record<string, (v: number, a: number, b: number) => boolean> = {
    exp: (_v, a) => a === 0,
    log: (_v, a) => a === 1,
    sin: (_v, a) => a === 0,
    cos: (_v, a) => a === 0,
    tan: (_v, a) => a === 0,
    atan: (_v, a) => a === 0,
    acos: (_v, a) => a === 0 || a === 1 || a === -1,
    asin: (_v, a) => a === 0 || a === 1 || a === -1,
    sinh: (_v, a) => a === 0,
    cbrt: (v, a) => a === 0 || Number.isInteger(v),
    log2: (v) => Number.isInteger(v),
    log10: (v) => Number.isInteger(v),
    pow: (v, a, b) => b === 0 || b === 1 || b === 2 || b === -1 || b === 0.5 || a === 0 || a === 1 || (Number.isInteger(a) && Number.isInteger(b) && b >= 0 && Math.abs(v) < 9007199254740992),
    atan2: (_v, a, b) => a === 0 || b === 0 || Math.abs(a) === Math.abs(b),
    hypot: (v, a, b) => a === 0 || b === 0 || Number.isInteger(v),
  };

  const sizeOf = (sizes: readonly number[]): number => {
    if (sizes.length === 1) return 1;
    const u = rng.next();
    for (let i = 0; i < sizes.length; i++) if (u < sizes[i]!) return i + 1;
    return sizes.length;
  };

  for (const name of NOISE_FUNCTIONS) {
    const f = M[name]!;
    orig[name] = f;
    const st = (stats[name] = { calls: 0, nudged: 0, skipped: 0 });
    const { rate: r0, sizes } = NOISE_SPECS[name]!;
    const rate = r0 * scale;
    const isExact = exact[name]!;
    // One-, two- and three-argument forms are written out: these run millions of times per run.
    const move = (v: number, a: number, b: number): number => {
      if (v === 0 || !Number.isFinite(v)) return v;
      if (isExact(v, a, b)) {
        st.skipped++;
        return v;
      }
      const k = sizeOf(sizes);
      st.nudged++;
      return stepUlp(v, rng.next() < 0.5 ? -k : k);
    };
    if (name === 'pow' || name === 'atan2') {
      M[name] = function (a: number, b: number): number {
        st.calls++;
        const v = f(a, b);
        return rng.next() >= rate ? v : move(v, a, b);
      };
    } else if (name === 'hypot') {
      M[name] = function (a?: number, b?: number, c?: number): number {
        st.calls++;
        const n = arguments.length;
        const v = n === 2 ? f(a!, b!) : n === 3 ? f(a!, b!, c!) : f(...(Array.prototype.slice.call(arguments) as number[]));
        if (rng.next() >= rate) return v;
        // Three arguments (17 call sites): the guards of the two-argument form, with a zero argument anywhere counting as one.
        if (n === 3) return move(v, a === 0 || b === 0 || c === 0 ? 0 : 1, 1);
        return move(v, a ?? 1, b ?? 1);
      };
    } else {
      M[name] = function (a: number): number {
        st.calls++;
        const v = f(a);
        return rng.next() >= rate ? v : move(v, a, 0);
      };
    }
  }

  return {
    restore(): void {
      for (const name of NOISE_FUNCTIONS) M[name] = orig[name]!;
    },
    report: () => ({
      seed,
      scale,
      calls: Object.fromEntries(NOISE_FUNCTIONS.map((n) => [n, stats[n]!.calls])),
      nudged: Object.fromEntries(NOISE_FUNCTIONS.map((n) => [n, stats[n]!.nudged])),
      exactSkipped: Object.fromEntries(NOISE_FUNCTIONS.map((n) => [n, stats[n]!.skipped])),
    }),
  };
}
