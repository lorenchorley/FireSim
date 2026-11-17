/**
 * T1.5 (c): the page side of the browser arms (bundled by harness/vite.arms.config.ts into `arms-page.js`, driven by harness/run-arms-browser.mjs). `window.runArm(spec)` spawns the
 * Web Workers (`arms-worker.js`, once per call), fetches the fixture from the local server and runs one problem exactly as the Node runner does (`orchestrate.ts`). The page is served
 * with Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp, so `crossOriginIsolated` is true and SharedArrayBuffer exists; the pool arm needs that,
 * the one-worker arm does not.
 */
import { runProblem, type RunSpec, type WorkerHandle } from './orchestrate';

function spawn(): WorkerHandle {
  const w = new Worker('/arms-worker.js');
  const queue: Record<string, unknown>[] = [];
  let waiter: { res: (m: Record<string, unknown>) => void; rej: (e: Error) => void } | null = null;
  let failure: Error | null = null;
  w.onmessage = (e: MessageEvent): void => {
    if (waiter) {
      const f = waiter;
      waiter = null;
      f.res(e.data as Record<string, unknown>);
    } else queue.push(e.data as Record<string, unknown>);
  };
  w.onerror = (e: ErrorEvent): void => {
    failure = new Error(`worker error: ${e.message}`);
    if (waiter) waiter.rej(failure);
  };
  return {
    post: (m) => w.postMessage(m),
    next: () =>
      new Promise((res, rej) => {
        if (failure) return rej(failure);
        const q = queue.shift();
        if (q) return res(q);
        waiter = { res, rej };
      }),
    terminate: () => w.terminate(),
  };
}

export interface PageSpec extends RunSpec { problem: string }

async function runArm(spec: PageSpec): Promise<Record<string, unknown>> {
  const [kind, fixName] = spec.problem.split(':') as ['air' | 'fast', string];
  const base = `/fx/${kind}/fx-${fixName}`;
  const header = await (await fetch(`${base}/header.json`)).text();
  const data = await (await fetch(`${base}/data.bin`)).arrayBuffer();
  const workers: WorkerHandle[] = [];
  for (let i = 0; i < spec.threads; i++) workers.push(spawn());
  try {
    const result = await runProblem(workers, kind, { name: `fx-${fixName}`, header, data }, spec);
    return { result, page: { crossOriginIsolated: self.crossOriginIsolated, hardwareConcurrency: navigator.hardwareConcurrency, userAgent: navigator.userAgent, sharedArrayBuffer: typeof SharedArrayBuffer } };
  } finally {
    for (const w of workers) await w.terminate();
  }
}

(window as unknown as { runArm: typeof runArm; armsPageReady: boolean }).runArm = runArm;
(window as unknown as { armsPageReady: boolean }).armsPageReady = true;
