/** T1.5 (c): Web Worker entry of every arm's worker (the code is in worker-core.ts). Built by harness/vite.arms.config.ts into one classic script. */
import { installWorker } from './worker-core';

const scope = self as unknown as { postMessage(m: unknown): void; onmessage: ((e: MessageEvent) => void) | null };
installWorker({
  post: (m) => scope.postMessage(m),
  on: (cb) => {
    scope.onmessage = (e: MessageEvent): void => cb(e.data as Record<string, unknown>);
  },
});
