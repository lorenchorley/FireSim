/**
 * T1.6a: the two FROZEN kernels of the app (`src/ui/speedTestKernels.ts`, imported unchanged) exposed as the global `FsKernels`, so a timing driver can build a kernel and run
 * its sweeps itself (round 0's `speedtest.worker.js` only offers the app's own `measureAll`). Same source file, same Vite target and settings as that bundle.
 * Built by `vite.kernels.config.ts` (see the top of `Fs.Bench/wasm/speed-run.mjs`); the output goes to the scratch folder, nothing is committed.
 */
import { makeCopyKernel, makeStencilKernel, sweeps } from '../../../src/ui/speedTestKernels';

export { makeCopyKernel, makeStencilKernel, sweeps };
