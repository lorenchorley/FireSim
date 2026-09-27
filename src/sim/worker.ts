/**
 * Web Worker entry of the simulation (spec §12.1, §2.3): `new Worker(new URL('./worker.ts', import.meta.url),
 * { type: 'module' })`. All state lives in the {@link SimHost}; runs in chunks of ≤ 40 ms and yields with a
 * MessageChannel post-to-self so pause / explain / edits are handled between chunks. Snapshot arrays are transferred.
 */
import { SimHost } from './host';
import type { FromWorker, ToWorker } from './protocol';

interface WorkerScope {
  postMessage(msg: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
  addEventListener(type: 'error' | 'unhandledrejection', cb: (e: Event) => void): void;
}

const scope = self as unknown as WorkerScope;

/** Yield to the worker's message queue, then run `fn` (a MessageChannel message is a macrotask, like setTimeout(0) without the clamp). */
const channel = new MessageChannel();
const pending: (() => void)[] = [];
channel.port1.onmessage = (): void => {
  const fn = pending.shift();
  if (fn) fn();
};
const schedule = (fn: () => void): void => {
  pending.push(fn);
  channel.port2.postMessage(0);
};

const host = new SimHost({ post: (msg, transfer) => scope.postMessage(msg, transfer ?? []) }, { schedule, transfer: true });

scope.onmessage = (e: MessageEvent<ToWorker>): void => host.handle(e.data);
scope.addEventListener('error', (e: Event) => {
  const m = (e as ErrorEvent).message ?? 'worker error';
  scope.postMessage({ type: 'error', message: m });
});
scope.addEventListener('unhandledrejection', (e: Event) => {
  const r = (e as PromiseRejectionEvent).reason;
  scope.postMessage({ type: 'error', message: r instanceof Error ? r.message : String(r) });
});
