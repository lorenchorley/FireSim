/**
 * The speed test's worker (0.7.0, item C): `new Worker(new URL('./speedTest.worker.ts', import.meta.url), { type: 'module' })` in speedTest.ts. It waits for one
 * message, runs both frozen kernels to the end on this thread (about two seconds) and answers with the raw numbers, then the page terminates it. It imports
 * only the kernels: nothing of the simulation, the session or the scenario (`speedTest.deps.test.ts`).
 */
import { measureAll, type SpeedRaw } from './speedTestKernels';

const scope = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage(m: SpeedRaw): void };

scope.onmessage = (): void => scope.postMessage(measureAll(() => performance.now()));
