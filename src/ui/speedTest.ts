/**
 * The speed test (0.7.0, item C; plan 5.3 "Speed test", docs/plans/0.7.0/D-CONTRACT-070-raster.md section 5): about two seconds of two frozen kernels
 * (an air stencil and a memory copy) off the main thread, shown against a reference measured by the same code on the build machine, so phones can be
 * compared before any run. It has no input from the scenario, the engine or the clock beyond its own timing, writes nothing the engine reads, and its
 * result is read by nothing but the debug statistics screen: never by Auto, the tier choice or the pace tracker (plan 4, rules 1 and 2).
 * C0: the types and constants and a stub `runSpeedTest` that rejects; lane C builds the kernels, the worker and the reference.
 */

/** The kernels are frozen: any edit to one bumps this (a unit test pins their checksums). */
export const SPEED_TEST_VERSION = 1;
/** About how long a test takes (ms): each kernel is warmed 0.2 s and timed 0.8 s. */
export const SPEED_TEST_BUDGET_MS = 2000;

export interface SpeedTestResult {
  /** `SPEED_TEST_VERSION` the numbers were made with. */
  version: number;
  /** The air stencil (K1), in million cell updates a second. */
  stencilMcellsPerS: number;
  /** The memory copy (K2), in GB a second. */
  copyGBps: number;
  /** How many times slower than the build machine each kernel is (reference / measured; over 1 is slower). */
  ratioStencil: number;
  ratioCopy: number;
  /** When the test finished (unix ms). */
  at: number;
}

/** The same code measured on the build machine (lane C measures the real numbers: `SPEEDTEST_REF=1 npx vitest run src/ui/speedTest.reference.test.ts`). C0 placeholder. */
export const SPEED_TEST_REFERENCE = { stencilMcellsPerS: 1, copyGBps: 1 };

/** C0 STUB (lane C): runs the test and resolves with the result; `signal` aborts it (the worker is terminated and the promise rejects). Rejects until built. */
export async function runSpeedTest(_o?: { signal?: AbortSignal }): Promise<SpeedTestResult> {
  throw new Error('not built in C0');
}
