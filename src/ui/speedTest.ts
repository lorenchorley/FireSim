/**
 * The speed test (0.7.0, item C; plan 5.3 "Speed test", docs/plans/0.7.0/D-CONTRACT-070-raster.md section 5): about two seconds of two frozen kernels
 * (an air stencil and a memory copy, speedTestKernels.ts) off the main thread, shown against a reference measured by the same code on the build machine,
 * so phones can be compared before any run. It has no input from the scenario, the engine or the clock beyond its own timing, writes nothing the engine
 * reads, and its result is read by nothing but the debug statistics screen: never by Auto, the tier choice or the pace tracker (plan 4, rules 1 and 2;
 * `speedTest.deps.test.ts` fences it).
 *
 * The worker is `speedTest.worker.ts` (the same `new Worker(new URL(...), { type: 'module' })` form as the simulation's, so it builds into the APK). Where
 * there is no Worker, or it will not start, the same sweeps run on the main thread in slices of `SLICE_MS`, so a phone on the in-thread engine still has a test.
 */
import { KernelTimer, makeCopyKernel, makeStencilKernel, type SpeedRaw } from './speedTestKernels';

/** The kernels are frozen: any edit to one bumps this (a unit test pins their checksums), and the reference below is measured again. */
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

/**
 * The same code measured on the build machine, in node 22 on one core (the machine this app is built on: a shared 4-core cloud container, so these are
 * the best of several runs, which is what the machine does when nothing else is using it). Measure again with
 * `SPEEDTEST_REF=1 npx vitest run src/ui/speedTest.reference.test.ts` and paste the two numbers and the date; a new kernel version needs new numbers.
 */
export const SPEED_TEST_REFERENCE = { stencilMcellsPerS: 33.2, copyGBps: 3.23 };
/** When `SPEED_TEST_REFERENCE` was measured. */
export const SPEED_TEST_REFERENCE_DATE = '2026-10-30';

/** The main-thread fallback runs the kernels in slices of this many ms (the in-thread engine uses 40 ms chunks, which would show as jank in a test the person is watching). */
const SLICE_MS = 8;

/** The raw numbers set against the reference: a ratio over 1 means this phone is slower than the build machine. */
export function scoreSpeedTest(raw: SpeedRaw, at: number, ref = SPEED_TEST_REFERENCE): SpeedTestResult {
  const ratio = (reference: number, measured: number): number => (measured > 0 && Number.isFinite(measured) ? reference / measured : NaN);
  return {
    version: SPEED_TEST_VERSION,
    stencilMcellsPerS: raw.stencilMcellsPerS,
    copyGBps: raw.copyGBps,
    ratioStencil: ratio(ref.stencilMcellsPerS, raw.stencilMcellsPerS),
    ratioCopy: ratio(ref.copyGBps, raw.copyGBps),
    at,
  };
}

const aborted = (): Error => Object.assign(new Error('The speed test was stopped.'), { name: 'AbortError' });

/** The test in a throwaway worker, or null where there is no Worker or it cannot be made. Terminated as soon as it answers, fails or is aborted. */
function inWorker(signal?: AbortSignal): Promise<SpeedRaw> | null {
  if (typeof Worker === 'undefined') return null;
  let w: Worker;
  try {
    w = new Worker(new URL('./speedTest.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
  return new Promise<SpeedRaw>((resolve, reject) => {
    const stop = (): void => {
      signal?.removeEventListener('abort', onAbort);
      w.terminate();
    };
    const onAbort = (): void => {
      stop();
      reject(aborted());
    };
    w.onmessage = (e: MessageEvent<SpeedRaw>): void => {
      stop();
      resolve(e.data);
    };
    w.onerror = (e: ErrorEvent): void => {
      e.preventDefault?.();
      stop();
      reject(new Error('The speed test worker failed to start.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    w.postMessage('run');
  });
}

/** The same sweeps on this thread: each slice runs for about `SLICE_MS`, then gives the page its turn; only the time spent sweeping is counted. */
async function onThisThread(signal?: AbortSignal): Promise<SpeedRaw> {
  const now = (): number => performance.now();
  const timed = async (make: typeof makeStencilKernel): Promise<number> => {
    const timer = new KernelTimer(make());
    while (!timer.step(now, SLICE_MS)) {
      await new Promise<void>((r) => setTimeout(r, 0));
      if (signal?.aborted) throw aborted();
    }
    return timer.rate();
  };
  const stencil = await timed(makeStencilKernel);
  const copy = await timed(makeCopyKernel);
  return { stencilMcellsPerS: stencil / 1e6, copyGBps: copy / 1e9 };
}

/** Runs the test and resolves with the result; `signal` aborts it (the worker is terminated and the promise rejects with an AbortError). */
export async function runSpeedTest(o: { signal?: AbortSignal } = {}): Promise<SpeedTestResult> {
  if (o.signal?.aborted) throw aborted();
  let raw: SpeedRaw;
  try {
    raw = await (inWorker(o.signal) ?? onThisThread(o.signal));
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    raw = await onThisThread(o.signal); // the worker would not start: the same test, here
  }
  return scoreSpeedTest(raw, Date.now());
}
