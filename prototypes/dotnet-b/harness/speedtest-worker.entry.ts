/**
 * Round 0's worker (plan T0.6b): the two FROZEN speed-test kernels of the app (`src/ui/speedTestKernels.ts`, imported unchanged) in a classic worker, run the way the
 * app's own speed test runs them (`src/ui/speedTest.worker.ts`: one message, `measureAll(performance.now)`, which warms each kernel 200 ms and times it 800 ms at sweep
 * boundaries), followed by the two checksum runs of `src/ui/speedTest.test.ts` (K1 after 3 sweeps, K2 after 2 sweeps, from fresh kernels, so they cannot disturb the timing).
 * Built to `Fs.TestApp/Resources/Raw/wwwroot/speedtest.worker.js` by `harness/build-speedtest.sh`.
 *
 * Message in:  anything (the app's worker also answers any message).   Message out: the object below, or { error } if something throws.
 */
import { makeCopyKernel, makeStencilKernel, measureAll, sweeps, TIME_MS, WARM_MS } from '../../../src/ui/speedTestKernels';

declare const __KERNELS_SHA256__: string;

const hex8 = (x: number): string => '0x' + (x >>> 0).toString(16).padStart(8, '0');

const scope = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(m: unknown): void;
};

scope.onmessage = (): void => {
  try {
    const t0 = performance.now();
    const raw = measureAll(() => performance.now());
    const t1 = performance.now();
    const k1 = makeStencilKernel();
    sweeps(k1, 3);
    const k2 = makeCopyKernel();
    sweeps(k2, 2);
    const t2 = performance.now();
    scope.postMessage({
      stencilMcellsPerS: raw.stencilMcellsPerS,
      copyGBps: raw.copyGBps,
      stencilAfter3: hex8(k1.checksum()),
      copyAfter2: hex8(k2.checksum()),
      measureMs: t1 - t0,
      verifyMs: t2 - t1,
      warmMs: WARM_MS,
      timeMs: TIME_MS,
      kernelsSha256: __KERNELS_SHA256__,
    });
  } catch (e) {
    scope.postMessage({ error: String(e && (e as Error).stack ? (e as Error).stack : e).slice(0, 1000) });
  }
};
