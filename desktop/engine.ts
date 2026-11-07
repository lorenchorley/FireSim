/**
 * The engine of one session as the host sees it (contract 0.8.0 J, 3.2): a worker thread running `SimHost`, to which the
 * host hands the client's frames as they came and from which it takes the frames to send. The host never decodes a
 * simulation message (a scenario is tens of MB): the worker does the codec work, so the thread that serves the page and
 * the socket stays free. Behind an interface, so the host's tests can stand in a small engine of their own.
 */
import { Worker } from 'node:worker_threads';

/** Set once at the start of the worker (`workerData`). Tests use `simulation` to switch off the wall-clock coalescing of snapshots. */
export interface EngineWorkerData {
  simulation?: { minSnapshotWallMs?: number; tier?: 'auto' | 'fast' | 'standard' | 'high' };
  chunkMs?: number;
}

export interface EngineEvents {
  /** One frame for the client (a codec frame; ownership passes to the receiver). */
  frame(bytes: Uint8Array): void;
  /** The engine failed (an uncaught error in the worker): it is finished. */
  failed(message: string): void;
  /** The thread has ended, for whatever reason. */
  exited(): void;
}

export interface Engine {
  /** One frame from the client (ownership passes to the engine). */
  receive(bytes: Uint8Array): void;
  /** Hold the simulation back while the link to the client is behind, and let it go again. */
  hold(on: boolean): void;
  /** End it and resolve when the thread is gone. */
  terminate(): Promise<void>;
}

export type EngineFactory = (events: EngineEvents) => Engine;

/** What the main thread sends to a worker besides frames. */
export interface HoldMessage {
  hold: boolean;
}

/** An engine in a worker thread started from `file` (the built `engineWorker.mjs`). */
export function workerEngines(file: string | URL, data: EngineWorkerData = {}): EngineFactory {
  return (events) => {
    const worker = new Worker(file, { workerData: data });
    worker.on('message', (m: unknown) => {
      if (m instanceof Uint8Array) events.frame(m);
    });
    worker.on('error', (e: Error) => events.failed(`The simulation engine stopped: ${e.message.split('\n')[0]}`));
    worker.on('exit', () => events.exited());
    return {
      receive: (bytes) => worker.postMessage(bytes, [bytes.buffer as ArrayBuffer]),
      hold: (on) => worker.postMessage({ hold: on } satisfies HoldMessage),
      terminate: async () => {
        await worker.terminate();
      },
    };
  };
}
